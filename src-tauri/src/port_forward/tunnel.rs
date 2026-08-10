use crate::port_forward::ForwardError;
use crate::ssh::live_cells::read_cell;
use crate::ssh::session::SessionHandle;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

/// Bind a local TCP listener and spawn an accept loop.
/// Returns `(bound_local_port, bytes_transferred_counter)`.
/// The counter is shared across all connections to this tunnel.
pub async fn create_tunnel(
    handle: SessionHandle,
    local_port: u16,
    remote_port: u16,
    remote_host: &str,
    cancel: CancellationToken,
) -> Result<(u16, Arc<AtomicU64>), ForwardError> {
    let (listener, bound_port) = super::pipe::bind_with_fallback(local_port).await?;
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
    handle: SessionHandle,
    tcp: TcpStream,
    remote_host: String,
    remote_port: u16,
    local_port: u16,
    cancel: CancellationToken,
    bytes: Arc<AtomicU64>,
) {
    // Read the handle per connection, not once at tunnel creation: the session
    // may have reconnected since, and the old handle is dead.
    let ch = match read_cell(&handle)
        .channel_open_direct_tcpip(
            &remote_host,
            remote_port as u32,
            "127.0.0.1",
            local_port as u32,
        )
        .await
    {
        Ok(c) => c,
        Err(_) => return,
    };

    super::pipe::pump(ch, tcp, cancel, bytes).await;
}
