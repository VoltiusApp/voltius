use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

const SUPPORTED_VERSION: u32 = 1;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum KeyType {
    Bool,
    String,
    Number,
    StringList,
    Json,
}

#[derive(Deserialize)]
struct KeyEntry {
    id: String,
    #[serde(rename = "type")]
    ty: KeyType,
}

static KEYS: LazyLock<HashMap<String, KeyType>> = LazyLock::new(|| {
    let entries: Vec<KeyEntry> =
        serde_json::from_str(include_str!("keys.json")).expect("policy/keys.json is valid");
    entries.into_iter().map(|e| (e.id, e.ty)).collect()
});

pub fn key_ids() -> impl Iterator<Item = &'static str> {
    KEYS.keys().map(String::as_str)
}

pub fn key_type(id: &str) -> Option<KeyType> {
    KEYS.get(id).copied()
}

#[derive(Serialize, Deserialize, Default, Clone, PartialEq, Debug)]
pub struct PolicyDoc {
    pub version: u32,
    pub policy: BTreeMap<String, Value>,
    pub defaults: BTreeMap<String, Value>,
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Layer {
    Policy,
    Defaults,
}

impl Layer {
    pub fn name(self) -> &'static str {
        match self {
            Layer::Policy => "policy",
            Layer::Defaults => "defaults",
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Issue {
    pub layer: Option<Layer>,
    pub key: Option<String>,
    pub message: String,
}

impl Issue {
    fn general(message: String) -> Self {
        Issue {
            layer: None,
            key: None,
            message,
        }
    }
}

fn value_matches(ty: KeyType, v: &Value) -> bool {
    match ty {
        KeyType::Bool => v.is_boolean(),
        KeyType::String => v.is_string(),
        KeyType::Number => v.is_number(),
        KeyType::StringList => v.as_array().is_some_and(|a| a.iter().all(Value::is_string)),
        KeyType::Json => true,
    }
}

fn is_range_entry(v: &Value) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == 1 && o.contains_key("$range"))
}

fn validate_layer(
    layer: Layer,
    raw: Option<&Value>,
    issues: &mut Vec<Issue>,
) -> BTreeMap<String, Value> {
    let mut out = BTreeMap::new();
    let Some(raw) = raw else { return out };
    let Some(map) = raw.as_object() else {
        issues.push(Issue {
            layer: Some(layer),
            key: None,
            message: format!("\"{}\" must be an object", layer.name()),
        });
        return out;
    };
    for (key, value) in map {
        let problem = if is_range_entry(value) {
            Some("range entries need a newer Voltius; ignored".to_string())
        } else {
            match key_type(key) {
                None => Some("unknown key; ignored".to_string()),
                Some(ty) if !value_matches(ty, value) => {
                    Some(format!("value does not match type {ty:?}; ignored"))
                }
                Some(_) => None,
            }
        };
        match problem {
            Some(message) => issues.push(Issue {
                layer: Some(layer),
                key: Some(key.clone()),
                message,
            }),
            None => {
                out.insert(key.clone(), value.clone());
            }
        }
    }
    out
}

pub fn parse(text: &str) -> (PolicyDoc, Vec<Issue>) {
    let mut issues = Vec::new();
    let root: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            issues.push(Issue::general(format!("invalid JSON: {e}")));
            return (PolicyDoc::default(), issues);
        }
    };
    let Some(obj) = root.as_object() else {
        issues.push(Issue::general("policy file must be a JSON object".into()));
        return (PolicyDoc::default(), issues);
    };
    let version = obj
        .get("version")
        .and_then(Value::as_u64)
        .map_or(SUPPORTED_VERSION, |v| u32::try_from(v).unwrap_or(u32::MAX));
    if version > SUPPORTED_VERSION {
        issues.push(Issue::general(format!(
            "policy version {version} is newer than supported version {SUPPORTED_VERSION}; unknown content ignored"
        )));
    }
    let policy = validate_layer(Layer::Policy, obj.get("policy"), &mut issues);
    let defaults = validate_layer(Layer::Defaults, obj.get("defaults"), &mut issues);
    (
        PolicyDoc {
            version,
            policy,
            defaults,
        },
        issues,
    )
}

pub fn parse_cli_value(ty: KeyType, raw: &str) -> Result<Value, String> {
    match ty {
        KeyType::Bool => match raw {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            _ => Err(format!("expected true or false, got \"{raw}\"")),
        },
        KeyType::Number => raw
            .trim()
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .ok_or_else(|| format!("expected a number, got \"{raw}\"")),
        KeyType::String => Ok(Value::String(raw.to_string())),
        KeyType::StringList => {
            let v = if raw.trim_start().starts_with('[') {
                serde_json::from_str::<Value>(raw).map_err(|e| format!("invalid JSON list: {e}"))?
            } else {
                Value::Array(
                    raw.split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(|s| Value::String(s.to_string()))
                        .collect(),
                )
            };
            if value_matches(KeyType::StringList, &v) {
                Ok(v)
            } else {
                Err("expected a list of strings".to_string())
            }
        }
        KeyType::Json => serde_json::from_str(raw).map_err(|e| format!("invalid JSON: {e}")),
    }
}

