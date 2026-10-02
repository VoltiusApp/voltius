use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use url::Url;

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
        let joined = self.url.join(href).ok()?;
        if joined.origin() != self.url.origin() {
            return None;
        }
        let base = decoded_segments(self.url.path())?;
        let full = decoded_segments(joined.path())?;
        if full.len() < base.len() || full[..base.len()] != base[..] {
            return None;
        }
        let rest = &full[base.len()..];
        if rest
            .iter()
            .any(|s| s.contains('/') || s == "." || s == "..")
        {
            return None;
        }
        Some(format!("/{}", rest.join("/")))
    }

    pub fn same_origin_redirect(&self, location: &str) -> Option<DavBase> {
        DavBase::parse(same_origin_join(&self.url, location)?.as_str()).ok()
    }
}

pub fn same_origin_join(base: &Url, location: &str) -> Option<Url> {
    let target = base.join(location).ok()?;
    (target.origin() == base.origin()).then_some(target)
}

fn decoded_segments(path: &str) -> Option<Vec<String>> {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            percent_decode_str(s)
                .decode_utf8()
                .ok()
                .map(|c| c.into_owned())
        })
        .collect()
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
    fn parse_adds_the_trailing_slash() {
        let b = base("https://cloud.example.com/remote.php/dav/files/me");
        assert_eq!(
            b.url().as_str(),
            "https://cloud.example.com/remote.php/dav/files/me/"
        );
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

    #[test]
    fn hrefs_cannot_escape_or_split_names() {
        let b = base("https://h/dav/");
        for href in [
            "/dav/..%2F..%2Fetc%2Fpasswd",
            "/dav/%2e%2e/x",
            "/dav/a%2Fb",
            "https://evil.example/dav/x",
            "http://h/dav/x",
            "/dav/%FF",
        ] {
            assert_eq!(b.path_of(href), None, "{href}");
        }
    }

    #[test]
    fn encoded_base_segments_match_decoded() {
        let b = base("https://h/my%20files/");
        assert_eq!(b.path_of("/my files/a.txt").as_deref(), Some("/a.txt"));
        assert_eq!(b.path_of("/my%20files/a.txt").as_deref(), Some("/a.txt"));
    }
}
