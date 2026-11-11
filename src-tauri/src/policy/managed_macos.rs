use super::managed_config::{is_known_key, managed_config_doc};
use super::{read_issue, trust_guards, Guard, Issue, IssueKind, LoadedPolicy, PolicyDoc, Trust};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

pub fn profile_path() -> Option<PathBuf> {
    cfg!(target_os = "macos")
        .then(|| PathBuf::from("/Library/Managed Preferences/com.voltius.app.plist"))
}

#[cfg(unix)]
pub fn unix_guard(path: &Path) -> std::io::Result<Guard> {
    use std::os::unix::fs::MetadataExt;
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Guard::Missing),
        Err(e) => return Err(e),
    };
    Ok(if meta.file_type().is_symlink() {
        Guard::Link
    } else if meta.uid() == 0 && meta.mode() & 0o022 == 0 {
        Guard::Protected
    } else {
        Guard::Unprotected
    })
}

pub fn load_profile(
    path: &Path,
    guard: fn(&Path) -> std::io::Result<Guard>,
) -> Option<LoadedPolicy> {
    let (doc, issues) = match trust_guards(path, guard, "push the profile again from your MDM") {
        Trust::Absent => return None,
        Trust::Ignored(issue) => (PolicyDoc::default(), vec![issue]),
        Trust::Trusted(()) => match read_profile(path) {
            Ok(bundle) => managed_config_doc(&bundle),
            Err(issue) => (PolicyDoc::default(), vec![issue]),
        },
    };
    Some(LoadedPolicy {
        path: Some(path.display().to_string()),
        doc,
        issues,
    })
}

fn read_profile(path: &Path) -> Result<Value, Issue> {
    let bytes = std::fs::read(path).map_err(|e| read_issue(path, &e))?;
    let unparsable = |why: String| {
        Issue::general(
            IssueKind::File,
            format!("cannot parse {}: {why}", path.display()),
        )
    };
    let dict = plist::Value::from_reader(std::io::Cursor::new(bytes))
        .map_err(|e| unparsable(e.to_string()))?
        .into_dictionary()
        .ok_or_else(|| unparsable("not a dictionary".to_string()))?;
    let known: Map<String, Value> = dict
        .into_iter()
        .filter(|(key, _)| is_known_key(key))
        .map(|(key, value)| (key, json_value(value)))
        .collect();
    Ok(Value::Object(known))
}

