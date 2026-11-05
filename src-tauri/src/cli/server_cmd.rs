use super::output::Output;
use super::policy_cmd::{layer_of, machine_path, plain, set, typed_value};
use super::user::require_user_account;
use super::{CliError, Ctx};
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
            let ty = policy::key_type(KEY)
                .ok_or_else(|| plain(IssueKind::UnknownKey, format!("unknown key \"{KEY}\"")))?;
            let url = typed_value(KEY, ty, &url)?;
            let url = url.as_str().unwrap_or_default().to_string();
            pending::append(user_dir, pending::Change::Server { url: url.clone() })
                .map_err(CliError::Io)?;
            ctx.out.line(format!(
                "Queued server {url}; Voltius applies it the next time it runs"
            ));
            Ok(())
        }
    }
}

fn show(machine: Option<&Path>, dir: &Path, out: &mut Output) -> Result<(), CliError> {
    let doc = machine
        .map(|p| policy::load_from(p).doc)
        .unwrap_or_default();
    let locked = doc.policy.get(KEY).cloned();
    let default = doc.defaults.get(KEY).cloned();
    let current = mirror::read(dir).and_then(|m| m.server_url);
    let queued = pending::load(dir)
        .0
        .changes
        .into_iter()
        .rev()
        .find_map(|e| match e.change {
            pending::Change::Server { url } => Some(url),
            _ => None,
        });
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

    fn run(
        cmd: ServerCmd,
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
        let r = run_server(cmd, machine, dir, &mut ctx);
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
        let doc = policy::load_from(&machine).doc;
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
            policy::load_from(&machine).doc.defaults[KEY],
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
