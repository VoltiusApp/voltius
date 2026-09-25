#[cfg(any(test, not(any(target_os = "android", target_os = "ios"))))]
use super::ProxyEndpoint;
use super::ProxySpec;

#[cfg(any(
    test,
    not(any(target_os = "macos", target_os = "android", target_os = "ios"))
))]
fn endpoint(host_port: &str, default_port: u16) -> Option<ProxyEndpoint> {
    let s = host_port.trim().trim_end_matches('/');
    let (host, port) = if let Some(rest) = s.strip_prefix('[') {
        let (h, tail) = rest.split_once(']')?;
        let port = match tail.strip_prefix(':') {
            Some(p) => p.parse().ok()?,
            None => default_port,
        };
        (h, port)
    } else {
        match s.split_once(':') {
            Some((h, p)) => (h, p.parse().ok()?),
            None => (s, default_port),
        }
    };
    if host.is_empty() {
        return None;
    }
    Some(ProxyEndpoint {
        host: host.to_string(),
        port,
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
    let socks = match scheme.to_ascii_lowercase().as_str() {
        "socks" | "socks5" | "socks5h" => true,
        "http" => false,
        _ => return None,
    };
    let mut ep = endpoint(
        host_port.split('/').next().unwrap_or(""),
        if socks { 1080 } else { 80 },
    )?;
    if let Some(info) = userinfo {
        let (u, p) = info.split_once(':').unwrap_or((info, ""));
        ep.username = Some(percent_decode(u));
        ep.password = Some(percent_decode(p));
    }
    Some(if socks {
        ProxySpec::Socks5(ep)
    } else {
        ProxySpec::Http(ep)
    })
}

#[cfg(any(target_os = "windows", test))]
pub fn parse_windows_proxy_server(value: &str) -> Option<ProxySpec> {
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
            k.trim()
                .eq_ignore_ascii_case(scheme)
                .then(|| v.trim().to_string())
        })
    };
    if let Some(v) = entry("https").or_else(|| entry("http")) {
        return parse_proxy_url(&v);
    }
    entry("socks")
        .and_then(|v| endpoint(v.split("://").last().unwrap_or(&v), 1080))
        .map(ProxySpec::Socks5)
}

#[cfg(any(target_os = "windows", target_os = "macos", test))]
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

#[cfg(any(target_os = "windows", target_os = "macos", test))]
pub fn bypass_matches(patterns: &[&str], host: &str, local_token: bool) -> bool {
    let host = host.to_ascii_lowercase();
    patterns
        .iter()
        .map(|p| p.trim().to_ascii_lowercase())
        .any(|p| {
            if local_token && p == "<local>" {
                !host.contains('.')
            } else {
                !p.is_empty() && glob(&p, &host)
            }
        })
}

#[cfg(any(target_os = "macos", test))]
pub fn parse_scutil(output: &str) -> Option<(ProxySpec, Vec<String>)> {
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
pub fn from_env(get: impl Fn(&str) -> Option<String>, host: &str) -> Option<ProxySpec> {
    let var = |names: &[&str]| {
        names
            .iter()
            .find_map(|n| get(n).filter(|v| !v.trim().is_empty()))
    };
    let raw = var(&["ALL_PROXY", "all_proxy"]).or_else(|| var(&["HTTPS_PROXY", "https_proxy"]))?;
    if let Some(no_proxy) = var(&["NO_PROXY", "no_proxy"]) {
        let host = host.to_ascii_lowercase();
        let skip = no_proxy
            .split(',')
            .map(|e| e.trim().to_ascii_lowercase())
            .any(|e| {
                e == "*"
                    || (!e.is_empty()
                        && (host == e.trim_start_matches('.')
                            || host.ends_with(&format!(".{}", e.trim_start_matches('.')))))
            });
        if skip && !host.is_empty() {
            return None;
        }
    }
    parse_proxy_url(&raw)
}

pub fn detect(host: &str) -> Option<ProxySpec> {
    let found = detect_os(host);
    if found.is_none() {
        log::info!("system proxy: none usable, connecting directly");
    }
    found
}

#[cfg(target_os = "windows")]
fn detect_os(host: &str) -> Option<ProxySpec> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;
    if key.get_u32("ProxyEnable").unwrap_or(0) == 0 {
        return None;
    }
    let spec = parse_windows_proxy_server(&key.get_string("ProxyServer").ok()?)?;
    let overrides = key.get_string("ProxyOverride").unwrap_or_default();
    let patterns: Vec<&str> = overrides.split(';').collect();
    (host.is_empty() || !bypass_matches(&patterns, host, true)).then_some(spec)
}

#[cfg(target_os = "macos")]
fn detect_os(host: &str) -> Option<ProxySpec> {
    let out = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    let (spec, exceptions) = parse_scutil(&String::from_utf8_lossy(&out.stdout))?;
    let patterns: Vec<&str> = exceptions.iter().map(String::as_str).collect();
    (host.is_empty() || !bypass_matches(&patterns, host, false)).then_some(spec)
}

#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "android",
    target_os = "ios"
)))]
fn detect_os(host: &str) -> Option<ProxySpec> {
    from_env(|k| std::env::var(k).ok(), host)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn detect_os(_host: &str) -> Option<ProxySpec> {
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
    fn windows_scheme_prefix_is_honoured() {
        assert_eq!(
            parse_windows_proxy_server("socks5://c:1080"),
            Some(ProxySpec::Socks5(ep("c", 1080)))
        );
        assert_eq!(
            parse_windows_proxy_server("http://a:3128"),
            Some(ProxySpec::Http(ep("a", 3128)))
        );
        assert_eq!(parse_windows_proxy_server(""), None);
    }

    #[test]
    fn bypass_local_token_and_wildcards() {
        let list = ["<local>", "*.corp.example", "10.*"];
        assert!(bypass_matches(&list, "intranet", true));
        assert!(bypass_matches(&list, "git.corp.example", true));
        assert!(bypass_matches(&list, "10.1.2.3", true));
        assert!(!bypass_matches(&list, "github.com", true));
        assert!(!bypass_matches(&["exact.host"], "other.host", false));
        assert!(bypass_matches(&["EXACT.host"], "exact.HOST", false));
    }

    const SCUTIL: &str = "<dictionary> {\n  ExceptionsList : <array> {\n    0 : *.local\n    1 : 169.254/16\n  }\n  HTTPEnable : 1\n  HTTPPort : 8080\n  HTTPProxy : web.corp\n  HTTPSEnable : 1\n  HTTPSPort : 8443\n  HTTPSProxy : secure.corp\n  SOCKSEnable : 0\n}\n";

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
        assert_eq!(parse_proxy_url("https://h:443"), None);
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
            from_env(both, "x.com"),
            Some(ProxySpec::Socks5(ep("s", 1080)))
        );
        let https_only = env(&[
            ("https_proxy", "http://h:3128"),
            ("no_proxy", ".corp,localhost"),
        ]);
        assert_eq!(
            from_env(https_only, "x.com"),
            Some(ProxySpec::Http(ep("h", 3128)))
        );
        assert_eq!(from_env(https_only, "git.corp"), None);
        assert_eq!(from_env(https_only, "localhost"), None);
        let star = env(&[("ALL_PROXY", "socks5://s:1080"), ("NO_PROXY", "*")]);
        assert_eq!(from_env(star, "x.com"), None);
    }
}
