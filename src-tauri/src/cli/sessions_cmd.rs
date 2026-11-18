use super::session::{keychain_refused, server_failure, Device, Keys};
use super::user::{confirm, CANCELLED};
use super::{cli_device, CliError, Ctx, Net};
use crate::auth::sessions::{self, SignedInDevice, Tokens};
use crate::auth::AuthError;
use clap::{Args, Subcommand};
use serde_json::{json, Value};

const LOCAL_ACCOUNT: &str = "This is a local account; it has no server sign-ins.";
const UNSUPPORTED: &str = "Your server doesn't support managing signed-in devices yet.";
const ENDED: &str =
    "This device is signed out. Sign in again from the Voltius app; its data here was kept.";
const OTHERS_DONE: &str = "Signed out every other device.";
const GONE: &str = "That device is already signed out.";
const ALL_QUESTION: &str =
    "Sign out every device, this one included? Data already on them is not erased.";
const OTHERS_QUESTION: &str = "Sign out every other device? Data already on them is not erased.";
const THIS_QUESTION: &str = "Sign out this device? Its data here is kept.";

#[derive(Args, Debug)]
pub struct SessionsArgs {
    #[command(subcommand)]
    cmd: Option<SessionsCmd>,
}

#[derive(Subcommand, Debug)]
enum SessionsCmd {
    /// Sign a device out of this account
    Revoke(RevokeArgs),
}

#[derive(Args, Debug)]
#[group(required = true, multiple = false)]
struct RevokeArgs {
    /// Id of the device to sign out, as `voltius-cli sessions` lists it
    id: Option<String>,
    /// Sign out every device except this one
    #[arg(long)]
    others: bool,
    /// Sign out every device, this one included
    #[arg(long)]
    all: bool,
}

pub(crate) trait Api {
    fn refresh(&self, server: &str, refresh_token: &str) -> Result<Tokens, AuthError>;
    fn list(&self, server: &str, jwt: &str) -> Result<Vec<SignedInDevice>, AuthError>;
    fn revoke(&self, server: &str, jwt: &str, id: &str) -> Result<(), AuthError>;
    fn revoke_others(&self, server: &str, jwt: &str) -> Result<Tokens, AuthError>;
    fn revoke_all(&self, server: &str, jwt: &str) -> Result<(), AuthError>;
}

impl Api for Net {
    fn refresh(&self, server: &str, refresh_token: &str) -> Result<Tokens, AuthError> {
        let device = cli_device();
        self.over_network(|c| sessions::refresh(c, server, refresh_token, &device))
    }
    fn list(&self, server: &str, jwt: &str) -> Result<Vec<SignedInDevice>, AuthError> {
        self.over_network(|c| sessions::list(c, server, jwt))
    }
    fn revoke(&self, server: &str, jwt: &str, id: &str) -> Result<(), AuthError> {
        self.over_network(|c| sessions::revoke(c, server, jwt, id))
    }
    fn revoke_others(&self, server: &str, jwt: &str) -> Result<Tokens, AuthError> {
        self.over_network(|c| sessions::revoke_others(c, server, jwt))
    }
    fn revoke_all(&self, server: &str, jwt: &str) -> Result<(), AuthError> {
        self.over_network(|c| sessions::revoke_all(c, server, jwt))
    }
}

pub fn run(args: SessionsArgs, ctx: &mut Ctx) -> Result<(), CliError> {
    run_sessions(args, ctx, &Device::this_user()?, &Net::default())
}

fn run_sessions(
    args: SessionsArgs,
    ctx: &mut Ctx,
    device: &Device,
    api: &dyn Api,
) -> Result<(), CliError> {
    let session = device
        .signed_in("sessions", "manages the sign-ins of")?
        .ok_or(CliError::NotSignedIn)?;
    if !session.is_server() {
        return Err(CliError::Refused(LOCAL_ACCOUNT.into()));
    }
    let server = session.server.ok_or(CliError::NotSignedIn)?;
    let signed = Signed {
        api,
        keys: device.keys,
        server,
    };
    match args.cmd {
        None => list(ctx, &signed),
        Some(SessionsCmd::Revoke(target)) => revoke(ctx, &signed, target),
    }
}

