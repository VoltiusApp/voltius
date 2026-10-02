use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use url::{Host, Url};

const SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'/')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

#[derive(Debug, Clone, PartialEq)]
pub struct DavBase {
    url: Url,
}

impl DavBase {
    pub fn parse(raw: &str) -> Result<Self, String> {
        let mut url = Url::parse(raw.trim()).map_err(|e| format!("Invalid WebDAV URL: {e}"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("A WebDAV URL starts with http:// or https://".into());
        }
        if url.host_str().is_none() {
            return Err("The WebDAV URL has no host".into());
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("Put the username and password in their own fields, not in the URL".into());
        }
        if url.query().is_some() || url.fragment().is_some() {
            return Err("A WebDAV URL cannot contain ? or #".into());
        }
        if !url.path().ends_with('/') {
            let path = format!("{}/", url.path());
            url.set_path(&path);
        }
        Ok(Self { url })
    }

    pub fn url(&self) -> &Url {
        &self.url
    }

    pub fn host(&self) -> String {
        match self.url.host() {
            Some(Host::Ipv6(ip)) => ip.to_string(),
            Some(host) => host.to_string(),
            None => String::new(),
        }
    }

    pub fn port(&self) -> u16 {
        self.url.port_or_known_default().unwrap_or(80)
    }

    pub fn url_for(&self, path: &str) -> Url {
        let tail: Vec<String> = normalize(path)
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| utf8_percent_encode(s, SEGMENT).to_string())
            .collect();
        let mut out = self.url.clone();
        out.set_path(&format!("{}{}", self.url.path(), tail.join("/")));
        out
    }

    pub fn dir_url_for(&self, path: &str) -> Url {
        let mut out = self.url_for(path);
        if !out.path().ends_with('/') {
            let p = format!("{}/", out.path());
            out.set_path(&p);
        }
        out
    }

    pub fn path_of(&self, href: &str) -> Option<String> {
        let full = decode(self.url.join(href).ok()?.path());
        let base = decode(self.url.path());
        let rel = if format!("{full}/") == base {
            ""
        } else {
            full.strip_prefix(base.as_str())?
        };
        Some(format!("/{}", rel.trim_end_matches('/')))
    }

    pub fn same_origin_redirect(&self, location: &str) -> Option<DavBase> {
        let target = self.url.join(location).ok()?;
        if target.origin() != self.url.origin() {
            return None;
        }
        DavBase::parse(target.as_str()).ok()
    }
}

fn decode(path: &str) -> String {
    percent_decode_str(path).decode_utf8_lossy().into_owned()
}

pub fn normalize(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    format!("/{}", out.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(raw: &str) -> DavBase {
        DavBase::parse(raw).unwrap()
    }

    #[test]
    fn parse_adds_the_trailing_slash_and_default_ports() {
        let b = base("https://cloud.example.com/remote.php/dav/files/me");
        assert_eq!(
            b.url().as_str(),
            "https://cloud.example.com/remote.php/dav/files/me/"
        );
        assert_eq!((b.host().as_str(), b.port()), ("cloud.example.com", 443));
        assert_eq!(base("http://nas.local").port(), 80);
        assert_eq!(base("http://nas.local:5005/dav/").port(), 5005);
        assert_eq!(base("https://[::1]:8443/").host(), "::1");
    }

    #[test]
    fn parse_rejects_what_cannot_be_a_dav_root() {
        for raw in [
            "ftp://h/",
            "https://u:p@h/",
            "https://h/?x=1",
            "https://h/#f",
            "not a url",
            "file:///tmp",
        ] {
            assert!(DavBase::parse(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn odd_names_round_trip_through_urls() {
        let b = base("https://h/dav/");
        for name in ["a b.txt", "100%.txt", "#tag", "q?.md", "ünï", "a&b", "x+y"] {
            let path = format!("/dir/{name}");
            let url = b.url_for(&path);
            assert_eq!(
                b.path_of(url.as_str()).as_deref(),
                Some(path.as_str()),
                "{name}"
            );
            assert_eq!(
                b.path_of(url.path()).as_deref(),
                Some(path.as_str()),
                "{name}"
            );
        }
    }

    #[test]
    fn the_base_itself_maps_to_root() {
        let b = base("https://h/dav/");
        assert_eq!(b.path_of("/dav/").as_deref(), Some("/"));
        assert_eq!(b.path_of("/dav").as_deref(), Some("/"));
        assert_eq!(b.path_of("/elsewhere/x"), None);
    }

    #[test]
    fn dot_dot_cannot_climb_above_the_base() {
        assert_eq!(normalize("/a/../../etc/./x/"), "/etc/x");
        assert_eq!(normalize("."), "/");
        assert_eq!(base("https://h/dav/").url_for("/../../x").path(), "/dav/x");
    }

    #[test]
    fn folders_get_a_trailing_slash() {
        assert_eq!(
            base("https://h/dav/").dir_url_for("/a b").path(),
            "/dav/a%20b/"
        );
        assert_eq!(base("https://h/dav/").dir_url_for("/").path(), "/dav/");
    }

    #[test]
    fn redirects_are_followed_only_on_the_same_origin() {
        let b = base("https://h/dav");
        assert_eq!(
            b.same_origin_redirect("/dav2/").unwrap().url().as_str(),
            "https://h/dav2/"
        );
        assert!(b
            .same_origin_redirect("https://evil.example/dav/")
            .is_none());
        assert!(b.same_origin_redirect("http://h/dav/").is_none());
    }
}
