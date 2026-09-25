#![allow(dead_code)]

mod http;
mod socks;
pub mod system;
#[cfg(test)]
mod tests;

use http::PrefixedStream;
use serde::Deserialize;
use std::fmt;
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_socks::tcp::Socks5Stream;

pub const PROXY_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProxySpec {
    Direct,
    System,
    Socks5(ProxyEndpoint),
    Http(ProxyEndpoint),
}

pub enum ProxiedStream {
    Tcp(TcpStream),
    Socks(Socks5Stream<TcpStream>),
    Http(PrefixedStream<TcpStream>),
}

pub struct Dialed {
    pub stream: ProxiedStream,
    pub via: Option<String>,
}

pub async fn dial(spec: Option<&ProxySpec>, host: &str, port: u16) -> Result<Dialed, ProxyError> {
    dial_with_timeout(spec, host, port, PROXY_HANDSHAKE_TIMEOUT).await
}

pub(crate) async fn dial_with_timeout(
    spec: Option<&ProxySpec>,
    host: &str,
    port: u16,
    limit: Duration,
) -> Result<Dialed, ProxyError> {
    let detected;
    let spec = match spec {
        Some(ProxySpec::System) => {
            let target = host.to_string();
            detected = tokio::task::spawn_blocking(move || system::detect(&target))
                .await
                .ok()
                .flatten();
            detected.as_ref()
        }
        other => other,
    };
    match spec {
        None | Some(ProxySpec::Direct) | Some(ProxySpec::System) => {
            TcpStream::connect((host, port))
                .await
                .map(|s| Dialed {
                    stream: ProxiedStream::Tcp(s),
                    via: None,
                })
                .map_err(ProxyError::Direct)
        }
        Some(ProxySpec::Socks5(ep)) => {
            let stream = bounded(ep, limit, socks::connect(ep, host, port)).await?;
            Ok(Dialed {
                stream: ProxiedStream::Socks(stream),
                via: Some(format!("socks5 {}", ep.label())),
            })
        }
        Some(ProxySpec::Http(ep)) => {
            let stream = bounded(ep, limit, async {
                let tcp = TcpStream::connect((ep.host.as_str(), ep.port))
                    .await
                    .map_err(|source| ProxyError::Unreachable {
                        proxy: ep.label(),
                        source,
                    })?;
                http::connect(tcp, ep.label(), host, port, ep.auth()).await
            })
            .await?;
            Ok(Dialed {
                stream: ProxiedStream::Http(stream),
                via: Some(format!("http {}", ep.label())),
            })
        }
    }
}

async fn bounded<T>(
    ep: &ProxyEndpoint,
    limit: Duration,
    fut: impl std::future::Future<Output = Result<T, ProxyError>>,
) -> Result<T, ProxyError> {
    tokio::time::timeout(limit, fut)
        .await
        .unwrap_or_else(|_| Err(ProxyError::Timeout { proxy: ep.label() }))
}

macro_rules! each_stream {
    ($self:ident, $s:ident => $e:expr) => {
        match $self.get_mut() {
            ProxiedStream::Tcp($s) => $e,
            ProxiedStream::Socks($s) => $e,
            ProxiedStream::Http($s) => $e,
        }
    };
}

impl AsyncRead for ProxiedStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        each_stream!(self, s => Pin::new(s).poll_read(cx, buf))
    }
}

impl AsyncWrite for ProxiedStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        each_stream!(self, s => Pin::new(s).poll_write(cx, buf))
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        each_stream!(self, s => Pin::new(s).poll_flush(cx))
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        each_stream!(self, s => Pin::new(s).poll_shutdown(cx))
    }
}

#[derive(Clone, Deserialize, PartialEq)]
pub struct ProxyEndpoint {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

impl ProxyEndpoint {
    pub fn label(&self) -> String {
        authority(&self.host, self.port)
    }

    pub fn auth(&self) -> Option<(&str, &str)> {
        let user = self.username.as_deref().filter(|u| !u.is_empty())?;
        Some((user, self.password.as_deref().unwrap_or("")))
    }
}

impl fmt::Debug for ProxyEndpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProxyEndpoint")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

pub(crate) fn authority(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

#[derive(Debug)]
pub enum ProxyError {
    Direct(io::Error),
    Unreachable { proxy: String, source: io::Error },
    Rejected { target: String, status: String },
    Socks { proxy: String, detail: String },
    Protocol { proxy: String, detail: String },
    Timeout { proxy: String },
}

impl fmt::Display for ProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Direct(e) => write!(f, "{e}"),
            Self::Unreachable { proxy, source } => write!(f, "Proxy {proxy} unreachable: {source}"),
            Self::Rejected { target, status } => {
                write!(f, "Proxy rejected CONNECT to {target}: {status}")
            }
            Self::Socks { detail, .. } => write!(f, "SOCKS5 proxy refused: {detail}"),
            Self::Protocol { proxy, detail } => write!(f, "Proxy {proxy}: {detail}"),
            Self::Timeout { proxy } => write!(f, "Proxy {proxy} did not answer in time"),
        }
    }
}

impl ProxyError {
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Direct(e) | Self::Unreachable { source: e, .. } => is_transient_io_kind(e.kind()),
            _ => false,
        }
    }
}

pub(crate) fn is_transient_io_kind(kind: io::ErrorKind) -> bool {
    use io::ErrorKind::*;
    matches!(
        kind,
        ConnectionReset
            | ConnectionAborted
            | ConnectionRefused
            | TimedOut
            | BrokenPipe
            | UnexpectedEof
    )
}

#[derive(serde::Serialize)]
pub struct DetectedProxy {
    kind: &'static str,
    host: String,
    port: u16,
}

#[tauri::command]
pub async fn proxy_detect_system() -> Option<DetectedProxy> {
    let spec = tokio::task::spawn_blocking(|| system::detect(""))
        .await
        .ok()
        .flatten()?;
    let (kind, ep) = match spec {
        ProxySpec::Socks5(ep) => ("socks5", ep),
        ProxySpec::Http(ep) => ("http", ep),
        ProxySpec::Direct | ProxySpec::System => return None,
    };
    Some(DetectedProxy {
        kind,
        host: ep.host,
        port: ep.port,
    })
}
