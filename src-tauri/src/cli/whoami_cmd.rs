use super::enroll_cmd::host_of;
use super::output::Output;
use super::session::{self, Keys, OsKeys, SessionInfo};
use super::user::require_account_as;
use super::{CliError, Ctx};
use serde_json::{json, Value};

pub fn run(ctx: &mut Ctx) -> Result<(), CliError> {
    require_account_as(super::user::is_system_account(), "whoami")?;
    session::open_keychain()?;
    whoami(&OsKeys, ctx.out)
}

fn whoami(keys: &dyn Keys, out: &mut Output) -> Result<(), CliError> {
    let session = session::current_session(keys)?;
    if out.json {
        out.json(&report(session.as_ref()));
    } else if let Some(s) = &session {
        out.line(describe(s));
    }
    session.map(drop).ok_or(CliError::NotSignedIn)
}

fn describe(s: &SessionInfo) -> String {
    match (s.mode.as_str(), &s.email, &s.server) {
        ("server", Some(email), Some(server)) => {
            format!("{email} on {} (server account)", host_of(server))
        }
        ("server", Some(email), None) => format!("{email} (server account)"),
        _ => "Local account on this device".into(),
    }
}

fn report(s: Option<&SessionInfo>) -> Value {
    json!({
        "signedIn": s.is_some(),
        "mode": s.map(|s| &s.mode),
        "email": s.and_then(|s| s.email.as_ref()),
        "server": s.and_then(|s| s.server.as_ref()),
        "accountId": s.map(|s| &s.account_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{capture, captured};
    use crate::cli::session::MemKeys;

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

    #[test]
    fn whoami_server() {
        let (mut out, buf) = capture(false);
        whoami(&server_keys(), &mut out).unwrap();
        assert_eq!(
            captured(&buf),
            "ada@example.com on sync.example.com:8443 (server account)\n"
        );
    }

    #[test]
    fn whoami_local() {
        let (mut out, buf) = capture(false);
        whoami(&MemKeys::with(&[("account_id", "acc-2")]), &mut out).unwrap();
        assert_eq!(captured(&buf), "Local account on this device\n");
    }

    #[test]
    fn whoami_none_exits_1() {
        let (mut out, buf) = capture(false);
        let err = whoami(&MemKeys::default(), &mut out).unwrap_err();
        assert!(matches!(err, CliError::NotSignedIn));
        assert_eq!(captured(&buf), "");
    }

    #[test]
    fn whoami_none_json() {
        let (mut out, buf) = capture(true);
        let err = whoami(&MemKeys::default(), &mut out).unwrap_err();
        assert!(matches!(err, CliError::NotSignedIn));
        let v: Value = serde_json::from_str(&captured(&buf)).unwrap();
        assert_eq!(
            v,
            json!({"signedIn": false, "mode": null, "email": null, "server": null, "accountId": null})
        );
    }

    #[test]
    fn whoami_json_has_no_secrets() {
        let (mut out, buf) = capture(true);
        whoami(&server_keys(), &mut out).unwrap();
        let text = captured(&buf);
        for (_, secret) in SECRETS {
            assert!(!text.contains(secret), "{text}");
        }
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            v,
            json!({"signedIn": true, "mode": "server", "email": "ada@example.com",
                   "server": "https://sync.example.com:8443/api", "accountId": "acc-1"})
        );
    }

    #[test]
    fn whoami_refuses_as_root() {
        match require_account_as(true, "whoami") {
            Err(CliError::Usage(m)) => assert!(m.contains("whoami"), "{m}"),
            other => panic!("{other:?}"),
        }
    }
}
