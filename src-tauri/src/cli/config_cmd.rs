use super::output::Output;
use super::policy_cmd::{
    effective_row, locked_message, machine_doc, plain, print_row, range_violation, typed_value,
    unknown_key_message,
};
use super::user::require_user_account;
use super::{queue, CliError, Ctx};
use crate::cli_state::pending::Change;
use crate::policy::{self, Issue, IssueKind, KeyType, PolicyDoc};
use clap::Subcommand;
use serde_json::Value;
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

fn rejected(key: &str, message: String) -> Issue {
    Issue {
        kind: IssueKind::Type,
        layer: None,
        key: Some(key.to_string()),
        message,
    }
}

fn setting_type(key: &str, doc: &PolicyDoc) -> Result<KeyType, Issue> {
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
    if policy::blocks_user_write(doc, key) {
        return Err(rejected(key, locked_message(key)));
    }
    Ok(ty)
}

fn queue_setting(dir: &Path, key: String, value: Value, out: &mut Output) -> Result<(), CliError> {
    queue(dir, Change::Setting { key, value }, out)
}

pub(super) fn run_config(
    cmd: ConfigCmd,
    machine: Option<&Path>,
    user_dir: &Path,
    ctx: &mut Ctx,
) -> Result<(), CliError> {
    match cmd {
        ConfigCmd::Get { key } => get(&key, machine, user_dir, ctx.out),
        ConfigCmd::Set { key, value } => {
            let doc = machine_doc(machine);
            let ty = setting_type(&key, &doc).map_err(|i| CliError::Validation(vec![i]))?;
            let value = typed_value(&key, ty, &value)?;
            if let Some(m) = range_violation(&doc, &key, &value) {
                return Err(plain(IssueKind::Range, m));
            }
            queue_setting(user_dir, key, value, ctx.out)
        }
        ConfigCmd::Import { file, data } => import(file, data, machine, user_dir, ctx.out),
    }
}

