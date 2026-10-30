use super::protocol::MAX_HELLO_ADDRS;
use super::route::{classify, is_link_local_v6, is_ula, Route};
use std::collections::HashSet;
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::sync::Arc;

pub type AddrSource = Arc<dyn Fn() -> Vec<SocketAddr> + Send + Sync>;

pub fn none() -> AddrSource {
    Arc::new(Vec::new)
}

const VIRTUAL_PREFIXES: [&str; 6] = ["docker", "br-", "veth", "virbr", "vboxnet", "vmnet"];

pub fn interfaces(port: u16) -> AddrSource {
    Arc::new(move || {
        let ifaces: Vec<(String, IpAddr)> = if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .filter(|i| !i.is_loopback() && i.is_oper_up())
            .map(|i| (i.name.clone(), i.ip()))
            .collect();
        choose(&ifaces, port)
    })
}

pub fn choose(ifaces: &[(String, IpAddr)], port: u16) -> Vec<SocketAddr> {
    let mut seen = HashSet::new();
    let mut ranked: Vec<(u8, SocketAddr)> = ifaces
        .iter()
        .filter(|(name, _)| !VIRTUAL_PREFIXES.iter().any(|p| name.starts_with(p)))
        .map(|(_, ip)| SocketAddr::new(*ip, port))
        .filter_map(|a| advertisable(a, &mut seen))
        .map(|a| (rank(a.ip()), a))
        .collect();
    ranked.sort_by_key(|(r, _)| *r);
    ranked
        .into_iter()
        .map(|(_, a)| a)
        .take(MAX_HELLO_ADDRS)
        .collect()
}

fn rank(ip: IpAddr) -> u8 {
    match (classify(ip), ip.is_ipv6()) {
        (Route::Tailscale, false) => 0,
        (Route::Tailscale, true) => 1,
        (Route::Lan, false) => 2,
        (Route::Lan, true) => 3,
        (Route::Vpn, _) => 4,
    }
}

pub fn canonical(addr: SocketAddr) -> SocketAddr {
    match addr.ip() {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => SocketAddr::new(IpAddr::V4(v4), addr.port()),
            None => addr,
        },
        IpAddr::V4(_) => addr,
    }
}

pub fn is_global_v6(v6: &Ipv6Addr) -> bool {
    v6.to_ipv4_mapped().is_none()
        && !is_ula(v6)
        && !is_link_local_v6(v6)
        && !v6.is_loopback()
        && !v6.is_unspecified()
        && !v6.is_multicast()
}

fn usable(addr: &SocketAddr, loopback: bool) -> bool {
    let ip = addr.ip();
    addr.port() != 0
        && !ip.is_unspecified()
        && (loopback || !ip.is_loopback())
        && !ip.is_multicast()
        && match ip {
            IpAddr::V4(v4) => !v4.is_broadcast(),
            IpAddr::V6(v6) => v6.is_loopback() || is_ula(&v6),
        }
}

pub fn dialable(addr: &SocketAddr) -> bool {
    usable(&canonical(*addr), false)
}

pub fn dial_target(addr: &SocketAddr) -> bool {
    usable(&canonical(*addr), cfg!(test))
}

fn advertisable(addr: SocketAddr, seen: &mut HashSet<SocketAddr>) -> Option<SocketAddr> {
    let addr = canonical(addr);
    (dialable(&addr) && seen.insert(addr)).then_some(addr)
}

pub fn sanitize(raw: &[String]) -> Vec<SocketAddr> {
    let mut seen = HashSet::new();
    raw.iter()
        .filter_map(|s| s.parse::<SocketAddr>().ok())
        .filter_map(|a| advertisable(a, &mut seen))
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

    fn sa(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn choose_orders_tailscale_first_and_skips_virtual() {
        let ifaces: Vec<(String, IpAddr)> = [
            ("eth0", "192.168.1.4"),
            ("tailscale0", "100.101.1.2"),
            ("tailscale0", "fd7a:115c:a1e0::5"),
            ("docker0", "172.17.0.1"),
            ("veth12", "10.1.1.1"),
            ("lo", "127.0.0.1"),
            ("eth0", "fe80::1"),
            ("eth0", "2001:db8::7"),
            ("wg0", "fd00::9"),
        ]
        .map(|(n, ip)| (n.to_string(), ip.parse().unwrap()))
        .into();
        assert_eq!(
            choose(&ifaces, 47391),
            vec![
                sa("100.101.1.2:47391"),
                sa("[fd7a:115c:a1e0::5]:47391"),
                sa("192.168.1.4:47391"),
                sa("[fd00::9]:47391"),
            ]
        );
    }

    #[test]
    fn dialable_rejects_link_local_and_global_v6() {
        assert!(!dialable(&sa("[fe80::1]:1")));
        assert!(!dialable(&sa("[2001:db8::7]:1")));
        assert!(dialable(&sa("[fd00::9]:1")));
        assert!(dialable(&sa("[fd7a:115c:a1e0::5]:1")));
        assert!(dialable(&sa("[::ffff:192.168.1.4]:1")));
    }

    #[test]
    fn dial_target_accepts_loopback_but_not_junk() {
        assert!(dial_target(&sa("127.0.0.1:1")));
        assert!(dial_target(&sa("[::1]:1")));
        assert!(dial_target(&sa("[::ffff:127.0.0.1]:1")));
        assert!(!dial_target(&sa("[fe80::1]:1")));
        assert!(!dial_target(&sa("[2001:db8::7]:1")));
        assert!(!dial_target(&sa("0.0.0.0:1")));
        assert!(!dial_target(&sa("10.0.0.1:0")));
        assert!(!dialable(&sa("[::1]:1")));
    }

    #[test]
    fn mapped_ipv4_is_not_global_v6() {
        assert!(!is_global_v6(&"::ffff:8.8.8.8".parse().unwrap()));
        assert!(is_global_v6(&"2001:db8::1".parse().unwrap()));
    }

    #[test]
    fn canonical_unmaps_ipv4() {
        assert_eq!(canonical(sa("[::ffff:10.0.0.2]:5")), sa("10.0.0.2:5"));
        assert_eq!(canonical(sa("[fd00::1]:5")), sa("[fd00::1]:5"));
    }
}