struct Signed<'a> {
    api: &'a dyn Api,
    keys: &'a dyn Keys,
    server: String,
}

impl Signed<'_> {
    fn call<T>(
        &self,
        missing: &str,
        work: impl Fn(&dyn Api, &str, &str) -> Result<T, AuthError>,
    ) -> Result<T, CliError> {
        let jwt = match self.keys.get("jwt")? {
            Some(jwt) => jwt,
            None => self.refresh()?,
        };
        let answer = match work(self.api, &self.server, &jwt) {
            Err(AuthError::Status { status: 401, .. }) => {
                work(self.api, &self.server, &self.refresh()?)
            }
            answer => answer,
        };
        answer.map_err(|e| match e {
            AuthError::Status { status: 401, .. } => ended(),
            AuthError::Status { status: 404, .. } => CliError::Refused(missing.into()),
            e => server_failure(e),
        })
    }

    fn refresh(&self) -> Result<String, CliError> {
        let token = self.keys.get("refresh_token")?.ok_or_else(ended)?;
        match self.api.refresh(&self.server, &token) {
            Ok(tokens) => self.store(tokens),
            Err(AuthError::Status { status: 401, .. }) => Err(ended()),
            Err(e) => Err(server_failure(e)),
        }
    }

    fn store(&self, tokens: Tokens) -> Result<String, CliError> {
        if let Some(refresh_token) = &tokens.refresh_token {
            self.keys
                .set("refresh_token", refresh_token)
                .map_err(keychain_refused)?;
        }
        self.keys
            .set("jwt", &tokens.jwt)
            .map_err(keychain_refused)?;
        Ok(tokens.jwt)
    }

    fn list(&self) -> Result<Vec<SignedInDevice>, CliError> {
        self.call(UNSUPPORTED, |api, server, jwt| api.list(server, jwt))
    }
}

fn ended() -> CliError {
    CliError::Denied(ENDED.into())
}

fn list(ctx: &mut Ctx, signed: &Signed) -> Result<(), CliError> {
    let devices = signed.list()?;
    if ctx.out.json {
        let rows: Vec<Value> = devices.iter().map(json_row).collect();
        ctx.out.json(&json!({ "sessions": rows }));
        return Ok(());
    }
    for d in &devices {
        let mark = if d.current { "*" } else { " " };
        ctx.out.line(format!("{mark} {}  {}", d.id, describe(d)));
        ctx.out.line(format!(
            "    last active {}, signed in {}",
            when(&d.last_seen_at),
            when(&d.created_at)
        ));
    }
    ctx.out.line("* this device");
    Ok(())
}

fn json_row(d: &SignedInDevice) -> Value {
    json!({
        "id": d.id,
        "deviceName": d.device_name,
        "platform": d.platform,
        "client": d.client,
        "createdAt": d.created_at,
        "lastSeenAt": d.last_seen_at,
        "current": d.current,
    })
}

fn describe(d: &SignedInDevice) -> String {
    let name = d.device_name.as_deref().unwrap_or("Unknown device");
    let mut tags: Vec<&str> = d
        .platform
        .as_deref()
        .map(platform_name)
        .into_iter()
        .collect();
    if d.client.as_deref() == Some("cli") {
        tags.push("CLI");
    }
    if tags.is_empty() {
        name.to_string()
    } else {
        format!("{name} ({})", tags.join(", "))
    }
}

fn platform_name(platform: &str) -> &str {
    match platform {
        "linux" => "Linux",
        "macos" => "macOS",
        "windows" => "Windows",
        "android" => "Android",
        "ios" => "iOS",
        other => other,
    }
}

fn when(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso).map_or_else(
        |_| iso.to_string(),
        |t| {
            t.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        },
    )
}

enum Plan {
    All,
    Others,
    One(SignedInDevice),
}

