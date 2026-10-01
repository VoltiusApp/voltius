#[cfg(any(test, not(any(target_os = "android", target_os = "ios"))))]
use super::ProxyEndpoint;
use super::ProxySpec;
#[cfg(any(test, not(any(target_os = "android", target_os = "ios"))))]
use std::net::IpAddr;

/// Splits `host[:port]`, `[v6][:port]` or a bare IPv6 literal (no port).
/// `None` when a port is present but malformed.
#[cfg(any(test, not(any(target_os = "android", target_os = "ios"))))]
fn split_host_port(s: &str) -> Option<(&str, Option<u16>)> {
    let (host, port) = match s.strip_prefix('[') {
        Some(rest) => {
            let (h, tail) = rest.split_once(']')?;
            (h, tail.strip_prefix(':'))
        }
        None => match s.split_once(':') {
            Some((h, p)) if !p.contains(':') => (h, Some(p)),
            _ => (s, None),
        },
    };
    Some((host, port.map(str::parse).transpose().ok()?))
}

#[cfg(any(
    test,
    not(any(target_os = "macos", target_os = "android", target_os = "ios"))
))]
fn endpoint(host_port: &str, default_port: u16) -> Option<ProxyEndpoint> {
    let s = host_port.trim().trim_end_matches('/');
    let (host, port) = split_host_port(s)?;
    // An unbracketed IPv6 host can't carry a port unambiguously, so refuse it.
    if host.is_empty() || (host.contains(':') && !s.starts_with('[')) {
        return None;
    }
    Some(ProxyEndpoint {
        host: host.to_string(),
        port: port.unwrap_or(default_port),
        username: None,
        password: None,
    })
}

#[cfg(any(
    test,
    not(any(target_os = "macos", target_os = "android", target_os = "ios"))
))]
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%')
            .then(|| s.get(i + 1..i + 3))
            .flatten()
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match hex {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(any(
    test,
    not(any(target_os = "macos", target_os = "android", target_os = "ios"))
))]
pub fn parse_proxy_url(url: &str) -> Option<ProxySpec> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://").unwrap_or(("http", url));
    let (userinfo, host_port) = match rest.rsplit_once('@') {
        Some((u, h)) => (Some(u), h),
        None => (None, rest),
    };
    let (spec, default_port): (fn(ProxyEndpoint) -> ProxySpec, u16) =
        match scheme.to_ascii_lowercase().as_str() {
            "socks" | "socks5" | "socks5h" => (ProxySpec::Socks5, 1080),
            "http" => (ProxySpec::Http, 80),
            "https" => (ProxySpec::Https, 443),
            _ => return None,
        };
    let mut ep = endpoint(host_port.split('/').next().unwrap_or(""), default_port)?;
    if let Some(info) = userinfo {
        let (u, p) = info.split_once(':').unwrap_or((info, ""));
        ep.username = Some(percent_decode(u));
        ep.password = Some(percent_decode(p));
    }
    Some(spec(ep))
}

#[cfg(any(target_os = "windows", test))]
fn parse_windows_proxy_server(value: &str) -> Option<ProxySpec> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if !value.contains('=') {
        return parse_proxy_url(value);
    }
    let entry = |scheme: &str| {
        value.split(';').find_map(|part| {
            let (k, v) = part.split_once('=')?;
            let v = v.trim();
            (k.trim().eq_ignore_ascii_case(scheme) && !v.is_empty()).then(|| v.to_string())
        })
    };
    if let Some(v) = entry("https").or_else(|| entry("http")) {
        return parse_proxy_url(&v);
    }
    entry("socks")
        .and_then(|v| endpoint(v.split("://").last().unwrap_or(&v), 1080))
        .map(ProxySpec::Socks5)
}

