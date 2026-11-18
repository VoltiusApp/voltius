use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{post, send, AuthError, DeviceInfo};

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct SignedInDevice {
    pub id: String,
    pub device_name: Option<String>,
    pub platform: Option<String>,
    pub client: Option<String>,
    pub created_at: String,
    pub last_seen_at: String,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Tokens {
    #[serde(rename = "jwt_token")]
    pub jwt: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

fn url(server: &str, path: &str) -> String {
    format!("{server}/v1/auth/{path}")
}

pub async fn refresh(
    client: &reqwest::Client,
    server: &str,
    refresh_token: &str,
    device: &DeviceInfo,
) -> Result<Tokens, AuthError> {
    let body = json!({ "refresh_token": refresh_token, "device": device });
    send(post(client, url(server, "refresh"), body))
        .await?
        .ok_body()
}

pub async fn list(
    client: &reqwest::Client,
    server: &str,
    jwt: &str,
) -> Result<Vec<SignedInDevice>, AuthError> {
    #[derive(Deserialize)]
    struct Listed {
        sessions: Vec<SignedInDevice>,
    }
    let answer = send(client.get(url(server, "sessions")).bearer_auth(jwt)).await?;
    Ok(answer.ok_body::<Listed>()?.sessions)
}

pub async fn revoke(
    client: &reqwest::Client,
    server: &str,
    jwt: &str,
    id: &str,
) -> Result<(), AuthError> {
    let path = format!("sessions/{}", utf8_percent_encode(id, NON_ALPHANUMERIC));
    send(client.delete(url(server, &path)).bearer_auth(jwt))
        .await?
        .ok()
}

pub async fn revoke_others(
    client: &reqwest::Client,
    server: &str,
    jwt: &str,
) -> Result<Tokens, AuthError> {
    let request = client
        .post(url(server, "sessions/revoke-others"))
        .bearer_auth(jwt);
    let tokens: Tokens = send(request).await?.ok_body()?;
    if tokens.refresh_token.is_none() {
        return Err(AuthError::BadAnswer);
    }
    Ok(tokens)
}

pub async fn revoke_all(
    client: &reqwest::Client,
    server: &str,
    jwt: &str,
) -> Result<(), AuthError> {
    let request = client
        .post(url(server, "sessions/revoke-all"))
        .bearer_auth(jwt);
    send(request).await?.ok()
}

#[cfg(test)]
mod tests {
    use super::super::tests::{dev, device_json, fake, http, request_body};
    use super::*;

    const LISTED: &str = r#"{"sessions":[
        {"id":"s-1","device_name":"box","platform":"linux","client":"app",
         "created_at":"2026-11-01T09:00:00Z","last_seen_at":"2026-11-13T10:00:00Z","current":true},
        {"id":"s-2","device_name":null,"platform":null,"client":null,
         "created_at":"2026-10-01T09:00:00Z","last_seen_at":"2026-10-02T10:00:00Z","current":false}]}"#;

    fn bearer(raw: &str) -> bool {
        raw.to_ascii_lowercase()
            .contains("authorization: bearer jwt-1\r\n")
    }

    #[tokio::test]
    async fn refresh_sends_the_device_and_reads_an_optional_new_refresh_token() {
        let (server, seen) = fake(200, r#"{"jwt_token":"j"}"#).await;
        let tokens = refresh(&http(), &server, "r-1", &dev()).await.unwrap();
        assert_eq!(
            tokens,
            Tokens {
                jwt: "j".into(),
                refresh_token: None
            }
        );
        let raw = seen.await.unwrap();
        assert!(raw.starts_with("POST /v1/auth/refresh "));
        assert_eq!(
            request_body(&raw),
            json!({"refresh_token":"r-1","device":device_json()})
        );

        let (server, _) = fake(200, r#"{"jwt_token":"j","refresh_token":"r-2"}"#).await;
        let tokens = refresh(&http(), &server, "r-1", &dev()).await.unwrap();
        assert_eq!(tokens.refresh_token.as_deref(), Some("r-2"));
    }

    #[tokio::test]
    async fn refresh_401_is_status_401() {
        let (server, _) = fake(401, "").await;
        assert_eq!(
            refresh(&http(), &server, "r", &dev()).await,
            Err(AuthError::Status {
                status: 401,
                code: None
            })
        );
    }

    #[tokio::test]
    async fn list_reads_sessions_with_bearer() {
        let (server, seen) = fake(200, LISTED).await;
        let sessions = list(&http(), &server, "jwt-1").await.unwrap();
        assert_eq!(sessions.len(), 2);
        assert!(sessions[0].current);
        assert_eq!(sessions[0].device_name.as_deref(), Some("box"));
        assert_eq!(sessions[1].device_name, None);
        let raw = seen.await.unwrap();
        assert!(raw.starts_with("GET /v1/auth/sessions "));
        assert!(bearer(&raw), "{raw}");
    }

    #[tokio::test]
    async fn list_404_is_an_older_server() {
        let (server, _) = fake(404, "").await;
        assert!(matches!(
            list(&http(), &server, "jwt-1").await,
            Err(AuthError::Status { status: 404, .. })
        ));
    }

    #[tokio::test]
    async fn revoke_deletes_the_encoded_id() {
        let (server, seen) = fake(204, "").await;
        revoke(&http(), &server, "jwt-1", "a/b").await.unwrap();
        let raw = seen.await.unwrap();
        assert!(raw.starts_with("DELETE /v1/auth/sessions/a%2Fb "), "{raw}");
        assert!(bearer(&raw));
    }

    #[tokio::test]
    async fn revoke_others_needs_both_tokens() {
        let (server, seen) = fake(200, r#"{"jwt_token":"j","refresh_token":"r"}"#).await;
        let tokens = revoke_others(&http(), &server, "jwt-1").await.unwrap();
        assert_eq!(tokens.refresh_token.as_deref(), Some("r"));
        let raw = seen.await.unwrap();
        assert!(raw.starts_with("POST /v1/auth/sessions/revoke-others "));
        assert!(bearer(&raw));

        let (server, _) = fake(200, r#"{"jwt_token":"j"}"#).await;
        assert_eq!(
            revoke_others(&http(), &server, "jwt-1").await,
            Err(AuthError::BadAnswer)
        );
    }

    #[tokio::test]
    async fn revoke_all_posts() {
        let (server, seen) = fake(204, "").await;
        revoke_all(&http(), &server, "jwt-1").await.unwrap();
        assert!(seen
            .await
            .unwrap()
            .starts_with("POST /v1/auth/sessions/revoke-all "));
    }
}
