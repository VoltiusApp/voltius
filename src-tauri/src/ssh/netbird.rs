use crate::commands::http::client_builder;
use crate::error::{AppError, ErrorCode};
use reqwest::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;
use tauri::ipc::Channel;
use url::Url;
use zeroize::Zeroizing;

pub struct Credential {
    pub fingerprint: String,
    pub token: Zeroizing<String>,
}

pub(super) async fn authenticate<H: russh::client::Handler>(
    handle: &mut russh::client::Handle<H>,
    username: &str,
    token: Zeroizing<String>,
) -> Result<(), AppError> {
    let reply = tokio::time::timeout(
        Duration::from_secs(30),
        handle.authenticate_password(username, token.as_str()),
    )
    .await
    .map_err(|_| "NetBird SSH authentication timed out.")?
    .map_err(|_| "NetBird SSH authentication failed.")?;
    if !reply.success() {
        return Err("NetBird rejected this identity for the requested SSH user.".into());
    }
    Ok(())
}

const MAX_WAIT: Duration = Duration::from_secs(600);
const EXPIRED: &str = "NetBird verification expired. Start sign-in again.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    issuer: String,
    client_id: String,
    scope: String,
    audience: String,
    token_type: TokenType,
    pub fingerprint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum TokenType {
    AccessToken,
    IdToken,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    verification_uri: String,
    user_code: String,
}

#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    device_authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Deserialize)]
struct DeviceGrant {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: Option<String>,
    id_token: Option<String>,
    error: Option<String>,
}

impl TokenReply {
    fn poll(
        self,
        success: bool,
        kind: &TokenType,
        interval: &mut u64,
    ) -> Result<Option<Zeroizing<String>>, AppError> {
        match (success, self.error.as_deref()) {
            (true, None) => {
                let token = match kind {
                    TokenType::AccessToken => self.access_token,
                    TokenType::IdToken => self.id_token,
                };
                token
                    .filter(|t| !t.is_empty())
                    .map(|t| Some(Zeroizing::new(t)))
                    .ok_or_else(|| "The provider did not return the configured token type.".into())
            }
            (false, Some("authorization_pending")) => Ok(None),
            (false, Some("slow_down")) => {
                *interval = interval.saturating_add(5);
                Ok(None)
            }
            (false, Some("expired_token")) => Err(EXPIRED.into()),
            _ => Err("NetBird sign-in was denied by the identity provider.".into()),
        }
    }
}

pub(super) fn required() -> AppError {
    AppError::coded(
        ErrorCode::SshNetbirdSsoRequired,
        "This peer requires NetBird SSH sign-in.",
    )
}

fn https(value: &str) -> Result<Url, AppError> {
    let url = Url::parse(value).map_err(|_| "Invalid NetBird SSO URL.")?;
    if url.scheme() != "https"
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("NetBird SSO requires an HTTPS URL without credentials or a fragment.".into());
    }
    Ok(url)
}

// Never forward a device code to another origin or follow a token-endpoint redirect.
fn endpoint(issuer: &Url, value: &str) -> Result<Url, AppError> {
    let url = https(value)?;
    if url.origin() != issuer.origin() {
        return Err("The SSO endpoint must use the configured issuer's HTTPS origin.".into());
    }
    Ok(url)
}

async fn read_json<T: DeserializeOwned>(mut response: Response) -> Result<T, AppError> {
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Incomplete SSO response.")?
    {
        if body.len() + chunk.len() > 256 * 1024 {
            return Err("SSO response too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "Invalid SSO response.".into())
}

async fn post(client: &Client, url: &Url, fields: &[(&str, &str)]) -> Result<Response, AppError> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields.iter().copied())
        .finish();
    client
        .post(url.clone())
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|_| "Could not reach the configured SSO provider.".into())
}

