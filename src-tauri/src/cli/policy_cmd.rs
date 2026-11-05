use super::output::Output;
use super::{Access, CliError};
use crate::cli_state::{mirror, pending};
use crate::policy::{self, Blocked, Issue, IssueKind, Layer, MachineAcl, PolicyDoc, Trust};
use clap::Subcommand;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Subcommand, Debug)]
pub enum PolicyCmd {
    /// Lock a setting to a value on this machine
    Set {
        key: String,
        value: String,
        /// Set a default users may override instead of a locked value
        #[arg(long)]
        defaults: bool,
    },
    /// Remove a setting from the machine policy file
    Unset {
        key: String,
        #[arg(long)]
        defaults: bool,
    },
    /// Show each setting's effective value and where it comes from
    Show,
    /// Validate a policy file (default: the machine file)
    Check { file: Option<PathBuf> },
    /// Merge a policy file into the machine file; nothing is written if it has any issue
    Import {
        file: PathBuf,
        /// Discard the machine file's current content and write exactly this file
        #[arg(long)]
        replace: bool,
    },
    /// Print the machine policy file
    Export,
    /// Print where the machine policy file lives
    Path,
}

pub fn run(cmd: PolicyCmd, machine: Option<&Path>, out: &mut Output) -> Result<(), CliError> {
    let Some(path) = machine else {
        return match cmd {
            PolicyCmd::Path => print_path(None, out),
            _ => Err(CliError::Usage(
                "policy commands are not available on this platform".into(),
            )),
        };
    };
    let acl = policy::machine_acl(path);
    match cmd {
        PolicyCmd::Set {
            key,
            value,
            defaults,
        } => set(&key, &value, layer_of(defaults), path, out),
        PolicyCmd::Unset { key, defaults } => unset(&key, layer_of(defaults), path, out),
        PolicyCmd::Show => show(path, user_dir().as_deref(), out),
        PolicyCmd::Check { file } => check(file.as_deref(), path, acl.map(|a| a.probe), out),
        PolicyCmd::Import { file, replace } => import(&file, path, acl, replace, out),
        PolicyCmd::Export => export(path, out),
        PolicyCmd::Path => print_path(Some(path), out),
    }
}

fn print_path(machine: Option<&Path>, out: &mut Output) -> Result<(), CliError> {
    if out.json {
        out.json(&json!({ "path": machine.map(|p| p.display().to_string()) }));
    } else {
        match machine {
            Some(p) => out.line(p.display()),
            None => out.line("no machine policy on this platform"),
        }
    }
    Ok(())
}

pub(super) fn layer_of(defaults: bool) -> Layer {
    if defaults {
        Layer::Defaults
    } else {
        Layer::Policy
    }
}

fn layers(doc: &PolicyDoc) -> [(Layer, &BTreeMap<String, Value>); 2] {
    [
        (Layer::Policy, &doc.policy),
        (Layer::Defaults, &doc.defaults),
    ]
}

fn entries(doc: &PolicyDoc) -> impl Iterator<Item = (Layer, &str)> {
    layers(doc)
        .into_iter()
        .flat_map(|(layer, map)| map.keys().map(move |k| (layer, k.as_str())))
}

fn io_error(path: &Path, access: Access, e: std::io::Error) -> CliError {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        CliError::Permission(access, path.to_path_buf())
    } else {
        CliError::Io(e)
    }
}

fn not_found(path: &Path) -> CliError {
    CliError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("{} does not exist", path.display()),
    ))
}

fn read_text(path: &Path) -> Result<Option<String>, CliError> {
    policy::read_optional(path).map_err(|e| io_error(path, Access::Read, e))
}

pub(super) type Raw = serde_json::Map<String, Value>;

pub(super) fn plain(kind: IssueKind, message: String) -> CliError {
    CliError::Validation(vec![Issue::general(kind, message)])
}

pub(super) fn unusable(path: &Path, why: &str) -> CliError {
    plain(
        IssueKind::File,
        format!(
            "{} {why}; fix it or run `voltius-cli policy check`",
            path.display()
        ),
    )
}

fn empty_root() -> Raw {
    let mut root = Raw::new();
    root.insert("version".into(), json!(1));
    root.insert("policy".into(), json!({}));
    root.insert("defaults".into(), json!({}));
    root
}

fn load_raw(path: &Path) -> Result<Raw, CliError> {
    let Some(text) = read_text(path)? else {
        return Ok(empty_root());
    };
    let Ok(Value::Object(root)) = serde_json::from_str::<Value>(&text) else {
        return Err(unusable(path, "is not a valid policy file"));
    };
    if policy::version_issue(&root).is_some() {
        return Err(unusable(path, "has an unsupported version"));
    }
    Ok(root)
}

pub(super) fn layer_entries<'a>(
    root: &'a mut Raw,
    layer: Layer,
    path: &Path,
) -> Result<&'a mut Raw, CliError> {
    root.entry(layer.name())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            unusable(
                path,
                &format!("has a malformed \"{}\" section", layer.name()),
            )
        })
}