fn revoke(ctx: &mut Ctx, signed: &Signed, target: RevokeArgs) -> Result<(), CliError> {
    let plan = match (target.all, target.others, target.id) {
        (true, ..) => Plan::All,
        (_, true, _) => Plan::Others,
        (_, _, id) => {
            let id = id.unwrap_or_default();
            let found = signed.list()?.into_iter().find(|d| d.id == id);
            Plan::One(found.ok_or_else(|| {
                CliError::Refused(format!(
                    "No signed-in device has the id {id}. Run voltius-cli sessions to list them."
                ))
            })?)
        }
    };
    let (question, done) = match &plan {
        Plan::All => (ALL_QUESTION.to_string(), ENDED.to_string()),
        Plan::Others => (OTHERS_QUESTION.to_string(), OTHERS_DONE.to_string()),
        Plan::One(d) if d.current => (THIS_QUESTION.to_string(), ENDED.to_string()),
        Plan::One(d) => (
            format!(
                "Sign out {}? Data already on it is not erased.",
                describe(d)
            ),
            format!("Signed out {}.", describe(d)),
        ),
    };
    if !confirm(ctx, &question)? {
        return Err(CliError::Refused(CANCELLED.into()));
    }
    match &plan {
        Plan::All => signed.call(UNSUPPORTED, |api, server, jwt| api.revoke_all(server, jwt))?,
        Plan::Others => {
            let tokens = signed.call(UNSUPPORTED, |api, server, jwt| {
                api.revoke_others(server, jwt)
            })?;
            signed.store(tokens)?;
        }
        Plan::One(d) => signed.call(GONE, |api, server, jwt| api.revoke(server, jwt, &d.id))?,
    }
    if ctx.out.json {
        let (revoked, here) = match &plan {
            Plan::All => ("all", true),
            Plan::Others => ("others", false),
            Plan::One(d) => (d.id.as_str(), d.current),
        };
        ctx.out
            .json(&json!({ "revoked": revoked, "thisDevice": here }));
    } else {
        ctx.out.line(done);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::session::{MemKeys, KEYCHAIN_UNREACHABLE};
    use crate::cli::testing::{Machine, Outcome};
    use crate::cli::{Cli, Command};
    use clap::Parser;
    use std::cell::RefCell;

    const SERVER: &str = "https://sync.example.com";

    fn device(
        id: &str,
        name: Option<&str>,
        platform: &str,
        client: &str,
        current: bool,
    ) -> SignedInDevice {
        SignedInDevice {
            id: id.into(),
            device_name: name.map(str::to_string),
            platform: Some(platform.into()),
            client: Some(client.into()),
            created_at: "2026-11-01T09:00:00Z".into(),
            last_seen_at: "2026-11-13T10:00:00Z".into(),
            current,
        }
    }

    struct FakeApi {
        listed: Result<Vec<SignedInDevice>, u16>,
        refreshed: Result<Tokens, u16>,
        calls: RefCell<Vec<String>>,
    }

    impl Default for FakeApi {
        fn default() -> Self {
            FakeApi {
                listed: Ok(vec![
                    device("s-1", Some("box"), "linux", "app", true),
                    device("s-2", None, "macos", "cli", false),
                ]),
                refreshed: Ok(Tokens {
                    jwt: "jwt-new".into(),
                    refresh_token: None,
                }),
                calls: RefCell::default(),
            }
        }
    }

    fn status(status: u16) -> AuthError {
        AuthError::Status { status, code: None }
    }

    impl FakeApi {
        fn authed(&self, call: String, jwt: &str) -> Result<(), AuthError> {
            self.calls.borrow_mut().push(format!("{call} {jwt}"));
            if jwt == "jwt-old" {
                Err(status(401))
            } else {
                Ok(())
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl Api for FakeApi {
        fn refresh(&self, server: &str, refresh_token: &str) -> Result<Tokens, AuthError> {
            assert_eq!(server, SERVER);
            self.calls
                .borrow_mut()
                .push(format!("refresh {refresh_token}"));
            self.refreshed.clone().map_err(status)
        }
        fn list(&self, _server: &str, jwt: &str) -> Result<Vec<SignedInDevice>, AuthError> {
            self.authed("list".into(), jwt)?;
            self.listed.clone().map_err(status)
        }
        fn revoke(&self, _server: &str, jwt: &str, id: &str) -> Result<(), AuthError> {
            self.authed(format!("revoke {id}"), jwt)
        }
        fn revoke_others(&self, _server: &str, jwt: &str) -> Result<Tokens, AuthError> {
            self.authed("revoke-others".into(), jwt)?;
            Ok(Tokens {
                jwt: "jwt-kept".into(),
                refresh_token: Some("refresh-kept".into()),
            })
        }
        fn revoke_all(&self, _server: &str, jwt: &str) -> Result<(), AuthError> {
            self.authed("revoke-all".into(), jwt)
        }
    }

    fn keys(jwt: &str) -> MemKeys {
        MemKeys::with(&[
            ("account_id", "acc-1"),
            ("mode", "server"),
            ("email", "ada@example.com"),
            ("server_url", SERVER),
            ("jwt", jwt),
            ("refresh_token", "refresh-1"),
        ])
    }

    fn machine(jwt: &str) -> Machine {
        Machine::new(keys(jwt))
    }

    fn args(argv: &[&str]) -> SessionsArgs {
        let argv = ["voltius-cli", "sessions"].iter().chain(argv).copied();
        match Cli::try_parse_from(argv).unwrap().command {
            Command::Sessions(args) => args,
            other => panic!("{other:?}"),
        }
    }

    fn run(m: &Machine, api: &FakeApi, argv: &[&str]) -> Outcome {
        let parsed = args(argv);
        m.run(|ctx, device| run_sessions(parsed, ctx, &device, api))
    }

    fn json_of(o: &Outcome) -> Value {
        serde_json::from_str(&o.out).unwrap()
    }

    #[test]
    fn lists_devices_and_marks_this_one() {
        let api = FakeApi::default();
        let o = run(&machine("jwt-ok"), &api, &[]);
        o.result.unwrap();
        let lines: Vec<&str> = o.out.lines().collect();
        assert_eq!(lines[0], "* s-1  box (Linux)");
        assert!(lines[1].starts_with("    last active "), "{}", lines[1]);
        assert_eq!(lines[2], "  s-2  Unknown device (macOS, CLI)");
        assert_eq!(lines.last(), Some(&"* this device"));
        assert_eq!(api.calls(), ["list jwt-ok"]);
    }

    #[test]
    fn lists_as_json_without_secrets() {
        let mut m = machine("jwt-ok");
        m.json = true;
        let o = run(&m, &FakeApi::default(), &[]);
        o.result.as_ref().unwrap();
        assert!(!o.out.contains("jwt-ok") && !o.out.contains("refresh-1"));
        assert_eq!(
            json_of(&o)["sessions"][0],
            json!({"id":"s-1","deviceName":"box","platform":"linux","client":"app",
                   "createdAt":"2026-11-01T09:00:00Z","lastSeenAt":"2026-11-13T10:00:00Z","current":true})
        );
        assert_eq!(json_of(&o)["sessions"][1]["deviceName"], Value::Null);
    }

    #[test]
    fn a_refused_access_token_is_refreshed_once_and_stored() {
        let api = FakeApi {
            refreshed: Ok(Tokens {
                jwt: "jwt-new".into(),
                refresh_token: Some("refresh-2".into()),
            }),
            ..FakeApi::default()
        };
        let m = machine("jwt-old");
        run(&m, &api, &[]).result.unwrap();
        assert_eq!(
            api.calls(),
            ["list jwt-old", "refresh refresh-1", "list jwt-new"]
        );
        assert_eq!(m.stored()["jwt"], "jwt-new");
        assert_eq!(m.stored()["refresh_token"], "refresh-2");
    }

    #[test]
    fn a_missing_access_token_is_refreshed_first() {
        let api = FakeApi::default();
        let m = machine("x");
        m.keys.delete("jwt").unwrap();
        run(&m, &api, &[]).result.unwrap();
        assert_eq!(api.calls(), ["refresh refresh-1", "list jwt-new"]);
        assert_eq!(m.stored()["refresh_token"], "refresh-1");
    }

    #[test]
    fn a_revoked_device_is_told_to_sign_in_again_and_keeps_its_keys() {
        let api = FakeApi {
            refreshed: Err(401),
            ..FakeApi::default()
        };
        let m = machine("jwt-old");
        let before = m.stored();
        run(&m, &api, &[]).refused(4, ENDED);
        assert_eq!(m.stored(), before);
    }

    #[test]
    fn an_older_server_is_named() {
        let api = FakeApi {
            listed: Err(404),
            ..FakeApi::default()
        };
        run(&machine("jwt-ok"), &api, &[]).refused(3, UNSUPPORTED);
    }

    #[test]
    fn refusals_without_a_server_session() {
        let api = FakeApi::default();
        let o = run(&Machine::new(MemKeys::default()), &api, &[]);
        assert!(matches!(o.result, Err(CliError::NotSignedIn)));
        let local = Machine::new(MemKeys::with(&[("account_id", "loc"), ("mode", "local")]));
        run(&local, &api, &[]).refused(3, LOCAL_ACCOUNT);
        let mut locked = machine("jwt-ok");
        locked.keychain = false;
        run(&locked, &api, &[]).refused(4, KEYCHAIN_UNREACHABLE);
        assert!(api.calls().is_empty());
    }

    #[test]
    fn revoking_another_device_asks_first() {
        let api = FakeApi::default();
        let mut m = machine("jwt-ok");
        run(&m, &api, &["revoke", "s-2"]).refused(
            2,
            "Sign out Unknown device (macOS, CLI)? Data already on it is not erased. Not a terminal: add --yes to confirm.",
        );
        assert_eq!(api.calls(), ["list jwt-ok"]);
        m.yes = true;
        let o = run(&m, &api, &["revoke", "s-2"]);
        o.result.unwrap();
        assert_eq!(o.out, "Signed out Unknown device (macOS, CLI).\n");
        assert_eq!(api.calls().last().unwrap(), "revoke s-2 jwt-ok");
    }

    #[test]
    fn revoking_this_device_keeps_its_data_and_says_so() {
        let api = FakeApi::default();
        let mut m = machine("jwt-ok");
        m.yes = true;
        let before = m.stored();
        let o = run(&m, &api, &["revoke", "s-1"]);
        o.result.unwrap();
        assert_eq!(o.out, format!("{ENDED}\n"));
        assert_eq!(m.stored(), before);
        m.json = true;
        let o = run(&m, &api, &["revoke", "s-1"]);
        assert_eq!(json_of(&o), json!({"revoked":"s-1","thisDevice":true}));
    }

    #[test]
    fn an_unknown_id_is_refused() {
        let mut m = machine("jwt-ok");
        m.yes = true;
        run(&m, &FakeApi::default(), &["revoke", "nope"]).refused(
            3,
            "No signed-in device has the id nope. Run voltius-cli sessions to list them.",
        );
    }

    #[test]
    fn revoking_the_others_stores_the_pair_it_returns() {
        let api = FakeApi::default();
        let mut m = machine("jwt-ok");
        m.yes = true;
        let o = run(&m, &api, &["revoke", "--others"]);
        o.result.unwrap();
        assert_eq!(o.out, format!("{OTHERS_DONE}\n"));
        assert_eq!(api.calls(), ["revoke-others jwt-ok"]);
        assert_eq!(m.stored()["jwt"], "jwt-kept");
        assert_eq!(m.stored()["refresh_token"], "refresh-kept");
    }

    #[test]
    fn revoking_all_ends_this_device_too() {
        let api = FakeApi::default();
        let mut m = machine("jwt-ok");
        m.yes = true;
        m.json = true;
        let o = run(&m, &api, &["revoke", "--all"]);
        assert_eq!(json_of(&o), json!({"revoked":"all","thisDevice":true}));
        assert_eq!(api.calls(), ["revoke-all jwt-ok"]);
        assert_eq!(m.stored()["jwt"], "jwt-ok");
    }

    #[test]
    fn revoke_takes_exactly_one_target() {
        let parse = |a: &[&str]| {
            Cli::try_parse_from(["voltius-cli", "sessions", "revoke"].iter().chain(a)).map(drop)
        };
        assert!(parse(&[]).is_err());
        assert!(parse(&["s-1", "--all"]).is_err());
        assert!(parse(&["--others", "--all"]).is_err());
        assert!(parse(&["--others"]).is_ok());
    }
}