impl Profile {
    pub async fn authorize(
        &self,
        progress: &Channel<Option<Challenge>>,
    ) -> Result<Zeroizing<String>, AppError> {
        let client = client_builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| "Could not initialize the SSO client.")?;
        let token = self
            .authorize_with(&client, |challenge| {
                progress
                    .send(Some(challenge))
                    .map_err(|_| AppError::from("The connection screen is no longer available."))
            })
            .await?;
        progress
            .send(None)
            .map_err(|_| "The connection screen is no longer available.")?;
        Ok(token)
    }

    async fn authorize_with(
        &self,
        client: &Client,
        show: impl FnOnce(Challenge) -> Result<(), AppError>,
    ) -> Result<Zeroizing<String>, AppError> {
        let issuer = https(&self.issuer)?;
        if issuer.query().is_some()
            || self.client_id.trim().is_empty()
            || !matches!(
                self.fingerprint.parse::<ssh_key::Fingerprint>(),
                Ok(ssh_key::Fingerprint::Sha256(_))
            )
        {
            return Err(
                "Enter an issuer, public client ID and trusted SSH SHA256 fingerprint.".into(),
            );
        }
        let metadata = format!(
            "{}/.well-known/openid-configuration",
            self.issuer.trim_end_matches('/')
        );
        let response = client
            .get(metadata)
            .send()
            .await
            .map_err(|_| "Could not reach the OIDC issuer.")?;
        if !response.status().is_success() {
            return Err("OIDC discovery failed.".into());
        }
        let discovery: Discovery = read_json(response).await?;
        if discovery.issuer != self.issuer {
            return Err("OIDC discovery returned a different issuer.".into());
        }
        let device = endpoint(&issuer, &discovery.device_authorization_endpoint)?;
        let token = endpoint(&issuer, &discovery.token_endpoint)?;
        let mut fields = vec![("client_id", self.client_id.as_str())];
        if !self.scope.is_empty() {
            fields.push(("scope", &self.scope));
        }
        if !self.audience.is_empty() {
            fields.push(("audience", &self.audience));
        }
        let response = post(client, &device, &fields).await?;
        if !response.status().is_success() {
            return Err("The provider declined device sign-in for this client.".into());
        }
        let grant: DeviceGrant = read_json(response).await?;
        let verification_uri = https(&grant.verification_uri)?;
        if grant.device_code.is_empty()
            || grant.user_code.trim().is_empty()
            || grant.expires_in == 0
        {
            return Err("The provider returned an invalid device grant.".into());
        }
        show(Challenge {
            verification_uri: verification_uri.into(),
            user_code: grant.user_code,
        })?;
        let limit = MAX_WAIT.min(Duration::from_secs(grant.expires_in));
        let device_code = Zeroizing::new(grant.device_code);
        let fields = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code.as_str()),
            ("client_id", self.client_id.as_str()),
        ];
        let mut interval = grant.interval.unwrap_or(5).max(1);
        tokio::time::timeout(limit, async {
            loop {
                if interval >= limit.as_secs() {
                    tokio::time::sleep(limit).await;
                    return Err(EXPIRED.into());
                }
                tokio::time::sleep(Duration::from_secs(interval)).await;
                let response = post(client, &token, &fields).await?;
                let status = response.status();
                if !status.is_success() && status != reqwest::StatusCode::BAD_REQUEST {
                    return Err("The provider rejected the token request.".into());
                }
                let reply: TokenReply = read_json(response).await?;
                if let Some(token) =
                    reply.poll(status.is_success(), &self.token_type, &mut interval)?
                {
                    return Ok(token);
                }
            }
        })
        .await
        .map_err(|_| AppError::from(EXPIRED))?
    }
}

