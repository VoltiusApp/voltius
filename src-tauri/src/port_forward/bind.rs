use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration};

const PROBE_TIMEOUT: Duration = Duration::from_millis(200);

/// Bind a loopback TCP listener on `port`, refusing to bind when another process
/// already serves that port on any local address.
///
/// A plain `TcpListener::bind("127.0.0.1:PORT")` is not enough on Windows: a bind
/// to the specific `127.0.0.1` succeeds even when another process holds the
/// wildcard `0.0.0.0:PORT` (e.g. Docker-published MongoDB), and Windows then
/// routes loopback traffic to our more-specific socket — silently hijacking the
/// port (issue #33). A short connect probe to `127.0.0.1:PORT` detects an
/// existing listener on `0.0.0.0`/`127.0.0.1` so callers fall back to the next
/// port instead of stealing it. On Linux/macOS the bind alone would already
/// fail; the probe just makes the behaviour uniform.
pub async fn bind_loopback(port: u16) -> std::io::Result<TcpListener> {
    if is_port_serving(port).await {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            format!("127.0.0.1:{port} is already served by another process"),
        ));
    }
    TcpListener::bind(("127.0.0.1", port)).await
}

/// True if something answers a TCP connection on `127.0.0.1:port`. A free port
/// refuses immediately (fast); a filtered one hits the short timeout.
async fn is_port_serving(port: u16) -> bool {
    matches!(
        timeout(PROBE_TIMEOUT, TcpStream::connect(("127.0.0.1", port))).await,
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

        assert!(!is_port_serving(port).await);
        assert!(bind_loopback(port).await.is_ok());
    }

    #[tokio::test]
    async fn wildcard_bind_is_detected_as_serving() {
        // Reproduces the issue #33 scenario cross-platform: another process holds
        // the wildcard 0.0.0.0:PORT (as Docker does). A specific-address bind can
        // slip past that on Windows, but the connect probe catches it, so
        // bind_loopback refuses and the caller falls back to the next port.
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

        assert!(is_port_serving(port).await);
        let err = bind_loopback(port).await.unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);
    }
}