#[cfg(any(test, not(any(target_os = "android", target_os = "ios"))))]
fn glob(pattern: &str, text: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == text;
    }
    let mut rest = text;
    for (i, part) in parts.iter().enumerate() {
        if i == 0 {
            let Some(r) = rest.strip_prefix(part) else {
                return false;
            };
            rest = r;
        } else if i == parts.len() - 1 {
            return rest.ends_with(part);
        } else if let Some(idx) = rest.find(part) {
            rest = &rest[idx + part.len()..];
        } else {
            return false;
        }
    }
    true
}

/// An IP or CIDR bypass entry as (network, prefix length). Accepts macOS short
/// forms, where missing IPv4 octets are zero (`169.254/16` is 169.254.0.0/16).
#[cfg(any(test, not(any(target_os = "android", target_os = "ios"))))]
fn parse_net(entry: &str) -> Option<(IpAddr, u8)> {
    let (addr, bits) = match entry.split_once('/') {
        Some((a, b)) => (a, Some(b.parse::<u8>().ok()?)),
        None => (entry, None),
    };
    let ip = match addr.parse::<IpAddr>() {
        Ok(ip) => ip,
        Err(_) if bits.is_some() => {
            let mut octets = [0u8; 4];
            for (i, part) in addr.split('.').enumerate() {
                *octets.get_mut(i)? = part.parse().ok()?;
            }
            IpAddr::from(octets)
        }
        Err(_) => return None,
    };
    let width = if ip.is_ipv4() { 32 } else { 128 };
    let bits = bits.unwrap_or(width);
    (bits <= width).then_some((ip, bits))
}

#[cfg(any(test, not(any(target_os = "android", target_os = "ios"))))]
fn in_net(ip: IpAddr, net: IpAddr, bits: u8) -> bool {
    let (a, b, width) = match (ip, net) {
        (IpAddr::V4(a), IpAddr::V4(b)) => (u32::from(a).into(), u32::from(b).into(), 32),
        (IpAddr::V6(a), IpAddr::V6(b)) => (u128::from(a), u128::from(b), 128),
        _ => return false,
    };
    (a ^ b).checked_shr(width - u32::from(bits)).unwrap_or(0) == 0
}

/// `suffix_names` is NO_PROXY semantics (`corp` covers subdomains); otherwise
/// names are exact or `*` globs. Hostnames are never resolved to match IP entries.
#[cfg(any(test, not(any(target_os = "android", target_os = "ios"))))]
fn bypass_matches<'a>(
    entries: impl IntoIterator<Item = &'a str>,
    host: &str,
    port: u16,
    suffix_names: bool,
) -> bool {
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    let ip = host.parse::<IpAddr>().ok();
    entries.into_iter().any(|entry| {
        let entry = entry.trim().to_ascii_lowercase();
        let Some((pattern, only_port)) = split_host_port(&entry) else {
            return false;
        };
        if pattern.is_empty() || only_port.is_some_and(|p| p != port) {
            return false;
        }
        if pattern == "<local>" {
            return ip.is_none() && !host.contains('.');
        }
        if let Some((net, bits)) = parse_net(pattern) {
            return ip.is_some_and(|ip| in_net(ip, net, bits));
        }
        if suffix_names && pattern != "*" {
            if ip.is_some() {
                return false;
            }
            let domain = pattern.trim_start_matches('*').trim_start_matches('.');
            return host
                .strip_suffix(domain)
                .is_some_and(|rest| rest.is_empty() || rest.ends_with('.'));
        }
        glob(pattern, &host)
    })
}

