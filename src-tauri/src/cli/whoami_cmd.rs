use super::enroll_cmd::host_of;
use super::session::{Device, SessionInfo};
use super::{CliError, Ctx};
use serde_json::{json, Value};

pub fn run(ctx: &mut Ctx) -> Result<(), CliError> {
    run_whoami(ctx, &Device::this_user()?)
}

fn run_whoami(ctx: &mut Ctx, device: &Device) -> Result<(), CliError> {
    let session = device.signed_in("whoami", "reads the sign-in of")?;
    if ctx.out.json {
        ctx.out.json(&report(session.as_ref()));
    } else if let Some(s) = &session {
        ctx.out.line(describe(s));
    }
    session.map(drop).ok_or(CliError::NotSignedIn)
}

fn describe(s: &SessionInfo) -> String {
    if !s.is_server() {
        return "Local account on this device".into();
    }
    match (&s.email, s.server.as_deref().map(host_of)) {
        (Some(email), Some(host)) => format!("{email} on {host} (server account)"),
        (Some(email), None) => format!("{email} (server account)"),
        (None, Some(host)) => format!("Server account on {host}"),
        (None, None) => "Server account".into(),
    }
}

pub(super) fn report(s: Option<&SessionInfo>) -> Value {
    json!({
        "signedIn": s.is_some(),
        "mode": s.map(|s| if s.is_server() { "server" } else { "local" }),
        "email": s.and_then(|s| s.email.as_ref()),
        "server": s.and_then(|s| s.server.as_ref()),
        "accountId": s.map(|s| &s.account_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::session::MemKeys;
    use crate::cli::testing::{Machine, Outcome};

    const SECRETS: [(&str, &str); 3] = [
        ("jwt", "JWT-SECRET"),
        ("refresh_token", "REFRESH-SECRET"),
        ("master_password", "MASTER-SECRET"),
    ];

    fn server_keys() -> MemKeys {
        let mut pairs = vec![
            ("account_id", "acc-1"),
            ("mode", "server"),
            ("email", "ada@example.com"),
            ("server_url", "https://sync.example.com:8443/api"),
        ];
        pairs.extend(SECRETS);
        MemKeys::with(&pairs)
    }

    fn whoami(keys: MemKeys, json: bool) -> Outcome {
        let mut m = Machine::new(keys);
        m.json = json;
        m.run(|ctx, device| run_whoami(ctx, &device))
    }

    fn json_of(o: &Outcome) -> Value {
        serde_json::from_str(&o.out).unwrap()
    }

    #[test]
    fn whoami_server() {
        let o = whoami(server_keys(), false);
        o.result.unwrap();
        assert_eq!(
            o.out,
            "ada@example.com on sync.example.com:8443 (server account)\n"
        );
    }

    #[test]
    fn whoami_local() {
        let o = whoami(MemKeys::with(&[("account_id", "acc-2")]), false);
        o.result.unwrap();
        assert_eq!(o.out, "Local account on this device\n");
    }

    #[test]
    fn whoami_server_without_email_is_not_local() {
        let keys = MemKeys::with(&[
            ("account_id", "acc-3"),
            ("mode", "server"),
            ("server_url", "https://sync.example.com"),
        ]);
        let o = whoami(keys, false);
        o.result.unwrap();
        assert_eq!(o.out, "Server account on sync.example.com\n");
    }

    #[test]
    fn whoami_none_exits_1() {
        let o = whoami(MemKeys::default(), false);
        assert!(matches!(o.result, Err(CliError::NotSignedIn)));
        assert_eq!(o.out, "");
    }

    #[test]
    fn whoami_none_json() {
        let o = whoami(MemKeys::default(), true);
        assert!(matches!(o.result, Err(CliError::NotSignedIn)));
        assert_eq!(
            json_of(&o),
            json!({"signedIn": false, "mode": null, "email": null, "server": null, "accountId": null})
        );
    }

    #[test]
    fn whoami_json_has_no_secrets() {
        let o = whoami(server_keys(), true);
        o.result.as_ref().unwrap();
        for (_, secret) in SECRETS {
            assert!(!o.out.contains(secret), "{}", o.out);
        }
        assert_eq!(
            json_of(&o),
            json!({"signedIn": true, "mode": "server", "email": "ada@example.com",
                   "server": "https://sync.example.com:8443/api", "accountId": "acc-1"})
        );
    }

    #[test]
    fn every_local_mode_reports_as_local() {
        for mode in [Some("local"), Some("local-nopassword"), Some("other"), None] {
            let mut pairs = vec![("account_id", "loc-1")];
            pairs.extend(mode.map(|m| ("mode", m)));
            let o = whoami(MemKeys::with(&pairs), true);
            o.result.as_ref().unwrap();
            assert_eq!(json_of(&o)["mode"], "local", "{mode:?}");
        }
    }

    #[test]
    fn whoami_refuses_as_root() {
        let mut m = Machine::new(server_keys());
        m.system = true;
        let o = m.run(|ctx, device| run_whoami(ctx, &device));
        let e = o.result.unwrap_err();
        assert_eq!(e.exit_code(), 2);
        assert!(
            e.to_string()
                .starts_with("voltius-cli whoami reads the sign-in of the user running it"),
            "{e}"
        );
    }

    #[test]
    fn whoami_ignores_a_running_app() {
        let mut m = Machine::new(server_keys());
        m.running = true;
        m.run(|ctx, device| run_whoami(ctx, &device))
            .result
            .unwrap();
    }
}
