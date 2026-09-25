#![allow(dead_code)]

mod http;

use serde::Deserialize;
use std::fmt;
use std::io;

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