#[cfg(any(target_os = "macos", test))]
fn parse_scutil(output: &str) -> Option<(ProxySpec, Vec<String>)> {
    let mut map = std::collections::HashMap::new();
    let mut exceptions = Vec::new();
    let mut in_exceptions = false;
    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("ExceptionsList") {
            in_exceptions = true;
            continue;
        }
        if in_exceptions {
            if line == "}" {
                in_exceptions = false;
            } else if let Some((_, v)) = line.split_once(" : ") {
                exceptions.push(v.trim().to_string());
            }
            continue;
        }
        if let Some((k, v)) = line.split_once(" : ") {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    let pick = |prefix: &str| -> Option<ProxyEndpoint> {
        if map.get(&format!("{prefix}Enable")).map(String::as_str) != Some("1") {
            return None;
        }
        let host = map.get(&format!("{prefix}Proxy"))?;
        let port = map.get(&format!("{prefix}Port"))?.parse().ok()?;
        Some(ProxyEndpoint {
            host: host.clone(),
            port,
            username: None,
            password: None,
        })
    };
    let spec = pick("SOCKS")
        .map(ProxySpec::Socks5)
        .or_else(|| pick("HTTPS").map(ProxySpec::Http))
        .or_else(|| pick("HTTP").map(ProxySpec::Http))?;
    if map.get("ExcludeSimpleHostnames").map(String::as_str) == Some("1") {
        exceptions.push("<local>".to_string());
    }
    Some((spec, exceptions))
}

#[cfg(any(
    test,
    not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "android",
        target_os = "ios"
    ))
))]
fn from_env(get: impl Fn(&str) -> Option<String>, host: &str, port: u16) -> Option<ProxySpec> {
    let var = |names: &[&str]| {
        names
            .iter()
            .find_map(|n| get(n).filter(|v| !v.trim().is_empty()))
    };
    let raw = var(&["ALL_PROXY", "all_proxy"]).or_else(|| var(&["HTTPS_PROXY", "https_proxy"]))?;
    let no_proxy = var(&["NO_PROXY", "no_proxy"]).unwrap_or_default();
    if bypass_matches(no_proxy.split(','), host, port, true) {
        return None;
    }
    parse_proxy_url(&raw)
}

/// The system proxy for a connection to `host:port`, or `None` to connect
/// directly. An empty `host` skips the bypass list (used to show the setting).
pub fn detect(host: &str, port: u16) -> Option<ProxySpec> {
    let found = detect_os(host, port);
    if found.is_none() {
        log::info!("system proxy: none usable, connecting directly");
    }
    found
}

#[cfg(target_os = "windows")]
fn detect_os(host: &str, port: u16) -> Option<ProxySpec> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;
    if key.get_u32("ProxyEnable").unwrap_or(0) == 0 {
        return None;
    }
    let spec = parse_windows_proxy_server(&key.get_string("ProxyServer").ok()?)?;
    let overrides = key.get_string("ProxyOverride").unwrap_or_default();
    (!bypass_matches(overrides.split(';'), host, port, false)).then_some(spec)
}

/// The lock is held across `fetch`, so a burst of pings shares one fetch.
#[cfg(any(target_os = "macos", test))]
fn cached<T: Clone>(
    slot: &std::sync::Mutex<Option<(std::time::Instant, T)>>,
    now: std::time::Instant,
    ttl: std::time::Duration,
    fetch: impl FnOnce() -> T,
) -> T {
    let mut slot = slot.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, value)) = slot.as_ref() {
        if now.saturating_duration_since(*at) < ttl {
            return value.clone();
        }
    }
    let value = fetch();
    *slot = Some((now, value.clone()));
    value
}

#[cfg(target_os = "macos")]
fn scutil_proxy(ttl: std::time::Duration) -> Option<(ProxySpec, Vec<String>)> {
    use std::sync::Mutex;
    use std::time::Instant;
    type Slot = Mutex<Option<(Instant, Option<(ProxySpec, Vec<String>)>)>>;
    static CACHE: Slot = Mutex::new(None);
    cached(&CACHE, Instant::now(), ttl, || {
        let out = std::process::Command::new("scutil")
            .arg("--proxy")
            .output()
            .ok()?;
        parse_scutil(&String::from_utf8_lossy(&out.stdout))
    })
}

#[cfg(target_os = "macos")]
fn detect_os(host: &str, port: u16) -> Option<ProxySpec> {
    // No host means the settings screen asked: always show the live value.
    let ttl = std::time::Duration::from_secs(if host.is_empty() { 0 } else { 5 });
    let (spec, exceptions) = scutil_proxy(ttl)?;
    let exceptions = exceptions.iter().map(String::as_str);
    (!bypass_matches(exceptions, host, port, false)).then_some(spec)
}

