use super::output::Output;
use super::policy_cmd::{machine_doc, machine_path, plain, put, remove_setting};
use super::{CliError, Ctx};
use crate::policy::enrollment_token::{self, EnrollmentToken};
use crate::policy::{self, IssueKind, Layer, PolicyDoc};
use clap::Args;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

const KEY: &str = "enrollment.token";
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Args, Debug)]
pub struct EnrollArgs {
    /// The enrolment token from your administrator
    token: Option<String>,
    /// Write the token without asking the server to check it
    #[arg(long)]
    no_verify: bool,
    /// Show the enrolment this machine has (checks the server unless --no-verify)
    #[arg(long, conflicts_with = "token")]
    show: bool,
    /// Remove this machine's enrolment
    #[arg(long, conflicts_with_all = ["token", "show"])]
    remove: bool,
}

#[derive(Debug, PartialEq)]
pub(super) enum ResolveError {
    NotFound,
    Gone,
    Lapsed,
    InvitesOff,
    ServerTooOld,
    RateLimited,
    BadAnswer,
    Network(String),
}

type Resolver<'a> = &'a dyn Fn(&EnrollmentToken) -> Result<String, ResolveError>;

pub fn run(args: EnrollArgs, ctx: &mut Ctx) -> Result<(), CliError> {
    run_enroll(
        args,
        policy::machine_policy_path().as_deref(),
        &resolve_over_network,
        ctx.out,
    )
}

pub(super) fn host_of(server_url: &str) -> String {
    url::Url::parse(server_url)
        .ok()
        .and_then(|u| {
            let host = u.host_str()?;
            Some(u.port().map_or(host.to_string(), |p| format!("{host}:{p}")))
        })
        .unwrap_or_else(|| server_url.to_string())
}

fn fail(message: String) -> CliError {
    plain(IssueKind::Type, message)
}

fn refusal(e: ResolveError, token: &EnrollmentToken) -> CliError {
    match e {
        ResolveError::NotFound => fail(
            "This enrolment token was not recognised. Ask your administrator for a new one.".into(),
        ),
        ResolveError::Gone => fail("This enrolment token has been revoked or has expired.".into()),
        ResolveError::Lapsed => fail("Your organization's plan no longer allows enrolment.".into()),
        ResolveError::InvitesOff => {
            fail("Your organization has turned off joining by invitation.".into())
        }
        ResolveError::ServerTooOld => fail(format!(
            "The server at {} is too old to support enrolment.",
            host_of(&token.server_url)
        )),
        ResolveError::RateLimited => {
            fail("The server is limiting requests. Try again in a minute.".into())
        }
        ResolveError::BadAnswer => fail(format!(
            "Unexpected answer from {}.",
            host_of(&token.server_url)
        )),
        ResolveError::Network(m) => CliError::io(format!(
            "{m}\nCheck the network, or pass --no-verify to write the token without checking it."
        )),
    }
}

fn parse_token(raw: &str) -> Result<EnrollmentToken, CliError> {
    enrollment_token::parse(raw)
        .ok_or_else(|| CliError::Usage("That is not a Voltius enrolment token.".into()))
}

pub(super) fn token_in(doc: &PolicyDoc) -> Option<EnrollmentToken> {
    doc.policy
        .get(KEY)
        .and_then(Value::as_str)
        .and_then(enrollment_token::parse)
}

fn current_token(machine: Option<&Path>) -> Option<EnrollmentToken> {
    token_in(&machine_doc(machine))
}

pub(super) fn refuse_locked_server(
    doc: &PolicyDoc,
    server: &str,
    what: &str,
) -> Result<(), CliError> {
    let locked = doc.policy.get("server.url").and_then(Value::as_str);
    let allow_other = doc.policy.get("server.allowOther").and_then(Value::as_bool);
    match locked.filter(|l| allow_other == Some(false) && !policy::same_server(l, server)) {
        Some(locked) => Err(fail(format!(
            "This machine's policy locks server.url to {}; {what} is for {}.",
            host_of(locked),
            host_of(server)
        ))),
        None => Ok(()),
    }
}

