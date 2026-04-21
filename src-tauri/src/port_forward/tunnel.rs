use crate::port_forward::ForwardError;
use russh::ChannelMsg;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

/// Bind a local TCP listener and spawn an accept loop.
/// Returns `(bound_local_port, bytes_transferred_counter)`.
/// The counter is shared across all connections to this tunnel.
pub async fn create_tunnel(
    handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
    local_port: u16,
    remote_port: u16,
    remote_host: &str,
    cancel: CancellationToken,
) -> Result<(u16, Arc<AtomicU64>), ForwardError> {
    let mut listener = None;
    let mut bound_port = local_port;

    for offset in 0..5u16 {
        let try_port = local_port.saturating_add(offset);
        if let Ok(l) = TcpListener::bind(format!("127.0.0.1:{try_port}")).await {
            bound_port = try_port;
            listener = Some(l);
            break;
        }
    }

    let listener = listener.ok_or(ForwardError::PortInUse(local_port, 5))?;
    let remote_host = remote_host.to_string();
    let cancel2 = cancel.clone();
    let bytes = Arc::new(AtomicU64::new(0));
    let bytes_accept = Arc::clone(&bytes);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel2.cancelled() => break,
                result = listener.accept() => {
                    let Ok((tcp_stream, _)) = result else { break };
                    tokio::spawn(bridge(
                        Arc::clone(&handle),
                        tcp_stream,
                        remote_host.clone(),
                        remote_port,
                        bound_port,
                        cancel2.clone(),
                        Arc::clone(&bytes_accept),
                    ));
                }
            }
        }
    });

    Ok((bound_port, bytes))
}

async fn bridge(
    handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
    tcp: TcpStream,
    remote_host: String,
    remote_port: u16,
    local_port: u16,
    cancel: CancellationToken,
    bytes: Arc<AtomicU64>,
) {
    let ch = match handle
        .channel_open_direct_tcpip(&remote_host, remote_port as u32, "127.0.0.1", local_port as u32)
        .await
    {
        Ok(c) => c,
        Err(_) => return,
    };

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
