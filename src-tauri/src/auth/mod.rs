pub mod keys;

use std::time::Duration;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{ser::SerializeMap, Deserialize, Serialize, Serializer};
use serde_json::{json, Value};

use crate::commands::http::{client_builder, with_causes};

// Mirrors the app's http_request path: a 10 s connect cap inside a 30 s overall one.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Session {
    pub jwt: String,
    pub refresh_token: String,
    pub wrapped_user_secrets: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoginStep {
    Signed(Session),
    SecondFactor {
        pending_token: String,
        methods: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Proof {
    Code(String),
    RecoveryCode(String),
    PasskeyCode(String),
}

impl Proof {
    fn field(&self) -> (&'static str, &str) {
        match self {
            Proof::Code(c) => ("code", c.trim()),
            Proof::RecoveryCode(c) => ("recovery_code", c.trim()),
            Proof::PasskeyCode(c) => ("passkey_code", c),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum AuthError {
    Status { status: u16, code: Option<String> },
    Network(String),
    BadAnswer,
}

impl Serialize for AuthError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(None)?;
        match self {
            AuthError::Status { status, code } => {
                map.serialize_entry("kind", "status")?;
                map.serialize_entry("status", status)?;
                if let Some(code) = code {
                    map.serialize_entry("code", code)?;
                }
            }
            AuthError::Network(message) => {
                map.serialize_entry("kind", "network")?;
                map.serialize_entry("message", message)?;
            }
            AuthError::BadAnswer => map.serialize_entry("kind", "badAnswer")?,
        }
        map.end()
    }
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::Status {
                status,
                code: Some(code),
            } => write!(f, "server refused ({status} {code})"),
            AuthError::Status { status, code: None } => write!(f, "server refused ({status})"),
            AuthError::Network(message) => write!(f, "network error: {message}"),
            AuthError::BadAnswer => write!(f, "unexpected answer from the server"),
        }
    }
}

#[derive(Deserialize)]
struct LoginData {
    jwt_token: String,
    refresh_token: String,
    #[serde(default)]
    wrapped_user_secrets: Option<String>,
}

impl From<LoginData> for Session {
    fn from(d: LoginData) -> Self {
        Session {
            jwt: d.jwt_token,
            refresh_token: d.refresh_token,
            wrapped_user_secrets: d.wrapped_user_secrets,
        }
    }
}

struct Answer {
    status: u16,
    body: Option<Value>,
}

impl Answer {
    fn error_code(&self) -> Option<String> {
        self.body
            .as_ref()?
            .get("error")?
            .as_str()
            .map(str::to_owned)
    }

    fn refused(&self) -> AuthError {
        AuthError::Status {
            status: self.status,
            code: self.error_code(),
        }
    }

    fn ok_body<T: serde::de::DeserializeOwned>(self) -> Result<T, AuthError> {
        if !(200..300).contains(&self.status) {
            return Err(self.refused());
        }
        self.body
            .and_then(|b| serde_json::from_value(b).ok())
            .ok_or(AuthError::BadAnswer)
    }
}

fn network(e: reqwest::Error) -> AuthError {
    AuthError::Network(with_causes(&e.without_url()))
}

async fn send(request: reqwest::RequestBuilder) -> Result<Answer, AuthError> {
    let response = request
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(network)?;
    let status = response.status().as_u16();
    let bytes = response.bytes().await.map_err(network)?;
    Ok(Answer {
        status,
        body: serde_json::from_slice(&bytes).ok(),
    })
}

fn post(client: &reqwest::Client, url: String, body: Value) -> reqwest::RequestBuilder {
    client
        .post(url)
        .header("content-type", "application/json")
        .body(body.to_string())
}

pub async fn challenge(
    client: &reqwest::Client,
    server: &str,
    email: &str,
) -> Result<String, AuthError> {
    #[derive(Deserialize)]
    struct Challenge {
        account_id: String,
    }
    let email = utf8_percent_encode(email, NON_ALPHANUMERIC);
    let answer = send(client.get(format!("{server}/v1/auth/challenge?email={email}"))).await?;
    Ok(answer.ok_body::<Challenge>()?.account_id)
}

pub async fn login(
    client: &reqwest::Client,
    server: &str,
    account_id: &str,
    auth_key: &str,
) -> Result<LoginStep, AuthError> {
    let body = json!({ "account_id": account_id, "auth_key": auth_key });
    let answer = send(post(client, format!("{server}/v1/auth/login"), body)).await?;
    if answer.status == 428 && answer.error_code().as_deref() == Some("TWO_FACTOR_REQUIRED") {
        let body = answer.body.as_ref();
        let pending_token = body
            .and_then(|b| b.get("pending_token"))
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty());
        if let Some(pending_token) = pending_token {
            let methods = body
                .and_then(|b| b.get("methods"))
                .and_then(|m| serde_json::from_value::<Vec<String>>(m.clone()).ok())
                .unwrap_or_else(|| vec!["totp".to_owned()]);
            return Ok(LoginStep::SecondFactor {
                pending_token: pending_token.to_owned(),
                methods,
            });
        }
    }
    Ok(LoginStep::Signed(answer.ok_body::<LoginData>()?.into()))
}

