use super::output::Output;
use super::{Access, CliError};
use crate::policy::{self, Issue, IssueKind, Layer, PolicyDoc};
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
    /// Show the machine policy file contents
    Show,
    /// Validate a policy file (default: the machine file)
    Check { file: Option<PathBuf> },
    /// Merge a policy file into the machine file; nothing is written if it has any issue
    Import { file: PathBuf },
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
    match cmd {
        PolicyCmd::Set {
            key,
            value,
            defaults,
        } => set(&key, &value, layer_of(defaults), path, out),
        PolicyCmd::Unset { key, defaults } => unset(&key, layer_of(defaults), path, out),
        PolicyCmd::Show => show(path, out),
        PolicyCmd::Check { file } => check(file.as_deref(), path, out),
        PolicyCmd::Import { file } => import(&file, path, out),
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

type Raw = serde_json::Map<String, Value>;

pub(super) fn plain(kind: IssueKind, message: String) -> CliError {
    CliError::Validation(vec![Issue::general(kind, message)])
}

fn unusable(path: &Path, why: &str) -> CliError {
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

fn layer_entries<'a>(
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

fn edit_raw(
    path: &Path,
    edit: impl FnOnce(&mut Raw) -> Result<bool, CliError>,
) -> Result<bool, CliError> {
    let mut root = load_raw(path)?;
    root.entry("version").or_insert_with(|| json!(1));
    let changed = edit(&mut root)?;
    if changed {
        let mut text = serde_json::to_string_pretty(&root).map_err(|e| CliError::Io(e.into()))?;
        text.push('\n');
        policy::write_text_atomic(path, &text).map_err(|e| io_error(path, Access::Write, e))?;
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

pub(super) fn unknown_key_message(key: &str) -> String {
    let closest = policy::key_ids()
        .map(|id| (edit_distance(key, id), id))
        .min();
    match closest {
        Some((d, id)) if d <= key.len() / 3 + 2 => {
            format!("unknown key \"{key}\"; did you mean \"{id}\"?")
        }
        _ => format!("unknown key \"{key}\""),
    }
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

fn show(path: &Path, out: &mut Output) -> Result<(), CliError> {
    let loaded = policy::load_from(path);
    if out.json {
        out.json(&json!({
            "path": loaded.path,
            "policy": loaded.doc.policy,
            "defaults": loaded.doc.defaults,
            "issues": loaded.issues,
        }));
        return Ok(());
    }
    let bold = anstyle::Style::new().bold();
    let dim = anstyle::Style::new().dimmed();
    out.line(format!(
        "{bold}Machine policy{bold:#} {dim}{}{dim:#}",
        path.display()
    ));
    for (title, map) in layers(&loaded.doc) {
        out.line(format!(
            "\n{bold}{}{bold:#} {dim}(source: machine){dim:#}",
            title.name()
        ));
        if map.is_empty() {
            out.line(format!("  {dim}none{dim:#}"));
        }
        for (k, v) in map {
            out.line(format!("  {k} = {v}"));
        }
    }
    let warn = anstyle::AnsiColor::Yellow.on_default();
    for i in &loaded.issues {
        out.line(format!("{warn}warning{warn:#}: {}", describe(i)));
    }
    Ok(())
}

pub fn describe(i: &Issue) -> String {
    match (i.layer, &i.key) {
        (Some(l), Some(k)) => format!("{}.{k}: {}", l.name(), i.message),
        (Some(l), None) => format!("{}: {}", l.name(), i.message),
        _ => i.message.clone(),
    }
}

fn check(file: Option<&Path>, machine: &Path, out: &mut Output) -> Result<(), CliError> {
    let target = file.unwrap_or(machine);
    let (doc, issues) = match policy::read_optional(target) {
        Ok(Some(t)) => policy::parse(&t),
        Ok(None) if file.is_none() => (PolicyDoc::default(), Vec::new()),
        Ok(None) => return Err(not_found(target)),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            (PolicyDoc::default(), vec![policy::read_issue(target, &e)])
        }
        Err(e) => return Err(io_error(target, Access::Read, e)),
    };
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

fn import(file: &Path, machine: &Path, out: &mut Output) -> Result<(), CliError> {
    let text = read_text(file)?.ok_or_else(|| not_found(file))?;
    let (incoming, issues) = policy::parse(&text);
    if !issues.is_empty() {
        return Err(CliError::Validation(issues));
    }
    edit_raw(machine, |root| {
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
        run(PolicyCmd::Show, &path, &mut sink).unwrap();
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
        let err = run(PolicyCmd::Import { file }, &path, &mut out()).unwrap_err();
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
        run(PolicyCmd::Import { file }, &path, &mut out()).unwrap();
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
        run(PolicyCmd::Import { file }, &path, &mut sink).unwrap();
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
            PolicyCmd::Import { file: file.clone() },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 4);
        let text = err.to_string();
        assert!(text.starts_with("Reading "), "{text}");
        assert!(text.contains(file.to_str().unwrap()), "{text}");
    }

    const NOT_APPLIED: &str = "appSettings.locale is saved as a default but this version of Voltius does not apply defaults for it yet";

    #[test]
    fn set_defaults_for_unapplied_key_warns() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, _, stderr) = capture_split(false, false);
        run(
            PolicyCmd::Set {
                key: "appSettings.locale".into(),
                value: "fr".into(),
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
            r#"{"version":1,"defaults":{"appSettings.locale":"fr","server.url":"https://x"}}"#,
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
