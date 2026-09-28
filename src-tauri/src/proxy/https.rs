use super::http::{self, PrefixedStream};
use super::{open, ProxyEndpoint, ProxyError};
use std::io;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{self, ClientConfig};
use tokio_rustls::TlsConnector;

/// Opens TLS to the proxy (SNI and certificate name = the proxy host), then runs
/// the same CONNECT exchange as a plain HTTP proxy inside that session.
pub async fn connect(
    ep: &ProxyEndpoint,
    config: Arc<ClientConfig>,
    host: &str,
    port: u16,
) -> Result<PrefixedStream<TlsStream<TcpStream>>, ProxyError> {
    let name = ServerName::try_from(ep.host.clone()).map_err(|_| ProxyError::Protocol {
        proxy: ep.label(),
        detail: "host is not a valid TLS server name".into(),
    })?;
    let tcp = open(ep).await?;
    let tls = TlsConnector::from(config)
        .connect(name, tcp)
        .await
        .map_err(|e| handshake_error(ep.label(), e))?;
    http::connect(tls, ep.label(), host, port, ep.auth()).await
}

fn handshake_error(proxy: String, source: io::Error) -> ProxyError {
    let detail = match source
        .get_ref()
        .and_then(|e| e.downcast_ref::<rustls::Error>())
    {
        Some(e @ rustls::Error::InvalidCertificate(_)) => format!("TLS certificate rejected: {e}"),
        Some(e) => format!("TLS handshake failed: {e}"),
        None => return ProxyError::Unreachable { proxy, source },
    };
    ProxyError::Protocol { proxy, detail }
}