async fn second_step(
    client: &reqwest::Client,
    server: &str,
    path: &str,
    pending_token: &str,
    (field, value): (&str, Value),
) -> Result<Answer, AuthError> {
    let mut body = serde_json::Map::new();
    body.insert("pending_token".into(), json!(pending_token));
    body.insert(field.into(), value);
    let body = Value::Object(body);
    send(post(
        client,
        format!("{server}/v1/auth/login/2fa{path}"),
        body,
    ))
    .await
}

pub async fn second_factor(
    client: &reqwest::Client,
    server: &str,
    pending_token: &str,
    proof: &Proof,
) -> Result<Session, AuthError> {
    let (field, value) = proof.field();
    let answer = second_step(client, server, "", pending_token, (field, json!(value))).await?;
    Ok(answer.ok_body::<LoginData>()?.into())
}

pub async fn passkey_start(
    client: &reqwest::Client,
    server: &str,
    pending_token: &str,
    return_to: Value,
) -> Result<String, AuthError> {
    #[derive(Deserialize)]
    struct Started {
        url: String,
    }
    let answer = second_step(
        client,
        server,
        "/passkey",
        pending_token,
        ("return_to", return_to),
    )
    .await?;
    Ok(answer.ok_body::<Started>()?.url)
}

pub(crate) fn client() -> Result<reqwest::Client, AuthError> {
    client_builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(network)
}

#[tauri::command]
pub async fn auth_challenge(server: String, email: String) -> Result<String, AuthError> {
    challenge(&client()?, &server, &email).await
}

#[tauri::command]
pub async fn auth_login(
    server: String,
    account_id: String,
    auth_key: String,
) -> Result<LoginStep, AuthError> {
    login(&client()?, &server, &account_id, &auth_key).await
}

#[tauri::command]
pub async fn auth_second_factor(
    server: String,
    pending_token: String,
    proof: Proof,
) -> Result<Session, AuthError> {
    second_factor(&client()?, &server, &pending_token, &proof).await
}

