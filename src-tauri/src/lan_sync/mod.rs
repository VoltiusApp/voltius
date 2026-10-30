pub mod addrs;
#[cfg(target_os = "android")]
pub mod android;
pub mod discovery;
pub mod handshake;
pub mod identity;
pub mod manager;
pub mod pairing;
pub mod peers;
pub mod protocol;
pub mod route;
pub mod stream;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod tailscale;

#[cfg(test)]
pub(crate) fn reserved() -> (socket2::Socket, std::net::SocketAddr) {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)).unwrap();
    let any = std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, 0));
    socket.bind(&any.into()).unwrap();
    let addr = socket.local_addr().unwrap().as_socket().unwrap();
    (socket, addr)
}

pub(crate) fn lock<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
