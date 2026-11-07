use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub mod acl;
#[cfg(windows)]
mod acl_windows;

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

impl KeyType {
    pub fn name(self) -> &'static str {
        match self {
            KeyType::Bool => "bool",
            KeyType::String => "string",
            KeyType::Number => "number",
            KeyType::StringList => "stringList",
            KeyType::Json => "json",
        }
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum RangeField {
    Min,
    Max,
    Allowed,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub enum LockKind {
    #[default]
    #[serde(skip)]
    Replace,
    Add,
    Never,
}

#[derive(Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Domain {
    pub values: Option<Vec<Value>>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub shape: Option<String>,
    pub colors: Option<Vec<String>>,
    pub max_rules: Option<usize>,
    pub max_words: Option<usize>,
    pub max_length: Option<usize>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: KeyType,
    pub enforced: bool,
    pub default_applied: bool,
    pub domain: Option<Domain>,
    #[serde(default)]
    pub range: Vec<RangeField>,
    #[serde(default)]
    pub lock: LockKind,
    pub implies: Option<String>,
}

static KEYS: LazyLock<HashMap<String, KeyEntry>> = LazyLock::new(|| {
    let entries: Vec<KeyEntry> =
        serde_json::from_str(include_str!("keys.json")).expect("policy/keys.json is valid");
    entries.into_iter().map(|e| (e.id.clone(), e)).collect()
});

static GATED_PERMISSIONS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("gated_permissions.json"))
        .expect("policy/gated_permissions.json is valid")
});

pub fn is_gated_permission(perm: &str) -> bool {
    GATED_PERMISSIONS.contains(perm)
}

static RETIRED_PLUGINS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("retired_plugins.json"))
        .expect("policy/retired_plugins.json is valid")
});

pub fn is_retired_plugin(id: &str) -> bool {
    RETIRED_PLUGINS.contains(id)
}

pub fn key_ids() -> impl Iterator<Item = &'static str> {
    KEYS.keys().map(String::as_str)
}

pub fn key_def(id: &str) -> Option<&'static KeyEntry> {
    KEYS.get(id)
}

pub fn key_type(id: &str) -> Option<KeyType> {
    KEYS.get(id).map(|k| k.ty)
}

pub fn is_enforced(key: &str) -> bool {
    KEYS.get(key).is_some_and(|k| k.enforced)
}