pub fn machine_policy_path() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("VOLTIUS_POLICY_PATH") {
        return Some(PathBuf::from(p));
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("ProgramData")
            .map_or_else(|| PathBuf::from(r"C:\ProgramData"), PathBuf::from);
        Some(base.join("Voltius").join("policy.json"))
    }
    #[cfg(target_os = "macos")]
    {
        Some(PathBuf::from(
            "/Library/Application Support/Voltius/policy.json",
        ))
    }
    #[cfg(any(
        target_os = "linux",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        Some(PathBuf::from("/etc/voltius/policy.json"))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        None
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPolicy {
    pub path: Option<String>,
    pub doc: PolicyDoc,
    pub issues: Vec<Issue>,
}

pub fn load_from(path: &Path) -> LoadedPolicy {
    let path_str = Some(path.display().to_string());
    match std::fs::read_to_string(path) {
        Ok(text) => {
            let (doc, issues) = parse(&text);
            LoadedPolicy {
                path: path_str,
                doc,
                issues,
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => LoadedPolicy {
            path: path_str,
            doc: PolicyDoc::default(),
            issues: Vec::new(),
        },
        Err(e) => LoadedPolicy {
            path: path_str,
            doc: PolicyDoc::default(),
            issues: vec![Issue::general(format!(
                "cannot read {}: {e}",
                path.display()
            ))],
        },
    }
}

pub fn load_machine() -> LoadedPolicy {
    match machine_policy_path() {
        Some(p) => load_from(&p),
        None => LoadedPolicy {
            path: None,
            doc: PolicyDoc::default(),
            issues: Vec::new(),
        },
    }
}

pub fn write_atomic(path: &Path, doc: &PolicyDoc) -> std::io::Result<()> {
    let mut text = serde_json::to_string_pretty(doc).map_err(std::io::Error::other)?;
    text.push('\n');
    write_text_atomic(path, &text)
}

pub fn write_text_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let result = write_tmp(&tmp, text.as_bytes()).and_then(|()| std::fs::rename(&tmp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn write_tmp(tmp: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o644);
    let mut file = opts.open(tmp)?;
    file.write_all(bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o644))?;
    }
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_keeps_valid_and_drops_unknown() {
        let (doc, issues) = parse(r#"{"version":1,"policy":{"server.url":"https://a","nope":1}}"#);
        assert_eq!(doc.policy.len(), 1);
        assert_eq!(doc.policy["server.url"], json!("https://a"));
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].key.as_deref(), Some("nope"));
    }

    #[test]
    fn parse_rejects_wrong_type() {
        let (doc, issues) = parse(r#"{"policy":{"sshConfig.import":"no"}}"#);
        assert!(doc.policy.is_empty());
        assert_eq!(issues.len(), 1);
    }

    #[test]
    fn parse_ignores_range_entries() {
        let (doc, issues) =
            parse(r#"{"policy":{"appSettings.detachedTtlHours":{"$range":{"max":24}}}}"#);
        assert!(doc.policy.is_empty());
        assert_eq!(issues.len(), 1);
        assert!(issues[0].message.contains("newer Voltius"));
    }

    #[test]
    fn parse_invalid_json_is_issue_not_panic() {
        let (doc, issues) = parse("{");
        assert_eq!(doc, PolicyDoc::default());
        assert_eq!(issues.len(), 1);
    }

    #[test]
    fn parse_future_version_keeps_known_keys() {
        let (doc, issues) = parse(r#"{"version":2,"policy":{"server.url":"https://a"}}"#);
        assert!(doc.policy.contains_key("server.url"));
        assert_eq!(issues.len(), 1);
    }

    #[test]
    fn cli_value_parsing() {
        assert_eq!(parse_cli_value(KeyType::Bool, "true"), Ok(json!(true)));
        assert!(parse_cli_value(KeyType::Bool, "yes").is_err());
        assert_eq!(
            parse_cli_value(KeyType::StringList, "a,b"),
            Ok(json!(["a", "b"]))
        );
        assert_eq!(
            parse_cli_value(KeyType::StringList, "[\"a\"]"),
            Ok(json!(["a"]))
        );
        assert_eq!(parse_cli_value(KeyType::Number, "12"), Ok(json!(12.0)));
    }

    #[test]
    fn load_missing_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = load_from(&dir.path().join("policy.json"));
        assert_eq!(loaded.doc, PolicyDoc::default());
        assert!(loaded.issues.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn load_reports_unreadable_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let loaded = load_from(&path);
        assert_eq!(loaded.doc, PolicyDoc::default());
        assert_eq!(loaded.issues.len(), 1);
        assert!(loaded.issues[0].message.contains(path.to_str().unwrap()));
    }

    #[test]
    fn write_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("policy.json");
        let mut doc = PolicyDoc {
            version: 1,
            ..Default::default()
        };
        doc.policy.insert("server.url".into(), json!("https://a"));
        doc.defaults.insert("sshConfig.import".into(), json!(true));
        write_atomic(&path, &doc).unwrap();
        let loaded = load_from(&path);
        assert_eq!(loaded.doc, doc);
        assert!(loaded.issues.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn write_atomic_sets_0644() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        write_atomic(&path, &PolicyDoc::default()).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o644);
    }

    #[test]
    fn write_atomic_cleans_tmp_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::create_dir(&path).unwrap();
        assert!(write_atomic(&path, &PolicyDoc::default()).is_err());
        assert!(!dir.path().join("policy.json.tmp").exists());
    }
}
