use super::output::Output;
use super::policy_cmd::{plain, typed_value, unknown_key_message};
use super::user::require_user_account;
use super::{CliError, Ctx};
use crate::cli_state::{mirror, pending};
use crate::policy::{self, Issue, IssueKind, KeyType};
use clap::Subcommand;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Subcommand, Debug)]
pub enum ConfigCmd {
    /// Print a setting's current value
    Get { key: String },
    /// Queue a setting change for this user
    Set { key: String, value: String },
    /// Queue several settings from a JSON object; nothing is queued if any is invalid
    Import {
        /// JSON file holding an object of key to value
        file: Option<PathBuf>,
        /// The JSON object inline instead of a file
        #[arg(long, conflicts_with = "file", required_unless_present = "file")]
        data: Option<String>,
    },
}

pub fn run(cmd: ConfigCmd, ctx: &mut Ctx) -> Result<(), CliError> {
    let dir = match cmd {
        ConfigCmd::Get { .. } => crate::storage::config::config_dir_peek(),
        ConfigCmd::Set { .. } => require_user_account("config set")?,
        ConfigCmd::Import { .. } => require_user_account("config import")?,
    };
    run_config(cmd, policy::machine_policy_path().as_deref(), &dir, ctx)
}

fn locked_keys(machine: Option<&Path>) -> Vec<String> {
    machine
        .map(|p| policy::load_from(p).doc.policy.into_keys().collect())
        .unwrap_or_default()
}

fn rejected(key: &str, message: String) -> Issue {
    Issue {
        kind: IssueKind::Type,
        layer: None,
        key: Some(key.to_string()),
        message,
    }
}

fn setting_type(key: &str, locked: &[String]) -> Result<KeyType, Issue> {
    let Some(ty) = policy::key_type(key) else {
        return Err(rejected(key, unknown_key_message(key)));
    };
    if !(key.starts_with("appSettings.") || key.starts_with("themes.")) {
        let hint = if key == "server.url" {
            "use voltius-cli server set"
        } else {
            "use voltius-cli policy set"
        };
        return Err(rejected(
            key,
            format!("{key} is not a user setting; {hint}"),
        ));
    }
    if locked.iter().any(|k| k == key) {
        return Err(rejected(
            key,
            format!("{key} is locked by your organization's policy"),
        ));
    }
    Ok(ty)
}

fn queue(dir: &Path, key: &str, value: Value, out: &mut Output) -> Result<(), CliError> {
    pending::append(
        dir,
        pending::Change::Setting {
            key: key.to_string(),
            value,
        },
    )
    .map_err(CliError::Io)?;
    out.line(format!(
        "Queued {key}; Voltius applies it the next time it runs"
    ));
    Ok(())
}

pub(super) fn run_config(
    cmd: ConfigCmd,
    machine: Option<&Path>,
    user_dir: &Path,
    ctx: &mut Ctx,
) -> Result<(), CliError> {
    match cmd {
        ConfigCmd::Get { key } => get(&key, user_dir, ctx.out),
        ConfigCmd::Set { key, value } => {
            let ty = setting_type(&key, &locked_keys(machine))
                .map_err(|i| CliError::Validation(vec![i]))?;
            let value = typed_value(&key, ty, &value)?;
            queue(user_dir, &key, value, ctx.out)
        }
        ConfigCmd::Import { file, data } => import(file, data, machine, user_dir, ctx.out),
    }
}

fn get(key: &str, dir: &Path, out: &mut Output) -> Result<(), CliError> {
    if policy::key_type(key).is_none() {
        return Err(plain(IssueKind::UnknownKey, unknown_key_message(key)));
    }
    let (doc, _) = pending::load(dir);
    let queued = doc.changes.iter().rev().find_map(|e| match &e.change {
        pending::Change::Setting { key: k, value } if k == key => Some((value.clone(), &e.at)),
        _ => None,
    });
    let (value, source, as_of) = match (queued, mirror::read(dir)) {
        (Some((v, at)), _) => (v, "pending", at.clone()),
        (None, Some(m)) => (
            m.settings.get(key).cloned().unwrap_or(Value::Null),
            "app",
            m.written_at,
        ),
        (None, None) => {
            return Err(CliError::Io(std::io::Error::other(
                "Voltius has not run yet for this user",
            )))
        }
    };
    if out.json {
        out.json(&json!({ "key": key, "value": value, "source": source, "asOf": as_of }));
    } else if source == "pending" {
        out.line(format!("{value} (pending)"));
    } else {
        out.line(format!("{value} (as of {as_of})"));
    }
    Ok(())
}

