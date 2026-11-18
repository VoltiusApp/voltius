use super::output::Output;
use super::session::{keychain_refused, Device, Keys, SecretStore, SessionInfo, ACCOUNT_ID};
use super::user::{confirm, CANCELLED};
use super::{whoami_cmd, CliError, Ctx};
use crate::auth::keys::key_lists;
use crate::cli_state::logout_marker;
use crate::commands::vault::{drop_parked_profile, reset_local_vault};
use crate::commands::vault_secret;
use serde_json::Value;

pub fn run(ctx: &mut Ctx) -> Result<(), CliError> {
    run_logout(ctx, &Device::this_user()?)
}

// account_id goes last: until it does, a failed step leaves a sign-in a second logout can finish.
pub(super) fn run_logout(ctx: &mut Ctx, device: &Device) -> Result<(), CliError> {
    let Some(session) = device.session("logout", "signs out")? else {
        return report(ctx.out, false);
    };
    let mode = device.keys.get("mode")?;
    if !confirm(ctx, &question(&session, mode.as_deref()))? {
        return Err(CliError::Refused(CANCELLED.into()));
    }
    device.refuse_while_running()?;
    let id = session.account_id.as_str();
    forget_saved_account(device.keys, id).map_err(keychain_refused)?;
    if let Err(e) = drop_parked_profile(&device.data_dir, id) {
        ctx.out
            .warn(format!("Kept this account's parked data: {e}"));
    }
    reset_local_vault(&device.data_dir, &device.config_dir).map_err(CliError::io)?;
    clear_session_keys(device.keys).map_err(keychain_refused)?;
    logout_marker::write(&device.config_dir, id).map_err(CliError::Io)?;
    device.keys.delete(ACCOUNT_ID).map_err(keychain_refused)?;
    report(ctx.out, true)
}

fn question(s: &SessionInfo, mode: Option<&str>) -> String {
    let who = match (&s.email, mode) {
        (Some(email), _) => email.as_str(),
        (None, Some("server")) => "this account",
        (None, Some(_)) => "the local account",
        (None, None) => "this device's Voltius account",
    };
    format!("Sign out {who}? This removes Voltius data stored on this device for this account.")
}

fn report(out: &mut Output, signed_out: bool) -> Result<(), CliError> {
    if out.json {
        let mut report = whoami_cmd::report(None);
        report["signedOut"] = signed_out.into();
        out.json(&report);
    } else {
        out.line(if signed_out {
            "Signed out."
        } else {
            "Not signed in."
        });
    }
    Ok(())
}

fn forget_saved_account(keys: &dyn Keys, account_id: &str) -> Result<(), CliError> {
    let lists = key_lists();
    let saved = keys.get(&lists.saved_index)?;
    if let Some(Value::Array(ids)) = saved.and_then(|raw| serde_json::from_str(&raw).ok()) {
        let names = |v: &Value| {
            v.as_str()
                .or_else(|| v.get("account_id").and_then(Value::as_str))
                == Some(account_id)
        };
        if ids.iter().any(names) {
            let kept: Vec<&Value> = ids.iter().filter(|v| !names(v)).collect();
            keys.set(&lists.saved_index, &serde_json::json!(kept).to_string())?;
        }
    }
    keys.delete(&format!("{}{account_id}", lists.saved_entry_prefix))
}

