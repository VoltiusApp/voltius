use crate::storage::config::{ProxyAuth, ProxyConfig, ProxyType};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::{rustls::ClientConfig as RustlsClientConfig, TlsConnector};
use url::Url;
use winreg::enums::*;
use winreg::RegKey;

/// Detect system proxy settings.
pub fn detect_system_proxy() -> Option<ProxyConfig> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(internet_settings) =
            hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        {
            let proxy_enable: u32 = internet_settings.get_value("ProxyEnable").unwrap_or(0);
            if proxy_enable == 1 {
                if let Ok(proxy_server) = internet_settings.get_value::<String, _>("ProxyServer") {
                    // Parse "host:port" or "http=host:port;https=host:port;..."
                    for part in proxy_server.split(';') {
                        if part.starts_with("http=") || part.starts_with("https=") {
                            let addr = part.split('=').nth(1)?;
                            let (host, port_str) = addr.split_once(':')?;
                            if let Ok(port) = port_str.parse::<u16>() {
                                return Some(ProxyConfig::http(host.to_string(), port, None));
                            }
                        } else if part.contains(':') && !part.contains('=') {
                            let (host, port_str) = part.split_once(':')?;
                            if let Ok(port) = port_str.parse::<u16>() {
                                return Some(ProxyConfig::http(host.to_string(), port, None));
                            }
                        }
                    }
                }
            }
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("scutil").arg("--proxy").output().ok()?;
        let output = String::from_utf8_lossy(&output.stdout);
        for line in output.lines() {
            if line.contains("HTTPProxy") || line.contains("HTTPSProxy") {
                // macOS proxy format is complex, simplified for now
            }
        }
        None
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Check standard environment variables
        if let Ok(proxy) = std::env::var("HTTPS_PROXY").or_else(|_| std::env::var("https_proxy")) {
            if let Ok(url) = Url::parse(&proxy) {
                let host = url.host_str()?.to_string();
                let port = url.port().unwrap_or(8080);
                let auth = if url.username().is_empty() {
                    None
                } else {
                    Some(ProxyAuth {
                        username: url.username().to_string(),
                        password: url.password().unwrap_or("").to_string(),
                    })
                };
                return Some(ProxyConfig::http(host, port, auth));
            }
        }
        if let Ok(proxy) = std::env::var("HTTP_PROXY").or_else(|_| std::env::var("http_proxy")) {
            if let Ok(url) = Url::parse(&proxy) {
                let host = url.host_str()?.to_string();
                let port = url.port().unwrap_or(8080);
                let auth = if url.username().is_empty() {
                    None
                } else {
                    Some(ProxyAuth {
                        username: url.username().to_string(),
                        password: url.password().unwrap_or("").to_string(),
                    })
                };
                return Some(ProxyConfig::http(host, port, auth));
            }
        }
        if let Ok(proxy) = std::env::var("ALL_PROXY").or_else(|_| std::env::var("all_proxy")) {
            if let Ok(url) = Url::parse(&proxy) {
                let host = url.host_str()?.to_string();
                let port = url.port().unwrap_or(1080);
                let auth = if url.username().is_empty() {
                    None
                } else {
                    Some(ProxyAuth {
                        username: url.username().to_string(),
                        password: url.password().unwrap_or("").to_string(),
                    })
                };
                if url.scheme() == "socks5" || url.scheme() == "socks5h" {
                    return Some(ProxyConfig::socks5(host, port, auth));
                } else {
                    return Some(ProxyConfig::http(host, port, auth));
                }
            }
        }
        None
    }
}
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::rustls::{pki_types::ServerName, ClientConfig, RootCertStore};
use tokio_rustls::TlsConnector;
use url::Url;