#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "android",
    target_os = "ios"
)))]
fn detect_os(host: &str, port: u16) -> Option<ProxySpec> {
    from_env(|k| std::env::var(k).ok(), host, port)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn detect_os(_host: &str, _port: u16) -> Option<ProxySpec> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(host: &str, port: u16) -> ProxyEndpoint {
        ProxyEndpoint {
            host: host.into(),
            port,
            username: None,
            password: None,
        }
    }

    #[test]
    fn windows_plain_host_port_is_http() {
        assert_eq!(
            parse_windows_proxy_server("proxy.corp:8080"),
            Some(ProxySpec::Http(ep("proxy.corp", 8080)))
        );
    }

    #[test]
    fn windows_per_scheme_prefers_https_then_http_then_socks() {
        assert_eq!(
            parse_windows_proxy_server("http=a:1;https=b:2;socks=c:3"),
            Some(ProxySpec::Http(ep("b", 2)))
        );
        assert_eq!(
            parse_windows_proxy_server("socks=c:3"),
            Some(ProxySpec::Socks5(ep("c", 3)))
        );
    }

    #[test]
    fn windows_empty_scheme_value_falls_back() {
        assert_eq!(
            parse_windows_proxy_server("https=;http=a:1"),
            Some(ProxySpec::Http(ep("a", 1)))
        );
        assert_eq!(
            parse_windows_proxy_server("https= ;http=;socks=c:3"),
            Some(ProxySpec::Socks5(ep("c", 3)))
        );
    }

    #[test]
    fn windows_scheme_prefix_is_honoured() {
        assert_eq!(
            parse_windows_proxy_server("socks5://c:1080"),
            Some(ProxySpec::Socks5(ep("c", 1080)))
        );
        assert_eq!(
            parse_windows_proxy_server("http://a:3128"),
            Some(ProxySpec::Http(ep("a", 3128)))
        );
        assert_eq!(
            parse_windows_proxy_server("https=https://b:8443"),
            Some(ProxySpec::Https(ep("b", 8443)))
        );
        assert_eq!(parse_windows_proxy_server(""), None);
    }

    /// A glob-style (Windows/macOS) bypass check for an SSH connection on port 22.
    fn bypassed(list: &[&str], host: &str) -> bool {
        bypass_matches(list.iter().copied(), host, 22, false)
    }

    #[test]
    fn bypass_local_token_and_wildcards() {
        let list = ["<local>", "*.corp.example", "10.*"];
        assert!(bypassed(&list, "intranet"));
        assert!(bypassed(&list, "git.corp.example"));
        assert!(bypassed(&list, "10.1.2.3"));
        assert!(!bypassed(&list, "github.com"));
        assert!(
            !bypassed(&list, "::1"),
            "an IP literal is not a simple name"
        );
        assert!(!bypassed(&["exact.host"], "other.host"));
        assert!(bypassed(&["EXACT.host"], "exact.HOST"));
    }

    #[test]
    fn bypass_ip_and_cidr_entries_match_literal_ips_only() {
        let list = ["169.254/16", "10.0.0.0/8", "192.168.1.*", "fd00::/8", "::1"];
        assert!(bypassed(&list, "169.254.3.4"));
        assert!(!bypassed(&list, "169.255.0.1"));
        assert!(bypassed(&list, "10.200.0.1"));
        assert!(bypassed(&list, "192.168.1.20"));
        assert!(!bypassed(&list, "192.168.2.20"));
        assert!(bypassed(&list, "fd12:3456::1"));
        assert!(bypassed(&list, "[fd12::1]"));
        assert!(!bypassed(&list, "fe80::1"));
        assert!(bypassed(&list, "0:0:0:0:0:0:0:1"));
        assert!(!bypassed(&list, "ten.example"), "names are never resolved");
        assert!(bypassed(&["0.0.0.0/0"], "8.8.8.8"));
        assert!(bypassed(&["::/0"], "2001:db8::1"));
        assert!(!bypassed(&["10/33", "1.2.3.4.5/8"], "10.0.0.1"));
    }

    #[test]
    fn bypass_entries_with_a_port_match_that_port_only() {
        let list = [
            "git.corp:22",
            "*.lab:2222",
            "[fd00::1]:22",
            "10.0.0.0/8",
            "any.host",
        ];
        let bypass = |host, port| bypass_matches(list, host, port, false);
        assert!(bypass("git.corp", 22) && !bypass("git.corp", 443));
        assert!(bypass("box.lab", 2222) && !bypass("box.lab", 22));
        assert!(bypass("fd00::1", 22) && !bypass("fd00::1", 23));
        assert!(bypass("10.1.1.1", 2200), "portless entries match any port");
        assert!(bypass("any.host", 8022));
        assert!(!bypass("", 22), "no target, nothing to bypass");
        assert!(!bypass_matches(["git.corp:x"], "git.corp", 22, false));
    }

    #[test]
    fn no_proxy_names_cover_subdomains() {
        let list = ["corp", ".lab", "*.test", "git.example:22"];
        let bypass = |host, port| bypass_matches(list, host, port, true);
        assert!(bypass("corp", 22) && bypass("a.b.corp", 22));
        assert!(bypass("lab", 22) && bypass("x.lab", 22));
        assert!(bypass("test", 22) && bypass("x.test", 22));
        assert!(!bypass("notcorp", 22));
        assert!(
            !bypass_matches(["0.1", "168.1.1"], "10.0.0.1", 22, true)
                && !bypass_matches(["168.1.1"], "192.168.1.1", 22, true),
            "names never suffix-match IP hosts"
        );
        assert!(bypass("git.example", 22) && bypass("a.git.example", 22));
        assert!(!bypass("git.example", 443));
        assert!(
            !bypassed(&["corp"], "a.corp"),
            "glob lists match names exactly"
        );
    }

    const SCUTIL: &str = "<dictionary> {\n  ExceptionsList : <array> {\n    0 : *.local\n    1 : 169.254/16\n  }\n  HTTPEnable : 1\n  HTTPPort : 8080\n  HTTPProxy : web.corp\n  HTTPSEnable : 1\n  HTTPSPort : 8443\n  HTTPSProxy : secure.corp\n  SOCKSEnable : 0\n}\n";

    #[test]
    fn scutil_exclude_simple_hostnames_bypasses_dotless_names() {
        let excluding = SCUTIL.replace(
            "  SOCKSEnable",
            "  ExcludeSimpleHostnames : 1\n  SOCKSEnable",
        );
        let (_, exceptions) = parse_scutil(&excluding).unwrap();
        let patterns: Vec<&str> = exceptions.iter().map(String::as_str).collect();
        assert!(bypassed(&patterns, "nas"));
        assert!(bypassed(&patterns, "printer.local"));
        assert!(bypassed(&patterns, "169.254.1.1"));
        assert!(!bypassed(&patterns, "github.com"));
        let (_, exceptions) = parse_scutil(SCUTIL).unwrap();
        assert!(!exceptions.iter().any(|e| e == "<local>"));
    }

    #[test]
    fn scutil_prefers_socks_then_https_then_http() {
        let (spec, exceptions) = parse_scutil(SCUTIL).unwrap();
        assert_eq!(spec, ProxySpec::Http(ep("secure.corp", 8443)));
        assert_eq!(
            exceptions,
            vec!["*.local".to_string(), "169.254/16".to_string()]
        );
        let socks = SCUTIL.replace(
            "SOCKSEnable : 0",
            "SOCKSEnable : 1\n  SOCKSPort : 1080\n  SOCKSProxy : s.corp",
        );
        assert_eq!(
            parse_scutil(&socks).unwrap().0,
            ProxySpec::Socks5(ep("s.corp", 1080))
        );
        assert!(parse_scutil("<dictionary> {\n  ProxyAutoConfigEnable : 1\n}\n").is_none());
    }

    #[test]
    fn cached_reuses_a_value_until_it_expires() {
        use std::sync::Mutex;
        use std::time::{Duration, Instant};
        let slot = Mutex::new(None);
        let ttl = Duration::from_secs(5);
        let t0 = Instant::now();
        let at = |secs| t0 + Duration::from_secs(secs);
        let mut fetches = 0;
        let mut fetch = |v: u32| {
            fetches += 1;
            v
        };
        assert_eq!(cached(&slot, at(0), ttl, || fetch(1)), 1);
        assert_eq!(cached(&slot, at(4), ttl, || fetch(2)), 1);
        assert_eq!(cached(&slot, at(5), ttl, || fetch(3)), 3);
        assert_eq!(cached(&slot, at(6), ttl, || fetch(4)), 3);
        assert_eq!(cached(&slot, at(6), Duration::ZERO, || fetch(5)), 5);
        assert_eq!(fetches, 3);
    }

    #[test]
    fn proxy_url_forms() {
        assert_eq!(
            parse_proxy_url("socks5h://h:1080"),
            Some(ProxySpec::Socks5(ep("h", 1080)))
        );
        assert_eq!(
            parse_proxy_url("socks://h"),
            Some(ProxySpec::Socks5(ep("h", 1080)))
        );
        assert_eq!(
            parse_proxy_url("http://h:3128/"),
            Some(ProxySpec::Http(ep("h", 3128)))
        );
        assert_eq!(
            parse_proxy_url("h:3128"),
            Some(ProxySpec::Http(ep("h", 3128)))
        );
        assert_eq!(
            parse_proxy_url("https://h"),
            Some(ProxySpec::Https(ep("h", 443)))
        );
        assert_eq!(parse_proxy_url("ftp://h:21"), None);
        assert_eq!(parse_proxy_url("http://fd00::1:3128"), None);
        assert_eq!(
            parse_proxy_url("http://[fd00::1]:3128"),
            Some(ProxySpec::Http(ep("fd00::1", 3128)))
        );
        assert_eq!(
            parse_proxy_url("http://us%40er:p%3Ass@h:8080"),
            Some(ProxySpec::Http(ProxyEndpoint {
                host: "h".into(),
                port: 8080,
                username: Some("us@er".into()),
                password: Some("p:ss".into()),
            }))
        );
    }

    #[test]
    fn env_precedence_and_no_proxy() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |k: &str| {
                pairs
                    .iter()
                    .find(|(n, _)| *n == k)
                    .map(|(_, v)| v.to_string())
            }
        };
        let both = env(&[
            ("ALL_PROXY", "socks5://s:1080"),
            ("HTTPS_PROXY", "http://h:3128"),
        ]);
        assert_eq!(
            from_env(both, "x.com", 22),
            Some(ProxySpec::Socks5(ep("s", 1080)))
        );
        let https_only = env(&[
            ("https_proxy", "http://h:3128"),
            ("no_proxy", ".corp,localhost"),
        ]);
        assert_eq!(
            from_env(https_only, "x.com", 22),
            Some(ProxySpec::Http(ep("h", 3128)))
        );
        assert_eq!(from_env(https_only, "git.corp", 22), None);
        assert_eq!(from_env(https_only, "localhost", 22), None);
        let tls = env(&[("HTTPS_PROXY", "https://t:8443")]);
        assert_eq!(
            from_env(tls, "x.com", 22),
            Some(ProxySpec::Https(ep("t", 8443)))
        );
        let star = env(&[("ALL_PROXY", "socks5://s:1080"), ("NO_PROXY", "*")]);
        assert_eq!(from_env(star, "x.com", 22), None);
        let with_port = env(&[
            ("ALL_PROXY", "socks5://s:1080"),
            ("NO_PROXY", "git.corp:22"),
        ]);
        assert_eq!(from_env(with_port, "git.corp", 22), None);
        assert_eq!(
            from_env(with_port, "git.corp", 2222),
            Some(ProxySpec::Socks5(ep("s", 1080)))
        );
    }
}
