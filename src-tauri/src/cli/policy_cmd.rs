use super::output::Output;
use super::CliError;
use crate::policy::{self, Issue, Layer, PolicyDoc};
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
}

pub fn run(cmd: PolicyCmd, path: &Path, out: &mut Output) -> Result<(), CliError> {
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
    }
}

fn layer_of(defaults: bool) -> Layer {
    if defaults {
        Layer::Defaults
    } else {
        Layer::Policy
    }
}

fn layer_map(doc: &mut PolicyDoc, layer: Layer) -> &mut BTreeMap<String, Value> {
    match layer {
        Layer::Policy => &mut doc.policy,
        Layer::Defaults => &mut doc.defaults,
    }
}

fn io_error(path: &Path, e: std::io::Error) -> CliError {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        CliError::Permission(path.to_path_buf())
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
    match std::fs::read_to_string(path) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_error(path, e)),
    }
}

fn load_for_edit(path: &Path) -> Result<PolicyDoc, CliError> {
    let mut doc = read_text(path)?.map_or_else(PolicyDoc::default, |t| policy::parse(&t).0);
    doc.version = 1;
    Ok(doc)
}

fn save(path: &Path, doc: &PolicyDoc) -> Result<(), CliError> {
    policy::write_atomic(path, doc).map_err(|e| io_error(path, e))
}

fn issue(layer: Layer, key: &str, message: String) -> CliError {
    CliError::Validation(vec![Issue {
        layer: Some(layer),
        key: Some(key.to_string()),
        message,
    }])
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

fn unknown_key_message(key: &str) -> String {
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

fn set(key: &str, raw: &str, layer: Layer, path: &Path, out: &mut Output) -> Result<(), CliError> {
    let ty = policy::key_type(key).ok_or_else(|| issue(layer, key, unknown_key_message(key)))?;
    let value = policy::parse_cli_value(ty, raw).map_err(|m| issue(layer, key, m))?;
    let mut doc = load_for_edit(path)?;
    layer_map(&mut doc, layer).insert(key.to_string(), value);
    save(path, &doc)?;
    out.line(format!("Set {key} in {}", layer.name()));
    Ok(())
}

fn unset(key: &str, layer: Layer, path: &Path, out: &mut Output) -> Result<(), CliError> {
    let mut doc = load_for_edit(path)?;
    if layer_map(&mut doc, layer).remove(key).is_some() {
        save(path, &doc)?;
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
    for (title, map) in [
        (Layer::Policy, &loaded.doc.policy),
        (Layer::Defaults, &loaded.doc.defaults),
    ] {
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
    let issues = match read_text(target)? {
        Some(t) => policy::parse(&t).1,
        None if file.is_none() => Vec::new(),
        None => return Err(not_found(target)),
    };
    if out.json {
        out.json(&json!({ "path": target.display().to_string(), "issues": issues }));
    }
    if issues.is_empty() {
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
    let mut doc = load_for_edit(machine)?;
    doc.policy.extend(incoming.policy);
    doc.defaults.extend(incoming.defaults);
    save(machine, &doc)?;
    out.line(format!(
        "Imported {} into {}",
        file.display(),
        machine.display()
    ));
    Ok(())
}

fn export(path: &Path, out: &mut Output) -> Result<(), CliError> {
    let doc = load_for_edit(path)?;
    out.json(&json!(doc));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn out() -> Output {
        Output::with_sink(false, true, Box::new(std::io::sink()))
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
        run(PolicyCmd::Show, &path, &mut out()).unwrap();
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
        assert!(matches!(err, CliError::Permission(_)));
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
}
