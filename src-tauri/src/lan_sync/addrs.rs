use super::protocol::MAX_HELLO_ADDRS;
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

pub type AddrSource = Arc<dyn Fn() -> Vec<SocketAddr> + Send + Sync>;

pub fn none() -> AddrSource {
    Arc::new(Vec::new)
}

pub fn interfaces(port: u16) -> AddrSource {
    Arc::new(move || {
        if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .filter(|i| !i.is_loopback() && i.is_oper_up())
            .filter_map(|i| match i.ip() {
                IpAddr::V4(ip) => Some(SocketAddr::new(IpAddr::V4(ip), port)),
                IpAddr::V6(_) => None,
            })
            .collect()
    })
}

pub fn dialable(addr: &SocketAddr) -> bool {
    let ip = addr.ip();
    addr.port() != 0
        && !ip.is_unspecified()
        && !ip.is_loopback()
        && !ip.is_multicast()
        && !matches!(ip, IpAddr::V4(v4) if v4.is_broadcast())
}

pub fn sanitize(raw: &[String]) -> Vec<SocketAddr> {
    let mut seen = HashSet::new();
    raw.iter()
        .filter_map(|s| s.parse::<SocketAddr>().ok())
        .filter(dialable)
        .filter(|a| seen.insert(*a))
        .take(MAX_HELLO_ADDRS)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_drops_junk_and_truncates() {
        let raw: Vec<String> = [
            "127.0.0.1:1",
            "0.0.0.0:5",
            "224.0.0.251:5353",
            "255.255.255.255:9",
            "192.168.1.4:0",
            "nonsense",
            "[fe80::1%eth0]:1",
            "192.168.1.4:47391",
            "192.168.1.4:47391",
        ]
        .map(String::from)
        .into();
        assert_eq!(
            sanitize(&raw),
            vec!["192.168.1.4:47391".parse::<SocketAddr>().unwrap()]
        );
        let many: Vec<String> = (0..1000)
            .map(|i| format!("10.0.{}.{}:4000", i / 250, i % 250 + 1))
            .collect();
        assert_eq!(
            sanitize(&many).len(),
            crate::lan_sync::protocol::MAX_HELLO_ADDRS
        );
    }
}
