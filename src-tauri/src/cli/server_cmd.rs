use super::output::Output;
use super::policy_cmd::{
    layer_of, locked_message, machine_doc, machine_path, plain, set, typed_value,
};
use super::user::require_user_account;
use super::{queue, CliError, Ctx};
use crate::cli_state::{mirror, pending};
use crate::policy::{self, IssueKind};
use clap::Subcommand;
use serde_json::{json, Value};
use std::path::Path;

const KEY: &str = "server.url";

#[derive(Subcommand, Debug)]
pub enum ServerCmd {
    /// Show the sync server URL and where each layer comes from
    Show,
    /// Set the sync server URL for this user, or for every user with --lock / --defaults
    Set {
        url: String,
        /// Lock the URL machine-wide (needs admin)
        #[arg(long, conflicts_with = "defaults")]
        lock: bool,
        /// Set a machine-wide default users may override (needs admin)
        #[arg(long)]
        defaults: bool,
    },
}

pub fn run(cmd: ServerCmd, ctx: &mut Ctx) -> Result<(), CliError> {
    let dir = match &cmd {
        ServerCmd::Set {
            lock: false,
            defaults: false,
            ..
        } => require_user_account("server set")?,
        _ => crate::storage::config::config_dir_peek(),
    };
    run_server(cmd, policy::machine_policy_path().as_deref(), &dir, ctx)
}

pub(super) fn run_server(
    cmd: ServerCmd,
    machine: Option<&Path>,
    user_dir: &Path,
    ctx: &mut Ctx,
) -> Result<(), CliError> {
    match cmd {
        ServerCmd::Show => show(machine, user_dir, ctx.out),
        ServerCmd::Set {
            url,
            lock,
            defaults,
        } if lock || defaults => set(
            KEY,
            &url,
            layer_of(defaults),
            machine_path(machine)?,
            ctx.out,
        ),
        ServerCmd::Set { url, .. } => {
            if machine_doc(machine).policy.contains_key(KEY) {
                return Err(plain(IssueKind::Type, locked_message(KEY)));
            }
            let ty = policy::key_type(KEY)
                .ok_or_else(|| plain(IssueKind::UnknownKey, format!("unknown key \"{KEY}\"")))?;
            let url = typed_value(KEY, ty, &url)?;
            let url = url.as_str().unwrap_or_default().to_string();
            queue(
                user_dir,
                pending::Change::Server { url: url.clone() },
                ctx.out,
            )?;
            ctx.out
                .line(format!("Voltius will use {url} at the next sign-in."));
            Ok(())
        }
    }
}

fn current(dir: &Path) -> Option<String> {
    mirror::read(dir).and_then(|m| m.server_url)
}

fn queued(dir: &Path) -> Option<String> {
    pending::load(dir)
        .0
        .queued_values()
        .remove(KEY)
        .and_then(|(v, _)| v.as_str().map(str::to_string))
}

/// The server the app's next sign-in starts from: one queued by `server set`, else the app's last one.
pub(super) fn user_server(dir: &Path) -> Option<String> {
    queued(dir).or_else(|| current(dir))
}