fn import(
    file: Option<PathBuf>,
    data: Option<String>,
    machine: Option<&Path>,
    dir: &Path,
    out: &mut Output,
) -> Result<(), CliError> {
    let text = match (file, data) {
        (_, Some(d)) => d,
        (Some(f), None) => std::fs::read_to_string(&f).map_err(CliError::Io)?,
        (None, None) => return Err(CliError::Usage("give a file or --data".into())),
    };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&text) else {
        return Err(plain(
            IssueKind::File,
            "expected a JSON object of key to value".into(),
        ));
    };
    let locked = locked_keys(machine);
    let mut issues = Vec::new();
    for (key, value) in &map {
        match setting_type(key, &locked) {
            Err(i) => issues.push(i),
            Ok(ty) => {
                if let Some(m) = policy::value_problem(key, ty, value) {
                    issues.push(rejected(key, format!("{key}: {m}")));
                }
            }
        }
    }
    if !issues.is_empty() {
        return Err(CliError::Validation(issues));
    }
    for (key, value) in map {
        queue(dir, &key, value, out)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{capture, captured};

    const CURSOR: &str = "appSettings.terminal.cursorStyle";

    fn lock(dir: &Path, key: &str) -> PathBuf {
        let path = dir.join("policy.json");
        std::fs::write(
            &path,
            format!(r#"{{"version":1,"policy":{{"{key}":"block"}},"defaults":{{}}}}"#),
        )
        .unwrap();
        path
    }

    fn run(
        cmd: ConfigCmd,
        machine: Option<&Path>,
        dir: &Path,
        json: bool,
    ) -> (Result<(), CliError>, String) {
        let (mut out, buf) = capture(json);
        let mut ctx = Ctx {
            out: &mut out,
            yes: true,
            interactive: false,
        };
        let r = run_config(cmd, machine, dir, &mut ctx);
        (r, captured(&buf))
    }

    fn set(key: &str, value: &str) -> ConfigCmd {
        ConfigCmd::Set {
            key: key.into(),
            value: value.into(),
        }
    }

    fn get_cmd() -> ConfigCmd {
        ConfigCmd::Get { key: CURSOR.into() }
    }

    fn import_data(data: &str) -> ConfigCmd {
        ConfigCmd::Import {
            file: None,
            data: Some(data.into()),
        }
    }

    fn queued(dir: &Path) -> Vec<pending::Change> {
        pending::load(dir)
            .0
            .changes
            .into_iter()
            .map(|e| e.change)
            .collect()
    }

    fn write_mirror(dir: &Path) {
        mirror::write(
            dir,
            &json!({
                "writtenAt": "2026-11-05T10:00:00Z", "appVersion": "1", "serverUrl": null,
                "plugins": [], "settings": { CURSOR: "block" }
            }),
        )
        .unwrap();
    }

    #[test]
    fn config_set_queues_setting() {
        let dir = tempfile::tempdir().unwrap();
        run(set(CURSOR, "bar"), None, dir.path(), false).0.unwrap();
        assert_eq!(
            queued(dir.path()),
            vec![pending::Change::Setting {
                key: CURSOR.into(),
                value: json!("bar")
            }]
        );
    }

    #[test]
    fn config_set_rejects_locked_key() {
        let dir = tempfile::tempdir().unwrap();
        let machine = lock(dir.path(), CURSOR);
        let e = run(set(CURSOR, "bar"), Some(&machine), dir.path(), false)
            .0
            .unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert!(e
            .to_string()
            .contains("is locked by your organization's policy"));
        assert!(queued(dir.path()).is_empty());
    }

    #[test]
    fn config_set_rejects_policy_only_key() {
        let dir = tempfile::tempdir().unwrap();
        let e = run(
            set("server.url", "https://a.example"),
            None,
            dir.path(),
            false,
        )
        .0
        .unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert!(e.to_string().contains("use voltius-cli server set"));
        assert!(queued(dir.path()).is_empty());
    }

    #[test]
    fn config_set_rejects_unknown_key() {
        let dir = tempfile::tempdir().unwrap();
        let e = run(set("appSettings.nope", "1"), None, dir.path(), false)
            .0
            .unwrap_err();
        assert_eq!(e.exit_code(), 3);
    }

    #[test]
    fn config_import_is_all_or_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let bad = format!(r#"{{"{CURSOR}":"bar","appSettings.nope":1}}"#);
        let e = run(import_data(&bad), None, dir.path(), false)
            .0
            .unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert!(queued(dir.path()).is_empty());

        let good = format!(r#"{{"{CURSOR}":"bar"}}"#);
        run(import_data(&good), None, dir.path(), false).0.unwrap();
        assert_eq!(queued(dir.path()).len(), 1);
    }

    #[test]
    fn config_import_reads_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("in.json");
        std::fs::write(&f, format!(r#"{{"{CURSOR}":"block"}}"#)).unwrap();
        let cmd = ConfigCmd::Import {
            file: Some(f),
            data: None,
        };
        run(cmd, None, dir.path(), false).0.unwrap();
        assert_eq!(queued(dir.path()).len(), 1);
    }

    #[test]
    fn config_get_prefers_pending_then_mirror() {
        let dir = tempfile::tempdir().unwrap();
        write_mirror(dir.path());
        let (r, text) = run(get_cmd(), None, dir.path(), false);
        r.unwrap();
        assert_eq!(text.trim(), "\"block\" (as of 2026-11-05T10:00:00Z)");

        run(set(CURSOR, "bar"), None, dir.path(), false).0.unwrap();
        let (_, text) = run(get_cmd(), None, dir.path(), false);
        assert_eq!(text.trim(), "\"bar\" (pending)");

        let (_, text) = run(get_cmd(), None, dir.path(), true);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["key"], CURSOR);
        assert_eq!(v["value"], "bar");
        assert_eq!(v["source"], "pending");
        assert!(v["asOf"].is_string());
    }

    #[test]
    fn config_get_json_from_app() {
        let dir = tempfile::tempdir().unwrap();
        write_mirror(dir.path());
        let (_, text) = run(get_cmd(), None, dir.path(), true);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["source"], "app");
        assert_eq!(v["asOf"], "2026-11-05T10:00:00Z");
    }

    #[test]
    fn config_get_without_mirror_is_io_error() {
        let dir = tempfile::tempdir().unwrap();
        let e = run(get_cmd(), None, dir.path(), false).0.unwrap_err();
        assert_eq!(e.exit_code(), 5);
        assert!(e.to_string().contains("has not run yet"));
    }
}
