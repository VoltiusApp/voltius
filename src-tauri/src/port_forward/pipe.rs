use crate::port_forward::ForwardError;
use russh::ChannelMsg;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

/// Number of consecutive ports a tunnel tries before giving up.
pub const PORT_ATTEMPTS: u16 = 5;

/// Bind a loopback listener on `local_port`, walking forward while the port is
/// taken. Returns the listener and the port it actually got.
pub async fn bind_with_fallback(local_port: u16) -> Result<(TcpListener, u16), ForwardError> {
    for offset in 0..PORT_ATTEMPTS {
        let try_port = local_port.saturating_add(offset);
        if let Ok(listener) = crate::port_forward::bind::bind_loopback(try_port).await {
            return Ok((listener, try_port));
        }
    }
    Err(ForwardError::PortInUse(local_port, PORT_ATTEMPTS as u8))
}

/// Pump an accepted TCP connection through an open SSH channel until either side
/// closes or `cancel` fires, counting every byte in both directions.
pub async fn pump(
    ch: russh::Channel<russh::client::Msg>,
    tcp: TcpStream,
    cancel: CancellationToken,
    bytes: Arc<AtomicU64>,
) {
    let (mut ch_read, ch_write) = ch.split();
    let mut ch_writer = ch_write.make_writer();
    let (mut tcp_r, mut tcp_w) = tokio::io::split(tcp);

    let c1 = cancel.clone();
    let bytes_up = Arc::clone(&bytes);
    let tcp_to_ssh = tokio::spawn(async move {
        let mut buf = [0u8; 65536];
        loop {
            tokio::select! {
                _ = c1.cancelled() => break,
                result = tcp_r.read(&mut buf) => {
                    match result {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            if ch_writer.write_all(&buf[..n]).await.is_err() { break; }
                            bytes_up.fetch_add(n as u64, Ordering::Relaxed);
                        }
                    }
                }
            }
        }
    });

    let c2 = cancel.clone();
    let bytes_down = Arc::clone(&bytes);
    let ssh_to_tcp = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = c2.cancelled() => break,
                msg = ch_read.wait() => match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if tcp_w.write_all(&data).await.is_err() { break; }
                        bytes_down.fetch_add(data.len() as u64, Ordering::Relaxed);
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    });

    let _ = tokio::join!(tcp_to_ssh, ssh_to_tcp);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn falls_back_to_the_next_free_port() {
        let taken = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = taken.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                if taken.accept().await.is_err() {
                    break;
                }
            }
        });

        let (_listener, bound) = bind_with_fallback(port).await.unwrap();
        assert!(bound > port, "expected a later port, got {bound}");
        assert!(bound < port + PORT_ATTEMPTS);
    }

    #[tokio::test]
    async fn reports_the_requested_port_when_every_attempt_is_taken() {
        // Port 0 asks the OS for an ephemeral port, so every attempt in the
        // window binds; use a port range held by listeners instead.
        let mut held = Vec::new();
        let first = {
            let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
            probe.local_addr().unwrap().port()
        };
        for offset in 0..PORT_ATTEMPTS {
            if let Ok(l) = TcpListener::bind(("127.0.0.1", first + offset)).await {
                tokio::spawn(async move {
                    loop {
                        if l.accept().await.is_err() {
                            break;
                        }
                    }
                });
            }
            held.push(first + offset);
        }
        match bind_with_fallback(first).await {
            Err(ForwardError::PortInUse(requested, attempts)) => {
                assert_eq!(requested, first);
                assert_eq!(attempts, PORT_ATTEMPTS as u8);
            }
            other => panic!("expected PortInUse, got {other:?}"),
        }
    }
}