fn clear_session_keys(keys: &dyn Keys) -> Result<(), String> {
    for key in key_lists().reset.iter().filter(|k| *k != ACCOUNT_ID) {
        keys.delete(key).map_err(|e| e.to_string())?;
    }
    vault_secret::clear(&SecretStore(keys))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::session::{Keys, MemKeys, KEYCHAIN_UNREACHABLE};
    use crate::cli::testing::{Machine, Outcome};
    use crate::cli_state::logout_marker;
    use std::collections::BTreeMap;

    const QUESTION: &str = "Sign out ada@example.com? This removes Voltius data stored on this device for this account.";

    fn signed_in() -> MemKeys {
        let keys = MemKeys::default();
        for key in &crate::auth::keys::key_lists().reset {
            keys.set(key, &format!("{key}-value")).unwrap();
        }
        for (k, v) in [
            ("account_id", "acc-1"),
            ("mode", "server"),
            ("email", "ada@example.com"),
            ("server_url", "https://sync.example.com"),
            ("master_password", "MASTER-SECRET"),
            ("master_password_sealed", "SEALED-SECRET"),
            ("voltius.saved_accounts", r#"["acc-1"]"#),
            (
                "voltius.saved_account.acc-1",
                r#"{"account_id":"acc-1","mode":"server"}"#,
            ),
        ] {
            keys.set(k, v).unwrap();
        }
        keys
    }

    fn world() -> Machine {
        let mut m = Machine::new(signed_in());
        m.yes = true;
        m
    }

    fn logout(m: &Machine) -> Outcome {
        m.run(|ctx, device| run_logout(ctx, &device))
    }

    fn marker(m: &Machine) -> Vec<String> {
        logout_marker::take(&m.path("config"))
    }

    #[test]
    fn logout_not_signed_in_exit_0() {
        let mut w = world();
        w.keys = MemKeys::default();
        let o = logout(&w);
        o.result.unwrap();
        assert_eq!(o.out, "Not signed in.\n");
        assert!(marker(&w).is_empty());

        w.json = true;
        let v: serde_json::Value = serde_json::from_str(&logout(&w).out).unwrap();
        assert_eq!(v["signedIn"], false);
        assert_eq!(v["signedOut"], false);
    }

    #[test]
    fn logout_needs_yes_when_not_tty() {
        let mut w = world();
        w.yes = false;
        let secrets = w.touch("data/secrets.enc");
        let before = w.stored();
        logout(&w).refused(
            2,
            &format!("{QUESTION} Not a terminal: add --yes to confirm."),
        );
        assert_eq!(w.stored(), before);
        assert!(secrets.exists());
        assert!(marker(&w).is_empty());
    }

    #[test]
    fn logout_removes_keys_vault_saved_entry_and_writes_marker_last() {
        let w = world();
        w.keys.set("master_password_forget", "1").unwrap();
        let files = [
            w.touch("data/secrets.enc"),
            w.touch("config/connections.json"),
            w.touch("config/cli-pending.json"),
            w.touch("data/accounts/acc-1/secrets.enc"),
        ];
        let o = logout(&w);
        o.result.unwrap();
        assert_eq!(o.out, "Signed out.\n");
        assert!(!o.out.contains("SECRET"));
        assert_eq!(
            w.stored(),
            BTreeMap::from([
                ("master_password_forget".into(), "1".into()),
                ("voltius.saved_accounts".into(), "[]".into()),
            ])
        );
        for f in &files {
            assert!(!f.exists(), "{}", f.display());
        }
        assert!(!w.path("config/connections.json").exists());
        assert_eq!(marker(&w), ["acc-1"]);
    }

    #[test]
    fn logout_keeps_other_saved_accounts() {
        let w = world();
        w.keys
            .set("voltius.saved_accounts", r#"["acc-0","acc-1"]"#)
            .unwrap();
        w.keys
            .set(
                "voltius.saved_account.acc-0",
                r#"{"account_id":"acc-0","mode":"server"}"#,
            )
            .unwrap();
        let parked = w.touch("data/accounts/acc-0/secrets.enc");
        logout(&w).result.unwrap();
        let stored = w.stored();
        assert_eq!(stored["voltius.saved_accounts"], r#"["acc-0"]"#);
        assert!(stored.contains_key("voltius.saved_account.acc-0"));
        assert!(!stored.contains_key("voltius.saved_account.acc-1"));
        assert!(parked.exists());
    }

    #[test]
    fn logout_refuses_when_app_running() {
        let mut w = world();
        w.running = true;
        let secrets = w.touch("data/secrets.enc");
        let before = w.stored();
        logout(&w).refused(3, "Quit Voltius first; it holds this account's keys.");
        assert_eq!(w.stored(), before);
        assert!(secrets.exists());
    }

    #[test]
    fn logout_refusals_come_in_order() {
        let mut w = world();
        w.system = true;
        w.keychain = false;
        w.running = true;
        logout(&w).refused(
            2,
            "voltius-cli logout signs out the user running it and cannot run as root/SYSTEM; run it as that user.",
        );
        w.system = false;
        logout(&w).refused(4, KEYCHAIN_UNREACHABLE);
        w.keychain = true;
        logout(&w).refused(3, "Quit Voltius first; it holds this account's keys.");
    }

    #[test]
    fn a_keychain_failure_keeps_the_sign_in_so_logout_can_run_again() {
        let w = world();
        w.keys.break_key("jwt");
        logout(&w).refused(4, KEYCHAIN_UNREACHABLE);
        assert_eq!(w.stored()["account_id"], "acc-1");
        w.keys.mend();
        logout(&w).result.unwrap();
        assert!(!w.stored().contains_key("account_id"));
        assert!(!w.stored().contains_key("jwt"));
        assert_eq!(marker(&w), ["acc-1"]);
    }

    #[test]
    fn a_local_account_is_named_as_such() {
        let mut w = world();
        w.keys = MemKeys::with(&[("account_id", "loc-1"), ("mode", "local")]);
        w.yes = false;
        let e = logout(&w).result.unwrap_err();
        assert!(
            e.to_string().starts_with("Sign out the local account? "),
            "{e}"
        );
    }

    #[test]
    fn a_parked_profile_that_cannot_be_dropped_warns_and_signs_out() {
        let w = world();
        w.keys.set("account_id", "not a profile id").unwrap();
        let o = logout(&w);
        o.result.unwrap();
        assert_eq!(o.out, "Signed out.\n");
        assert!(o.err.contains("warning"), "{}", o.err);
        assert!(!w.stored().contains_key("account_id"));
        assert_eq!(marker(&w), ["not a profile id"]);
    }

    #[test]
    fn a_half_finished_logout_is_not_called_a_local_account() {
        let mut w = world();
        w.keys = MemKeys::with(&[("account_id", "acc-1")]);
        w.yes = false;
        let e = logout(&w).result.unwrap_err();
        assert!(
            e.to_string()
                .starts_with("Sign out this device's Voltius account? "),
            "{e}"
        );
    }
}