fn blocked(b: Blocked) -> CliError {
    match b {
        Blocked::Link(p) => CliError::Denied(format!(
            "{} is a link; delete it and run again",
            p.display()
        )),
        Blocked::Unprotected(p) => plain(
            IssueKind::Unprotected,
            format!(
                "{} was writable by standard users; review it, then run \
                 `voltius-cli policy import --replace <reviewed file>` or delete it",
                p.display()
            ),
        ),
        Blocked::Io(p, e) => io_error(&p, Access::Write, e),
    }
}

pub(super) fn edit_raw(
    path: &Path,
    edit: impl FnOnce(&mut Raw) -> Result<bool, CliError>,
) -> Result<bool, CliError> {
    edit_raw_with(path, policy::machine_acl(path), false, edit)
}

fn edit_raw_with(
    path: &Path,
    acl: Option<MachineAcl>,
    replace: bool,
    edit: impl FnOnce(&mut Raw) -> Result<bool, CliError>,
) -> Result<bool, CliError> {
    if let Some(a) = acl {
        let check = || policy::write_check(path, a.probe, replace).map_err(blocked);
        check()?;
        (a.harden_dir)(path).map_err(blocked)?;
        // Re-check once standard users can no longer add or swap entries in the folder.
        check()?;
    }
    let mut root = if replace {
        empty_root()
    } else {
        load_raw(path)?
    };
    root.entry("version").or_insert_with(|| json!(1));
    let changed = edit(&mut root)?;
    if changed {
        let mut text = serde_json::to_string_pretty(&root).map_err(|e| CliError::Io(e.into()))?;
        text.push('\n');
        policy::write_text_atomic(path, &text).map_err(|e| io_error(path, Access::Write, e))?;
        if let Some(a) = acl {
            // The renamed-in file is owned by the caller's token owner, which may not be an admin SID.
            (a.adopt_written)(path).map_err(blocked)?;
        }
    }
    Ok(changed)
}

fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cur = row[j + 1];
            row[j + 1] = (prev + usize::from(ca != *cb)).min(row[j] + 1).min(cur + 1);
            prev = cur;
        }
    }
    row[b.len()]
}

pub(super) fn unknown_message<'a>(
    what: &str,
    key: &str,
    candidates: impl Iterator<Item = &'a str>,
) -> String {
    let closest = candidates.map(|id| (edit_distance(key, id), id)).min();
    match closest {
        Some((d, id)) if d <= key.len() / 3 + 2 => {
            format!("unknown {what} \"{key}\"; did you mean \"{id}\"?")
        }
        _ => format!("unknown {what} \"{key}\""),
    }
}

pub(super) fn unknown_key_message(key: &str) -> String {
    unknown_message("key", key, policy::key_ids())
}

pub(super) fn machine_path(machine: Option<&Path>) -> Result<&Path, CliError> {
    machine
        .ok_or_else(|| CliError::Usage("machine policy is not available on this platform".into()))
}

fn not_honoured_message(layer: Layer, key: &str) -> Option<String> {
    match layer {
        Layer::Policy if !policy::is_enforced(key) => Some(format!(
            "{key} is saved but this version of Voltius does not enforce it yet"
        )),
        Layer::Defaults if !policy::is_default_applied(key) => Some(format!(
            "{key} is saved as a default but this version of Voltius does not apply defaults for it yet"
        )),
        _ => None,
    }
}

fn not_honoured<'a>(
    entries: impl IntoIterator<Item = (Layer, &'a str)>,
) -> impl Iterator<Item = (Layer, &'a str, String)> {
    entries
        .into_iter()
        .filter_map(|(layer, key)| not_honoured_message(layer, key).map(|m| (layer, key, m)))
}

fn warn_not_honoured<'a>(out: &mut Output, entries: impl IntoIterator<Item = (Layer, &'a str)>) {
    for (_, _, message) in not_honoured(entries) {
        out.warn(message);
    }
}

pub(super) fn typed_value(key: &str, ty: policy::KeyType, raw: &str) -> Result<Value, CliError> {
    policy::parse_cli_value(ty, raw)
        .and_then(|v| policy::value_problem(key, ty, &v).map_or(Ok(v), Err))
        .map_err(|m| plain(IssueKind::Type, format!("{key}: {m}")))
}

pub(super) fn set(
    key: &str,
    raw: &str,
    layer: Layer,
    path: &Path,
    out: &mut Output,
) -> Result<(), CliError> {
    let ty = policy::key_type(key)
        .ok_or_else(|| plain(IssueKind::UnknownKey, unknown_key_message(key)))?;
    let value = typed_value(key, ty, raw)?;
    edit_raw(path, |root| {
        layer_entries(root, layer, path)?.insert(key.to_string(), value);
        Ok(true)
    })?;
    out.line(format!("Set {key} in {}", layer.name()));
    warn_not_honoured(out, [(layer, key)]);
    Ok(())
}

