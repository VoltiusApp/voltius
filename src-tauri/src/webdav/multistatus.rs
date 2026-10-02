use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::Event;
use quick_xml::name::ResolveResult;
use quick_xml::NsReader;
use std::time::UNIX_EPOCH;

const DAV: &[u8] = b"DAV:";

#[derive(Debug, Default, Clone, PartialEq)]
pub struct DavEntry {
    pub href: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Clone, Copy)]
enum Field {
    Href,
    Length,
    Modified,
}

pub fn parse(xml: &str) -> Result<Vec<DavEntry>, String> {
    let bad = |e: &dyn std::fmt::Display| format!("Unreadable WebDAV listing: {e}");
    let mut reader = NsReader::from_str(xml);
    let mut entries = Vec::new();
    let mut current: Option<DavEntry> = None;
    let mut field: Option<Field> = None;
    let mut text = String::new();
    loop {
        match reader.read_resolved_event().map_err(|e| bad(&e))? {
            (ResolveResult::Bound(ns), Event::Start(e)) if ns.as_ref() == DAV => {
                match e.local_name().as_ref() {
                    b"response" => current = Some(DavEntry::default()),
                    b"collection" => mark_dir(&mut current),
                    b"href" => field = Some(Field::Href),
                    b"getcontentlength" => field = Some(Field::Length),
                    b"getlastmodified" => field = Some(Field::Modified),
                    _ => {}
                }
                text.clear();
            }
            (ResolveResult::Bound(ns), Event::Empty(e))
                if ns.as_ref() == DAV && e.local_name().as_ref() == b"collection" =>
            {
                mark_dir(&mut current)
            }
            (_, Event::Text(t)) if field.is_some() => {
                text.push_str(&t.decode().map_err(|e| bad(&e))?)
            }
            (_, Event::CData(t)) if field.is_some() => {
                text.push_str(&t.decode().map_err(|e| bad(&e))?)
            }
            (_, Event::GeneralRef(r)) if field.is_some() => {
                if let Some(ch) = r.resolve_char_ref().map_err(|e| bad(&e))? {
                    text.push(ch);
                } else if let Some(v) = resolve_predefined_entity(&r.decode().map_err(|e| bad(&e))?)
                {
                    text.push_str(v);
                }
            }
            (ResolveResult::Bound(ns), Event::End(e)) if ns.as_ref() == DAV => {
                match e.local_name().as_ref() {
                    b"response" => {
                        if let Some(entry) = current.take().filter(|c| !c.href.is_empty()) {
                            entries.push(entry);
                        }
                    }
                    b"href" | b"getcontentlength" | b"getlastmodified" => {
                        if let (Some(f), Some(entry)) = (field.take(), current.as_mut()) {
                            apply(f, text.trim(), entry);
                        }
                    }
                    _ => {}
                }
            }
            (_, Event::Eof) => break,
            _ => {}
        }
    }
    Ok(entries)
}

fn mark_dir(current: &mut Option<DavEntry>) {
    if let Some(entry) = current.as_mut() {
        entry.is_dir = true;
    }
}

fn apply(field: Field, value: &str, entry: &mut DavEntry) {
    match field {
        Field::Href => entry.href = value.to_string(),
        Field::Length => entry.size = value.parse().ok(),
        Field::Modified => {
            entry.modified = httpdate::parse_http_date(value)
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(xml: &str) -> Vec<DavEntry> {
        parse(xml).unwrap()
    }

    #[test]
    fn nextcloud_listing() {
        let e = entries(include_str!("fixtures/nextcloud.xml"));
        assert_eq!(e.len(), 3);
        assert_eq!(
            (e[0].href.as_str(), e[0].is_dir, e[0].size),
            ("/remote.php/dav/files/me/", true, None)
        );
        assert_eq!(
            (e[1].href.as_str(), e[1].is_dir),
            ("/remote.php/dav/files/me/Photos/", true)
        );
        assert_eq!(e[2].href, "/remote.php/dav/files/me/Notes%20%26%20todo.md");
        assert_eq!(
            (e[2].is_dir, e[2].size, e[2].modified),
            (false, Some(1234), Some(1_790_929_800))
        );
    }

    #[test]
    fn apache_live_props_under_another_prefix() {
        let e = entries(include_str!("fixtures/apache.xml"));
        assert_eq!(e[0].is_dir, true);
        assert_eq!(e[1].href, "http://nas.local/dav/r%C3%A9sum%C3%A9.pdf");
        assert_eq!((e[1].is_dir, e[1].size), (false, Some(42)));
    }

    #[test]
    fn entities_and_encoded_hrefs_decode() {
        let e = entries(include_str!("fixtures/nginx.xml"));
        assert_eq!(e[1].href, "/files/a&b.txt");
        let r = entries(include_str!("fixtures/rclone.xml"));
        assert_eq!((r[0].href.as_str(), r[0].is_dir), ("/sub", true));
        assert_eq!(
            (r[1].href.as_str(), r[1].modified),
            ("/sub/x%23y.txt", None)
        );
    }

    #[test]
    fn mismatched_tags_are_an_error() {
        assert!(parse("<a></b>").is_err());
    }
}