fn json_value(value: plist::Value) -> Value {
    match value {
        plist::Value::String(s) => Value::String(s),
        plist::Value::Boolean(b) => Value::Bool(b),
        plist::Value::Integer(i) => i
            .as_signed()
            .map(Value::from)
            .or_else(|| i.as_unsigned().map(Value::from))
            .unwrap_or(Value::Null),
        plist::Value::Real(r) => Value::from(r),
        _ => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io;

    fn on_disk(p: &Path, dir: Guard, file: Guard) -> io::Result<Guard> {
        Ok(if p.is_dir() {
            dir
        } else if p.exists() {
            file
        } else {
            Guard::Missing
        })
    }

    fn protected(p: &Path) -> io::Result<Guard> {
        on_disk(p, Guard::Protected, Guard::Protected)
    }

    fn file_unprotected(p: &Path) -> io::Result<Guard> {
        on_disk(p, Guard::Protected, Guard::Unprotected)
    }

    fn dir_unprotected(p: &Path) -> io::Result<Guard> {
        on_disk(p, Guard::Unprotected, Guard::Protected)
    }

    fn file_link(p: &Path) -> io::Result<Guard> {
        on_disk(p, Guard::Protected, Guard::Link)
    }

    fn written(bytes: &[u8]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("com.voltius.app.plist");
        std::fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    fn xml(entries: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>{entries}</dict></plist>"#
        )
    }

    fn load(entries: &str, guard: fn(&Path) -> io::Result<Guard>) -> (LoadedPolicy, PathBuf) {
        let (_dir, path) = written(xml(entries).as_bytes());
        (load_profile(&path, guard).unwrap(), path)
    }

    const SERVER: &str = "<key>server_url</key><string>https://sync.example.com</string>\
        <key>server_allow_other</key><false/>";

    fn assert_server(loaded: &LoadedPolicy) {
        assert!(loaded.issues.is_empty(), "{:?}", loaded.issues);
        assert_eq!(
            loaded.doc.policy["server.url"],
            json!("https://sync.example.com")
        );
        assert_eq!(loaded.doc.policy["server.allowOther"], json!(false));
    }

    #[test]
    fn missing_file_is_no_profile() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_profile(&dir.path().join("absent.plist"), protected).is_none());
    }

    #[test]
    fn xml_plist_keys_become_policy() {
        let (loaded, path) = load(SERVER, protected);
        assert_server(&loaded);
        assert_eq!(loaded.path, Some(path.display().to_string()));
    }

    #[test]
    fn binary_plist_parses() {
        let mut dict = plist::Dictionary::new();
        dict.insert("server_url".into(), "https://sync.example.com".into());
        dict.insert("server_allow_other".into(), false.into());
        let mut bytes = Vec::new();
        plist::Value::Dictionary(dict)
            .to_writer_binary(&mut bytes)
            .unwrap();
        let (_dir, path) = written(&bytes);
        assert_server(&load_profile(&path, protected).unwrap());
    }

    #[test]
    fn policy_string_is_parsed() {
        let text =
            r#"{"version":1,"policy":{"appSettings.terminal.cursorStyle":"bar"},"defaults":{}}"#;
        let (loaded, _) = load(
            &format!("<key>policy</key><string>{text}</string>"),
            protected,
        );
        assert!(loaded.issues.is_empty(), "{:?}", loaded.issues);
        assert_eq!(
            loaded.doc.policy["appSettings.terminal.cursorStyle"],
            json!("bar")
        );
    }

    #[test]
    fn vendor_keys_are_ignored_silently() {
        let vendor = "<key>PayloadUUID</key><string>5D1C2B3A-0000-0000-0000-000000000000</string>\
            <key>PayloadIdentifier</key><string>com.voltius.app</string>";
        let (loaded, _) = load(&format!("{vendor}{SERVER}"), protected);
        assert_server(&loaded);
    }

    #[test]
    fn non_string_policy_is_a_type_issue() {
        let (loaded, _) = load("<key>policy</key><integer>3</integer>", protected);
        let kinds: Vec<_> = loaded.issues.iter().map(|i| i.kind).collect();
        assert_eq!(kinds, [IssueKind::File]);
    }

    fn assert_ignored(guard: fn(&Path) -> io::Result<Guard>, why: &str) {
        let (loaded, path) = load(SERVER, guard);
        assert!(loaded.doc.policy.is_empty());
        assert_eq!(loaded.issues.len(), 1, "{:?}", loaded.issues);
        let issue = &loaded.issues[0];
        assert_eq!(issue.kind, IssueKind::Unprotected);
        assert!(
            issue.message.contains(path.to_str().unwrap()),
            "{}",
            issue.message
        );
        assert!(issue.message.contains(why), "{}", issue.message);
        assert!(
            issue
                .message
                .ends_with("push the profile again from your MDM"),
            "{}",
            issue.message
        );
    }

    #[test]
    fn unprotected_file_is_ignored() {
        assert_ignored(file_unprotected, "standard users can change it");
    }

    #[test]
    fn unprotected_folder_is_ignored() {
        assert_ignored(dir_unprotected, "standard users can change it");
    }

    #[test]
    fn link_is_ignored() {
        assert_ignored(file_link, "it is a link");
    }

    #[test]
    fn garbage_plist_is_a_file_issue() {
        let (_dir, path) = written(b"not a plist");
        let loaded = load_profile(&path, protected).unwrap();
        assert!(loaded.doc.policy.is_empty());
        assert_eq!(loaded.issues.len(), 1, "{:?}", loaded.issues);
        assert_eq!(loaded.issues[0].kind, IssueKind::File);
        assert!(loaded.issues[0].message.contains(path.to_str().unwrap()));
    }

    #[cfg(unix)]
    #[test]
    fn unix_guard_reports_user_owned_as_unprotected() {
        let (dir, path) = written(b"x");
        let link = dir.path().join("link.plist");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert_eq!(unix_guard(&path).unwrap(), Guard::Unprotected);
        assert_eq!(unix_guard(&link).unwrap(), Guard::Link);
        assert_eq!(
            unix_guard(&dir.path().join("absent")).unwrap(),
            Guard::Missing
        );
    }
}
