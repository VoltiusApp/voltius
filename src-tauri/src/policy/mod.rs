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

fn nums_equal(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => x == y,
        _ => a == b,
    }
}

fn show(v: &Value) -> String {
    v.as_str().map_or_else(|| v.to_string(), str::to_string)
}

fn non_empty_str(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| !s.is_empty())
}

fn object_with<'a>(
    v: &'a Value,
    what: &str,
    allowed: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, String> {
    let o = v
        .as_object()
        .ok_or_else(|| format!("{what} must be an object"))?;
    match o.keys().find(|k| !allowed.contains(&k.as_str())) {
        Some(k) => Err(format!("unknown field {k}")),
        None => Ok(o),
    }
}

fn in_range_num(v: Option<&Value>, lo: f64, hi: f64) -> bool {
    v.and_then(Value::as_f64)
        .is_some_and(|n| (lo..=hi).contains(&n))
}

type Check = Result<(), String>;

fn fail<T>(msg: impl Into<String>) -> Result<T, String> {
    Err(msg.into())
}

fn shell_check(v: &Value) -> Check {
    if non_empty_str(Some(v)) {
        Ok(())
    } else {
        fail("must be a non-empty string")
    }
}

fn proxy_check(d: &Domain, v: &Value) -> Check {
    let o = object_with(
        v,
        "proxy",
        &["mode", "host", "port", "username", "password"],
    )?;
    if o.contains_key("password") {
        return fail("the policy file never carries a password; each user keeps their own");
    }
    let modes = d.values.as_deref().unwrap_or_default();
    let mode = o.get("mode").and_then(Value::as_str);
    let Some(mode) = mode.filter(|m| modes.iter().any(|x| x.as_str() == Some(m))) else {
        return fail(values_problem(modes));
    };
    let needs_host = !matches!(mode, "none" | "system");
    let host = o.get("host");
    if host.map_or(needs_host, |h| !non_empty_str(Some(h))) {
        return fail("host must be a non-empty string");
    }
    let port = o.get("port");
    let valid_port = |p: &Value| p.as_u64().is_some_and(|n| (1..=65535).contains(&n));
    if port.map_or(needs_host, |p| !valid_port(p)) {
        return fail("port must be an integer from 1 to 65535");
    }
    if o.get("username").is_some_and(|u| !u.is_string()) {
        return fail("username must be a string");
    }
    Ok(())
}

fn location_check(v: &Value) -> Check {
    let o = object_with(v, "location", &["lat", "lng", "label", "source"])?;
    if !in_range_num(o.get("lat"), -90.0, 90.0) {
        return fail("lat must be a number from -90 to 90");
    }
    if !in_range_num(o.get("lng"), -180.0, 180.0) {
        return fail("lng must be a number from -180 to 180");
    }
    if o.get("label").is_some_and(|l| !l.is_string()) {
        return fail("label must be a string");
    }
    if o.get("source")
        .is_some_and(|s| !matches!(s.as_str(), Some("manual" | "geo")))
    {
        return fail("source must be manual or geo");
    }
    Ok(())
}

// UTF-16 units, matching the app sanitizer's string length.
fn keyword_text_check(s: Option<&Value>, what: &str, max_len: usize) -> Check {
    let ok = s
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= max_len);
    if ok {
        Ok(())
    } else {
        fail(format!(
            "{what} must be a non-empty string of at most {max_len} characters"
        ))
    }
}

fn keyword_rule_check(d: &Domain, rule: &Value, seen: &mut HashSet<String>) -> Check {
    let max_len = d.max_length.unwrap_or(usize::MAX);
    let max_words = d.max_words.unwrap_or(usize::MAX);
    let o = object_with(rule, "a rule", &["id", "color", "words", "enabled"])?;
    keyword_text_check(o.get("id"), "id", max_len)?;
    let id = o["id"].as_str().unwrap_or_default();
    if !seen.insert(id.to_string()) {
        return fail(format!("duplicate rule id {id}"));
    }
    let colors = d.colors.as_deref().unwrap_or_default();
    if !o
        .get("color")
        .and_then(Value::as_str)
        .is_some_and(|c| colors.iter().any(|x| x == c))
    {
        return fail(format!("color must be one of: {}", colors.join(", ")));
    }
    let Some(words) = o
        .get("words")
        .and_then(Value::as_array)
        .filter(|w| (1..=max_words).contains(&w.len()))
    else {
        return fail(format!("words must be a list of 1 to {max_words} strings"));
    };
    for w in words {
        keyword_text_check(Some(w), "a word", max_len)?;
    }
    if o.get("enabled").is_some_and(|e| !e.is_boolean()) {
        return fail("enabled must be a boolean");
    }
    Ok(())
}

