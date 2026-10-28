use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Route {
    Lan,
    Tailscale,
    Vpn,
}

pub fn classify(ip: IpAddr) -> Route {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => classify_v4(v4),
            None => classify_v6(v6),
        },
    }
}

fn classify_v4(ip: Ipv4Addr) -> Route {
    let [a, b, ..] = ip.octets();
    if a == 100 && (64..128).contains(&b) {
        Route::Tailscale
    } else if ip.is_private() || ip.is_link_local() || ip.is_loopback() {
        Route::Lan
    } else {
        Route::Vpn
    }
}

fn classify_v6(ip: Ipv6Addr) -> Route {
    let seg = ip.segments();
    if seg[..3] == [0xfd7a, 0x115c, 0xa1e0] {
        Route::Tailscale
    } else if ip.is_loopback() || (seg[0] & 0xfe00) == 0xfc00 || (seg[0] & 0xffc0) == 0xfe80 {
        Route::Lan
    } else {
        Route::Vpn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(s: &str) -> Route {
        classify(s.parse().unwrap())
    }

    #[test]
    fn private_and_link_local_are_lan() {
        for ip in [
            "192.168.1.4",
            "10.0.0.2",
            "172.16.5.5",
            "169.254.3.3",
            "fe80::1",
            "fd00::1",
        ] {
            assert_eq!(route(ip), Route::Lan, "{ip}");
        }
    }

    #[test]
    fn loopback_is_lan() {
        assert_eq!(route("127.0.0.1"), Route::Lan);
        assert_eq!(route("::1"), Route::Lan);
    }

    #[test]
    fn tailscale_ranges() {
        for ip in [
            "100.101.102.103",
            "100.64.0.1",
            "100.127.255.254",
            "fd7a:115c:a1e0::1",
        ] {
            assert_eq!(route(ip), Route::Tailscale, "{ip}");
        }
        assert_eq!(route("100.128.0.1"), Route::Vpn);
        assert_eq!(route("100.63.255.255"), Route::Vpn);
    }

    #[test]
    fn public_is_vpn() {
        assert_eq!(route("8.8.8.8"), Route::Vpn);
        assert_eq!(route("2001:4860:4860::8888"), Route::Vpn);
    }

    #[test]
    fn ipv4_mapped_ipv6_uses_ipv4_form() {
        assert_eq!(route("::ffff:192.168.1.4"), Route::Lan);
        assert_eq!(route("::ffff:100.101.102.103"), Route::Tailscale);
        assert_eq!(route("::ffff:8.8.8.8"), Route::Vpn);
    }
}