#[tauri::command]
pub async fn auth_passkey_start(
    server: String,
    pending_token: String,
    return_to: Value,
) -> Result<String, AuthError> {
    passkey_start(&client()?, &server, &pending_token, return_to).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn fake(status: u16, body: &str) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let body = body.to_owned();
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut seen = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = sock.read(&mut buf).await.unwrap();
                seen.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&seen).into_owned();
                if let Some((head, rest)) = text.split_once("\r\n\r\n") {
                    let len = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse().unwrap())
                        })
                        .unwrap_or(0usize);
                    if rest.len() >= len || n == 0 {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let reply = format!(
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            sock.write_all(reply.as_bytes()).await.unwrap();
            let _ = sock.shutdown().await;
            String::from_utf8_lossy(&seen).into_owned()
        });
        (url, handle)
    }

    fn http() -> reqwest::Client {
        client().unwrap()
    }

    fn request_body(raw: &str) -> Value {
        serde_json::from_str(raw.split_once("\r\n\r\n").unwrap().1).unwrap()
    }

    const SIGNED: &str = r#"{"jwt_token":"j","refresh_token":"r","wrapped_user_secrets":"w"}"#;

    #[tokio::test]
    async fn challenge_returns_account_id() {
        let (url, seen) = fake(200, r#"{"account_id":"acc-1"}"#).await;
        assert_eq!(challenge(&http(), &url, "a+b@x.io").await.unwrap(), "acc-1");
        assert!(seen
            .await
            .unwrap()
            .starts_with("GET /v1/auth/challenge?email=a%2Bb%40x%2Eio "));
    }

    #[tokio::test]
    async fn challenge_404_is_status_404() {
        let (url, _) = fake(404, r#"{"error":"NOT_FOUND"}"#).await;
        assert_eq!(
            challenge(&http(), &url, "a@b.c").await,
            Err(AuthError::Status {
                status: 404,
                code: Some("NOT_FOUND".into())
            })
        );
    }

    #[tokio::test]
    async fn login_signed_with_and_without_wrapped_secrets() {
        let (url, seen) = fake(200, SIGNED).await;
        let step = login(&http(), &url, "acc", "key").await.unwrap();
        assert_eq!(
            step,
            LoginStep::Signed(Session {
                jwt: "j".into(),
                refresh_token: "r".into(),
                wrapped_user_secrets: Some("w".into())
            })
        );
        let raw = seen.await.unwrap();
        assert!(raw.starts_with("POST /v1/auth/login "));
        assert_eq!(
            request_body(&raw),
            json!({"account_id":"acc","auth_key":"key"})
        );

        let (url, _) = fake(200, r#"{"jwt_token":"j","refresh_token":"r"}"#).await;
        let step = login(&http(), &url, "acc", "key").await.unwrap();
        assert_eq!(
            step,
            LoginStep::Signed(Session {
                jwt: "j".into(),
                refresh_token: "r".into(),
                wrapped_user_secrets: None
            })
        );
    }

    #[tokio::test]
    async fn login_428_two_factor_required_gives_pending_token_and_methods() {
        let (url, _) = fake(
            428,
            r#"{"error":"TWO_FACTOR_REQUIRED","pending_token":"p","methods":["totp","passkey"]}"#,
        )
        .await;
        assert_eq!(
            login(&http(), &url, "a", "k").await.unwrap(),
            LoginStep::SecondFactor {
                pending_token: "p".into(),
                methods: vec!["totp".into(), "passkey".into()]
            }
        );
        let (url, _) = fake(
            428,
            r#"{"error":"TWO_FACTOR_REQUIRED","pending_token":"p"}"#,
        )
        .await;
        assert_eq!(
            login(&http(), &url, "a", "k").await.unwrap(),
            LoginStep::SecondFactor {
                pending_token: "p".into(),
                methods: vec!["totp".into()]
            }
        );
        let (url, _) = fake(428, r#"{"error":"TWO_FACTOR_REQUIRED"}"#).await;
        assert_eq!(
            login(&http(), &url, "a", "k").await,
            Err(AuthError::Status {
                status: 428,
                code: Some("TWO_FACTOR_REQUIRED".into())
            })
        );
    }

    #[tokio::test]
    async fn second_factor_sends_code_recovery_or_passkey_field_trimmed() {
        let cases = [
            (
                Proof::Code(" 123456 ".into()),
                json!({"pending_token":"p","code":"123456"}),
            ),
            (
                Proof::RecoveryCode("  abcd-efgh\n".into()),
                json!({"pending_token":"p","recovery_code":"abcd-efgh"}),
            ),
            (
                Proof::PasskeyCode(" raw ".into()),
                json!({"pending_token":"p","passkey_code":" raw "}),
            ),
        ];
        for (proof, expected) in cases {
            let (url, seen) = fake(200, SIGNED).await;
            let session = second_factor(&http(), &url, "p", &proof).await.unwrap();
            assert_eq!(session.jwt, "j");
            let raw = seen.await.unwrap();
            assert!(raw.starts_with("POST /v1/auth/login/2fa "));
            assert_eq!(request_body(&raw), expected);
        }
    }

    #[tokio::test]
    async fn second_factor_error_keeps_server_code() {
        let (url, _) = fake(401, r#"{"error":"INVALID_TWO_FACTOR_CODE"}"#).await;
        assert_eq!(
            second_factor(&http(), &url, "p", &Proof::Code("1".into())).await,
            Err(AuthError::Status {
                status: 401,
                code: Some("INVALID_TWO_FACTOR_CODE".into())
            })
        );
    }

    #[tokio::test]
    async fn second_factor_bare_401_has_no_code() {
        let (url, _) = fake(401, "").await;
        assert_eq!(
            second_factor(&http(), &url, "p", &Proof::Code("1".into())).await,
            Err(AuthError::Status {
                status: 401,
                code: None
            })
        );
    }

    #[tokio::test]
    async fn login_428_non_array_methods_falls_back_to_totp() {
        let (url, _) = fake(
            428,
            r#"{"error":"TWO_FACTOR_REQUIRED","pending_token":"p","methods":"totp"}"#,
        )
        .await;
        assert_eq!(
            login(&http(), &url, "a", "k").await.unwrap(),
            LoginStep::SecondFactor {
                pending_token: "p".into(),
                methods: vec!["totp".into()]
            }
        );
    }

    #[tokio::test]
    async fn passkey_start_posts_return_to_and_returns_url() {
        let (url, seen) = fake(200, r#"{"url":"https://x/y"}"#).await;
        let started = passkey_start(&http(), &url, "p", json!({"port": 1}))
            .await
            .unwrap();
        assert_eq!(started, "https://x/y");
        let raw = seen.await.unwrap();
        assert!(raw.starts_with("POST /v1/auth/login/2fa/passkey "));
        assert_eq!(
            request_body(&raw),
            json!({"pending_token":"p","return_to":{"port":1}})
        );
    }

    #[tokio::test]
    async fn rate_limit_is_status_429() {
        let (url, _) = fake(429, "slow down").await;
        assert_eq!(
            login(&http(), &url, "a", "k").await,
            Err(AuthError::Status {
                status: 429,
                code: None
            })
        );
    }

    #[tokio::test]
    async fn network_failure_is_network() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        match challenge(&http(), &url, "secret@b.c").await {
            Err(AuthError::Network(message)) => {
                assert!(!message.contains("secret"), "{message}");
                assert!(!message.contains("127.0.0.1"), "{message}");
            }
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn malformed_200_is_bad_answer() {
        let (url, _) = fake(200, "<html>").await;
        assert_eq!(
            login(&http(), &url, "a", "k").await,
            Err(AuthError::BadAnswer)
        );
    }

    #[test]
    fn errors_serialize_to_kind_status_code_message() {
        let status = serde_json::to_value(AuthError::Status {
            status: 401,
            code: Some("X".into()),
        })
        .unwrap();
        assert_eq!(status, json!({"kind":"status","status":401,"code":"X"}));
        let net = serde_json::to_value(AuthError::Network("down".into())).unwrap();
        assert_eq!(net, json!({"kind":"network","message":"down"}));
        assert_eq!(
            serde_json::to_value(AuthError::BadAnswer).unwrap(),
            json!({"kind":"badAnswer"})
        );
    }

    #[test]
    fn login_steps_serialize_to_the_shape_the_app_reads() {
        let signed = LoginStep::Signed(Session {
            jwt: "J".into(),
            refresh_token: "R".into(),
            wrapped_user_secrets: None,
        });
        assert_eq!(
            serde_json::to_value(signed).unwrap(),
            json!({"kind":"signed","jwt":"J","refresh_token":"R","wrapped_user_secrets":null})
        );
        let second = LoginStep::SecondFactor {
            pending_token: "P".into(),
            methods: vec!["totp".into()],
        };
        assert_eq!(
            serde_json::to_value(second).unwrap(),
            json!({"kind":"secondFactor","pending_token":"P","methods":["totp"]})
        );
    }

    #[test]
    fn proofs_deserialize_from_the_app_payloads() {
        let p = |v| serde_json::from_value::<Proof>(v).unwrap();
        assert_eq!(p(json!({"code":"1"})), Proof::Code("1".into()));
        assert_eq!(
            p(json!({"recoveryCode":"2"})),
            Proof::RecoveryCode("2".into())
        );
        assert_eq!(
            p(json!({"passkeyCode":"3"})),
            Proof::PasskeyCode("3".into())
        );
    }
}