fn unset(key: &str, layer: Layer, path: &Path, out: &mut Output) -> Result<(), CliError> {
    let removed = edit_raw(path, |root| {
        Ok(layer_entries(root, layer, path)?.remove(key).is_some())
    })?;
    if removed {
        out.line(format!("Removed {key} from {}", layer.name()));
    } else {
        out.line(format!("{key} is not set in {}", layer.name()));
    }
    Ok(())
}

struct Row {
    value: Value,
    source: &'static str,
    default_value: Option<Value>,
}

impl Row {
    fn new(value: Value, source: &'static str) -> Self {
        Row {
            value,
            source,
            default_value: None,
        }
    }
}

fn user_values(dir: &Path) -> (BTreeMap<String, Row>, Option<String>) {
    let mut rows = BTreeMap::new();
    let mut as_of = None;
    let mut put = |key: String, value: Value, source: &'static str| {
        rows.insert(key, Row::new(value, source));
    };
    if let Some(m) = mirror::read(dir) {
        for (k, v) in m.values() {
            put(k, v, "app");
        }
        as_of = Some(m.written_at);
    }
    for (k, (v, _)) in pending::load(dir).0.queued_values() {
        put(k, v, "pending");
    }
    (rows, as_of)
}

fn effective_rows(doc: &PolicyDoc, mut rows: BTreeMap<String, Row>) -> BTreeMap<String, Row> {
    for (k, v) in &doc.defaults {
        match rows.get_mut(k) {
            Some(r) if r.value != *v => r.default_value = Some(v.clone()),
            _ => {
                rows.insert(k.clone(), Row::new(v.clone(), "machine default"));
            }
        }
    }
    for (k, v) in &doc.policy {
        rows.insert(k.clone(), Row::new(v.clone(), "machine policy"));
    }
    rows
}

fn show(path: &Path, user_dir: Option<&Path>, out: &mut Output) -> Result<(), CliError> {
    let loaded = policy::load_from(path);
    let (user, as_of) = user_dir.map_or_else(Default::default, user_values);
    let rows = effective_rows(&loaded.doc, user);
    if out.json {
        let entries: Vec<Value> = rows
            .iter()
            .map(|(k, r)| {
                let mut e = json!({ "key": k, "value": r.value, "source": r.source });
                if let Some(u) = &r.default_value {
                    e["defaultValue"] = u.clone();
                }
                e
            })
            .collect();
        out.json(&json!({
            "path": loaded.path,
            "entries": entries,
            "issues": loaded.issues,
            "mirrorAsOf": as_of,
        }));
        return Ok(());
    }
    let bold = anstyle::Style::new().bold();
    let dim = anstyle::Style::new().dimmed();
    out.line(format!(
        "{bold}Effective settings{bold:#} {dim}{}{dim:#}",
        path.display()
    ));
    if rows.is_empty() {
        out.line(format!("  {dim}none{dim:#}"));
    }
    for (k, r) in &rows {
        let note = match &r.default_value {
            Some(u) => format!(", machine default: {u}"),
            None => String::new(),
        };
        out.line(format!(
            "  {k} = {} {dim}({}{note}){dim:#}",
            r.value, r.source
        ));
    }
    match (user_dir, &as_of) {
        (None, _) => out.line(format!(
            "\n{dim}user values not shown when run as root{dim:#}"
        )),
        (Some(_), Some(t)) => out.line(format!("\n{dim}app values as of {t}{dim:#}")),
        (Some(_), None) => out.line(format!(
            "\n{dim}Voltius has not run yet for this user{dim:#}"
        )),
    }
    let warn = anstyle::AnsiColor::Yellow.on_default();
    for i in &loaded.issues {
        out.line(format!("{warn}warning{warn:#}: {}", describe(i)));
    }
    Ok(())
}

fn user_dir() -> Option<PathBuf> {
    (!super::user::is_system_account()).then(crate::storage::config::config_dir_peek)
}

pub fn describe(i: &Issue) -> String {
    match (i.layer, &i.key) {
        (Some(l), Some(k)) => format!("{}.{k}: {}", l.name(), i.message),
        (Some(l), None) => format!("{}: {}", l.name(), i.message),
        _ => i.message.clone(),
    }
}

