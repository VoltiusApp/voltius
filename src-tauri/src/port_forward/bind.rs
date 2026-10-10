use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use tokio::net::{lookup_host, TcpListener, TcpStream};
use tokio::time::{timeout, Duration};

const PROBE_TIMEOUT: Duration = Duration::from_millis(200);

pub const LOOPBACK: &str = "127.0.0.1";

/// Resolve the address a tunnel listens on. Blank means loopback.
pub async fn resolve(host: &str, port: u16) -> std::io::Result<SocketAddr> {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    let host = if host.is_empty() { LOOPBACK } else { host };
    lookup_host((host, port)).await?.next().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AddrNotAvailable,
            format!("{host} did not resolve"),
        )
    })
}

/// Bind `addr` unless another process already serves it: on Windows a
/// specific-address bind succeeds over a wildcard holder and steals its traffic.
pub async fn bind_local(addr: SocketAddr) -> std::io::Result<TcpListener> {
    if is_serving(probe_target(addr)).await {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            format!("{addr} is already served by another process"),
        ));
    }
    TcpListener::bind(addr).await
}

/// A wildcard address cannot be connected to; its loopback answers for it.
fn probe_target(addr: SocketAddr) -> SocketAddr {
    let ip = match addr.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        ip => ip,
    };
    SocketAddr::new(ip, addr.port())
}

/// True if something answers a TCP connection on `addr`. A free port refuses
/// immediately (fast); a filtered one hits the short timeout.
async fn is_serving(addr: SocketAddr) -> bool {
    matches!(
        timeout(PROBE_TIMEOUT, TcpStream::connect(addr)).await,
        Ok(Ok(_))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn free_port_binds() {
        // An ephemeral port nobody holds: probe refuses, bind succeeds.
        let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);

        let addr = resolve(LOOPBACK, port).await.unwrap();
        assert!(!is_serving(addr).await);
        assert!(bind_local(addr).await.is_ok());
    }

    #[tokio::test]
    async fn wildcard_bind_is_detected_as_serving() {
        // Reproduces the issue #33 scenario cross-platform: another process holds
        // the wildcard 0.0.0.0:PORT (as Docker does). A specific-address bind can
        // slip past that on Windows, but the connect probe catches it, so
        // bind_local refuses and the caller falls back to the next port.
        let docker = TcpListener::bind("0.0.0.0:0").await.unwrap();
        let port = docker.local_addr().unwrap().port();
        // Keep an accept loop alive so connects succeed.
        tokio::spawn(async move {
            loop {
                if docker.accept().await.is_err() {
                    break;
                }
            }
        });

        let addr = resolve(LOOPBACK, port).await.unwrap();
        assert!(is_serving(addr).await);
        let err = bind_local(addr).await.unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);
    }

    #[tokio::test]
    async fn a_wildcard_bind_is_refused_while_loopback_serves_the_port() {
        let held = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = held.local_addr().unwrap().port();
        tokio::spawn(async move { while held.accept().await.is_ok() {} });

        let addr = resolve("0.0.0.0", port).await.unwrap();
        let err = bind_local(addr).await.unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);
    }

    #[tokio::test]
    async fn a_wildcard_bind_listens_on_every_interface() {
        let addr = resolve("0.0.0.0", 0).await.unwrap();
        let listener = bind_local(addr).await.unwrap();
        assert!(listener.local_addr().unwrap().ip().is_unspecified());
    }

    #[tokio::test]
    async fn blank_and_bracketed_hosts_resolve() {
        assert!(resolve("  ", 80).await.unwrap().ip().is_loopback());
        assert_eq!(
            resolve("[::1]", 80).await.unwrap().ip(),
            IpAddr::V6(Ipv6Addr::LOCALHOST)
        );
    }
}