fn get(key: &str, machine: Option<&Path>, dir: &Path, out: &mut Output) -> Result<(), CliError> {
    if policy::key_type(key).is_none() {
        return Err(plain(IssueKind::UnknownKey, unknown_key_message(key)));
    }
    let row = effective_row(&machine_doc(machine), dir, key).ok_or_else(|| {
        CliError::Io(std::io::Error::other(
            "Voltius has not run yet for this user",
        ))
    })?;
    print_row(key, &row, out);
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
    let doc = machine_doc(machine);
    let mut issues = Vec::new();
    for (key, value) in &map {
        match setting_type(key, &doc) {
            Err(i) => issues.push(i),
            Ok(ty) => {
                let problem = policy::value_problem(key, ty, value)
                    .map(|m| format!("{key}: {m}"))
                    .or_else(|| range_violation(&doc, key, value));
                if let Some(m) = problem {
                    issues.push(rejected(key, m));
                }
            }
        }
    }
    if !issues.is_empty() {
        return Err(CliError::Validation(issues));
    }
    for (key, value) in map {
        queue_setting(dir, key, value, out)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{capture, captured};
    use crate::cli_state::{mirror, pending};
    use serde_json::json;

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
        assert_eq!(text.trim(), "\"block\" (app, as of 2026-11-05T10:00:00Z)");

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
    fn config_get_server_url_sees_queued_change() {
        let dir = tempfile::tempdir().unwrap();
        write_mirror(dir.path());
        pending::append(
            dir.path(),
            pending::Change::Server {
                url: "https://queued".into(),
            },
        )
        .unwrap();
        let cmd = ConfigCmd::Get {
            key: "server.url".into(),
        };
        let (r, text) = run(cmd, None, dir.path(), true);
        r.unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["value"], "https://queued");
        assert_eq!(v["source"], "pending");
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

    fn machine(dir: &Path, doc: Value) -> PathBuf {
        let path = dir.join("policy.json");
        std::fs::write(&path, doc.to_string()).unwrap();
        path
    }

    #[test]
    fn config_get_machine_policy_beats_pending() {
        let dir = tempfile::tempdir().unwrap();
        write_mirror(dir.path());
        run(set(CURSOR, "bar"), None, dir.path(), false).0.unwrap();
        let m = machine(
            dir.path(),
            json!({"version": 1, "policy": { CURSOR: "underline" }}),
        );
        let (r, text) = run(get_cmd(), Some(&m), dir.path(), true);
        r.unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["value"], "underline");
        assert_eq!(v["source"], "machine policy");
    }

    #[test]
    fn config_get_machine_default_without_mirror() {
        let dir = tempfile::tempdir().unwrap();
        let m = machine(
            dir.path(),
            json!({"version": 1, "defaults": { CURSOR: "bar" }}),
        );
        let (r, text) = run(get_cmd(), Some(&m), dir.path(), false);
        r.unwrap();
        assert_eq!(text.trim(), "\"bar\" (machine default)");
    }

    #[test]
    fn config_get_app_value_over_default_carries_note() {
        let dir = tempfile::tempdir().unwrap();
        write_mirror(dir.path());
        let m = machine(
            dir.path(),
            json!({"version": 1, "defaults": { CURSOR: "bar" }}),
        );
        let (_, text) = run(get_cmd(), Some(&m), dir.path(), true);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["source"], "app");
        assert_eq!(v["defaultValue"], "bar");
    }

    #[test]
    fn config_get_without_mirror_is_io_error() {
        let dir = tempfile::tempdir().unwrap();
        let e = run(get_cmd(), None, dir.path(), false).0.unwrap_err();
        assert_eq!(e.exit_code(), 5);
        assert!(e.to_string().contains("has not run yet"));
    }

    const TTL: &str = "appSettings.detachedTtlHours";
    const RULES: &str = "appSettings.terminal.keywordRules";

    #[test]
    fn config_set_outside_range_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let m = machine(
            dir.path(),
            json!({"version": 1, "policy": { TTL: {"$range": {"max": 24}} }}),
        );
        let e = run(set(TTL, "72"), Some(&m), dir.path(), false)
            .0
            .unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert_eq!(
            e.to_string(),
            format!("{TTL}: outside the range your organization allows (max 24)")
        );
        assert!(queued(dir.path()).is_empty());
        let bad = format!(r#"{{"{TTL}":72}}"#);
        let e = run(import_data(&bad), Some(&m), dir.path(), false)
            .0
            .unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert!(e.to_string().contains("outside the range"));
        assert!(queued(dir.path()).is_empty());
    }

    #[test]
    fn config_set_inside_range_queues() {
        let dir = tempfile::tempdir().unwrap();
        let m = machine(
            dir.path(),
            json!({"version": 1, "policy": { TTL: {"$range": {"max": 24}} }}),
        );
        run(set(TTL, "12"), Some(&m), dir.path(), false).0.unwrap();
        assert_eq!(
            queued(dir.path()),
            vec![pending::Change::Setting {
                key: TTL.into(),
                value: json!(12)
            }]
        );
    }

    #[test]
    fn config_set_keyword_rules_allowed_under_lock() {
        let dir = tempfile::tempdir().unwrap();
        let m = machine(dir.path(), json!({"version": 1, "policy": { RULES: [] }}));
        let rules = r#"[{"id":"a","color":"red","words":["x"]}]"#;
        run(set(RULES, rules), Some(&m), dir.path(), false)
            .0
            .unwrap();
        assert_eq!(queued(dir.path()).len(), 1);
    }

    #[test]
    fn config_set_implied_toggle_refused() {
        let dir = tempfile::tempdir().unwrap();
        let m = machine(
            dir.path(),
            json!({"version": 1, "policy": { TTL: {"$range": {"max": 24}} }}),
        );
        let e = run(
            set("appSettings.toggles.detached-session-ttl", "false"),
            Some(&m),
            dir.path(),
            false,
        )
        .0
        .unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert!(e
            .to_string()
            .contains("is locked by your organization's policy"));
        assert!(queued(dir.path()).is_empty());
    }
}