pub fn is_default_applied(key: &str) -> bool {
    KEYS.get(key).is_some_and(|k| k.default_applied)
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

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IssueKind {
    File,
    Type,
    UnknownKey,
    NewerVersion,
    Range,
    Unprotected,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Issue {
    pub kind: IssueKind,
    pub layer: Option<Layer>,
    pub key: Option<String>,
    pub message: String,
}

impl Issue {
    pub fn general(kind: IssueKind, message: String) -> Self {
        Issue {
            kind,
            layer: None,
            key: None,
            message,
        }
    }
}

pub fn read_issue(path: &Path, e: &std::io::Error) -> Issue {
    let why = match e.kind() {
        std::io::ErrorKind::PermissionDenied => "permission denied".to_string(),
        _ => e.to_string(),
    };
    Issue::general(
        IssueKind::File,
        format!("cannot read {}: {why}", path.display()),
    )
}

pub fn version_issue(root: &serde_json::Map<String, Value>) -> Option<Issue> {
    let raw = root.get("version")?;
    let supported = u64::from(SUPPORTED_VERSION);
    match raw.as_u64() {
        Some(v) if v == supported => None,
        Some(v) if v > supported => Some(Issue::general(
            IssueKind::NewerVersion,
            format!("policy version {v} is newer than supported version {SUPPORTED_VERSION}; unknown content ignored"),
        )),
        _ => Some(Issue::general(
            IssueKind::File,
            format!("policy version {raw} is invalid; expected {SUPPORTED_VERSION}"),
        )),
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

fn is_http_url(s: &str) -> bool {
    url::Url::parse(s).is_ok_and(|u| matches!(u.scheme(), "http" | "https") && u.has_host())
}

pub fn value_problem(key: &str, ty: KeyType, v: &Value) -> Option<String> {
    if !value_matches(ty, v) {
        return Some(format!("value does not match type {}", ty.name()));
    }
    match (key, v) {
        ("server.url", Value::String(s)) if !is_http_url(s) => {
            Some("must be an absolute http(s) URL".to_string())
        }
        _ => None,
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
            kind: IssueKind::File,
            layer: Some(layer),
            key: None,
            message: format!("\"{}\" must be an object", layer.name()),
        });
        return out;
    };
    for (key, value) in map {
        let problem = if is_range_entry(value) {
            Some((
                IssueKind::Range,
                "range entries need a newer Voltius".into(),
            ))
        } else {
            match key_type(key) {
                None => Some((IssueKind::UnknownKey, "unknown key".into())),
                Some(ty) => value_problem(key, ty, value).map(|m| (IssueKind::Type, m)),
            }
        };
        match problem {
            Some((kind, message)) => issues.push(Issue {
                kind,
                layer: Some(layer),
                key: Some(key.clone()),
                message: format!("{message}; ignored"),
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
            issues.push(Issue::general(
                IssueKind::File,
                format!("invalid JSON: {e}"),
            ));
            return (PolicyDoc::default(), issues);
        }
    };
    let Some(obj) = root.as_object() else {
        issues.push(Issue::general(
            IssueKind::File,
            "policy file must be a JSON object".into(),
        ));
        return (PolicyDoc::default(), issues);
    };
    issues.extend(version_issue(obj));
    let version = obj
        .get("version")
        .and_then(Value::as_u64)
        .map_or(SUPPORTED_VERSION, |v| u32::try_from(v).unwrap_or(u32::MAX));
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
    default_machine_policy_path()
}

fn default_machine_policy_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let base =
            crate::win_security::program_data().unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
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

pub fn read_optional(path: &Path) -> std::io::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Guard {
    Missing,
    Link,
    Protected,
    Unprotected,
}

/// `text` is read from the same handle the guard was decided on, and only for a protected file.
#[derive(Debug)]
pub struct Entry {
    pub guard: Guard,
    pub hard_linked: bool,
    pub text: Option<std::io::Result<String>>,
}

impl Entry {
    pub fn new(guard: Guard) -> Self {
        Entry {
            guard,
            hard_linked: false,
            text: None,
        }
    }
}

pub type Probe = fn(&Path) -> std::io::Result<Entry>;

#[derive(Debug)]
pub enum Blocked {
    Link(PathBuf),
    Unprotected(PathBuf),
    Held(PathBuf),
    Io(PathBuf, std::io::Error),
}

#[derive(Clone, Copy)]
pub struct MachineAcl {
    pub probe: Probe,
    pub harden_dir: fn(&Path) -> Result<Option<PathBuf>, Blocked>,
    pub write: fn(&Path, &str) -> std::io::Result<()>,
    pub adopt_written: fn(&Path) -> Result<(), Blocked>,
}

#[cfg(windows)]
const OS_ACL: Option<MachineAcl> = Some(MachineAcl {
    probe: acl_windows::probe,
    harden_dir: acl_windows::harden_dir,
    write: acl_windows::write,
    adopt_written: acl_windows::adopt_written,
});
#[cfg(not(windows))]
const OS_ACL: Option<MachineAcl> = None;

fn paths_equal(a: &Path, b: &Path, ignore_case: bool) -> bool {
    if ignore_case {
        a.as_os_str().eq_ignore_ascii_case(b.as_os_str())
    } else {
        a == b
    }
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    paths_equal(a, b, cfg!(windows))
}

pub fn machine_acl(path: &Path) -> Option<MachineAcl> {
    OS_ACL.filter(|_| default_machine_policy_path().is_some_and(|d| same_path(&d, path)))
}

fn dir_of(path: &Path) -> &Path {
    path.parent().unwrap_or(path)
}

fn probe_both(path: &Path, probe: Probe) -> Result<(Entry, Entry), (PathBuf, std::io::Error)> {
    let at = |p: &Path| probe(p).map_err(|e| (p.to_path_buf(), e));
    Ok((at(dir_of(path))?, at(path)?))
}

pub enum Trust {
    Absent,
    Trusted(String),
    Ignored(Issue),
}

pub fn trust(path: &Path, probe: Probe) -> Trust {
    let why = match probe_both(path, probe) {
        Err((_, e)) => format!("its permissions could not be read ({e})"),
        Ok((dir, file)) => match (dir.guard, file.guard) {
            (Guard::Link, _) => "its folder is a link".to_string(),
            (_, Guard::Link) => "it is a link".to_string(),
            (_, Guard::Missing) => return Trust::Absent,
            (Guard::Protected, Guard::Protected) => {
                return match file.text.transpose() {
                    Ok(text) => Trust::Trusted(text.unwrap_or_default()),
                    Err(e) => Trust::Ignored(read_issue(path, &e)),
                }
            }
            _ => "standard users can change it".to_string(),
        },
    };
    Trust::Ignored(Issue::general(
        IssueKind::Unprotected,
        format!(
            "{} ignored because {why}; set it again with voltius-cli run as Administrator",
            path.display()
        ),
    ))
}

pub fn write_check(path: &Path, probe: Probe, replace: bool) -> Result<Option<String>, Blocked> {
    let (dir, file) = probe_both(path, probe).map_err(|(p, e)| Blocked::Io(p, e))?;
    match (dir.guard, file.guard) {
        (Guard::Link, _) => Err(Blocked::Link(dir_of(path).to_path_buf())),
        (_, Guard::Link) => Err(Blocked::Link(path.to_path_buf())),
        _ if file.hard_linked => Err(Blocked::Link(path.to_path_buf())),
        (_, Guard::Unprotected) if !replace => Err(Blocked::Unprotected(path.to_path_buf())),
        _ => file
            .text
            .transpose()
            .map_err(|e| Blocked::Io(path.to_path_buf(), e)),
    }
}

pub fn load_from(path: &Path) -> LoadedPolicy {
    load_with(path, machine_acl(path).map(|a| a.probe))
}

fn load_with(path: &Path, probe: Option<Probe>) -> LoadedPolicy {
    let read = match probe.map(|p| trust(path, p)) {
        Some(Trust::Absent) => Ok(None),
        Some(Trust::Ignored(issue)) => Err(issue),
        Some(Trust::Trusted(text)) => Ok(Some(text)),
        None => read_optional(path).map_err(|e| read_issue(path, &e)),
    };
    let (doc, issues) = match read {
        Ok(Some(text)) => parse(&text),
        Ok(None) => (PolicyDoc::default(), Vec::new()),
        Err(issue) => (PolicyDoc::default(), vec![issue]),
    };
    LoadedPolicy {
        path: Some(path.display().to_string()),
        doc,
        issues,
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

pub fn write_text_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    write_text_atomic_via(path, text, create_tmp)
}

pub fn write_text_atomic_via(
    path: &Path,
    text: &str,
    create: impl FnOnce(&Path) -> std::io::Result<std::fs::File>,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".{}-{nanos}.tmp", std::process::id()));
    let tmp = PathBuf::from(tmp);
    let file = create(&tmp)?;
    let result = write_tmp(file, text.as_bytes()).and_then(|()| std::fs::rename(&tmp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn create_tmp(tmp: &Path) -> std::io::Result<std::fs::File> {
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o644);
    opts.open(tmp)
}

fn write_tmp(mut file: std::fs::File, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    file.write_all(bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o644))?;
    }
    file.sync_all()
}

#[cfg(test)]
pub(crate) mod test_probes {
    use super::{Blocked, Entry, Guard, MachineAcl, Probe};
    use std::cell::{Cell, RefCell};
    use std::io;
    use std::path::{Path, PathBuf};

    pub const CHECKED: &str = r#"{"version":1,"policy":{"server.url":"https://checked.example"}}"#;

    fn is_file(p: &Path) -> bool {
        p.extension().is_some()
    }

    fn entry(p: &Path, dir: Guard, file: Guard) -> io::Result<Entry> {
        let guard = if is_file(p) { file } else { dir };
        Ok(Entry {
            guard,
            hard_linked: false,
            text: (is_file(p) && guard == Guard::Protected).then(|| Ok(CHECKED.to_string())),
        })
    }

    pub fn all_unprotected(p: &Path) -> io::Result<Entry> {
        entry(p, Guard::Unprotected, Guard::Unprotected)
    }

    pub fn file_unprotected(p: &Path) -> io::Result<Entry> {
        entry(p, Guard::Protected, Guard::Unprotected)
    }

    pub fn dir_unprotected(p: &Path) -> io::Result<Entry> {
        entry(p, Guard::Unprotected, Guard::Protected)
    }

    pub fn file_link(p: &Path) -> io::Result<Entry> {
        entry(p, Guard::Protected, Guard::Link)
    }

    pub fn dir_link_no_file(p: &Path) -> io::Result<Entry> {
        entry(p, Guard::Link, Guard::Missing)
    }

    pub fn unprotected_dir_no_file(p: &Path) -> io::Result<Entry> {
        entry(p, Guard::Unprotected, Guard::Missing)
    }

    pub fn unreadable_acl(_: &Path) -> io::Result<Entry> {
        Err(io::ErrorKind::PermissionDenied.into())
    }

    pub fn all_protected(p: &Path) -> io::Result<Entry> {
        entry(p, Guard::Protected, Guard::Protected)
    }

    pub fn hard_linked_protected(p: &Path) -> io::Result<Entry> {
        let mut e = all_protected(p)?;
        e.hard_linked = is_file(p);
        Ok(e)
    }

    pub fn unreadable_content(p: &Path) -> io::Result<Entry> {
        let mut e = all_protected(p)?;
        if is_file(p) {
            e.text = Some(Err(io::ErrorKind::InvalidData.into()));
        }
        Ok(e)
    }

    pub fn on_disk(p: &Path) -> io::Result<Entry> {
        if !p.exists() {
            return Ok(Entry::new(Guard::Missing));
        }
        Ok(Entry {
            text: is_file(p).then(|| std::fs::read_to_string(p)),
            ..Entry::new(Guard::Protected)
        })
    }

    pub fn harden_denied(p: &Path) -> Result<Option<PathBuf>, Blocked> {
        Err(Blocked::Io(
            p.to_path_buf(),
            io::ErrorKind::PermissionDenied.into(),
        ))
    }

    pub fn harden_held(p: &Path) -> Result<Option<PathBuf>, Blocked> {
        Err(Blocked::Held(super::dir_of(p).to_path_buf()))
    }

    pub fn harden_replacing(p: &Path) -> Result<Option<PathBuf>, Blocked> {
        record("harden_dir");
        let dir = super::dir_of(p);
        let at = |e| Blocked::Io(dir.to_path_buf(), e);
        let aside = super::acl::untrusted_sibling(dir, 1);
        std::fs::rename(dir, &aside).map_err(at)?;
        std::fs::create_dir(dir).map_err(at)?;
        Ok(Some(aside))
    }

    thread_local! {
        static CALLS: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
        static FILE_PROBES: Cell<u32> = const { Cell::new(0) };
    }

    fn record(call: &'static str) {
        CALLS.with_borrow_mut(|c| c.push(call));
    }

    pub fn calls() -> Vec<&'static str> {
        CALLS.with_borrow(Clone::clone)
    }

    pub fn appears_after_first_probe(p: &Path) -> io::Result<Entry> {
        if !is_file(p) {
            return Ok(Entry::new(Guard::Protected));
        }
        let n = FILE_PROBES.replace(FILE_PROBES.get() + 1);
        Ok(Entry::new(if n == 0 {
            Guard::Missing
        } else {
            Guard::Unprotected
        }))
    }

    pub fn acl(probe: Probe) -> MachineAcl {
        CALLS.with_borrow_mut(Vec::clear);
        FILE_PROBES.set(0);
        MachineAcl {
            probe,
            harden_dir: |_| {
                record("harden_dir");
                Ok(None)
            },
            write: |p, text| {
                record("write");
                super::write_text_atomic(p, text)
            },
            adopt_written: |_| {
                record("adopt_written");
                Ok(())
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_probes::*;
    use super::*;
    use serde_json::json;

    #[test]
    fn gated_permissions_mirror_the_plugin_list() {
        assert!(is_gated_permission("docker:manage"));
        assert!(!is_gated_permission("sessions:read"));
    }

    #[test]
    fn keys_json_domains_load() {
        let ttl = key_def("appSettings.detachedTtlHours").unwrap();
        assert_eq!(
            ttl.domain.as_ref().unwrap().values.as_ref().unwrap().len(),
            6
        );
        assert_eq!(
            ttl.implies.as_deref(),
            Some("appSettings.toggles.detached-session-ttl")
        );
        assert_eq!(
            ttl.range,
            [RangeField::Allowed, RangeField::Min, RangeField::Max]
        );
        assert_eq!(
            key_def("appSettings.terminal.keywordRules").unwrap().lock,
            LockKind::Add
        );
        assert_eq!(
            key_def("appSettings.plugins.overrides").unwrap().lock,
            LockKind::Never
        );
        assert_eq!(key_def("server.url").unwrap().lock, LockKind::Replace);
    }

    #[test]
    fn retired_plugins_mirror_the_app_list() {
        assert!(is_retired_plugin("plugin-ssh-config"));
        assert!(!is_retired_plugin("plugin-docker"));
    }

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
    fn parse_rejects_schemeless_server_url() {
        let (doc, issues) = parse(r#"{"policy":{"server.url":"voltius.acme.com"}}"#);
        assert!(doc.policy.is_empty());
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].key.as_deref(), Some("server.url"));
        let (doc, issues) = parse(r#"{"defaults":{"server.url":"ftp://voltius.acme.com"}}"#);
        assert!(doc.defaults.is_empty());
        assert_eq!(issues.len(), 1);
        let (doc, issues) = parse(r#"{"policy":{"server.url":"https://voltius.acme.com"}}"#);
        assert_eq!(doc.policy.len(), 1);
        assert!(issues.is_empty());
    }

    #[test]
    fn parse_flags_invalid_version() {
        for text in [
            r#"{"version":"1"}"#,
            r#"{"version":0}"#,
            r#"{"version":1.5}"#,
            r#"{"version":null}"#,
        ] {
            assert_eq!(parse(text).1.len(), 1, "{text}");
        }
        assert!(parse(r#"{"version":1}"#).1.is_empty());
        assert!(parse("{}").1.is_empty());
    }

    #[test]
    fn issues_carry_kind() {
        let kinds =
            |text: &str| -> Vec<IssueKind> { parse(text).1.iter().map(|i| i.kind).collect() };
        assert_eq!(kinds("{"), [IssueKind::File]);
        assert_eq!(kinds("[]"), [IssueKind::File]);
        assert_eq!(kinds(r#"{"policy":[]}"#), [IssueKind::File]);
        assert_eq!(kinds(r#"{"version":"x"}"#), [IssueKind::File]);
        assert_eq!(kinds(r#"{"version":2}"#), [IssueKind::NewerVersion]);
        assert_eq!(kinds(r#"{"policy":{"nope":1}}"#), [IssueKind::UnknownKey]);
        assert_eq!(
            kinds(r#"{"policy":{"sshConfig.import":1}}"#),
            [IssueKind::Type]
        );
        assert_eq!(
            kinds(r#"{"policy":{"server.url":{"$range":[1]}}}"#),
            [IssueKind::Range]
        );
        let issue = serde_json::to_value(&parse(r#"{"policy":{"nope":1}}"#).1[0]).unwrap();
        assert_eq!(issue["kind"], "unknownKey");
    }

    #[test]
    fn default_applied_comes_from_keys_json() {
        assert!(is_default_applied("server.url"));
        assert!(is_default_applied("appSettings.toggles.cursor-blink"));
        assert!(!is_default_applied("sshConfig.import"));
    }

    #[test]
    fn type_mismatch_names_keys_json_type() {
        let (_, issues) = parse(r#"{"policy":{"plugins.enabled":"x","sshConfig.import":1}}"#);
        let messages: Vec<&str> = issues.iter().map(|i| i.message.as_str()).collect();
        assert!(
            messages.iter().any(|m| m.contains("stringList")),
            "{messages:?}"
        );
        assert!(
            messages.iter().any(|m| m.contains("type bool")),
            "{messages:?}"
        );
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

    fn policy_file() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(
            &path,
            r#"{"version":1,"policy":{"sshConfig.import":false}}"#,
        )
        .unwrap();
        (dir, path)
    }

    #[test]
    fn load_ignores_unprotected_file() {
        let (_dir, path) = policy_file();
        for probe in [
            all_unprotected as Probe,
            file_unprotected,
            dir_unprotected,
            file_link,
            dir_link_no_file,
            unreadable_acl,
        ] {
            let loaded = load_with(&path, Some(probe));
            assert_eq!(loaded.doc, PolicyDoc::default());
            assert_eq!(loaded.issues.len(), 1);
            assert_eq!(loaded.issues[0].kind, IssueKind::Unprotected);
            assert!(loaded.issues[0].message.contains(path.to_str().unwrap()));
        }
        assert_eq!(load_with(&path, None).doc.policy.len(), 1);
    }

    #[test]
    fn app_reads_the_checked_handle_not_the_path() {
        let (_dir, path) = policy_file();
        let doc = load_with(&path, Some(all_protected)).doc;
        assert_eq!(doc.policy.len(), 1, "{:?}", doc.policy);
        assert_eq!(doc.policy["server.url"], json!("https://checked.example"));
    }

    #[test]
    fn app_trusts_a_hard_linked_protected_file_but_the_cli_refuses_it() {
        let (_dir, path) = policy_file();
        let doc = load_with(&path, Some(hard_linked_protected)).doc;
        assert_eq!(doc.policy["server.url"], json!("https://checked.example"));
        for replace in [false, true] {
            assert!(matches!(
                write_check(&path, hard_linked_protected, replace),
                Err(Blocked::Link(p)) if p == path
            ));
        }
    }

    #[test]
    fn a_content_read_error_is_not_a_permissions_problem() {
        let (_dir, path) = policy_file();
        let loaded = load_with(&path, Some(unreadable_content));
        assert_eq!(loaded.doc, PolicyDoc::default());
        assert_eq!(loaded.issues.len(), 1);
        let issue = &loaded.issues[0];
        assert_eq!(issue.kind, IssueKind::File);
        assert!(!issue.message.contains("permissions"), "{}", issue.message);
        assert!(issue.message.contains(path.to_str().unwrap()));
        assert!(matches!(
            write_check(&path, unreadable_content, false),
            Err(Blocked::Io(p, e)) if p == path && e.kind() == std::io::ErrorKind::InvalidData
        ));
    }

    #[test]
    fn missing_file_is_not_read_even_if_it_appears() {
        let (_dir, path) = policy_file();
        let loaded = load_with(&path, Some(unprotected_dir_no_file));
        assert_eq!(loaded.doc, PolicyDoc::default());
        assert!(loaded.issues.is_empty());
    }

    #[test]
    fn linked_folder_is_reported_without_a_file() {
        let path = Path::new("/x/Voltius/policy.json");
        let Trust::Ignored(issue) = trust(path, dir_link_no_file) else {
            panic!("a linked folder must be reported");
        };
        assert!(issue.message.contains("link"), "{}", issue.message);
        assert!(matches!(
            trust(path, unprotected_dir_no_file),
            Trust::Absent
        ));
        assert!(matches!(trust(path, all_protected), Trust::Trusted(t) if t == CHECKED));
    }

    #[test]
    fn write_check_refuses_links_and_unprotected_files() {
        let path = Path::new("/x/Voltius/policy.json");
        let check = |probe, replace| write_check(path, probe, replace);
        assert!(
            matches!(check(dir_link_no_file, true), Err(Blocked::Link(p)) if p == Path::new("/x/Voltius"))
        );
        assert!(matches!(check(file_link, true), Err(Blocked::Link(p)) if p == path));
        assert!(
            matches!(check(file_unprotected, false), Err(Blocked::Unprotected(p)) if p == path)
        );
        assert!(matches!(
            check(all_unprotected, false),
            Err(Blocked::Unprotected(_))
        ));
        assert!(matches!(check(unreadable_acl, false), Err(Blocked::Io(..))));
        assert!(check(file_unprotected, true).is_ok());
        assert!(check(dir_unprotected, false).is_ok());
        assert!(check(unprotected_dir_no_file, false).is_ok());
        assert_eq!(
            check(all_protected, false).unwrap().as_deref(),
            Some(CHECKED)
        );
    }

    #[test]
    fn machine_path_comparison_can_ignore_case() {
        let a = Path::new(r"C:\ProgramData\Voltius\policy.json");
        let b = Path::new(r"c:\programdata\VOLTIUS\Policy.json");
        assert!(paths_equal(a, b, true));
        assert!(!paths_equal(a, b, false));
        assert!(paths_equal(a, a, false));
    }

    #[test]
    fn non_default_path_skips_acl() {
        let dir = tempfile::tempdir().unwrap();
        assert!(machine_acl(&dir.path().join("policy.json")).is_none());
    }

    #[test]
    fn unprotected_issue_serializes_camel_case() {
        let Trust::Ignored(issue) = trust(Path::new("/x/policy.json"), all_unprotected) else {
            panic!("expected an issue");
        };
        assert_eq!(serde_json::to_value(&issue).unwrap()["kind"], "unprotected");
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
        write_text_atomic(&path, &serde_json::to_string_pretty(&doc).unwrap()).unwrap();
        let loaded = load_from(&path);
        assert_eq!(loaded.doc, doc);
        assert!(loaded.issues.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn write_text_atomic_sets_0644() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        write_text_atomic(&path, "{}\n").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o644);
    }

    #[test]
    fn write_text_atomic_cleans_tmp_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::create_dir(&path).unwrap();
        assert!(write_text_atomic(&path, "{}\n").is_err());
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["policy.json"]);
    }

    #[cfg(unix)]
    #[test]
    fn write_text_atomic_never_reuses_a_planted_file() {
        use std::os::unix::fs::MetadataExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let planted = dir.path().join("policy.json.tmp");
        std::fs::write(&path, "old").unwrap();
        std::fs::write(&planted, "planted").unwrap();
        let held = [&path, &planted].map(|p| std::fs::metadata(p).unwrap().ino());
        write_text_atomic(&path, "{}\n").unwrap();
        assert!(!held.contains(&std::fs::metadata(&path).unwrap().ino()));
        assert_eq!(std::fs::read_to_string(&planted).unwrap(), "planted");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}\n");
    }

    #[test]
    fn write_text_atomic_via_creates_the_tmp_through_the_given_creator() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let mut seen = None;
        write_text_atomic_via(&path, "{}\n", |tmp| {
            seen = Some(tmp.to_path_buf());
            std::fs::File::create_new(tmp)
        })
        .unwrap();
        let seen = seen.unwrap();
        assert_eq!(seen.parent(), Some(dir.path()));
        assert!(!seen.exists());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}\n");
        let refused = write_text_atomic_via(&path, "x", |_| {
            Err(std::io::ErrorKind::PermissionDenied.into())
        });
        assert!(refused.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}\n");
    }
}
