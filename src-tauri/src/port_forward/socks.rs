use crate::port_forward::ForwardError;
use crate::ssh::live_cells::read_cell;
use crate::ssh::session::SessionHandle;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_util::sync::CancellationToken;

/// Bind a local SOCKS5 listener and spawn an accept loop.
/// Returns `(bound_local_port, bytes_transferred_counter)`.
pub async fn create_socks_tunnel(
    handle: SessionHandle,
    local_port: u16,
    cancel: CancellationToken,
) -> Result<(u16, Arc<AtomicU64>), ForwardError> {
    let (listener, bound_port) = super::pipe::bind_with_fallback(local_port).await?;
    let cancel2 = cancel.clone();
    let bytes = Arc::new(AtomicU64::new(0));
    let bytes_accept = Arc::clone(&bytes);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel2.cancelled() => break,
                result = listener.accept() => {
                    let Ok((tcp_stream, _)) = result else { break };
                    tokio::spawn(socks_bridge(
                        Arc::clone(&handle),
                        tcp_stream,
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

async fn socks_bridge(
    handle: SessionHandle,
    mut tcp: TcpStream,
    local_port: u16,
    cancel: CancellationToken,
    bytes: Arc<AtomicU64>,
) {
    let (target_host, target_port) = match negotiate_socks5(&mut tcp).await {
        Ok(t) => t,
        Err(_) => return,
    };

    // Read the handle per connection, not once at tunnel creation: the session
    // may have reconnected since, and the old handle is dead.
    let ch = match read_cell(&handle)
        .channel_open_direct_tcpip(
            &target_host,
            target_port as u32,
            "127.0.0.1",
            local_port as u32,
        )
        .await
    {
        Ok(c) => c,
        Err(_) => {
            // Send SOCKS5 host unreachable reply
            let _ = tcp.write_all(&socks5_reply(0x04)).await;
            return;
        }
    };

    // Send SOCKS5 success reply: bound address 0.0.0.0:0
    if tcp.write_all(&socks5_reply(0x00)).await.is_err() {
        return;
    }

    super::pipe::pump(ch, tcp, cancel, bytes).await;
}

/// Perform SOCKS5 handshake; return (target_host, target_port) on success.
async fn negotiate_socks5<S: AsyncRead + AsyncWrite + Unpin>(
    tcp: &mut S,
) -> Result<(String, u16), ()> {
    // --- Auth negotiation ---
    let mut header = [0u8; 2];
    tcp.read_exact(&mut header).await.map_err(|_| ())?;
    let ver = header[0];
    let nmethods = header[1] as usize;
    if ver != 0x05 {
        return Err(());
    }
    let mut methods = vec![0u8; nmethods];
    tcp.read_exact(&mut methods).await.map_err(|_| ())?;

    if !methods.contains(&0x00) {
        // No acceptable auth method
        let _ = tcp.write_all(&[0x05, 0xFF]).await;
        return Err(());
    }
    // Accept no-auth
    tcp.write_all(&[0x05, 0x00]).await.map_err(|_| ())?;

    // --- CONNECT request ---
    let mut req = [0u8; 4];
    tcp.read_exact(&mut req).await.map_err(|_| ())?;
    if req[0] != 0x05 {
        return Err(());
    }
    let cmd = req[1];
    let atyp = req[3];

    if cmd != 0x01 {
        // Command not supported
        let _ = tcp.write_all(&socks5_reply(0x07)).await;
        return Err(());
    }

    let host = match atyp {
        0x01 => {
            // IPv4
            let mut addr = [0u8; 4];
            tcp.read_exact(&mut addr).await.map_err(|_| ())?;
            Ipv4Addr::from(addr).to_string()
        }
        0x03 => {
            // Domain
            let mut len = [0u8; 1];
            tcp.read_exact(&mut len).await.map_err(|_| ())?;
            let mut domain = vec![0u8; len[0] as usize];
            tcp.read_exact(&mut domain).await.map_err(|_| ())?;
            String::from_utf8(domain).map_err(|_| ())?
        }
        0x04 => {
            // IPv6, bare: the host of a direct-tcpip request goes to the
            // server's getaddrinfo, which rejects the `[…]` URL form.
            let mut addr = [0u8; 16];
            tcp.read_exact(&mut addr).await.map_err(|_| ())?;
            Ipv6Addr::from(addr).to_string()
        }
        _ => {
            let _ = tcp.write_all(&socks5_reply(0x08)).await;
            return Err(());
        }
    };

    let mut port_bytes = [0u8; 2];
    tcp.read_exact(&mut port_bytes).await.map_err(|_| ())?;
    let port = u16::from_be_bytes(port_bytes);

    Ok((host, port))
}

fn socks5_reply(rep: u8) -> [u8; 10] {
    // VER REP RSV ATYP BND.ADDR(4 bytes IPv4 0.0.0.0) BND.PORT(2 bytes 0)
    [0x05, rep, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
}

#[cfg(test)]
mod tests {
    use super::negotiate_socks5;
    use tokio::io::AsyncWriteExt;

    /// Run a no-auth CONNECT for `atyp` + `addr` to port 443 through the handshake.
    async fn connect_to(atyp: u8, addr: &[u8]) -> Result<(String, u16), ()> {
        let (mut client, mut server) = tokio::io::duplex(256);
        let mut request = vec![0x05, 0x01, 0x00, 0x05, 0x01, 0x00, atyp];
        request.extend_from_slice(addr);
        request.extend_from_slice(&443u16.to_be_bytes());
        client.write_all(&request).await.unwrap();
        negotiate_socks5(&mut server).await
    }

    #[tokio::test]
    async fn an_ipv6_destination_is_passed_on_bare_and_compressed() {
        let mut addr = [0u8; 16];
        addr[..4].copy_from_slice(&[0x20, 0x01, 0x0d, 0xb8]);
        addr[15] = 1;
        assert_eq!(
            connect_to(0x04, &addr).await,
            Ok(("2001:db8::1".to_string(), 443))
        );
    }

    #[tokio::test]
    async fn ipv4_and_domain_destinations_are_unchanged() {
        assert_eq!(
            connect_to(0x01, &[10, 0, 0, 7]).await,
            Ok(("10.0.0.7".to_string(), 443))
        );
        let mut domain = vec![11];
        domain.extend_from_slice(b"example.com");
        assert_eq!(
            connect_to(0x03, &domain).await,
            Ok(("example.com".to_string(), 443))
        );
    }
}