fn keyword_rules_check(d: &Domain, v: &Value) -> Check {
    let Some(rules) = v.as_array() else {
        return fail("must be a list of keyword rules");
    };
    if let Some(max) = d.max_rules.filter(|m| rules.len() > *m) {
        return fail(format!("at most {max} rules are allowed"));
    }
    let mut seen = HashSet::new();
    rules
        .iter()
        .try_for_each(|r| keyword_rule_check(d, r, &mut seen))
}

fn values_problem(values: &[Value]) -> String {
    let list: Vec<String> = values.iter().map(show).collect();
    format!("must be one of: {}", list.join(", "))
}

fn min_problem(d: &Domain, n: f64) -> Option<String> {
    d.min
        .filter(|m| n < *m)
        .map(|m| format!("must be at least {m}"))
}

fn domain_problem(d: &Domain, v: &Value) -> Option<String> {
    match d.shape.as_deref() {
        Some("shell") => return shell_check(v).err(),
        Some("proxy") => return proxy_check(d, v).err(),
        Some("location") => return location_check(v).err(),
        Some("keywordRules") => return keyword_rules_check(d, v).err(),
        _ => {}
    }
    if let Some(values) = &d.values {
        if !values.iter().any(|x| nums_equal(x, v)) {
            return Some(values_problem(values));
        }
    }
    v.as_f64().and_then(|n| min_problem(d, n))
}