fn check(
    file: Option<&Path>,
    machine: &Path,
    probe: Option<policy::Probe>,
    out: &mut Output,
) -> Result<(), CliError> {
    let target = file.unwrap_or(machine);
    let (doc, mut issues) = match policy::read_optional(target) {
        Ok(Some(t)) => policy::parse(&t),
        Ok(None) if file.is_none() => (PolicyDoc::default(), Vec::new()),
        Ok(None) => return Err(not_found(target)),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            (PolicyDoc::default(), vec![policy::read_issue(target, &e)])
        }
        Err(e) => return Err(io_error(target, Access::Read, e)),
    };
    if let Some(Trust::Ignored(issue)) = probe
        .filter(|_| policy::same_path(target, machine))
        .map(|p| policy::trust(target, p))
    {
        issues.push(issue);
    }
    let warnings: Vec<Value> = not_honoured(entries(&doc))
        .map(|(layer, key, message)| {
            json!({ "layer": layer.name(), "key": key, "message": message })
        })
        .collect();
    if out.json {
        out.json(&json!({
            "path": target.display().to_string(),
            "issues": issues,
            "warnings": warnings,
        }));
    } else {
        for w in &warnings {
            out.warn(w["message"].as_str().unwrap_or_default());
        }
    }
    if issues.is_empty() {
        if out.json {
            return Ok(());
        }
        let ok = anstyle::AnsiColor::Green.on_default();
        out.line(format!("{ok}ok{ok:#}: {}", target.display()));
        Ok(())
    } else {
        Err(CliError::Validation(issues))
    }
}

fn import(
    file: &Path,
    machine: &Path,
    acl: Option<MachineAcl>,
    replace: bool,
    out: &mut Output,
) -> Result<(), CliError> {
    let text = read_text(file)?.ok_or_else(|| not_found(file))?;
    let (incoming, issues) = policy::parse(&text);
    if !issues.is_empty() {
        return Err(CliError::Validation(issues));
    }
    edit_raw_with(machine, acl, replace, |root| {
        for (layer, map) in layers(&incoming) {
            layer_entries(root, layer, machine)?.extend(map.clone());
        }
        Ok(true)
    })?;
    out.line(format!(
        "Imported {} into {}",
        file.display(),
        machine.display()
    ));
    warn_not_honoured(out, entries(&incoming));
    Ok(())
}

