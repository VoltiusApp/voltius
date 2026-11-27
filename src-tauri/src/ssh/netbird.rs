use crate::commands::http::client_builder;
use crate::error::{AppError, ErrorCode};
use crate::storage::config::{NetbirdSsh, NetbirdTokenType};
use reqwest::{Client, Response, StatusCode};
use russh::keys::ssh_key::Fingerprint;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::time::Instant;
use url::Url;
use zeroize::Zeroizing;

const MAX_WAIT: Duration = Duration::from_secs(600);
const SCREEN_GONE: &str = "The connection screen is no longer available.";

fn coded(code: ErrorCode, message: &str) -> AppError {
    AppError::coded(code, message)
}

pub(super) fn required() -> AppError {
    coded(
        ErrorCode::SshNetbirdSsoRequired,
        "This peer requires NetBird SSH sign-in.",
    )
}

fn settings_invalid() -> AppError {
    coded(
        ErrorCode::SshNetbirdSettingsInvalid,
        "The NetBird SSH settings need an HTTPS issuer without credentials, query or fragment, \
         a public client ID and a SHA256 host key fingerprint.",
    )
}

fn provider_unreachable() -> AppError {
    coded(
        ErrorCode::SshNetbirdProviderUnreachable,
        "Could not reach the configured identity provider.",
    )
}

fn provider_error() -> AppError {
    coded(
        ErrorCode::SshNetbirdProviderError,
        "The identity provider returned an unexpected response.",
    )
}

fn expired() -> AppError {
    coded(
        ErrorCode::SshNetbirdExpired,
        "NetBird verification expired. Start sign-in again.",
    )
}

fn auth_failed() -> AppError {
    coded(
        ErrorCode::SshNetbirdAuthFailed,
        "NetBird SSH authentication failed or timed out.",
    )
}

pub(super) fn pin_mismatch(actual: &Fingerprint) -> AppError {
    AppError::coded(
        ErrorCode::SshNetbirdPinMismatch,
        format!(
            "The peer's SSH host key {actual} does not match the NetBird fingerprint configured \
             for this host."
        ),
    )
    .with_param("fingerprint", actual)
}

pub(super) fn pin(settings: &NetbirdSsh) -> Result<Fingerprint, AppError> {
    match settings
        .fingerprint
        .trim()
        .trim_end_matches('=')
        .parse::<Fingerprint>()
    {
        Ok(pin @ Fingerprint::Sha256(_)) => Ok(pin),
        _ => Err(settings_invalid()),
    }
}

pub(super) async fn authenticate<H: russh::client::Handler>(
    handle: &mut russh::client::Handle<H>,
    username: &str,
    token: &str,
) -> Result<(), AppError> {
    let reply = tokio::time::timeout(
        Duration::from_secs(30),
        handle.authenticate_password(username, token),
    )
    .await
    .map_err(|_| auth_failed())?
    .map_err(|_| auth_failed())?;
    if !reply.success() {
        return Err(coded(
            ErrorCode::SshNetbirdRejected,
            "NetBird rejected this identity for the requested SSH user.",
        ));
    }
    Ok(())
}

/// The host's NetBird settings and where its device code is shown.
pub struct Login {
    pub settings: NetbirdSsh,
    pub progress: Channel<Option<Challenge>>,
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
        kind: NetbirdTokenType,
        interval: &mut u64,
    ) -> Result<Option<Zeroizing<String>>, AppError> {
        match (success, self.error.as_deref()) {
            (_, Some("authorization_pending")) => Ok(None),
            (_, Some("slow_down")) => {
                *interval = interval.saturating_add(5);
                Ok(None)
            }
            (_, Some("expired_token")) => Err(expired()),
            (_, Some(_)) => Err(coded(
                ErrorCode::SshNetbirdDenied,
                "NetBird sign-in was denied by the identity provider.",
            )),
            (true, None) => {
                let token = match kind {
                    NetbirdTokenType::AccessToken => self.access_token,
                    NetbirdTokenType::IdToken => self.id_token,
                };
                token
                    .filter(|t| !t.is_empty())
                    .map(|t| Some(Zeroizing::new(t)))
                    .ok_or_else(provider_error)
            }
            (false, None) => Err(provider_error()),
        }
    }
}

/// Every 4xx carries an OAuth error (Auth0 answers `authorization_pending` with 403).
fn token_status(status: StatusCode) -> Result<bool, AppError> {
    if status.is_success() || status.is_client_error() {
        Ok(status.is_success())
    } else {
        Err(provider_error())
    }
}

fn https(value: &str) -> Result<Url, AppError> {
    let url = Url::parse(value).map_err(|_| settings_invalid())?;
    if url.scheme() != "https"
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(settings_invalid());
    }
    Ok(url)
}