pub fn value_problem(key: &str, ty: KeyType, v: &Value) -> Option<String> {
    if !value_matches(ty, v) {
        return Some(format!("value does not match type {}", ty.name()));
    }
    if let Some(p) = key_def(key)
        .and_then(|k| k.domain.as_ref())
        .and_then(|d| domain_problem(d, v))
    {
        return Some(p);
    }
    match (key, v) {
        ("server.url", Value::String(s)) if !is_http_url(s) => {
            Some("must be an absolute http(s) URL".to_string())
        }
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Range {
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub allowed: Option<Vec<Value>>,
}

pub fn parse_range(v: &Value) -> Result<Range, String> {
    let inner = v.as_object().and_then(|o| o.get("$range"));
    let o = object_with(
        inner.unwrap_or(&Value::Null),
        "a range",
        &["min", "max", "allowed"],
    )?;
    let malformed = || "min and max must be numbers and allowed a list".to_string();
    let bound = |k: &str| match o.get(k) {
        None => Ok(None),
        Some(n) => n.as_f64().map(Some).ok_or_else(malformed),
    };
    let allowed = match o.get("allowed") {
        None => None,
        Some(a) => Some(a.as_array().ok_or_else(malformed)?.clone()),
    };
    Ok(Range {
        min: bound("min")?,
        max: bound("max")?,
        allowed,
    })
}

pub fn range_of(v: &Value) -> Option<Range> {
    parse_range(v).ok()
}

pub fn within(_key: &str, r: &Range, v: &Value) -> bool {
    let n = v.as_f64();
    r.min.is_none_or(|m| n.is_some_and(|n| n >= m))
        && r.max.is_none_or(|m| n.is_some_and(|n| n <= m))
        && r.allowed
            .as_ref()
            .is_none_or(|a| a.iter().any(|x| nums_equal(x, v)))
}

pub fn range_problem(key: &str, r: &Range) -> Option<String> {
    let def = key_def(key)?;
    if def.range.is_empty() {
        return Some(format!("{key} takes a fixed value, not a range"));
    }
    let fields = [
        (RangeField::Min, "min", r.min.is_some()),
        (RangeField::Max, "max", r.max.is_some()),
        (RangeField::Allowed, "allowed", r.allowed.is_some()),
    ];
    if fields.iter().all(|f| !f.2) {
        return Some("a range needs min, max or allowed".into());
    }
    if fields
        .iter()
        .any(|(f, _, set)| *set && !def.range.contains(f))
    {
        let names: Vec<&str> = fields
            .iter()
            .filter(|(f, ..)| def.range.contains(f))
            .map(|f| f.1)
            .collect();
        return Some(format!("{key} range accepts only: {}", names.join(", ")));
    }
    if let (Some(lo), Some(hi)) = (r.min, r.max) {
        if lo > hi {
            return Some("min is above max".into());
        }
    }
    let domain = def.domain.as_ref();
    if let Some(p) = domain.and_then(|d| {
        [r.min, r.max]
            .into_iter()
            .flatten()
            .find_map(|n| min_problem(d, n))
    }) {
        return Some(p);
    }
    for entry in r.allowed.iter().flatten() {
        if let Some(p) = value_problem(key, def.ty, entry) {
            return Some(p);
        }
    }
    let empty = match domain.and_then(|d| d.values.as_ref()) {
        Some(values) => !values.iter().any(|v| within(key, r, v)),
        None => r.allowed.as_ref().is_some_and(Vec::is_empty),
    };
    empty.then(|| "leaves no allowed value".into())
}

fn nearest_to(candidates: Vec<&Value>, target: Option<f64>) -> Option<&Value> {
    let Some(t) = target else {
        return candidates.into_iter().next();
    };
    candidates.into_iter().min_by(|a, b| {
        let key = |v: &Value| {
            let n = v.as_f64().unwrap_or(f64::INFINITY);
            ((n - t).abs(), n)
        };
        key(a)
            .partial_cmp(&key(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}

pub fn bounded(
    key: &str,
    r: &Range,
    stored: Option<&Value>,
    admin_default: Option<&Value>,
    built_in: Option<&Value>,
) -> Value {
    let sources = [stored, admin_default, built_in];
    if let Some(v) = sources.into_iter().flatten().find(|v| within(key, r, v)) {
        return v.clone();
    }
    let def = key_def(key);
    let is_number = def.is_some_and(|d| d.ty == KeyType::Number);
    let domain = def.and_then(|d| d.domain.as_ref()?.values.as_ref());
    let allowed_in_domain = || {
        let allowed = r.allowed.as_ref()?;
        allowed
            .iter()
            .find(|a| domain.is_none_or(|d| d.iter().any(|x| nums_equal(x, a))))
    };
    if let Some(values) = domain {
        let picked = if is_number {
            let candidates = values.iter().filter(|v| within(key, r, v)).collect();
            nearest_to(candidates, stored.and_then(Value::as_f64))
        } else {
            allowed_in_domain()
        };
        if let Some(v) = picked {
            return v.clone();
        }
    }
    if is_number {
        let base = stored
            .and_then(Value::as_f64)
            .or(built_in.and_then(Value::as_f64));
        if let Some(n) = base {
            let n = r.min.map_or(n, |m| n.max(m));
            return number_value(r.max.map_or(n, |m| n.min(m)));
        }
    }
    allowed_in_domain()
        .or(r.allowed.as_ref().and_then(|a| a.first()))
        .cloned()
        .unwrap_or(Value::Null)
}

pub fn number_value(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9e15 {
        Value::from(n as i64)
    } else {
        Value::from(n)
    }
}

pub fn implied_lock(doc: &PolicyDoc, toggle_key: &str) -> Option<&'static str> {
    key_ids()
        .filter(|id| doc.policy.contains_key(*id))
        .filter(|id| key_def(id).and_then(|d| d.implies.as_deref()) == Some(toggle_key))
        .min()
}

pub fn blocks_user_write(doc: &PolicyDoc, key: &str) -> bool {
    let fixed_replace = doc.policy.get(key).is_some_and(|v| !is_range_entry(v))
        && key_def(key).is_some_and(|d| d.lock == LockKind::Replace);
    fixed_replace || implied_lock(doc, key).is_some()
}

pub fn conflicts(doc: &PolicyDoc) -> Vec<String> {
    doc.policy
        .iter()
        .filter(|(_, v)| **v == Value::Bool(false))
        .filter_map(|(toggle, _)| {
            let by = implied_lock(doc, toggle)?;
            Some(format!(
                "{toggle} is locked off but {by} forces it on; {by} wins"
            ))
        })
        .collect()
}

fn is_range_entry(v: &Value) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == 1 && o.contains_key("$range"))
}

pub fn lock_problem(layer: Layer, key: &str) -> Option<String> {
    (layer == Layer::Policy && key_def(key).is_some_and(|d| d.lock == LockKind::Never)).then(|| {
        "appSettings.plugins.overrides cannot be locked; use plugins.enabled / plugins.disabled"
            .to_string()
    })
}

fn entry_problem(layer: Layer, key: &str, value: &Value) -> Option<(IssueKind, String)> {
    let Some(def) = key_def(key) else {
        return Some((IssueKind::UnknownKey, "unknown key".to_string()));
    };
    if let Some(m) = lock_problem(layer, key) {
        return Some((IssueKind::Type, m));
    }
    if !is_range_entry(value) {
        return value_problem(key, def.ty, value).map(|m| (IssueKind::Type, m));
    }
    let problem = if layer == Layer::Defaults {
        Some("ranges belong under policy".to_string())
    } else {
        match parse_range(value) {
            Ok(r) => range_problem(key, &r),
            Err(m) => Some(m),
        }
    };
    problem.map(|m| (IssueKind::Range, m))
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
        match entry_problem(layer, key, value) {
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
            .filter(|n| n.is_finite())
            .map(number_value)
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
    fn parse_keeps_valid_range() {
        let (doc, issues) =
            parse(r#"{"policy":{"appSettings.detachedTtlHours":{"$range":{"max":24}}}}"#);
        assert!(issues.is_empty(), "{issues:?}");
        assert_eq!(
            doc.policy["appSettings.detachedTtlHours"],
            json!({"$range":{"max":24}})
        );
    }

    #[test]
    fn parse_rejects_bad_entries() {
        let rules = |n: usize| {
            let r: Vec<Value> = (0..n)
                .map(|i| json!({"id": format!("r{i}"), "color": "red", "words": ["x"]}))
                .collect();
            json!(r).to_string()
        };
        let rule = |id: &str, color: &str| json!({"id": id, "color": color, "words": ["x"]});
        let dup = json!([rule("a", "red"), rule("a", "blue")]).to_string();
        let pink = json!([rule("a", "pink")]).to_string();
        let rows: Vec<(&str, String, String, &str)> = vec![
            ("policy", "appSettings.locale".into(), r#""xx""#.into(), "must be one of: en, fr"),
            ("policy", "appSettings.detachedTtlHours".into(), "5".into(), "must be one of: 1, 6, 12"),
            ("policy", "appSettings.sftp.autoRefreshIntervalMs".into(), "100".into(), "must be at least 500"),
            ("policy", "appSettings.sftp.autoRefreshIntervalMs".into(), r#"{"$range":{"min":100}}"#.into(), "must be at least 500"),
            ("policy", "appSettings.detachedTtlHours".into(), r#"{"$range":{"min":25,"max":30}}"#.into(), "leaves no allowed value"),
            ("policy", "appSettings.detachedTtlHours".into(), r#"{"$range":{"allowed":[]}}"#.into(), "leaves no allowed value"),
            ("policy", "appSettings.detachedTtlHours".into(), r#"{"$range":{"min":30,"max":2}}"#.into(), "min is above max"),
            ("policy", "appSettings.detachedTtlHours".into(), r#"{"$range":{"allowed":[5]}}"#.into(), "must be one of"),
            ("policy", "appSettings.detachedTtlHours".into(), r#"{"$range":{}}"#.into(), "a range needs min, max or allowed"),
            ("policy", "appSettings.terminal.cursorStyle".into(), r#"{"$range":{"max":3}}"#.into(), "appSettings.terminal.cursorStyle range accepts only: allowed"),
            ("policy", "appSettings.proxy".into(), r#"{"$range":{"allowed":["none"]}}"#.into(), "appSettings.proxy takes a fixed value, not a range"),
            ("policy", "appSettings.terminal.preferredShell".into(), r#""""#.into(), "non-empty string"),
            ("policy", "appSettings.proxy".into(), r#"{"mode":"http","host":"p","port":1,"password":"x"}"#.into(), "the policy file never carries a password; each user keeps their own"),
            ("policy", "appSettings.proxy".into(), r#"{"mode":"http"}"#.into(), "host"),
            ("policy", "appSettings.proxy".into(), r#"{"mode":"http","host":"p","port":70000}"#.into(), "port"),
            ("policy", "appSettings.proxy".into(), r#"{"mode":"ftp"}"#.into(), "must be one of"),
            ("policy", "appSettings.proxy".into(), r#"{"mode":"none","host":5,"port":"abc"}"#.into(), "host must be a non-empty string"),
            ("policy", "appSettings.proxy".into(), r#"{"mode":"system","port":"abc"}"#.into(), "port must be an integer"),
            ("policy", "appSettings.detachedTtlHours".into(), r#"{"$range":{"max":24,"alowed":[6]}}"#.into(), "unknown field alowed"),
            ("policy", "appSettings.detachedTtlHours".into(), r#"{"$range":{"max":"24"}}"#.into(), "min and max must be numbers and allowed a list"),
            ("policy", "appSettings.detachedTtlHours".into(), r#"{"$range":[1]}"#.into(), "a range must be an object"),
            ("policy", "appSettings.terminal.keywordRules".into(), json!([{"id":"a","color":"red","words":["\u{1F600}".repeat(33)]}]).to_string(), "at most 64"),
            ("policy", "appSettings.proxy".into(), r#"{"mode":"none","extra":1}"#.into(), "unknown field extra"),
            ("policy", "appSettings.terminal.keywordRules".into(), rules(21), "at most 20"),
            ("policy", "appSettings.terminal.keywordRules".into(), dup, "duplicate"),
            ("policy", "appSettings.terminal.keywordRules".into(), pink, "color"),
            ("policy", "themes.location".into(), r#"{"lat":91,"lng":0}"#.into(), "lat"),
            ("policy", "themes.location".into(), r#"{"lat":1,"lng":0,"x":1}"#.into(), "unknown field x"),
            ("defaults", "appSettings.detachedTtlHours".into(), r#"{"$range":{"max":24}}"#.into(), "ranges belong under policy"),
            ("policy", "appSettings.plugins.overrides".into(), "{}".into(), "appSettings.plugins.overrides cannot be locked; use plugins.enabled / plugins.disabled"),
        ];
        for (layer, key, value, want) in rows {
            let (doc, issues) = parse(&format!(r#"{{"{layer}":{{"{key}":{value}}}}}"#));
            assert!(
                doc.policy.is_empty() && doc.defaults.is_empty(),
                "{key} {value}"
            );
            assert_eq!(issues.len(), 1, "{key} {value}: {issues:?}");
            assert!(
                issues[0].message.contains(want),
                "{key} {value}: {}",
                issues[0].message
            );
            assert!(issues[0].message.ends_with("; ignored"));
        }
    }

    #[test]
    fn parse_keeps_valid_fixed_values() {
        let text = json!({
            "policy": {
                "appSettings.proxy": {"mode": "system"},
                "appSettings.terminal.keywordRules": [
                    {"id": "a", "color": "red", "words": ["x", "y"]},
                    {"id": "b", "color": "brightBlue", "words": ["z"], "enabled": false}
                ],
                "appSettings.terminal.preferredShell": {"$range": {"allowed": ["/bin/bash", "zsh"]}},
                "appSettings.detachedTtlHours": 24.0,
                "appSettings.sftp.autoRefreshIntervalMs": {"$range": {"min": 1000, "max": 5000}},
                "themes.location": {"lat": 1.5, "lng": -3, "label": "x", "source": "geo"}
            },
            "defaults": {
                "appSettings.proxy": {"mode": "http", "host": "p", "port": 3128},
                "appSettings.plugins.overrides": {"a": 1}
            }
        })
        .to_string();
        let (doc, issues) = parse(&text);
        assert!(issues.is_empty(), "{issues:?}");
        assert_eq!(doc.policy.len(), 6);
        assert_eq!(doc.defaults.len(), 2);
    }

    #[test]
    fn within_compares_numerically() {
        let r = range_of(&json!({"$range": {"min": 6, "allowed": [6, 12, 24]}})).unwrap();
        assert!(within("appSettings.detachedTtlHours", &r, &json!(12.0)));
        assert!(!within("appSettings.detachedTtlHours", &r, &json!(1)));
        assert!(!within("appSettings.detachedTtlHours", &r, &json!(72)));
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
            kinds(r#"{"policy":{"appSettings.locale":{"$range":{}}}}"#),
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
        assert_eq!(parse_cli_value(KeyType::Number, "12"), Ok(json!(12)));
        assert_eq!(parse_cli_value(KeyType::Number, "2.5"), Ok(json!(2.5)));
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

    const TTL: &str = "appSettings.detachedTtlHours";
    const TTL_TOGGLE: &str = "appSettings.toggles.detached-session-ttl";

    fn doc_with(policy: Value) -> PolicyDoc {
        let (doc, issues) = parse(&json!({"version": 1, "policy": policy}).to_string());
        assert!(issues.is_empty(), "{issues:?}");
        doc
    }

    #[test]
    fn effective_fixture() {
        let rows: Vec<Value> =
            serde_json::from_str(include_str!("fixtures/effective.json")).unwrap();
        assert!(rows.len() >= 12);
        for row in rows {
            let name = row["name"].as_str().unwrap();
            let range = parse_range(&json!({"$range": row["range"]})).unwrap();
            let key = row["key"].as_str().unwrap();
            let opt = |k: &str| row.get(k).filter(|v| !v.is_null());
            let got = bounded(
                key,
                &range,
                opt("stored"),
                opt("adminDefault"),
                opt("builtIn"),
            );
            assert!(nums_equal(&got, &row["expect"]), "{name}: got {got}");
        }
    }

    #[test]
    fn implied_toggle_from_ttl_range() {
        let doc = doc_with(json!({TTL: {"$range": {"max": 24}}}));
        assert_eq!(implied_lock(&doc, TTL_TOGGLE), Some(TTL));
        assert_eq!(implied_lock(&doc_with(json!({})), TTL_TOGGLE), None);
    }

    #[test]
    fn keyword_lock_does_not_block_user_rules() {
        let doc = doc_with(json!({"appSettings.terminal.keywordRules": []}));
        assert!(!blocks_user_write(
            &doc,
            "appSettings.terminal.keywordRules"
        ));
        assert!(blocks_user_write(
            &doc,
            "appSettings.toggles.keyword-highlight"
        ));
    }

    #[test]
    fn range_does_not_block_writes() {
        let doc = doc_with(json!({TTL: {"$range": {"max": 24}}}));
        assert!(!blocks_user_write(&doc, TTL));
        assert!(blocks_user_write(&doc, TTL_TOGGLE));
        let fixed = doc_with(json!({TTL: 12}));
        assert!(blocks_user_write(&fixed, TTL));
    }

    #[test]
    fn conflict_reported() {
        let doc = doc_with(json!({TTL: {"$range": {"max": 24}}, TTL_TOGGLE: false}));
        assert_eq!(
            conflicts(&doc),
            vec![format!(
                "{TTL_TOGGLE} is locked off but {TTL} forces it on; {TTL} wins"
            )]
        );
        let on = doc_with(json!({TTL: {"$range": {"max": 24}}, TTL_TOGGLE: true}));
        assert!(conflicts(&on).is_empty());
    }

    #[test]
    fn bounded_clamp_returns_whole_numbers_as_integers() {
        let key = "appSettings.sftp.autoRefreshIntervalMs";
        let r = Range {
            min: Some(5000.0),
            max: None,
            allowed: None,
        };
        let v = bounded(key, &r, Some(&json!(1000)), None, None);
        assert_eq!(v.to_string(), "5000");
        assert_eq!(number_value(2.5).to_string(), "2.5");
    }
}
