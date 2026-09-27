use crate::port_forward::ForwardError;
use russh::ChannelMsg;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
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

/// Pump a local stream (TCP connection, ssh-agent socket) through an open SSH
/// channel until either side closes or `cancel` fires, counting every byte.
pub async fn pump<S>(
    ch: russh::Channel<russh::client::Msg>,
    tcp: S,
    cancel: CancellationToken,
    bytes: Arc<AtomicU64>,
) where
    S: AsyncRead + AsyncWrite + Send + 'static,
{
    let (mut ch_read, ch_write) = ch.split();
    let ch_write = Arc::new(ch_write);
    let mut ch_writer = ch_write.make_writer();
    let (mut tcp_r, mut tcp_w) = tokio::io::split(tcp);
    // Dies with the tunnel, and on its own when either direction fails for good.
    let conn = cancel.child_token();

    let c1 = conn.clone();
    let eof_write = Arc::clone(&ch_write);
    let bytes_up = Arc::clone(&bytes);
    let tcp_to_ssh = tokio::spawn(async move {
        let mut buf = [0u8; 65536];
        loop {
            tokio::select! {
                _ = c1.cancelled() => break,
                result = tcp_r.read(&mut buf) => {
                    match result {
                        // A writer on a dead channel blocks on a window that will
                        // never open, so a failed direction has to cancel the pair.
                        Err(_) => { c1.cancel(); break; }
                        Ok(0) => { let _ = eof_write.eof().await; break; }
                        Ok(n) => {
                            if ch_writer.write_all(&buf[..n]).await.is_err() {
                                c1.cancel();
                                break;
                            }
                            bytes_up.fetch_add(n as u64, Ordering::Relaxed);
                        }
                    }
                }
            }
        }
    });

    let c2 = conn.clone();
    let bytes_down = Arc::clone(&bytes);
    let ssh_to_tcp = tokio::spawn(async move {
        let mut gone = true;
        loop {
            tokio::select! {
                _ = c2.cancelled() => break,
                msg = ch_read.wait() => match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if tcp_w.write_all(&data).await.is_err() { break; }
                        bytes_down.fetch_add(data.len() as u64, Ordering::Relaxed);
                    }
                    // Eof leaves the upstream direction usable; Close does not.
                    Some(ChannelMsg::Eof) => { gone = false; break; }
                    Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
        let _ = tcp_w.shutdown().await;
        if gone {
            c2.cancel();
        }
    });

    let _ = tokio::join!(tcp_to_ssh, ssh_to_tcp);
    let _ = ch_write.close().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::port_forward::test_ssh::{self, Behavior, GREETING, SAW_EOF};
    use std::sync::atomic::AtomicU16;
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    const STEP: Duration = Duration::from_secs(5);

    fn spawn_pump(ch: russh::Channel<russh::client::Msg>, tcp: TcpStream) -> CancellationToken {
        let cancel = CancellationToken::new();
        tokio::spawn(pump(ch, tcp, cancel.clone(), Arc::new(AtomicU64::new(0))));
        cancel
    }

    #[tokio::test]
    async fn a_remote_close_closes_the_local_socket() {
        let (_session, ch) = test_ssh::open_direct_channel(Behavior::GreetThenClose).await;
        let (mut local, forwarded) = test_ssh::tcp_pair().await;
        let _cancel = spawn_pump(ch, forwarded);

        let mut greeting = vec![0u8; GREETING.len()];
        timeout(STEP, local.read_exact(&mut greeting))
            .await
            .expect("greeting never arrived")
            .unwrap();
        assert_eq!(greeting, GREETING);

        let mut tail = [0u8; 1];
        let n = timeout(STEP, local.read(&mut tail))
            .await
            .expect("local socket never saw the remote close")
            .unwrap();
        assert_eq!(n, 0, "expected EOF, got a byte");
    }

    #[tokio::test]
    async fn a_local_half_close_reaches_the_remote() {
        let (_session, ch) = test_ssh::open_direct_channel(Behavior::AnswerOnEof).await;
        let (mut local, forwarded) = test_ssh::tcp_pair().await;
        let _cancel = spawn_pump(ch, forwarded);

        local.write_all(b"ping").await.unwrap();
        local.shutdown().await.unwrap();

        let mut answer = vec![0u8; SAW_EOF.len()];
        timeout(STEP, local.read_exact(&mut answer))
            .await
            .expect("remote never saw the local EOF")
            .unwrap();
        assert_eq!(answer, SAW_EOF);
    }

    /// First of `n` consecutive free ports below every OS's ephemeral range. The
    /// ports after a `bind(0)` result belong to tests running alongside (macOS
    /// hands them out sequentially), and `bind_with_fallback` connect-probes each
    /// one — stealing the single connection their one-shot listeners accept.
    fn free_window(n: u16) -> u16 {
        static NEXT: AtomicU16 = AtomicU16::new(0);
        loop {
            let base = 10_000
                + (std::process::id() % 10_000) as u16
                + NEXT.fetch_add(n, Ordering::Relaxed);
            if (base..base + n).all(|p| std::net::TcpListener::bind(("127.0.0.1", p)).is_ok()) {
                return base;
            }
        }
    }

    async fn hold(port: u16) {
        let l = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        tokio::spawn(async move { while l.accept().await.is_ok() {} });
    }

    #[tokio::test]
    async fn falls_back_to_the_next_free_port() {
        let port = free_window(PORT_ATTEMPTS);
        hold(port).await;

        let (_listener, bound) = bind_with_fallback(port).await.unwrap();
        assert_eq!(bound, port + 1);
    }

    #[tokio::test]
    async fn reports_the_requested_port_when_every_attempt_is_taken() {
        let first = free_window(PORT_ATTEMPTS);
        for port in first..first + PORT_ATTEMPTS {
            hold(port).await;
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