/// NetBird advertises JWT authentication in its SSH identification string.
/// This is a hint for the UI, never proof of a peer's identity.
pub(super) fn requires_jwt(identification: &[u8]) -> bool {
    let mut words = identification.split(|b| b.is_ascii_whitespace());
    words
        .next()
        .is_some_and(|software| software.starts_with(b"SSH-2.0-NetBird-SSH-Server-"))
        && words.any(|word| word == b"NetBird-JWT-Required")
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;

    #[test]
    fn rejects_insecure_or_foreign_endpoints() {
        let issuer = https("https://id.example/tenant").unwrap();
        assert!(endpoint(&issuer, "https://id.example/tenant/token").is_ok());
        for uri in [
            "http://id.example/token",
            "file:///tmp/token",
            "https://id.example.attacker.test/token",
            "https://id.example@attacker.test/token",
            "https://user@id.example/token",
            "https://id.example:4433/token",
            "https://id.example/token#fragment",
        ] {
            assert!(endpoint(&issuer, uri).is_err(), "{uri}");
        }
    }

    #[test]
    fn pending_and_slow_down_never_return_a_token() {
        let mut interval = 5;
        for (error, delay) in [
            ("authorization_pending", 5),
            ("slow_down", 10),
            ("slow_down", 15),
        ] {
            let reply: TokenReply =
                serde_json::from_value(json!({"error":error, "access_token":"ignored"})).unwrap();
            assert!(reply
                .poll(false, &TokenType::AccessToken, &mut interval)
                .unwrap()
                .is_none());
            assert_eq!(interval, delay);
        }
        for error in ["access_denied", "expired_token", "invalid_grant"] {
            let reply: TokenReply = serde_json::from_value(json!({"error":error})).unwrap();
            assert!(reply
                .poll(false, &TokenType::AccessToken, &mut interval)
                .is_err());
        }
    }

    #[tokio::test]
    async fn obtains_the_configured_token_from_a_device_flow_provider() {
        use crate::tls::pin_tests::{ca_signed, test_acceptor};
        use http_body_util::{BodyExt, Full};
        use hyper::server::conn::http1;
        use hyper::service::service_fn;
        use std::collections::HashMap;
        use tokio::net::TcpListener;

        let (leaf, ca) = ca_signed();
        let tls = test_acceptor(&leaf);
        let client = client_builder()
            .no_proxy()
            .tls_certs_only([reqwest::Certificate::from_der(ca.as_ref()).unwrap()])
            .build()
            .unwrap();
        let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let issuer = format!("https://{}", server.local_addr().unwrap());
        let origin = issuer.clone();
        let provider = tokio::spawn(async move {
            let (socket, _) = server.accept().await.unwrap();
            let connection = tls.accept(socket).await.unwrap();
            let handler = service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                let origin = origin.clone();
                async move {
                    let path = request.uri().path().to_owned();
                    let bytes = request.into_body().collect().await.unwrap().to_bytes();
                    let form: HashMap<_, _> =
                        url::form_urlencoded::parse(&bytes).into_owned().collect();
                    let response = match path.as_str() {
                        "/.well-known/openid-configuration" => json!({"issuer":origin,
                            "device_authorization_endpoint":format!("{origin}/device"), "token_endpoint":format!("{origin}/token")}),
                        "/device" => {
                            assert_eq!(form["client_id"], "public");
                            assert_eq!(form["scope"], "openid");
                            assert_eq!(form["audience"], "netbird");
                            json!({"device_code":"private-test-code", "user_code":"ABCD", "verification_uri":format!("{origin}/verify"), "interval":1, "expires_in":60})
                        }
                        "/token" => {
                            assert_eq!(
                                form["grant_type"],
                                "urn:ietf:params:oauth:grant-type:device_code"
                            );
                            assert_eq!(form["device_code"], "private-test-code");
                            json!({"access_token":"other-token", "id_token":"test-id-token"})
                        }
                        _ => panic!("unexpected request"),
                    };
                    Ok::<_, std::convert::Infallible>(hyper::Response::new(Full::new(
                        bytes::Bytes::from(response.to_string()),
                    )))
                }
            });
            http1::Builder::new()
                .serve_connection(hyper_util::rt::TokioIo::new(connection), handler)
                .await
                .unwrap();
        });
        let profile = Profile {
            issuer: issuer.clone(),
            client_id: "public".into(),
            scope: "openid".into(),
            audience: "netbird".into(),
            token_type: TokenType::IdToken,
            fingerprint: ssh_key::Fingerprint::Sha256([7; 32]).to_string(),
        };
        let token = profile
            .authorize_with(&client, |challenge| {
                assert_eq!(
                    serde_json::to_value(&challenge).unwrap(),
                    json!({"verificationUri": format!("{issuer}/verify"), "userCode": "ABCD"})
                );
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(token.as_str(), "test-id-token");
        drop(client);
        provider.await.unwrap();
    }

    #[test]
    fn only_the_netbird_server_with_the_jwt_marker_requests_sso() {
        assert!(requires_jwt(
            b"SSH-2.0-NetBird-SSH-Server-0.81.5 NetBird-JWT-Required"
        ));
        for id in [
            &b"SSH-2.0-OpenSSH_9.9"[..],
            b"SSH-2.0-OpenSSH_9.9 NetBird-JWT-Required",
            b"SSH-2.0-NetBird-SSH-Proxy-0.81.5 NetBird-JWT-Required",
            b"SSH-2.0-NetBird-SSH-Server-0.81.5",
            b"SSH-2.0-NetBird-SSH-Server-0.81.5 xNetBird-JWT-Required",
        ] {
            assert!(!requires_jwt(id));
        }
    }
}
