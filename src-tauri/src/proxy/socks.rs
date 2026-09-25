use super::{ProxyEndpoint, ProxyError};
use tokio::net::TcpStream;
use tokio_socks::tcp::Socks5Stream;

pub async fn connect(
    ep: &ProxyEndpoint,
    host: &str,
    port: u16,
) -> Result<Socks5Stream<TcpStream>, ProxyError> {
    let proxy = (ep.host.as_str(), ep.port);
    let result = match ep.auth() {
        Some((user, pass)) => {
            Socks5Stream::connect_with_password(proxy, (host, port), user, pass).await
        }
        None => Socks5Stream::connect(proxy, (host, port)).await,
    };
    result.map_err(|e| match e {
        tokio_socks::Error::Io(source) => ProxyError::Unreachable {
            proxy: ep.label(),
            source,
        },
        other => ProxyError::Socks {
            detail: other.to_string(),
        },
    })
}