#[derive(Debug, Error)]
pub enum ProxyError {
    #[error("Invalid proxy URL: {0}")]
    InvalidUrl(String),
    #[error("Proxy connection failed: {0}")]
    ConnectionFailed(String),
    #[error("Proxy authentication failed: {0}")]
    AuthFailed(String),
    #[error("Proxy handshake failed: {0}")]
    HandshakeFailed(String),
    #[error("Unsupported proxy type: {0}")]
    UnsupportedType(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("TLS error: {0}")]
    Tls(#[from] tokio_rustls::rustls::Error),
    #[error("URL parse error: {0}")]
    UrlParse(#[from] url::ParseError),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedProxy {
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub bypass_hosts: Vec<String>,
    pub tls_config: Option<ProxyTlsConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyTlsConfig {
    pub verify_certificates: bool,
    pub ca_cert: Option<String>,
}

impl Default for ProxyTlsConfig {
    fn default() -> Self {
        Self {
            verify_certificates: true,
            ca_cert: None,
        }
    }
}

pub async fn resolve_proxy_for_host(
    host: &str,
    port: u16,
    global_proxy: Option<&ProxyConfig>,
    per_host_overrides: &HashMap<String, ProxyConfig>,
) -> Option<ResolvedProxy> {
    let host_key = format!("{}:{}", host, port);

    if let Some(override_proxy) = per_host_overrides.get(&host_key) {
        return Some(resolve_proxy_config(override_proxy).await);
    }

    if let Some(override_proxy) = per_host_overrides.get(host) {
        return Some(resolve_proxy_config(override_proxy).await);
    }

    global_proxy.as_ref().map(|p| resolve_proxy_config(p).await)
}

async fn resolve_proxy_config(config: &ProxyConfig) -> ResolvedProxy {
    match &config.proxy_type {
        ProxyType::None => ResolvedProxy {
            proxy_type: ProxyType::None,
            host: String::new(),
            port: 0,
            username: None,
            password: None,
            bypass_hosts: config.bypass_hosts.clone(),
            tls_config: None,
        },
        ProxyType::System => {
            if let Some(system) = resolve_system_proxy().await {
                system
            } else {
                ResolvedProxy {
                    proxy_type: ProxyType::None,
                    host: String::new(),
                    port: 0,
                    username: None,
                    password: None,
                    bypass_hosts: config.bypass_hosts.clone(),
                    tls_config: None,
                }
            }
        }
        ProxyType::Socks5 | ProxyType::Http => {
            if let Some(url) = &config.proxy_url {
                parse_proxy_url(url, &config.proxy_type).await
            } else {
                ResolvedProxy {
                    proxy_type: ProxyType::None,
                    host: String::new(),
                    port: 0,
                    username: None,
                    password: None,
                    bypass_hosts: config.bypass_hosts.clone(),
                    tls_config: None,
                }
            }
        }
    }
}

async fn parse_proxy_url(url: &str, proxy_type: &ProxyType) -> ResolvedProxy {
    let parsed = Url::parse(url).expect("Invalid proxy URL");
    let host = parsed.host_str().unwrap_or("").to_string();
    let port = parsed.port().unwrap_or(match proxy_type {
        ProxyType::Socks5 => 1080,
        ProxyType::Http => 8080,
        _ => 8080,
    });

    let username = parsed.username().to_string();
    let password = parsed.password().map(|s| s.to_string());

    ResolvedProxy {
        proxy_type: proxy_type.clone(),
        host,
        port,
        username: if username.is_empty() {
            None
        } else {
            Some(username)
        },
        password,
        bypass_hosts: Vec::new(),
        tls_config: None,
    }
}

async fn resolve_system_proxy() -> Option<ResolvedProxy> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(proxy) = detect_windows_system_proxy().await {
            return Some(proxy);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(proxy) = detect_unix_system_proxy().await {
            return Some(proxy);
        }
    }

    None
}

#[cfg(target_os = "windows")]
async fn detect_windows_system_proxy() -> Result<ResolvedProxy, ProxyError> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")?;

    let proxy_enable: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    if proxy_enable == 0 {
        return Err(ProxyError::ConnectionFailed("System proxy disabled".into()));
    }

    let proxy_server: String = key
        .get_value("ProxyServer")
        .map_err(|_| ProxyError::ConnectionFailed("No ProxyServer value".into()))?;

    let proxy_override: String = key.get_value("ProxyOverride").unwrap_or_default();
    let bypass_hosts: Vec<String> = proxy_override
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if proxy_server.contains('=') {
        for part in proxy_server.split(';') {
            if let Some((proto, server)) = part.split_once('=') {
                if proto.eq_ignore_ascii_case("http") || proto.eq_ignore_ascii_case("https") {
                    let url = format!("http://{}", server);
                    return Ok(parse_proxy_url(&url, &ProxyType::Http).await);
                } else if proto.eq_ignore_ascii_case("socks") {
                    let url = format!("socks5://{}", server);
                    return Ok(parse_proxy_url(&url, &ProxyType::Socks5).await);
                }
            }
        }
    } else {
        if proxy_server.starts_with("socks") {
            let url = format!("socks5://{}", proxy_server);
            return Ok(parse_proxy_url(&url, &ProxyType::Socks5).await);
        } else {
            let url = format!("http://{}", proxy_server);
            return Ok(parse_proxy_url(&url, &ProxyType::Http).await);
        }
    }

    Err(ProxyError::ConnectionFailed(
        "Could not parse system proxy".into(),
    ))
}

#[cfg(not(target_os = "windows"))]
async fn detect_unix_system_proxy() -> Result<ResolvedProxy, ProxyError> {
    let http_proxy = std::env::var("HTTP_PROXY")
        .or_else(|_| std::env::var("http_proxy"))
        .ok();

    let https_proxy = std::env::var("HTTPS_PROXY")
        .or_else(|_| std::env::var("https_proxy"))
        .ok();

    let all_proxy = std::env::var("ALL_PROXY")
        .or_else(|_| std::env::var("all_proxy"))
        .ok();

    let no_proxy = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();

    let bypass_hosts: Vec<String> = no_proxy
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let proxy_url = https_proxy.or(http_proxy).or(all_proxy);

    if let Some(url) = proxy_url {
        let parsed = Url::parse(&url)?;
        let scheme = parsed.scheme().to_lowercase();

        let proxy_type = match scheme.as_str() {
            "socks5" | "socks" => ProxyType::Socks5,
            "http" | "https" => ProxyType::Http,
            _ => return Err(ProxyError::UnsupportedType(scheme)),
        };

        let mut resolved = parse_proxy_url(&url, &proxy_type).await;
        resolved.bypass_hosts = bypass_hosts;
        return Ok(resolved);
    }

    Err(ProxyError::ConnectionFailed(
        "No system proxy configured".into(),
    ))
}

pub async fn connect_through_proxy(
    proxy: &ResolvedProxy,
    target_host: &str,
    target_port: u16,
    timeout_duration: Duration,
) -> Result<Box<dyn AsyncRead + AsyncWrite + Unpin + Send>, ProxyError> {
    match proxy.proxy_type {
        ProxyType::Socks5 => {
            connect_socks5(proxy, target_host, target_port, timeout_duration).await
        }
        ProxyType::Http => {
            connect_http_connect(proxy, target_host, target_port, timeout_duration).await
        }
        ProxyType::None => {
            let stream = tokio::time::timeout(
                timeout_duration,
                TcpStream::connect((target_host, target_port)),
            )
            .await
            .map_err(|_| ProxyError::ConnectionFailed("Connection timeout".into()))??;
            Ok(Box::new(stream))
        }
        ProxyType::System => {
            if proxy.host.is_empty() {
                let stream = tokio::time::timeout(
                    timeout_duration,
                    TcpStream::connect((target_host, target_port)),
                )
                .await
                .map_err(|_| ProxyError::ConnectionFailed("Connection timeout".into()))??;
                Ok(Box::new(stream))
            } else {
                match proxy.proxy_type {
                    ProxyType::Socks5 => {
                        connect_socks5(proxy, target_host, target_port, timeout_duration).await
                    }
                    ProxyType::Http => {
                        connect_http_connect(proxy, target_host, target_port, timeout_duration)
                            .await
                    }
                    _ => {
                        let stream = tokio::time::timeout(
                            timeout_duration,
                            TcpStream::connect((target_host, target_port)),
                        )
                        .await
                        .map_err(|_| ProxyError::ConnectionFailed("Connection timeout".into()))??;
                        Ok(Box::new(stream))
                    }
                }
            }
        }
    }
}

async fn connect_socks5(
    proxy: &ResolvedProxy,
    target_host: &str,
    target_port: u16,
    timeout_duration: Duration,
) -> Result<Box<dyn AsyncRead + AsyncWrite + Unpin + Send>, ProxyError> {
    let proxy_addr = format!("{}:{}", proxy.host, proxy.port);

    let mut stream = tokio::time::timeout(timeout_duration, TcpStream::connect(&proxy_addr))
        .await
        .map_err(|_| ProxyError::ConnectionFailed("SOCKS5 proxy connection timeout".into()))??;

    stream.set_nodelay(true)?;

    let mut methods = vec![0x00];
    if proxy.username.is_some() && proxy.password.is_some() {
        methods.push(0x02);
    }

    let auth_request = [0x05, methods.len() as u8, methods[0]];
    let mut auth_request_vec = Vec::new();
    auth_request_vec.extend_from_slice(&auth_request);
    if methods.len() > 1 {
        auth_request_vec.extend_from_slice(&[methods[1]]);
    }

    tokio::time::timeout(timeout_duration, stream.write_all(&auth_request_vec))
        .await
        .map_err(|_| ProxyError::HandshakeFailed("SOCKS5 auth request timeout".into()))??;

    let mut auth_response = [0u8; 2];
    tokio::time::timeout(timeout_duration, stream.read_exact(&mut auth_response))
        .await
        .map_err(|_| ProxyError::HandshakeFailed("SOCKS5 auth response timeout".into()))??;

    if auth_response[0] != 0x05 {
        return Err(ProxyError::HandshakeFailed("Invalid SOCKS5 version".into()));
    }

    if auth_response[1] == 0x02 {
        let username = proxy.username.as_deref().unwrap_or("");
        let password = proxy.password.as_deref().unwrap_or("");

        let mut auth_data = vec![0x01, username.len() as u8];
        auth_data.extend_from_slice(username.as_bytes());
        auth_data.push(password.len() as u8);
        auth_data.extend_from_slice(password.as_bytes());

        tokio::time::timeout(timeout_duration, stream.write_all(&auth_data))
            .await
            .map_err(|_| ProxyError::HandshakeFailed("SOCKS5 user/pass auth timeout".into()))??;

        let mut auth_result = [0u8; 2];
        tokio::time::timeout(timeout_duration, stream.read_exact(&mut auth_result))
            .await
            .map_err(|_| {
                ProxyError::HandshakeFailed("SOCKS5 user/pass auth result timeout".into())
            })??;

        if auth_result[1] != 0x00 {
            return Err(ProxyError::AuthFailed(
                "SOCKS5 authentication failed".into(),
            ));
        }
    } else if auth_response[1] != 0x00 {
        return Err(ProxyError::AuthFailed(
            "SOCKS5 no acceptable auth method".into(),
        ));
    }

    let target_addr = format!("{}:{}", target_host, target_port);
    let target_addr_bytes = target_addr.as_bytes();

    let mut connect_request = vec![0x05, 0x01, 0x00];

    if let Ok(ip) = target_host.parse::<std::net::Ipv4Addr>() {
        connect_request.push(0x01);
        connect_request.extend_from_slice(&ip.octets());
    } else if let Ok(ip) = target_host.parse::<std::net::Ipv6Addr>() {
        connect_request.push(0x04);
        connect_request.extend_from_slice(&ip.octets());
    } else {
        connect_request.push(0x03);
        connect_request.push(target_addr_bytes.len() as u8);
        connect_request.extend_from_slice(target_addr_bytes);
    }

    connect_request.extend_from_slice(&target_port.to_be_bytes());

    tokio::time::timeout(timeout_duration, stream.write_all(&connect_request))
        .await
        .map_err(|_| ProxyError::HandshakeFailed("SOCKS5 connect request timeout".into()))??;

    let mut connect_response = [0u8; 10];
    tokio::time::timeout(
        timeout_duration,
        stream.read_exact(&mut connect_response[..4]),
    )
    .await
    .map_err(|_| ProxyError::HandshakeFailed("SOCKS5 connect response timeout".into()))??;

    if connect_response[0] != 0x05 {
        return Err(ProxyError::HandshakeFailed(
            "Invalid SOCKS5 version in response".into(),
        ));
    }
    if connect_response[1] != 0x00 {
        return Err(ProxyError::ConnectionFailed(format!(
            "SOCKS5 connection failed: {}",
            connect_response[1]
        )));
    }

    let addr_type = connect_response[3];
    let addr_len = match addr_type {
        0x01 => 4,
        0x04 => 16,
        0x03 => {
            let mut len_byte = [0u8; 1];
            tokio::time::timeout(timeout_duration, stream.read_exact(&mut len_byte))
                .await
                .map_err(|_| {
                    ProxyError::HandshakeFailed("SOCKS5 domain length timeout".into())
                })??;
            len_byte[0] as usize
        }
        _ => {
            return Err(ProxyError::HandshakeFailed(
                "Unknown SOCKS5 address type".into(),
            ))
        }
    };

    let mut remaining = addr_len + 2;
    let mut buf = vec![0u8; remaining];
    tokio::time::timeout(timeout_duration, stream.read_exact(&mut buf))
        .await
        .map_err(|_| ProxyError::HandshakeFailed("SOCKS5 address/port read timeout".into()))??;

    Ok(Box::new(stream))
}

async fn connect_http_connect(
    proxy: &ResolvedProxy,
    target_host: &str,
    target_port: u16,
    timeout_duration: Duration,
) -> Result<Box<dyn AsyncRead + AsyncWrite + Unpin + Send>, ProxyError> {
    let proxy_addr = format!("{}:{}", proxy.host, proxy.port);

    let mut stream = tokio::time::timeout(timeout_duration, TcpStream::connect(&proxy_addr))
        .await
        .map_err(|_| ProxyError::ConnectionFailed("HTTP proxy connection timeout".into()))??;

    stream.set_nodelay(true)?;

    let mut request = format!(
        "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n",
        target_host, target_port, target_host, target_port
    );

    if let (Some(username), Some(password)) = (&proxy.username, &proxy.password) {
        let auth = format!("{}:{}", username, password);
        let encoded = BASE64.encode(auth);
        request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", encoded));
    }

    request.push_str("\r\n");

    tokio::time::timeout(timeout_duration, stream.write_all(request.as_bytes()))
        .await
        .map_err(|_| ProxyError::HandshakeFailed("HTTP CONNECT request timeout".into()))??;

    let mut response = Vec::new();
    let mut buf = [0u8; 1024];
    let mut found_end = false;

    while !found_end {
        let n = tokio::time::timeout(timeout_duration, stream.read(&mut buf))
            .await
            .map_err(|_| ProxyError::HandshakeFailed("HTTP CONNECT response timeout".into()))??;

        if n == 0 {
            break;
        }
        response.extend_from_slice(&buf[..n]);
        if response.windows(4).any(|w| w == b"\r\n\r\n") {
            found_end = true;
            break;
        }
    }

    let response_str = String::from_utf8_lossy(&response);
    let status_line = response_str.lines().next().unwrap_or("");

    if !status_line.contains(" 200 ") {
        return Err(ProxyError::ConnectionFailed(format!(
            "HTTP CONNECT failed: {}",
            status_line
        )));
    }

    Ok(Box::new(stream))
}

pub async fn connect_tls_through_proxy(
    proxy: &ResolvedProxy,
    target_host: &str,
    target_port: u16,
    timeout_duration: Duration,
    server_name: &str,
) -> Result<Box<dyn AsyncRead + AsyncWrite + Unpin + Send>, ProxyError> {
    let tcp_stream =
        connect_through_proxy(proxy, target_host, target_port, timeout_duration).await?;

    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    if let Some(tls_config) = &proxy.tls_config {
        if let Some(ca_cert) = &tls_config.ca_cert {
            let certs = rustls_pemfile::certs(&mut ca_cert.as_bytes());
            for cert in certs {
                if let Ok(cert) = cert {
                    root_store.add(cert).ok();
                }
            }
        }
    }

    let mut config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    if let Some(tls_config) = &proxy.tls_config {
        config.enable_sni = tls_config.verify_certificates;
        if !tls_config.verify_certificates {
            config = ClientConfig::builder()
                .with_root_certificates(RootCertStore::empty())
                .with_no_client_auth();
            config.enable_sni = false;
        }
    }

    let connector = TlsConnector::from(Arc::new(config));
    let server_name = ServerName::try_from(server_name)
        .map_err(|_| ProxyError::Tls(tokio_rustls::rustls::Error::InvalidDnsName))?;

    let tls_stream =
        tokio::time::timeout(timeout_duration, connector.connect(server_name, tcp_stream))
            .await
            .map_err(|_| {
                ProxyError::Tls(tokio_rustls::rustls::Error::General(
                    "TLS handshake timeout".into(),
                ))
            })??;

    Ok(Box::new(tls_stream))
}

/// Connect through proxy using ProxyConfig directly (resolves and connects)
pub async fn connect_via_proxy(
    target_host: &str,
    target_port: u16,
    proxy_config: &ProxyConfig,
    timeout_duration: Duration,
) -> Result<Box<dyn AsyncRead + AsyncWrite + Unpin + Send>, ProxyError> {
    let resolved = resolve_proxy_config(proxy_config).await;
    connect_through_proxy(&resolved, target_host, target_port, timeout_duration).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_proxy_url_socks5() {
        let url = "socks5://user:pass@127.0.0.1:1080";
        let resolved = parse_proxy_url(url, &ProxyType::Socks5);
        assert_eq!(resolved.host, "127.0.0.1");
        assert_eq!(resolved.port, 1080);
        assert_eq!(resolved.username, Some("user".to_string()));
        assert_eq!(resolved.password, Some("pass".to_string()));
    }

    #[test]
    fn test_parse_proxy_url_http() {
        let url = "http://proxy.example.com:8080";
        let resolved = parse_proxy_url(url, &ProxyType::Http);
        assert_eq!(resolved.host, "proxy.example.com");
        assert_eq!(resolved.port, 8080);
        assert_eq!(resolved.username, None);
        assert_eq!(resolved.password, None);
    }

    #[test]
    fn test_parse_proxy_url_without_auth() {
        let url = "socks5://127.0.0.1:1080";
        let resolved = parse_proxy_url(url, &ProxyType::Socks5);
        assert_eq!(resolved.host, "127.0.0.1");
        assert_eq!(resolved.port, 1080);
        assert_eq!(resolved.username, None);
        assert_eq!(resolved.password, None);
    }
}