fn export(path: &Path, out: &mut Output) -> Result<(), CliError> {
    let root = match read_text(path)? {
        None => Value::Object(empty_root()),
        Some(t) => serde_json::from_str(&t).map_err(|_| unusable(path, "is not valid JSON"))?,
    };
    out.json(&root);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{capture, captured, Buf, Shared};
    use crate::cli_state::{mirror, pending};
    use crate::policy::test_probes::*;
    use std::sync::{Arc, Mutex};

    fn run(cmd: PolicyCmd, path: &Path, out: &mut Output) -> Result<(), CliError> {
        super::run(cmd, Some(path), out)
    }

    fn out() -> Output {
        Output::with_sink(false, true, Box::new(std::io::sink()))
    }

    fn unset(path: &Path, key: &str) -> Result<(), CliError> {
        run(
            PolicyCmd::Unset {
                key: key.into(),
                defaults: false,
            },
            path,
            &mut out(),
        )
    }

    fn set(path: &Path, key: &str, value: &str, defaults: bool) -> Result<(), CliError> {
        run(
            PolicyCmd::Set {
                key: key.into(),
                value: value.into(),
                defaults,
            },
            path,
            &mut out(),
        )
    }

    fn read(path: &Path) -> PolicyDoc {
        policy::parse(&std::fs::read_to_string(path).unwrap()).0
    }

    #[test]
    fn set_then_show_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "server.url", "https://x", false).unwrap();
        set(&path, "appSettings.toggles.cursor-blink", "false", true).unwrap();
        let doc = read(&path);
        assert_eq!(doc.policy["server.url"], Value::from("https://x"));
        assert_eq!(
            doc.defaults["appSettings.toggles.cursor-blink"],
            Value::Bool(false)
        );
        assert_eq!(doc.policy.len(), 1);
        assert_eq!(doc.defaults.len(), 1);
        let (mut sink, buf) = capture(false);
        show(&path, None, &mut sink).unwrap();
        assert!(captured(&buf).contains("server.url"));
    }

    #[test]
    fn set_unknown_key_suggests() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        match set(&path, "server.ur", "https://x", false) {
            Err(CliError::Validation(issues)) => assert!(issues[0].message.contains("server.url")),
            other => panic!("expected validation error, got {other:?}"),
        }
        assert!(!path.exists());
    }

    #[test]
    fn set_bad_value_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let err = set(&path, "sshConfig.import", "maybe", false).unwrap_err();
        assert_eq!(err.exit_code(), 3);
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn set_without_permission_exits_4() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("ro");
        std::fs::create_dir(&sub).unwrap();
        std::fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o555)).unwrap();
        if std::fs::write(sub.join("probe"), b"").is_ok() {
            return;
        }
        let err = set(&sub.join("policy.json"), "server.url", "https://x", false).unwrap_err();
        assert!(matches!(err, CliError::Permission(Access::Write, _)));
        assert_eq!(err.exit_code(), 4);
    }

    #[test]
    fn import_is_all_or_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "server.url", "https://x", false).unwrap();
        let before = std::fs::read_to_string(&path).unwrap();
        let file = dir.path().join("in.json");
        std::fs::write(
            &file,
            r#"{"version":1,"policy":{"sshConfig.import":true,"nope.key":1}}"#,
        )
        .unwrap();
        let err = run(
            PolicyCmd::Import {
                file,
                replace: false,
            },
            &path,
            &mut out(),
        )
        .unwrap_err();
        assert!(matches!(err, CliError::Validation(_)));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
    }

    #[test]
    fn import_merges_valid_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "server.url", "https://x", false).unwrap();
        let file = dir.path().join("in.json");
        std::fs::write(&file, r#"{"version":1,"policy":{"sshConfig.import":true}}"#).unwrap();
        run(
            PolicyCmd::Import {
                file,
                replace: false,
            },
            &path,
            &mut out(),
        )
        .unwrap();
        assert_eq!(read(&path).policy.len(), 2);
    }

    #[test]
    fn check_reports_issues_exit_3() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("bad.json");
        std::fs::write(&file, r#"{"version":1,"policy":{"nope.key":1}}"#).unwrap();
        let err = run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 3);
    }

    #[test]
    fn check_clean_file_ok() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("good.json");
        std::fs::write(&file, r#"{"version":1,"policy":{"sshConfig.import":true}}"#).unwrap();
        run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap();
    }

    #[test]
    fn check_reports_unprotected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "sshConfig.import", "true", false).unwrap();
        for file in [None, Some(path.as_path())] {
            let err = check(file, &path, Some(all_unprotected), &mut out()).unwrap_err();
            assert_eq!(err.exit_code(), 3);
            assert!(unprotected_issue(&err).is_some());
        }
        check(None, &path, None, &mut out()).unwrap();
        let other = dir.path().join("other.json");
        std::fs::copy(&path, &other).unwrap();
        check(Some(&other), &path, Some(all_unprotected), &mut out()).unwrap();
    }

    fn unprotected_issue(err: &CliError) -> Option<&Issue> {
        let CliError::Validation(issues) = err else {
            return None;
        };
        issues.iter().find(|i| i.kind == IssueKind::Unprotected)
    }

    const PLANTED: &str = r#"{"version":1,"policy":{"server.url":"https://evil.example"}}"#;

    fn planted() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, PLANTED).unwrap();
        (dir, path)
    }

    fn insert_key(root: &mut Raw) -> Result<bool, CliError> {
        root.insert("policy".into(), json!({ "sshConfig.import": true }));
        Ok(true)
    }

    #[test]
    fn writers_never_adopt_an_unprotected_file() {
        let (_dir, path) = planted();
        for probe in [all_unprotected as policy::Probe, file_unprotected] {
            let err = edit_raw_with(&path, Some(acl(probe)), false, insert_key).unwrap_err();
            assert_eq!(err.exit_code(), 3);
            let message = &unprotected_issue(&err).unwrap().message;
            assert!(
                message.contains("was writable by standard users"),
                "{message}"
            );
            assert!(message.contains("policy import --replace"), "{message}");
            assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
        }
        edit_raw_with(&path, Some(acl(dir_unprotected)), false, insert_key).unwrap();
    }

    #[test]
    fn import_replace_writes_exactly_the_reviewed_file() {
        let (dir, path) = planted();
        let file = dir.path().join("reviewed.json");
        std::fs::write(
            &file,
            r#"{"version":1,"defaults":{"sshConfig.import":true}}"#,
        )
        .unwrap();
        let unprotected = Some(acl(file_unprotected));
        let err = import(&file, &path, unprotected, false, &mut out()).unwrap_err();
        assert!(unprotected_issue(&err).is_some());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
        import(&file, &path, unprotected, true, &mut out()).unwrap();
        let doc = read(&path);
        assert!(doc.policy.is_empty(), "{:?}", doc.policy);
        assert_eq!(doc.defaults["sshConfig.import"], Value::Bool(true));
        assert_eq!(calls(), ["harden_dir", "adopt_written"]);
    }

    #[test]
    fn a_file_appearing_after_the_first_check_is_refused() {
        let (_dir, path) = planted();
        let err = edit_raw_with(
            &path,
            Some(acl(appears_after_first_probe)),
            false,
            insert_key,
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 3, "{err}");
        assert!(unprotected_issue(&err).is_some());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
        assert_eq!(calls(), ["harden_dir"]);
    }

    #[test]
    fn replace_never_adopts_the_old_file_even_if_the_write_fails() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("planted"), PLANTED).unwrap();
        let err = edit_raw_with(&path, Some(acl(file_unprotected)), true, insert_key).unwrap_err();
        assert!(matches!(err, CliError::Io(_)), "{err:?}");
        assert_eq!(calls(), ["harden_dir"]);
    }

    #[test]
    fn links_are_refused_with_exit_4() {
        let (_dir, path) = planted();
        for probe in [file_link as policy::Probe, dir_link_no_file] {
            let err = edit_raw_with(&path, Some(acl(probe)), true, insert_key).unwrap_err();
            assert_eq!(err.exit_code(), 4);
            assert!(
                err.to_string()
                    .contains("is a link; delete it and run again"),
                "{err}"
            );
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
    }

    #[test]
    fn harden_access_denied_exits_4() {
        let (_dir, path) = planted();
        let denied = policy::MachineAcl {
            harden_dir: harden_denied,
            ..acl(all_protected)
        };
        let err = edit_raw_with(&path, Some(denied), false, insert_key).unwrap_err();
        assert!(matches!(err, CliError::Permission(Access::Write, _)));
    }

    #[test]
    fn unset_removes_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "server.url", "https://x", false).unwrap();
        run(
            PolicyCmd::Unset {
                key: "server.url".into(),
                defaults: false,
            },
            &path,
            &mut out(),
        )
        .unwrap();
        assert!(read(&path).policy.is_empty());
    }

    const HAND_WRITTEN: &str = r#"{"version":1,"policy":{"future.key":7,"server.allowOther":{"$range":[1,2]}},"defaults":{}}"#;

    #[test]
    fn set_keeps_unknown_and_range_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        set(&path, "server.url", "https://x", false).unwrap();
        let root: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(root["policy"]["future.key"], Value::from(7));
        assert!(root["policy"]["server.allowOther"].get("$range").is_some());
        assert_eq!(root["policy"]["server.url"], Value::from("https://x"));
    }

    #[test]
    fn unset_keeps_unrelated_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        set(&path, "server.url", "https://x", false).unwrap();
        unset(&path, "server.url").unwrap();
        let root: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(root["policy"]["future.key"], Value::from(7));
        assert!(root["policy"].get("server.url").is_none());
    }

    #[test]
    fn set_on_unusable_file_exits_3_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        for content in [
            "{not json",
            "[1]",
            r#"{"version":2,"policy":{}}"#,
            r#"{"version":"2","policy":{}}"#,
            r#"{"version":0,"policy":{}}"#,
            r#"{"version":1.5,"policy":{}}"#,
            r#"{"version":null,"policy":{}}"#,
        ] {
            std::fs::write(&path, content).unwrap();
            let err = set(&path, "server.url", "https://x", false).unwrap_err();
            assert_eq!(err.exit_code(), 3);
            assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        }
    }

    #[test]
    fn check_json_output_is_pure_json() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("good.json");
        std::fs::write(&file, r#"{"version":1,"policy":{"sshConfig.import":true}}"#).unwrap();
        let (mut sink, buf) = capture(true);
        run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut sink,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&captured(&buf)).unwrap();
        assert_eq!(v["issues"], serde_json::json!([]));
    }

    #[test]
    fn export_prints_file_as_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        let (mut sink, buf) = capture(true);
        run(PolicyCmd::Export, &path, &mut sink).unwrap();
        let v: Value = serde_json::from_str(&captured(&buf)).unwrap();
        assert_eq!(v["policy"]["future.key"], Value::from(7));
    }

    const CURSOR: &str = "appSettings.terminal.cursorStyle";
    const BLINK: &str = "appSettings.toggles.cursor-blink";

    fn user_dir(settings: Value, server: Value) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        mirror::write(
            dir.path(),
            &json!({
                "writtenAt": "2026-11-05T10:00:00Z", "appVersion": "1", "serverUrl": server,
                "plugins": [], "settings": settings
            }),
        )
        .unwrap();
        dir
    }

    fn show_json(path: &Path, dir: Option<&Path>) -> Value {
        let (mut sink, buf) = capture(true);
        show(path, dir, &mut sink).unwrap();
        serde_json::from_str(&captured(&buf)).unwrap()
    }

    fn source_of(v: &Value, key: &str) -> Value {
        v["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["key"] == key)
            .map_or(Value::Null, |e| e["source"].clone())
    }

    fn machine(dir: &Path, policy: Value, defaults: Value) -> PathBuf {
        let path = dir.join("policy.json");
        std::fs::write(
            &path,
            json!({"version":1,"policy":policy,"defaults":defaults}).to_string(),
        )
        .unwrap();
        path
    }

    #[test]
    fn show_merges_sources_in_precedence() {
        let user = user_dir(
            json!({ CURSOR: "bar", BLINK: true, "appSettings.fontSize": 14 }),
            json!("https://app"),
        );
        let m = tempfile::tempdir().unwrap();
        let path = machine(
            m.path(),
            json!({ CURSOR: "block", "server.url": "https://locked" }),
            json!({ BLINK: false }),
        );
        let v = show_json(&path, Some(user.path()));
        assert_eq!(source_of(&v, CURSOR), "machine policy");
        assert_eq!(source_of(&v, "server.url"), "machine policy");
        assert_eq!(source_of(&v, BLINK), "app");
        assert_eq!(source_of(&v, "appSettings.fontSize"), "app");
        let cursor = v["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["key"] == CURSOR)
            .unwrap();
        assert_eq!(cursor["value"], "block");
        assert_eq!(v["mirrorAsOf"], "2026-11-05T10:00:00Z");
    }

    #[test]
    fn show_marks_pending() {
        let user = user_dir(json!({ CURSOR: "bar" }), Value::Null);
        pending::append(
            user.path(),
            pending::Change::Setting {
                key: CURSOR.into(),
                value: json!("underline"),
            },
        )
        .unwrap();
        pending::append(
            user.path(),
            pending::Change::Server {
                url: "https://queued".into(),
            },
        )
        .unwrap();
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({}));
        let v = show_json(&path, Some(user.path()));
        assert_eq!(source_of(&v, CURSOR), "pending");
        assert_eq!(source_of(&v, "server.url"), "pending");
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        assert!(captured(&buf).contains("underline"));
    }

    fn entry<'a>(v: &'a Value, key: &str) -> &'a Value {
        v["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["key"] == key)
            .unwrap()
    }

    #[test]
    fn show_user_value_beats_default_with_note() {
        let user = user_dir(json!({ BLINK: true }), Value::Null);
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({ BLINK: false }));
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        assert!(captured(&buf).contains("(app, machine default: false)"));
        let v = show_json(&path, Some(user.path()));
        let e = entry(&v, BLINK);
        assert_eq!(e["source"], "app");
        assert_eq!(e["value"], true);
        assert_eq!(e["defaultValue"], false);
        assert!(e.get("userValue").is_none());
    }

    #[test]
    fn show_pending_overrides_default() {
        let user = user_dir(json!({ BLINK: false }), Value::Null);
        pending::append(
            user.path(),
            pending::Change::Setting {
                key: BLINK.into(),
                value: json!(true),
            },
        )
        .unwrap();
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({ BLINK: false }));
        let v = show_json(&path, Some(user.path()));
        let e = entry(&v, BLINK);
        assert_eq!(e["source"], "pending");
        assert_eq!(e["value"], true);
        assert_eq!(e["defaultValue"], false);
    }

    #[test]
    fn show_user_value_equal_to_default_is_machine_default() {
        let user = user_dir(json!({ BLINK: false }), Value::Null);
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({ BLINK: false }));
        let v = show_json(&path, Some(user.path()));
        let e = entry(&v, BLINK);
        assert_eq!(e["source"], "machine default");
        assert!(e.get("defaultValue").is_none());
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        assert!(!captured(&buf).contains("machine default: "));
    }

    #[test]
    fn show_as_system_skips_user_values() {
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({ CURSOR: "block" }), json!({}));
        let v = show_json(&path, None);
        assert_eq!(v["entries"].as_array().unwrap().len(), 1);
        assert_eq!(v["mirrorAsOf"], Value::Null);
        let (mut sink, buf) = capture(false);
        show(&path, None, &mut sink).unwrap();
        assert!(captured(&buf).contains("user values not shown when run as root"));
    }

    #[test]
    fn show_json_shape() {
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({ "nope.key": 1 }), json!({}));
        let v = show_json(&path, None);
        assert!(v["path"].is_string());
        assert!(v["entries"].is_array());
        assert_eq!(v["issues"].as_array().unwrap().len(), 1);
        assert!(v.get("mirrorAsOf").is_some());
    }

    fn capture_split(json: bool, quiet: bool) -> (Output, Shared, Shared) {
        let (o, e) = (
            Arc::new(Mutex::new(Vec::new())),
            Arc::new(Mutex::new(Vec::new())),
        );
        let out = Output::with_sinks(
            json,
            quiet,
            Box::new(Buf(o.clone())),
            Box::new(Buf(e.clone())),
        );
        (out, o, e)
    }

    fn set_with(out: &mut Output, path: &Path, key: &str, value: &str) {
        run(
            PolicyCmd::Set {
                key: key.into(),
                value: value.into(),
                defaults: false,
            },
            path,
            out,
        )
        .unwrap();
    }

    const NOT_ENFORCED: &str =
        "appSettings.locale is saved but this version of Voltius does not enforce it yet";

    #[test]
    fn set_unenforced_key_warns() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, stdout, stderr) = capture_split(false, false);
        set_with(&mut sink, &path, "appSettings.locale", "fr");
        assert!(captured(&stderr).contains(NOT_ENFORCED));
        assert!(!captured(&stdout).contains("does not enforce"));
        assert_eq!(read(&path).policy["appSettings.locale"], Value::from("fr"));
    }

    #[test]
    fn set_enforced_key_no_warning() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, _, stderr) = capture_split(false, false);
        set_with(&mut sink, &path, "server.url", "https://x");
        assert_eq!(captured(&stderr), "");
    }

    #[test]
    fn quiet_suppresses_warning() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, _, stderr) = capture_split(false, true);
        set_with(&mut sink, &path, "appSettings.locale", "fr");
        assert_eq!(captured(&stderr), "");
    }

    #[test]
    fn import_unenforced_key_warns_json_stdout_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let file = dir.path().join("in.json");
        std::fs::write(
            &file,
            r#"{"version":1,"policy":{"appSettings.locale":"fr"}}"#,
        )
        .unwrap();
        let (mut sink, stdout, stderr) = capture_split(true, false);
        run(
            PolicyCmd::Import {
                file,
                replace: false,
            },
            &path,
            &mut sink,
        )
        .unwrap();
        assert!(captured(&stderr).contains(NOT_ENFORCED));
        assert!(!captured(&stdout).contains("does not enforce"));
    }

    #[test]
    fn set_schemeless_server_url_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let err = set(&path, "server.url", "voltius.acme.com", false).unwrap_err();
        assert_eq!(err.exit_code(), 3);
        assert!(!path.exists());
        set(&path, "server.url", "https://voltius.acme.com", false).unwrap();
    }

    #[cfg(unix)]
    fn unreadable(dir: &Path, name: &str) -> Option<PathBuf> {
        use std::os::unix::fs::PermissionsExt;
        let file = dir.join(name);
        std::fs::write(&file, r#"{"version":1}"#).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o000)).unwrap();
        std::fs::read(&file).is_err().then_some(file)
    }

    #[cfg(unix)]
    #[test]
    fn check_unreadable_file_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let Some(file) = unreadable(dir.path(), "locked.json") else {
            return;
        };
        let err = run(
            PolicyCmd::Check {
                file: Some(file.clone()),
            },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 3);
        let CliError::Validation(issues) = err else {
            unreachable!()
        };
        assert_eq!(
            issues[0].message,
            format!("cannot read {}: permission denied", file.display())
        );
    }

    #[cfg(unix)]
    #[test]
    fn import_unreadable_source_says_reading() {
        let dir = tempfile::tempdir().unwrap();
        let Some(file) = unreadable(dir.path(), "in.json") else {
            return;
        };
        let err = run(
            PolicyCmd::Import {
                file: file.clone(),
                replace: false,
            },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 4);
        let text = err.to_string();
        assert!(text.starts_with("Reading "), "{text}");
        assert!(text.contains(file.to_str().unwrap()), "{text}");
    }

    const NOT_APPLIED: &str = "sshConfig.import is saved as a default but this version of Voltius does not apply defaults for it yet";

    #[test]
    fn set_defaults_for_unapplied_key_warns() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, _, stderr) = capture_split(false, false);
        run(
            PolicyCmd::Set {
                key: "sshConfig.import".into(),
                value: "true".into(),
                defaults: true,
            },
            &path,
            &mut sink,
        )
        .unwrap();
        assert!(captured(&stderr).contains(NOT_APPLIED));
        let (mut sink, _, stderr) = capture_split(false, false);
        run(
            PolicyCmd::Set {
                key: "appSettings.toggles.cursor-blink".into(),
                value: "false".into(),
                defaults: true,
            },
            &path,
            &mut sink,
        )
        .unwrap();
        assert_eq!(captured(&stderr), "");
    }

    #[test]
    fn check_json_lists_default_warnings() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("good.json");
        std::fs::write(
            &file,
            r#"{"version":1,"defaults":{"sshConfig.import":true,"server.url":"https://x"}}"#,
        )
        .unwrap();
        let (mut sink, stdout, _) = capture_split(true, false);
        run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut sink,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert_eq!(v["warnings"].as_array().unwrap().len(), 1);
        assert_eq!(v["warnings"][0]["layer"], "defaults");
        assert_eq!(v["warnings"][0]["message"], NOT_APPLIED);
    }

    #[test]
    fn path_prints_machine_path() {
        let (mut sink, stdout, _) = capture_split(true, false);
        run(
            PolicyCmd::Path,
            Path::new("/etc/voltius/policy.json"),
            &mut sink,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert_eq!(v["path"], "/etc/voltius/policy.json");
        let (mut sink, stdout, _) = capture_split(true, false);
        super::run(PolicyCmd::Path, None, &mut sink).unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert_eq!(v["path"], Value::Null);
        let (mut sink, stdout, _) = capture_split(false, false);
        super::run(PolicyCmd::Path, None, &mut sink).unwrap();
        assert_eq!(captured(&stdout), "no machine policy on this platform\n");
    }

    #[test]
    fn check_json_lists_warnings() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("good.json");
        std::fs::write(
            &file,
            r#"{"version":1,"policy":{"appSettings.locale":"fr","server.url":"https://x"}}"#,
        )
        .unwrap();
        let (mut sink, stdout, _) = capture_split(true, false);
        run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut sink,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert_eq!(v["warnings"].as_array().unwrap().len(), 1);
        assert_eq!(v["warnings"][0]["key"], "appSettings.locale");
        assert_eq!(v["warnings"][0]["layer"], "policy");
        assert_eq!(v["warnings"][0]["message"], NOT_ENFORCED);
    }
}