pub(super) fn run_enroll(
    args: EnrollArgs,
    machine: Option<&Path>,
    resolve: Resolver,
    out: &mut Output,
) -> Result<(), CliError> {
    if args.remove {
        return remove(machine, out);
    }
    if args.show {
        return show(machine, args.no_verify, resolve, out);
    }
    let raw = args
        .token
        .ok_or_else(|| CliError::Usage("pass the enrolment token, or --show / --remove".into()))?;
    let token = parse_token(&raw)?;
    let path = machine_path(machine)?;
    let host = host_of(&token.server_url);
    refuse_locked_server(&machine_doc(machine), &token.server_url, "the token")?;
    let changed = current_token(machine).as_ref() != Some(&token);
    let (team, unreachable) = match lookup(&token, args.no_verify, resolve) {
        Err(ResolveError::Network(_)) if !changed => (None, true),
        Err(e) => return Err(refusal(e, &token)),
        Ok(team) => (team, false),
    };
    if changed {
        put(KEY, raw.trim(), Layer::Policy, path, out)?;
    }
    if out.json {
        out.json(&json!({"changed": changed, "team": team, "server": token.server_url}));
        return Ok(());
    }
    let team_part = team.map(|t| format!(" in {t}")).unwrap_or_default();
    out.line(if unreachable {
        format!("Already enrolled ({host}); couldn't reach the server to check the token.")
    } else if changed {
        format!(
            "Enrolled this machine{team_part} ({host}). Voltius asks people to sign in at next launch."
        )
    } else {
        format!("Already enrolled{team_part} ({host}).")
    });
    Ok(())
}

fn lookup(
    token: &EnrollmentToken,
    no_verify: bool,
    resolve: Resolver,
) -> Result<Option<String>, ResolveError> {
    if no_verify {
        return Ok(None);
    }
    resolve(token).map(Some)
}

fn show(
    machine: Option<&Path>,
    no_verify: bool,
    resolve: Resolver,
    out: &mut Output,
) -> Result<(), CliError> {
    let Some(token) = current_token(machine) else {
        if out.json {
            out.json(&json!({"enrolled": false}));
        } else {
            out.line("This machine is not enrolled.");
        }
        return Ok(());
    };
    let team = lookup(&token, no_verify, resolve).map_err(|e| refusal(e, &token))?;
    let id = &token.id[..8];
    if out.json {
        out.json(
            &json!({"enrolled": true, "team": team, "server": token.server_url, "tokenId": id}),
        );
    } else {
        out.line(format!(
            "{} · {} · token {id}…",
            team.as_deref().unwrap_or("unknown team"),
            host_of(&token.server_url)
        ));
    }
    Ok(())
}

fn remove(machine: Option<&Path>, out: &mut Output) -> Result<(), CliError> {
    let removed = remove_setting(KEY, Layer::Policy, machine_path(machine)?, out)?;
    if out.json {
        out.json(&json!({"changed": removed}));
    } else if removed {
        out.line("Removed this machine's enrolment.");
    } else {
        out.line("This machine is not enrolled.");
    }
    Ok(())
}