fn show(machine: Option<&Path>, dir: &Path, out: &mut Output) -> Result<(), CliError> {
    let doc = machine_doc(machine);
    let locked = doc.policy.get(KEY).cloned();
    let default = doc.defaults.get(KEY).cloned();
    let (current, queued) = (current(dir), queued(dir));
    if out.json {
        out.json(&json!({
            "locked": locked,
            "default": default,
            "current": current,
            "pending": queued,
        }));
        return Ok(());
    }
    let none = |v: Option<String>| v.unwrap_or_else(|| "none".into());
    let text = |v: Option<Value>| none(v.map(|v| v.as_str().map_or(v.to_string(), str::to_string)));
    out.line(format!("Locked by policy: {}", text(locked)));
    out.line(format!("Machine default: {}", text(default)));
    out.line(format!("Current (from the app): {}", none(current)));
    out.line(format!("Pending: {}", none(queued)));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{capture, captured};
    use crate::cli::testing::ctx;

    fn run(
        cmd: ServerCmd,
        machine: Option<&Path>,
        dir: &Path,
        json: bool,
    ) -> (Result<(), CliError>, String) {
        let (mut out, buf) = capture(json);
        let r = run_server(cmd, machine, dir, &mut ctx(&mut out, true));
        (r, captured(&buf))
    }

    fn set_cmd(url: &str, lock: bool, defaults: bool) -> ServerCmd {
        ServerCmd::Set {
            url: url.into(),
            lock,
            defaults,
        }
    }

    #[test]
    fn server_set_lock_writes_policy() {
        let dir = tempfile::tempdir().unwrap();
        let machine = dir.path().join("policy.json");
        run(
            set_cmd("https://v.acme.com", true, false),
            Some(&machine),
            dir.path(),
            false,
        )
        .0
        .unwrap();
        let doc = policy::load_machine_at(&machine).doc;
        assert_eq!(doc.policy[KEY], json!("https://v.acme.com"));
        assert!(pending::load(dir.path()).0.changes.is_empty());

        run(
            set_cmd("https://d.acme.com", false, true),
            Some(&machine),
            dir.path(),
            false,
        )
        .0
        .unwrap();
        assert_eq!(
            policy::load_machine_at(&machine).doc.defaults[KEY],
            json!("https://d.acme.com")
        );
    }

    #[test]
    fn server_set_queues_for_user() {
        let dir = tempfile::tempdir().unwrap();
        run(
            set_cmd("https://v.acme.com", false, false),
            None,
            dir.path(),
            false,
        )
        .0
        .unwrap();
        let changes = pending::load(dir.path()).0.changes;
        assert_eq!(
            changes[0].change,
            pending::Change::Server {
                url: "https://v.acme.com".into()
            }
        );
    }

    #[test]
    fn plain_server_set_refuses_a_locked_url() {
        let dir = tempfile::tempdir().unwrap();
        let machine = dir.path().join("policy.json");
        std::fs::write(
            &machine,
            r#"{"version":1,"policy":{"server.url":"https://corp.example"}}"#,
        )
        .unwrap();
        let e = run(
            set_cmd("https://v.acme.com", false, false),
            Some(&machine),
            dir.path(),
            false,
        )
        .0
        .unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert_eq!(
            e.to_string(),
            "server.url is locked by your organization's policy"
        );
        assert!(pending::load(dir.path()).0.changes.is_empty());
    }

    #[test]
    fn server_set_says_when_it_applies() {
        let dir = tempfile::tempdir().unwrap();
        let (_, text) = run(
            set_cmd("https://v.acme.com", false, false),
            None,
            dir.path(),
            false,
        );
        assert_eq!(
            text,
            "Queued: server https://v.acme.com. Applies when Voltius next opens or regains focus.\n\
             Voltius will use https://v.acme.com at the next sign-in.\n"
        );
    }

    #[test]
    fn server_set_rejects_non_http() {
        let dir = tempfile::tempdir().unwrap();
        let machine = dir.path().join("policy.json");
        for (lock, m) in [(false, None), (true, Some(machine.as_path()))] {
            let e = run(
                set_cmd("ftp://x.example", lock, false),
                m,
                dir.path(),
                false,
            )
            .0
            .unwrap_err();
            assert_eq!(e.exit_code(), 3);
        }
        assert!(pending::load(dir.path()).0.changes.is_empty());
        assert!(!machine.exists());
    }

    #[test]
    fn server_show_labels_each_layer() {
        let dir = tempfile::tempdir().unwrap();
        let machine = dir.path().join("policy.json");
        run(
            set_cmd("https://d.acme.com", false, true),
            Some(&machine),
            dir.path(),
            false,
        )
        .0
        .unwrap();
        run(
            set_cmd("https://u.acme.com", false, false),
            None,
            dir.path(),
            false,
        )
        .0
        .unwrap();
        let (r, text) = run(ServerCmd::Show, Some(&machine), dir.path(), false);
        r.unwrap();
        assert!(text.contains("Locked by policy: none"), "{text}");
        assert!(
            text.contains("Machine default: https://d.acme.com"),
            "{text}"
        );
        assert!(text.contains("Pending: https://u.acme.com"), "{text}");
        let (_, text) = run(ServerCmd::Show, Some(&machine), dir.path(), true);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["default"], "https://d.acme.com");
        assert_eq!(v["pending"], "https://u.acme.com");
    }
}