// Never forward a device code to another origin or follow a token-endpoint redirect.
fn endpoint(issuer: &Url, value: &str) -> Result<Url, AppError> {
    let url = https(value)?;
    if url.origin() != issuer.origin() {
        return Err(coded(
            ErrorCode::SshNetbirdEndpointOrigin,
            "The identity provider's device or token endpoint is not on the issuer's HTTPS origin.",
        ));
    }
    Ok(url)
}

async fn read_json<T: DeserializeOwned>(mut response: Response) -> Result<T, AppError> {
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = response.chunk().await.map_err(|_| provider_error())? {
        if body.len() + chunk.len() > 256 * 1024 {
            return Err(provider_error());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| provider_error())
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
        .map_err(|_| provider_unreachable())
}

impl Login {
    pub async fn sign_in(&self) -> Result<Zeroizing<String>, AppError> {
        let client = client_builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| provider_unreachable())?;
        let token = device_flow(&self.settings, &client, |challenge| {
            self.progress
                .send(Some(challenge))
                .map_err(|_| AppError::from(SCREEN_GONE))
        })
        .await?;
        self.progress
            .send(None)
            .map_err(|_| AppError::from(SCREEN_GONE))?;
        Ok(token)
    }
}

async fn device_flow(
    settings: &NetbirdSsh,
    client: &Client,
    show: impl FnOnce(Challenge) -> Result<(), AppError>,
) -> Result<Zeroizing<String>, AppError> {
    let issuer = https(&settings.issuer)?;
    if issuer.query().is_some() || settings.client_id.trim().is_empty() {
        return Err(settings_invalid());
    }
    let metadata = format!(
        "{}/.well-known/openid-configuration",
        settings.issuer.trim_end_matches('/')
    );
    let response = client
        .get(metadata)
        .send()
        .await
        .map_err(|_| provider_unreachable())?;
    if !response.status().is_success() {
        return Err(provider_error());
    }
    let discovery: Discovery = read_json(response).await?;
    if discovery.issuer != settings.issuer {
        return Err(settings_invalid());
    }
    let device = endpoint(&issuer, &discovery.device_authorization_endpoint)?;
    let token = endpoint(&issuer, &discovery.token_endpoint)?;
    let mut fields = vec![("client_id", settings.client_id.as_str())];
    if !settings.scope.is_empty() {
        fields.push(("scope", &settings.scope));
    }
    if !settings.audience.is_empty() {
        fields.push(("audience", &settings.audience));
    }
    let response = post(client, &device, &fields).await?;
    if !response.status().is_success() {
        return Err(coded(
            ErrorCode::SshNetbirdDeviceFlowDeclined,
            "The identity provider declined device sign-in for this client ID.",
        ));
    }
    let grant: DeviceGrant = read_json(response).await?;
    let verification_uri = https(&grant.verification_uri).map_err(|_| provider_error())?;
    if grant.device_code.is_empty() || grant.user_code.trim().is_empty() || grant.expires_in == 0 {
        return Err(provider_error());
    }
    show(Challenge {
        verification_uri: verification_uri.into(),
        user_code: grant.user_code,
    })?;
    let deadline = Instant::now() + MAX_WAIT.min(Duration::from_secs(grant.expires_in));
    let device_code = Zeroizing::new(grant.device_code);
    let fields = [
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ("device_code", device_code.as_str()),
        ("client_id", settings.client_id.as_str()),
    ];
    let mut interval = grant.interval.unwrap_or(5).max(1);
    tokio::time::timeout_at(deadline, async {
        loop {
            let wait = Duration::from_secs(interval);
            if Instant::now() + wait >= deadline {
                return Err(expired());
            }
            tokio::time::sleep(wait).await;
            let response = post(client, &token, &fields).await?;
            let success = token_status(response.status())?;
            let reply: TokenReply = read_json(response).await?;
            if let Some(token) = reply.poll(success, settings.token_type, &mut interval)? {
                return Ok(token);
            }
        }
    })
    .await
    .map_err(|_| expired())?
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
        assert_eq!(
            endpoint(&issuer, "https://oauth2.example/token")
                .unwrap_err()
                .code(),
            Some(ErrorCode::SshNetbirdEndpointOrigin)
        );
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
                .poll(false, NetbirdTokenType::AccessToken, &mut interval)
                .unwrap()
                .is_none());
            assert_eq!(interval, delay);
        }
        for (error, code) in [
            ("access_denied", ErrorCode::SshNetbirdDenied),
            ("expired_token", ErrorCode::SshNetbirdExpired),
            ("invalid_grant", ErrorCode::SshNetbirdDenied),
        ] {
            let reply: TokenReply = serde_json::from_value(json!({"error":error})).unwrap();
            let err = reply
                .poll(false, NetbirdTokenType::AccessToken, &mut interval)
                .unwrap_err();
            assert_eq!(err.code(), Some(code));
        }
    }

    #[test]
    fn every_client_error_is_read_as_an_oauth_reply() {
        for status in [
            StatusCode::BAD_REQUEST,
            StatusCode::FORBIDDEN,
            StatusCode::UNAUTHORIZED,
        ] {
            assert!(!token_status(status).unwrap());
        }
        assert!(token_status(StatusCode::OK).unwrap());
        for status in [StatusCode::INTERNAL_SERVER_ERROR, StatusCode::FOUND] {
            assert_eq!(
                token_status(status).unwrap_err().code(),
                Some(ErrorCode::SshNetbirdProviderError)
            );
        }
    }

    #[test]
    fn the_pin_must_be_a_sha256_fingerprint() {
        let settings = |fingerprint: &str| NetbirdSsh {
            issuer: "https://id.example".into(),
            client_id: "public".into(),
            scope: String::new(),
            audience: String::new(),
            token_type: NetbirdTokenType::AccessToken,
            fingerprint: fingerprint.into(),
        };
        let pin = Fingerprint::Sha256([7; 32]);
        for value in [pin.to_string(), format!(" {pin}= ")] {
            assert_eq!(super::pin(&settings(&value)).unwrap(), pin);
        }
        for value in ["", "SHA256:short", "MD5:aa:bb"] {
            assert!(super::pin(&settings(value)).is_err(), "{value}");
        }
    }

    #[tokio::test]
    async fn obtains_the_configured_token_from_a_device_flow_provider() {
        use crate::tls::pin_tests::{ca_signed, test_acceptor};
        use http_body_util::{BodyExt, Full};
        use hyper::server::conn::http1;
        use hyper::service::service_fn;
        use std::collections::HashMap;
        use std::sync::atomic::{AtomicU32, Ordering};
        use std::sync::Arc;
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
        let polls = Arc::new(AtomicU32::new(0));
        let provider = tokio::spawn(async move {
            let (socket, _) = server.accept().await.unwrap();
            let connection = tls.accept(socket).await.unwrap();
            let handler = service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                let origin = origin.clone();
                let polls = Arc::clone(&polls);
                async move {
                    let path = request.uri().path().to_owned();
                    let bytes = request.into_body().collect().await.unwrap().to_bytes();
                    let form: HashMap<_, _> =
                        url::form_urlencoded::parse(&bytes).into_owned().collect();
                    let (status, response) = match path.as_str() {
                        "/.well-known/openid-configuration" => (
                            200,
                            json!({"issuer":origin,
                            "device_authorization_endpoint":format!("{origin}/device"), "token_endpoint":format!("{origin}/token")}),
                        ),
                        "/device" => {
                            assert_eq!(form["client_id"], "public");
                            assert_eq!(form["scope"], "openid");
                            assert_eq!(form["audience"], "netbird");
                            (
                                200,
                                json!({"device_code":"private-test-code", "user_code":"ABCD", "verification_uri":format!("{origin}/verify"), "interval":1, "expires_in":60}),
                            )
                        }
                        "/token" => {
                            assert_eq!(
                                form["grant_type"],
                                "urn:ietf:params:oauth:grant-type:device_code"
                            );
                            assert_eq!(form["device_code"], "private-test-code");
                            if polls.fetch_add(1, Ordering::Relaxed) == 0 {
                                (403, json!({"error":"authorization_pending"}))
                            } else {
                                (
                                    200,
                                    json!({"access_token":"other-token", "id_token":"test-id-token"}),
                                )
                            }
                        }
                        _ => panic!("unexpected request"),
                    };
                    let mut reply =
                        hyper::Response::new(Full::new(bytes::Bytes::from(response.to_string())));
                    *reply.status_mut() = hyper::StatusCode::from_u16(status).unwrap();
                    Ok::<_, std::convert::Infallible>(reply)
                }
            });
            http1::Builder::new()
                .serve_connection(hyper_util::rt::TokioIo::new(connection), handler)
                .await
                .unwrap();
        });
        let settings = NetbirdSsh {
            issuer: issuer.clone(),
            client_id: "public".into(),
            scope: "openid".into(),
            audience: "netbird".into(),
            token_type: NetbirdTokenType::IdToken,
            fingerprint: Fingerprint::Sha256([7; 32]).to_string(),
        };
        let token = device_flow(&settings, &client, |challenge| {
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