fn classify(status: u16, body: &str) -> Result<String, ResolveError> {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let code = parsed
        .as_ref()
        .and_then(|v| v.get("error"))
        .and_then(Value::as_str);
    match (status, code) {
        (200, _) => parsed
            .as_ref()
            .and_then(|v| v.get("team_name"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or(ResolveError::BadAnswer),
        (404, Some("ENROLLMENT_NOT_FOUND")) => Err(ResolveError::NotFound),
        (404, _) => Err(ResolveError::ServerTooOld),
        (410, _) => Err(ResolveError::Gone),
        (402, _) => Err(ResolveError::Lapsed),
        (403, Some("TEAM_INVITES_DISABLED")) => Err(ResolveError::InvitesOff),
        (429, _) => Err(ResolveError::RateLimited),
        (s, _) => Err(ResolveError::Network(format!("HTTP {s}"))),
    }
}

async fn post_resolve(token: &EnrollmentToken) -> Result<String, ResolveError> {
    let net = |e: reqwest::Error| ResolveError::Network(e.to_string());
    let id = uuid::Uuid::parse_str(&token.id)
        .map_err(|e| ResolveError::Network(e.to_string()))?
        .hyphenated()
        .to_string();
    let body = json!({"id": id, "secret": token.secret}).to_string();
    let resp = crate::commands::http::client_builder()
        .build()
        .map_err(net)?
        .post(format!(
            "{}/v1/enrollment/resolve",
            token.server_url.trim_end_matches('/')
        ))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(net)?;
    let status = resp.status().as_u16();
    classify(status, &resp.text().await.map_err(net)?)
}

fn resolve_over_network(token: &EnrollmentToken) -> Result<String, ResolveError> {
    super::block_on_timeout(RESOLVE_TIMEOUT, post_resolve(token)).map_err(ResolveError::Network)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{capture, captured};
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use std::cell::Cell;

    const ID: &str = "0123456789abcdef0123456789abcdef";
    const SECRET: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

    fn token_for(server: &str) -> String {
        format!("vte1.{}.{ID}.{SECRET}", URL_SAFE_NO_PAD.encode(server))
    }

    fn token() -> String {
        token_for("https://v.acme.com")
    }

    fn args(t: Option<&str>) -> EnrollArgs {
        EnrollArgs {
            token: t.map(str::to_string),
            no_verify: false,
            show: false,
            remove: false,
        }
    }

    fn run(
        a: EnrollArgs,
        machine: &Path,
        json: bool,
        resolve: Resolver,
    ) -> (Result<(), CliError>, String) {
        let (mut out, buf) = capture(json);
        let r = run_enroll(a, Some(machine), resolve, &mut out);
        (r, captured(&buf))
    }

    fn acme(_: &EnrollmentToken) -> Result<String, ResolveError> {
        Ok("Acme".into())
    }

    fn stored(machine: &Path) -> Option<String> {
        policy::load_machine_at(machine)
            .doc
            .policy
            .get(KEY)
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    fn machine() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        (dir, path)
    }

    #[test]
    fn enroll_writes_token_after_resolve() {
        let (_d, m) = machine();
        let (r, text) = run(args(Some(&token())), &m, false, &acme);
        r.unwrap();
        assert_eq!(
            text,
            "Enrolled this machine in Acme (v.acme.com). Voltius asks people to sign in at next launch.\n"
        );
        assert_eq!(stored(&m), Some(token()));
    }

    #[test]
    fn enroll_same_token_is_unchanged() {
        let (_d, m) = machine();
        run(args(Some(&token())), &m, false, &acme).0.unwrap();
        let before = std::fs::read_to_string(&m).unwrap();
        let (r, text) = run(args(Some(&token())), &m, false, &acme);
        r.unwrap();
        assert_eq!(text, "Already enrolled in Acme (v.acme.com).\n");
        assert_eq!(std::fs::read_to_string(&m).unwrap(), before);
    }

    #[test]
    fn enroll_json_reports_changed() {
        let (_d, m) = machine();
        let (_, first) = run(args(Some(&token())), &m, true, &acme);
        let v: Value = serde_json::from_str(&first).unwrap();
        assert_eq!(
            v,
            json!({"changed": true, "team": "Acme", "server": "https://v.acme.com"})
        );
        let (_, second) = run(args(Some(&token())), &m, true, &acme);
        let v: Value = serde_json::from_str(&second).unwrap();
        assert_eq!(v["changed"], false);
    }

    #[test]
    fn enroll_bad_token_is_usage_error_without_network() {
        let (_d, m) = machine();
        let calls = Cell::new(0);
        let resolve = |_: &EnrollmentToken| {
            calls.set(calls.get() + 1);
            Ok("x".into())
        };
        for bad in [Some("nope"), None] {
            let e = run(args(bad), &m, false, &resolve).0.unwrap_err();
            assert_eq!(e.exit_code(), 2);
        }
        assert_eq!(calls.get(), 0);
        assert!(!m.exists());
    }

    #[test]
    fn enroll_not_found_and_gone_exit_3_and_write_nothing() {
        let (_d, m) = machine();
        for why in [
            ResolveError::NotFound,
            ResolveError::Gone,
            ResolveError::Lapsed,
            ResolveError::InvitesOff,
            ResolveError::ServerTooOld,
            ResolveError::RateLimited,
        ] {
            let why = Cell::new(Some(why));
            let resolve = |_: &EnrollmentToken| Err(why.take().unwrap());
            let e = run(args(Some(&token())), &m, false, &resolve)
                .0
                .unwrap_err();
            assert_eq!(e.exit_code(), 3);
        }
        assert!(!m.exists());
    }

    #[test]
    fn enroll_same_token_offline_is_unchanged_exit_0() {
        let (_d, m) = machine();
        run(args(Some(&token())), &m, false, &acme).0.unwrap();
        let before = std::fs::read_to_string(&m).unwrap();
        let offline = |_: &EnrollmentToken| Err(ResolveError::Network("offline".into()));
        let (r, text) = run(args(Some(&token())), &m, false, &offline);
        r.unwrap();
        assert_eq!(
            text,
            "Already enrolled (v.acme.com); couldn't reach the server to check the token.\n"
        );
        let (_, text) = run(args(Some(&token())), &m, true, &offline);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["changed"], false);
        assert_eq!(v["team"], Value::Null);
        assert_eq!(std::fs::read_to_string(&m).unwrap(), before);
    }

    #[test]
    fn enroll_same_token_revoked_exits_3_without_writing() {
        let (_d, m) = machine();
        run(args(Some(&token())), &m, false, &acme).0.unwrap();
        let before = std::fs::read_to_string(&m).unwrap();
        let gone = |_: &EnrollmentToken| Err(ResolveError::Gone);
        let e = run(args(Some(&token())), &m, false, &gone).0.unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert_eq!(std::fs::read_to_string(&m).unwrap(), before);
    }

    #[test]
    fn enroll_without_machine_path_fails_before_network() {
        let (mut out, _) = capture(false);
        let resolve = |_: &EnrollmentToken| panic!("must not resolve");
        let e = run_enroll(args(Some(&token())), None, &resolve, &mut out).unwrap_err();
        assert_eq!(e.exit_code(), 2);
    }

    #[test]
    fn enroll_network_failure_exits_5_and_writes_nothing() {
        let (_d, m) = machine();
        let resolve = |_: &EnrollmentToken| Err(ResolveError::Network("offline".into()));
        let e = run(args(Some(&token())), &m, false, &resolve)
            .0
            .unwrap_err();
        assert_eq!(e.exit_code(), 5);
        assert!(e.to_string().ends_with(
            "Check the network, or pass --no-verify to write the token without checking it."
        ));
        assert!(!m.exists());
    }

    #[test]
    fn enroll_no_verify_skips_resolver() {
        let (_d, m) = machine();
        let resolve = |_: &EnrollmentToken| panic!("must not resolve");
        let mut a = args(Some(&token()));
        a.no_verify = true;
        let (r, text) = run(a, &m, false, &resolve);
        r.unwrap();
        assert_eq!(
            text,
            "Enrolled this machine (v.acme.com). Voltius asks people to sign in at next launch.\n"
        );
        assert_eq!(stored(&m), Some(token()));
    }

    #[test]
    fn enroll_refuses_other_locked_server() {
        let (_d, m) = machine();
        std::fs::write(
            &m,
            r#"{"version":1,"policy":{"server.url":"https://corp.example","server.allowOther":false}}"#,
        )
        .unwrap();
        let e = run(args(Some(&token())), &m, false, &acme).0.unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert_eq!(
            e.to_string(),
            "This machine's policy locks server.url to corp.example; the token is for v.acme.com."
        );
        assert_eq!(stored(&m), None);

        std::fs::write(
            &m,
            r#"{"version":1,"policy":{"server.url":"https://V.acme.com/"}}"#,
        )
        .unwrap();
        run(args(Some(&token())), &m, false, &acme).0.unwrap();
        assert_eq!(stored(&m), Some(token()));
    }

    #[test]
    fn enroll_allows_other_server_unless_allow_other_is_locked_off() {
        for allow_other in ["", r#","server.allowOther":true"#] {
            let (_d, m) = machine();
            std::fs::write(
                &m,
                format!(r#"{{"version":1,"policy":{{"server.url":"https://corp.example"{allow_other}}}}}"#),
            )
            .unwrap();
            run(args(Some(&token())), &m, false, &acme).0.unwrap();
            assert_eq!(stored(&m), Some(token()));
        }
    }

    #[test]
    fn enroll_show_never_prints_secret() {
        let (_d, m) = machine();
        run(args(Some(&token())), &m, false, &acme).0.unwrap();
        let mut a = args(None);
        a.show = true;
        let (r, text) = run(a, &m, false, &acme);
        r.unwrap();
        assert_eq!(text, "Acme · v.acme.com · token 01234567…\n");
        let mut a = args(None);
        a.show = true;
        a.no_verify = true;
        let (_, text) = run(a, &m, true, &acme);
        assert!(!text.contains(SECRET), "{text}");
        assert!(!text.contains(ID), "{text}");
    }

    #[test]
    fn enroll_remove_unsets() {
        let (_d, m) = machine();
        run(args(Some(&token())), &m, false, &acme).0.unwrap();
        let mut a = args(None);
        a.remove = true;
        run(a, &m, false, &acme).0.unwrap();
        assert_eq!(stored(&m), None);
        let mut a = args(None);
        a.remove = true;
        let (r, text) = run(a, &m, false, &acme);
        r.unwrap();
        assert_eq!(text, "This machine is not enrolled.\n");
    }

    #[test]
    fn server_answers_map_to_refusals() {
        let nf = r#"{"error":"ENROLLMENT_NOT_FOUND"}"#;
        let off = r#"{"error":"TEAM_INVITES_DISABLED"}"#;
        assert_eq!(classify(200, r#"{"team_name":"Acme"}"#), Ok("Acme".into()));
        assert_eq!(classify(200, "{}"), Err(ResolveError::BadAnswer));
        assert_eq!(classify(404, nf), Err(ResolveError::NotFound));
        assert_eq!(classify(404, ""), Err(ResolveError::ServerTooOld));
        assert_eq!(classify(410, "{}"), Err(ResolveError::Gone));
        assert_eq!(classify(402, "{}"), Err(ResolveError::Lapsed));
        assert_eq!(classify(403, off), Err(ResolveError::InvitesOff));
        assert_eq!(classify(429, ""), Err(ResolveError::RateLimited));
        assert!(matches!(classify(500, ""), Err(ResolveError::Network(_))));
    }
}
