use super::enroll_cmd::{host_of, refuse_locked_server, token_in};
use super::output::Output;
use super::policy_cmd::machine_doc;
use super::prompt::{Prompt, Terminal};
use super::session::{keychain_refused, Device, Keys, SecretStore, SessionInfo};
use super::user::{confirm, CANCELLED};
use super::{server_cmd, whoami_cmd, CliError, Ctx};
use crate::auth::{self, AuthError, LoginStep, Proof, Session};
use crate::commands::crypto::{unwrap_b64, DeriveKeysResult};
use crate::commands::sync::ENTITY_FILES;
use crate::commands::vault_secret::{self, State};
use crate::policy::{self, PolicyDoc};
use crate::storage::secrets::SECRETS_FILE;
use clap::Args;
use serde_json::Value;
use std::future::Future;
use std::path::Path;
use std::time::Duration;
use zeroize::{Zeroize, Zeroizing};

const DEFAULT_SERVER_URL: &str = "https://api.voltius.app";
const SERVER_KEY: &str = "server.url";
const MAX_CODES: usize = 3;
const NETWORK_TIMEOUT: Duration = Duration::from_secs(45);

const NOT_A_TERMINAL: &str = "voltius-cli login is interactive; run it in a terminal.";
const LOCAL_ACCOUNT: &str = "This device has a local Voltius account. Sign in from the app to keep its data, or run voltius-cli logout to remove it.";
const LEFTOVER: &str = "This device has Voltius data from an earlier sign-in that can't be opened any more. Remove it and continue?";
const INVALID: &str = "Invalid email or password.";
const TOO_MANY_ATTEMPTS: &str = "Too many attempts — wait a minute and try again.";
const EXPIRED: &str = "This sign-in took too long. Start again.";
const TOO_MANY_CODES: &str = "Three wrong codes. Run voltius-cli login again.";
const PASSKEY_ONLY: &str = "This account signs in with a passkey. Finish in the Voltius app.";
const NEEDS_UPGRADE: &str =
    "Finish your first sign-in in the Voltius app; this account needs a one-time upgrade.";
const KEYS_DO_NOT_OPEN: &str = "This password doesn't open this account's keys. Nothing was saved; sign in from the Voltius app.";
const ASKS_FOR_PASSWORD: &str = "Voltius will ask for your master password when it opens.";
const JOIN_HINT: &str = "Open Voltius to join your organization.";

#[derive(Args, Debug)]
pub struct LoginArgs {
    /// Server to sign in to (default: this machine's policy, its enrolment, or Voltius cloud)
    #[arg(long)]
    server: Option<String>,
    /// Account email (asked for when left out)
    #[arg(long)]
    email: Option<String>,
}

// Key derivation sits here too: Argon2id is far too slow unoptimised for the CLI tests.
pub(crate) trait Auth {
    fn challenge(&self, server: &str, email: &str) -> Result<String, AuthError>;
    fn login(&self, server: &str, account_id: &str, auth_key: &str)
        -> Result<LoginStep, AuthError>;
    fn second_factor(
        &self,
        server: &str,
        pending_token: &str,
        proof: &Proof,
    ) -> Result<Session, AuthError>;
    fn derive_keys(&self, password: &str, account_id: &str) -> Result<DeriveKeysResult, String>;
    fn opens(&self, kek: &[u8], wrapped_b64: &str) -> bool;
}

pub(super) struct LoginDeps<'a> {
    pub device: Device<'a>,
    pub auth: &'a dyn Auth,
    pub prompt: &'a dyn Prompt,
    pub machine: Option<&'a Path>,
}

struct SignedIn {
    account_id: String,
    session: Session,
    wrapped: String,
}

pub fn run(args: LoginArgs, ctx: &mut Ctx) -> Result<(), CliError> {
    let machine = policy::machine_policy_path();
    let deps = LoginDeps {
        device: Device::this_user()?,
        auth: &NetAuth,
        prompt: &Terminal,
        machine: machine.as_deref(),
    };
    run_login(args, ctx, &deps)
}

pub(super) fn run_login(args: LoginArgs, ctx: &mut Ctx, deps: &LoginDeps) -> Result<(), CliError> {
    let device = &deps.device;
    if let Some(signed_in) = device.session("login", "signs in")? {
        return Err(already_signed_in(&signed_in));
    }
    if !deps.prompt.tty() {
        return Err(CliError::Usage(NOT_A_TERMINAL.into()));
    }
    let doc = machine_doc(deps.machine);
    let token = token_in(&doc);
    let fallback = [
        server_cmd::user_server(&device.config_dir),
        doc.defaults
            .get(SERVER_KEY)
            .and_then(Value::as_str)
            .map(str::to_string),
        token.as_ref().map(|t| t.server_url.clone()),
    ]
    .into_iter()
    .flatten()
    .next()
    .unwrap_or_else(|| DEFAULT_SERVER_URL.into());
    let server = choose_server(args.server, &doc, fallback, deps.prompt, ctx.out)?;
    refuse_locked_server(&doc, &server, "this sign-in")?;
    let leftover = leftover_data(&device.data_dir, &device.config_dir);
    if leftover && !confirm(ctx, LEFTOVER)? {
        return Err(CliError::Refused(CANCELLED.into()));
    }
    let email = match args.email {
        Some(email) => email,
        None => deps.prompt.line("Email: ").map_err(CliError::Io)?,
    };
    let email = email.trim().to_string();
    if email.is_empty() {
        return Err(CliError::Usage("An email is required.".into()));
    }
    let password = deps
        .prompt
        .hidden("Master password: ")
        .map_err(CliError::Io)?;
    if password.is_empty() {
        return Err(CliError::Usage("A master password is required.".into()));
    }
    let signed = sign_in(deps, &server, &email, &password, ctx.out)?;
    device.refuse_while_running()?;
    if leftover {
        crate::commands::vault::reset_local_vault(&device.data_dir, &device.config_dir)
            .map_err(CliError::io)?;
    }
    let entries = [
        ("mode", "server"),
        ("email", email.as_str()),
        ("server_url", server.as_str()),
        ("jwt", signed.session.jwt.as_str()),
        ("refresh_token", signed.session.refresh_token.as_str()),
        ("wrapped_user_secrets", signed.wrapped.as_str()),
        ("account_id", signed.account_id.as_str()),
    ];
    let remembers = write_session(device.keys, &entries, &password)?;
    let info = SessionInfo {
        mode: "server".into(),
        email: Some(email.clone()),
        server: Some(server.clone()),
        account_id: signed.account_id.clone(),
    };
    if ctx.out.json {
        let mut report = whoami_cmd::report(Some(&info));
        report["passwordStored"] = remembers.into();
        ctx.out.json(&report);
        return Ok(());
    }
    ctx.out.line(format!(
        "Signed in as {email} on {}. Open Voltius to finish setting up this device.",
        host_of(&server)
    ));
    if !remembers {
        ctx.out.line(ASKS_FOR_PASSWORD);
    }
    if token.is_some_and(|t| policy::same_server(&t.server_url, &server)) {
        ctx.out.line(JOIN_HINT);
    }
    Ok(())
}

fn already_signed_in(s: &SessionInfo) -> CliError {
    if s.mode != "server" {
        return CliError::Refused(LOCAL_ACCOUNT.into());
    }
    let who = s.email.as_deref().unwrap_or("another account");
    let host = s
        .server
        .as_deref()
        .map_or_else(|| "its server".into(), host_of);
    CliError::Refused(format!(
        "Already signed in as {who} on {host}. Run voltius-cli logout first."
    ))
}

fn choose_server(
    flag: Option<String>,
    doc: &PolicyDoc,
    fallback: String,
    prompt: &dyn Prompt,
    out: &mut Output,
) -> Result<String, CliError> {
    let pinned = doc.policy.get(SERVER_KEY).and_then(Value::as_str);
    let raw = match (flag, pinned) {
        (Some(flag), _) => flag,
        (None, Some(pinned)) => {
            out.notice(format!("Server: {pinned} (set by this machine's policy)"));
            pinned.to_string()
        }
        (None, None) => {
            let answer = prompt
                .line(&format!("Server [{fallback}]: "))
                .map_err(CliError::Io)?;
            if answer.trim().is_empty() {
                fallback
            } else {
                answer
            }
        }
    };
    server_url(&raw)
}

fn server_url(raw: &str) -> Result<String, CliError> {
    let raw = raw.trim();
    match url::Url::parse(raw) {
        Ok(u) if matches!(u.scheme(), "http" | "https") && u.has_host() => {
            Ok(raw.trim_end_matches('/').to_string())
        }
        _ => Err(CliError::Usage(format!(
            "{raw} is not a server URL; give it as https://…"
        ))),
    }
}

fn leftover_data(data_dir: &Path, config_dir: &Path) -> bool {
    data_dir.join(SECRETS_FILE).exists() || ENTITY_FILES.iter().any(|f| config_dir.join(f).exists())
}

fn sign_in(
    deps: &LoginDeps,
    server: &str,
    email: &str,
    password: &str,
    out: &mut Output,
) -> Result<SignedIn, CliError> {
    let first = |e| refusal(e, false);
    let account_id = deps.auth.challenge(server, email).map_err(first)?;
    let keys = deps
        .auth
        .derive_keys(password, &account_id)
        .map_err(CliError::io)?;
    let (auth_key, kek) = (Zeroizing::new(keys.auth_key), Zeroizing::new(keys.enc_key));
    let session = match deps
        .auth
        .login(server, &account_id, &auth_key)
        .map_err(first)?
    {
        LoginStep::Signed(session) => session,
        LoginStep::SecondFactor {
            pending_token,
            methods,
        } => second_factor(deps, server, &pending_token, &methods, out)?,
    };
    let Some(wrapped) = session.wrapped_user_secrets.clone() else {
        return Err(CliError::Denied(NEEDS_UPGRADE.into()));
    };
    if !deps.auth.opens(&kek, &wrapped) {
        return Err(CliError::Refused(KEYS_DO_NOT_OPEN.into()));
    }
    Ok(SignedIn {
        account_id,
        session,
        wrapped,
    })
}

fn second_factor(
    deps: &LoginDeps,
    server: &str,
    pending_token: &str,
    methods: &[String],
    out: &mut Output,
) -> Result<Session, CliError> {
    let offers = |m: &str| methods.iter().any(|x| x == m);
    let totp = offers("totp");
    if !totp && offers("passkey") {
        return Err(CliError::Denied(PASSKEY_ONLY.into()));
    }
    let label = if totp {
        "Two-step code (or a recovery code): "
    } else {
        "Recovery code: "
    };
    let mut attempt = 0;
    while attempt < MAX_CODES {
        let typed = deps.prompt.line(label).map_err(CliError::Io)?;
        let typed = typed.trim();
        if typed.is_empty() {
            continue;
        }
        attempt += 1;
        let proof = if totp && typed.chars().all(|c| c.is_ascii_digit()) {
            Proof::Code(typed.into())
        } else {
            Proof::RecoveryCode(typed.into())
        };
        match deps.auth.second_factor(server, pending_token, &proof) {
            Ok(session) => return Ok(session),
            Err(e) if !wrong_code(&e) => return Err(refusal(e, true)),
            Err(e) if attempt < MAX_CODES => out.warn(refusal(e, true)),
            Err(_) => {}
        }
    }
    Err(CliError::Refused(TOO_MANY_CODES.into()))
}

fn wrong_code(e: &AuthError) -> bool {
    matches!(e, AuthError::Status { code: Some(c), .. }
        if c == "TWO_FACTOR_INVALID" || c == "TWO_FACTOR_UNAVAILABLE")
}

fn two_factor_text(code: &str) -> Option<&'static str> {
    Some(match code {
        "TWO_FACTOR_INVALID" => "Wrong code. Try the next one your app shows.",
        "TWO_FACTOR_LOCKED" => "Too many wrong codes. Try again in 15 minutes.",
        "TWO_FACTOR_UNAVAILABLE" => {
            "This server cannot check authenticator codes right now. Use a recovery code."
        }
        _ => return None,
    })
}

fn refusal(e: AuthError, second: bool) -> CliError {
    let refused = |m: &str| CliError::Refused(m.into());
    match e {
        AuthError::Network(m) => CliError::io(format!("Network error — {m}")),
        AuthError::BadAnswer => CliError::io("Server login failed."),
        AuthError::Status { status, code } => {
            if second {
                if let Some(text) = code.as_deref().and_then(two_factor_text) {
                    return refused(text);
                }
                if status == 401 {
                    return refused(EXPIRED);
                }
            }
            match status {
                429 => refused(TOO_MANY_ATTEMPTS),
                401 | 403 | 404 => refused(INVALID),
                s => CliError::io(format!("Server error: {s}")),
            }
        }
    }
}

// account_id goes last: until it lands, the app and `current_session` see no sign-in.
fn write_session(
    keys: &dyn Keys,
    entries: &[(&str, &str)],
    password: &str,
) -> Result<bool, CliError> {
    let store = SecretStore(keys);
    let mut touched = Vec::new();
    let mut write = || -> Result<bool, String> {
        let remembers = vault_secret::remembers(&store)?;
        vault_secret::import(&store, State::Plain, password)?;
        for (key, value) in entries {
            touched.push(*key);
            keys.set(key, value).map_err(|e| e.to_string())?;
        }
        Ok(remembers)
    };
    write().map_err(|e| {
        for key in &touched {
            let _ = keys.delete(key);
        }
        let _ = vault_secret::clear(&store);
        keychain_refused(e)
    })
}

struct NetAuth;

fn over_network<T, F>(work: impl FnOnce(reqwest::Client) -> F) -> Result<T, AuthError>
where
    F: Future<Output = Result<T, AuthError>>,
{
    super::block_on_timeout(NETWORK_TIMEOUT, async { work(auth::client()?).await })
        .map_err(AuthError::Network)?
}

impl Auth for NetAuth {
    fn challenge(&self, server: &str, email: &str) -> Result<String, AuthError> {
        over_network(|c| async move { auth::challenge(&c, server, email).await })
    }

    fn login(
        &self,
        server: &str,
        account_id: &str,
        auth_key: &str,
    ) -> Result<LoginStep, AuthError> {
        over_network(|c| async move { auth::login(&c, server, account_id, auth_key).await })
    }

    fn second_factor(
        &self,
        server: &str,
        pending_token: &str,
        proof: &Proof,
    ) -> Result<Session, AuthError> {
        over_network(|c| async move { auth::second_factor(&c, server, pending_token, proof).await })
    }

    fn derive_keys(&self, password: &str, account_id: &str) -> Result<DeriveKeysResult, String> {
        crate::crypto::derive_keys(password, account_id).map(Into::into)
    }

    fn opens(&self, kek: &[u8], wrapped_b64: &str) -> bool {
        unwrap_b64(kek, wrapped_b64)
            .map(|(mut dek, mut x25519)| {
                dek.zeroize();
                x25519.zeroize();
            })
            .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{Buf, Shared};
    use crate::cli::output::Output;
    use crate::cli::session::{MemKeys, KEYCHAIN_UNREACHABLE};
    use serde_json::json;
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use std::io;
    use std::sync::{Arc, Mutex};

    const EMAIL: &str = "ada@example.com";
    const PASSWORD: &str = "correct horse battery staple";
    const ACCOUNT: &str = "acc-1";
    const WRAPPED: &str = "d3JhcHBlZC11c2VyLXNlY3JldHM=";
    const SERVER: &str = "https://sync.example.com";
    const CODE: &str = "123456";
    const EXPIRED_CODE: &str = "999999";
    const RECOVERY: &str = "abcd-efgh-ijkl";
    const GOOD_KEK: [u8; 32] = [7; 32];
    const CODE_LABEL: &str = "Two-step code (or a recovery code): ";
    const SIGNED_IN: &str = "Signed in as ada@example.com on sync.example.com. Open Voltius to finish setting up this device.\n";

    struct FakeAuth {
        methods: Option<Vec<&'static str>>,
        wrapped: Option<&'static str>,
        calls: RefCell<Vec<String>>,
    }

    impl FakeAuth {
        fn plain() -> Self {
            FakeAuth {
                methods: None,
                wrapped: Some(WRAPPED),
                calls: RefCell::default(),
            }
        }

        fn two_step(methods: &[&'static str]) -> Self {
            FakeAuth {
                methods: Some(methods.to_vec()),
                ..Self::plain()
            }
        }

        fn session(&self) -> Session {
            Session {
                jwt: "fixture-jwt".into(),
                refresh_token: "fixture-refresh-token".into(),
                wrapped_user_secrets: self.wrapped.map(str::to_string),
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl Auth for FakeAuth {
        fn challenge(&self, _server: &str, email: &str) -> Result<String, AuthError> {
            self.calls.borrow_mut().push("challenge".into());
            if email == EMAIL {
                Ok(ACCOUNT.into())
            } else {
                Err(AuthError::Status {
                    status: 404,
                    code: None,
                })
            }
        }

        fn login(&self, _s: &str, _a: &str, auth_key: &str) -> Result<LoginStep, AuthError> {
            self.calls.borrow_mut().push(format!("login {auth_key}"));
            if auth_key != "good-auth-key" {
                return Err(AuthError::Status {
                    status: 401,
                    code: None,
                });
            }
            Ok(match &self.methods {
                None => LoginStep::Signed(self.session()),
                Some(m) => LoginStep::SecondFactor {
                    pending_token: "pending".into(),
                    methods: m.iter().map(|s| s.to_string()).collect(),
                },
            })
        }

        fn second_factor(&self, _s: &str, _p: &str, proof: &Proof) -> Result<Session, AuthError> {
            self.calls.borrow_mut().push(format!("2fa {proof:?}"));
            match proof {
                Proof::Code(c) if c == CODE => Ok(self.session()),
                Proof::RecoveryCode(c) if c == RECOVERY => Ok(self.session()),
                Proof::Code(c) if c == EXPIRED_CODE => Err(AuthError::Status {
                    status: 401,
                    code: None,
                }),
                _ => Err(AuthError::Status {
                    status: 401,
                    code: Some("TWO_FACTOR_INVALID".into()),
                }),
            }
        }

        fn derive_keys(
            &self,
            password: &str,
            account_id: &str,
        ) -> Result<DeriveKeysResult, String> {
            let good = password == PASSWORD && account_id == ACCOUNT;
            Ok(DeriveKeysResult {
                auth_key: if good {
                    "good-auth-key"
                } else {
                    "bad-auth-key"
                }
                .into(),
                enc_key: if good { GOOD_KEK.to_vec() } else { vec![0; 32] },
            })
        }

        fn opens(&self, kek: &[u8], wrapped_b64: &str) -> bool {
            kek == GOOD_KEK && wrapped_b64 == WRAPPED
        }
    }

    struct Script {
        tty: bool,
        answers: RefCell<VecDeque<&'static str>>,
        asked: RefCell<Vec<String>>,
    }

    impl Script {
        fn next(&self, label: &str) -> io::Result<String> {
            self.asked.borrow_mut().push(label.into());
            self.answers
                .borrow_mut()
                .pop_front()
                .map(str::to_string)
                .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "no answer"))
        }
    }

    impl Prompt for Script {
        fn tty(&self) -> bool {
            self.tty
        }
        fn line(&self, label: &str) -> io::Result<String> {
            self.next(label)
        }
        fn hidden(&self, label: &str) -> io::Result<Zeroizing<String>> {
            self.next(label).map(Zeroizing::new)
        }
    }

    struct World {
        keys: MemKeys,
        auth: FakeAuth,
        answers: Vec<&'static str>,
        tty: bool,
        running: bool,
        app_starts_at_check: Option<usize>,
        system: bool,
        keychain: bool,
        yes: bool,
        dir: tempfile::TempDir,
    }

    struct Outcome {
        result: Result<(), CliError>,
        out: String,
        err: String,
        asked: Vec<String>,
    }

    impl Outcome {
        fn everything(&self) -> String {
            let error = self.result.as_ref().err().map(ToString::to_string);
            format!("{}{}{:?}{error:?}", self.out, self.err, self.asked)
        }

        fn refused(&self, code: u8, message: &str) {
            let e = self.result.as_ref().unwrap_err();
            assert_eq!((e.exit_code(), e.to_string().as_str()), (code, message));
        }
    }

    fn text(buf: &Shared) -> String {
        String::from_utf8(buf.lock().unwrap().clone()).unwrap()
    }

    fn args(server: Option<&str>, email: Option<&str>) -> LoginArgs {
        LoginArgs {
            server: server.map(str::to_string),
            email: email.map(str::to_string),
        }
    }

    impl World {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            for sub in ["data", "config"] {
                std::fs::create_dir_all(dir.path().join(sub)).unwrap();
            }
            World {
                keys: MemKeys::default(),
                auth: FakeAuth::plain(),
                answers: vec![PASSWORD],
                tty: true,
                running: false,
                app_starts_at_check: None,
                system: false,
                keychain: true,
                yes: false,
                dir,
            }
        }

        fn path(&self, sub: &str) -> std::path::PathBuf {
            self.dir.path().join(sub)
        }

        fn policy(&self, body: &str) {
            std::fs::write(self.path("policy.json"), body).unwrap();
        }

        fn run(&self, a: LoginArgs) -> Outcome {
            let (out, err) = (
                Arc::new(Mutex::new(Vec::new())),
                Arc::new(Mutex::new(Vec::new())),
            );
            let mut output = Output::with_sinks(
                false,
                false,
                Box::new(Buf(out.clone())),
                Box::new(Buf(err.clone())),
            );
            let mut ctx = Ctx {
                out: &mut output,
                yes: self.yes,
                interactive: false,
            };
            let script = Script {
                tty: self.tty,
                answers: RefCell::new(self.answers.iter().copied().collect()),
                asked: RefCell::default(),
            };
            let open = || {
                if self.keychain {
                    Ok(())
                } else {
                    Err(CliError::Denied(KEYCHAIN_UNREACHABLE.into()))
                }
            };
            let checks = std::cell::Cell::new(0);
            let running = || {
                checks.set(checks.get() + 1);
                self.running || self.app_starts_at_check.is_some_and(|n| checks.get() >= n)
            };
            let machine = self.path("policy.json");
            let deps = LoginDeps {
                device: Device {
                    system: self.system,
                    open_keychain: &open,
                    keys: &self.keys,
                    app_running: &running,
                    data_dir: self.path("data"),
                    config_dir: self.path("config"),
                },
                auth: &self.auth,
                prompt: &script,
                machine: Some(&machine),
            };
            let result = run_login(a, &mut ctx, &deps);
            Outcome {
                result,
                out: text(&out),
                err: text(&err),
                asked: script.asked.into_inner(),
            }
        }

        fn stored(&self) -> std::collections::BTreeMap<String, String> {
            self.keys.map.borrow().clone()
        }
    }

    fn session_map(server: &str) -> std::collections::BTreeMap<String, String> {
        [
            ("account_id", ACCOUNT),
            ("mode", "server"),
            ("email", EMAIL),
            ("server_url", server),
            ("jwt", "fixture-jwt"),
            ("refresh_token", "fixture-refresh-token"),
            ("wrapped_user_secrets", WRAPPED),
            ("master_password", PASSWORD),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    const OTHER_PINNED: &str =
        r#"{"version":1,"policy":{"server.url":"https://corp.example","server.allowOther":false}}"#;

    #[test]
    fn refusals_come_in_order() {
        let mut w = World::new();
        w.system = true;
        w.keychain = false;
        w.running = true;
        w.keys = MemKeys::with(&[
            ("account_id", "acc-0"),
            ("mode", "server"),
            ("email", "old@example.com"),
            ("server_url", "https://old.example.com/api"),
        ]);
        w.tty = false;
        w.policy(OTHER_PINNED);
        let a = || args(Some(SERVER), Some(EMAIL));

        w.run(a()).refused(
            2,
            "voltius-cli login signs in the user running it and cannot run as root/SYSTEM; run it as that user.",
        );
        w.system = false;
        w.run(a()).refused(4, KEYCHAIN_UNREACHABLE);
        w.keychain = true;
        w.run(a())
            .refused(3, "Quit Voltius first; it holds this account's keys.");
        w.running = false;
        w.run(a()).refused(
            3,
            "Already signed in as old@example.com on old.example.com. Run voltius-cli logout first.",
        );
        w.keys = MemKeys::with(&[("account_id", "acc-0"), ("mode", "local")]);
        w.run(a()).refused(
            3,
            "This device has a local Voltius account. Sign in from the app to keep its data, or run voltius-cli logout to remove it.",
        );
        w.keys = MemKeys::default();
        w.run(a())
            .refused(2, "voltius-cli login is interactive; run it in a terminal.");
        w.tty = true;
        w.run(a()).refused(
            3,
            "This machine's policy locks server.url to corp.example; this sign-in is for sync.example.com.",
        );
        assert!(w.auth.calls().is_empty());
        assert!(w.stored().is_empty());
    }

    #[test]
    fn login_without_two_factor_writes_session() {
        let w = World::new();
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.result.unwrap();
        assert_eq!(o.out, SIGNED_IN);
        assert_eq!(o.asked, ["Master password: "]);
        assert_eq!(w.stored(), session_map(SERVER));
        let lists = crate::auth::keys::key_lists();
        for key in w.stored().keys().filter(|k| *k != "master_password") {
            assert!(lists.session.contains(key), "{key} is not a session key");
        }
    }

    #[test]
    fn login_prompts_for_server_and_email_and_normalises_the_url() {
        let mut w = World::new();
        w.answers = vec!["https://sync.example.com:8443/api/ ", EMAIL, PASSWORD];
        let o = w.run(args(None, None));
        o.result.unwrap();
        assert_eq!(
            o.asked,
            [
                "Server [https://api.voltius.app]: ",
                "Email: ",
                "Master password: "
            ]
        );
        assert_eq!(
            w.stored()["server_url"],
            "https://sync.example.com:8443/api"
        );
    }

    #[test]
    fn login_with_totp() {
        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["totp", "recovery"]);
        w.answers = vec![PASSWORD, CODE];
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.result.unwrap();
        assert_eq!(o.asked, ["Master password: ", CODE_LABEL]);
        assert_eq!(
            w.auth.calls().last().unwrap(),
            &format!("2fa {:?}", Proof::Code(CODE.into()))
        );
        assert_eq!(w.stored(), session_map(SERVER));
    }

    #[test]
    fn login_with_recovery_code() {
        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["totp", "passkey", "recovery"]);
        w.answers = vec![PASSWORD, RECOVERY];
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.result.unwrap();
        assert_eq!(
            w.auth.calls().last().unwrap(),
            &format!("2fa {:?}", Proof::RecoveryCode(RECOVERY.into()))
        );
        assert_eq!(w.stored(), session_map(SERVER));
    }

    #[test]
    fn three_wrong_codes_exit_3() {
        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["totp", "recovery"]);
        w.answers = vec![PASSWORD, "000000", "111111", "222222", CODE];
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.refused(3, "Three wrong codes. Run voltius-cli login again.");
        assert_eq!(o.asked.iter().filter(|l| *l == CODE_LABEL).count(), 3);
        assert_eq!(
            o.err
                .matches("Wrong code. Try the next one your app shows.")
                .count(),
            2
        );
        assert!(w.stored().is_empty());
    }

    #[test]
    fn expired_second_step_says_start_again() {
        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["totp"]);
        w.answers = vec![PASSWORD, EXPIRED_CODE];
        w.run(args(Some(SERVER), Some(EMAIL)))
            .refused(3, "This sign-in took too long. Start again.");
        assert!(w.stored().is_empty());
    }

    #[test]
    fn passkey_only_exits_4_writes_nothing() {
        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["passkey", "recovery"]);
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.refused(
            4,
            "This account signs in with a passkey. Finish in the Voltius app.",
        );
        assert!(!o.asked.iter().any(|l| l == CODE_LABEL));
        assert!(w.stored().is_empty());
    }

    #[test]
    fn missing_wrapped_secrets_exits_4_writes_nothing() {
        let mut w = World::new();
        w.auth.wrapped = None;
        w.run(args(Some(SERVER), Some(EMAIL))).refused(
            4,
            "Finish your first sign-in in the Voltius app; this account needs a one-time upgrade.",
        );
        assert!(w.stored().is_empty());
    }

    #[test]
    fn keys_that_do_not_open_refuse_and_write_nothing() {
        let mut w = World::new();
        w.auth.wrapped = Some("b3RoZXI=");
        let e = w.run(args(Some(SERVER), Some(EMAIL))).result.unwrap_err();
        assert_eq!(e.exit_code(), 3);
        assert!(w.stored().is_empty());
    }

    #[test]
    fn wrong_password_exits_3_writes_nothing() {
        let mut w = World::new();
        w.answers = vec!["not the password"];
        w.run(args(Some(SERVER), Some(EMAIL)))
            .refused(3, "Invalid email or password.");
        assert!(w.stored().is_empty());
    }

    #[test]
    fn failed_keychain_write_leaves_nothing() {
        for key in [
            "master_password_forget",
            "master_password",
            "master_password_sealed",
            "mode",
            "email",
            "server_url",
            "jwt",
            "refresh_token",
            "wrapped_user_secrets",
        ] {
            let w = World::new();
            w.keys.break_key(key);
            w.run(args(Some(SERVER), Some(EMAIL)))
                .refused(4, KEYCHAIN_UNREACHABLE);
            assert!(w.stored().is_empty(), "{key}: {:?}", w.stored());
        }
    }

    #[test]
    fn remember_off_does_not_store_password() {
        let w = World::new();
        w.keys.set("master_password_forget", "1").unwrap();
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.result.unwrap();
        assert_eq!(
            o.out,
            format!("{SIGNED_IN}Voltius will ask for your master password when it opens.\n")
        );
        let mut expected = session_map(SERVER);
        expected.remove("master_password");
        expected.insert("master_password_forget".into(), "1".into());
        assert_eq!(w.stored(), expected);
    }

    fn leave_data(w: &World) -> [std::path::PathBuf; 2] {
        let files = [
            w.path("data/secrets.enc"),
            w.path("config/connections.json"),
        ];
        for f in &files {
            std::fs::write(f, "old").unwrap();
        }
        files
    }

    #[test]
    fn leftover_data_confirmed_is_reset() {
        let mut w = World::new();
        w.yes = true;
        let files = leave_data(&w);
        w.run(args(Some(SERVER), Some(EMAIL))).result.unwrap();
        assert!(files.iter().all(|f| !f.exists()));
        assert_eq!(w.stored(), session_map(SERVER));
    }

    #[test]
    fn leftover_data_needs_yes_without_a_terminal_and_is_kept() {
        let w = World::new();
        let files = leave_data(&w);
        let e = w.run(args(Some(SERVER), Some(EMAIL))).result.unwrap_err();
        assert_eq!(e.exit_code(), 2);
        assert!(e.to_string().contains("can't be opened any more"), "{e}");
        assert!(files.iter().all(|f| f.exists()));
        assert!(w.auth.calls().is_empty());
    }

    #[test]
    fn device_files_outside_the_account_are_not_leftovers() {
        let w = World::new();
        std::fs::write(w.path("config/updater.json"), "{}").unwrap();
        w.run(args(Some(SERVER), Some(EMAIL))).result.unwrap();
        assert!(w.path("config/updater.json").exists());
    }

    #[test]
    fn policy_pins_other_server_refuses() {
        let w = World::new();
        w.policy(OTHER_PINNED);
        w.run(args(Some(SERVER), Some(EMAIL))).refused(
            3,
            "This machine's policy locks server.url to corp.example; this sign-in is for sync.example.com.",
        );
        assert!(w.auth.calls().is_empty());

        let w = World::new();
        w.policy(r#"{"version":1,"policy":{"server.url":"https://corp.example"}}"#);
        w.run(args(Some(SERVER), Some(EMAIL))).result.unwrap();
        assert_eq!(w.stored()["server_url"], SERVER);
    }

    #[test]
    fn a_pinned_server_is_used_without_asking() {
        let mut w = World::new();
        w.policy(
            OTHER_PINNED
                .replace("https://corp.example", "https://sync.example.com/")
                .as_str(),
        );
        w.answers = vec![EMAIL, PASSWORD];
        let o = w.run(args(None, None));
        o.result.unwrap();
        assert_eq!(o.asked, ["Email: ", "Master password: "]);
        assert_eq!(w.stored()["server_url"], SERVER);
    }

    #[test]
    fn the_default_server_comes_from_machine_defaults_before_the_token() {
        let mut w = World::new();
        w.policy(&format!(
            r#"{{"version":1,"policy":{{"enrollment.token":"{}"}},"defaults":{{"server.url":"https://corp.example"}}}}"#,
            token_for("https://v.acme.com")
        ));
        w.answers = vec!["", EMAIL, PASSWORD];
        let o = w.run(args(None, None));
        assert_eq!(o.asked[0], "Server [https://corp.example]: ");
    }

    fn token_for(server: &str) -> String {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine;
        format!(
            "vte1.{}.0123456789abcdef0123456789abcdef.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
            URL_SAFE_NO_PAD.encode(server)
        )
    }

    #[test]
    fn enrolled_machine_prints_join_hint() {
        let mut w = World::new();
        w.policy(&format!(
            r#"{{"version":1,"policy":{{"enrollment.token":"{}"}}}}"#,
            token_for(SERVER)
        ));
        w.answers = vec!["", EMAIL, PASSWORD];
        let o = w.run(args(None, None));
        o.result.unwrap();
        assert_eq!(o.asked[0], format!("Server [{SERVER}]: "));
        assert_eq!(
            o.out,
            format!("{SIGNED_IN}Open Voltius to join your organization.\n")
        );
    }

    #[test]
    fn a_token_for_another_server_prints_no_join_hint() {
        let w = World::new();
        w.policy(&format!(
            r#"{{"version":1,"policy":{{"enrollment.token":"{}"}}}}"#,
            token_for("https://v.acme.com")
        ));
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.result.unwrap();
        assert_eq!(o.out, SIGNED_IN);
    }

    #[test]
    fn a_bad_server_url_is_a_usage_error() {
        let w = World::new();
        let e = w
            .run(args(Some("sync.example.com"), Some(EMAIL)))
            .result
            .unwrap_err();
        assert_eq!(e.exit_code(), 2);
        assert!(w.auth.calls().is_empty());
    }

    #[test]
    fn password_never_in_output() {
        let mut runs = Vec::new();
        let w = World::new();
        runs.push(w.run(args(Some(SERVER), Some(EMAIL))));
        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["totp"]);
        w.answers = vec![PASSWORD, "1", "2", "3"];
        runs.push(w.run(args(Some(SERVER), Some(EMAIL))));
        let mut w = World::new();
        w.keys.break_key("jwt");
        runs.push(w.run(args(Some(SERVER), Some(EMAIL))));
        w = World::new();
        w.answers = vec!["wrong-password-xyz"];
        let wrong = w.run(args(Some(SERVER), Some(EMAIL)));
        assert!(!wrong.everything().contains("wrong-password-xyz"));
        for o in &runs {
            assert!(!o.everything().contains(PASSWORD), "{}", o.everything());
        }
        assert!(w
            .auth
            .calls()
            .iter()
            .all(|c| !c.contains("wrong-password-xyz")));
    }

    #[test]
    fn the_real_key_check_opens_only_this_accounts_secrets() {
        let wrapped = crate::commands::crypto::wrap_user_secrets_cmd(
            GOOD_KEK.to_vec(),
            vec![1; 32],
            vec![2; 32],
        )
        .unwrap();
        assert!(NetAuth.opens(&GOOD_KEK, &wrapped));
        assert!(!NetAuth.opens(&[8; 32], &wrapped));
        assert!(!NetAuth.opens(&GOOD_KEK, "not base64!"));
        let keys = DeriveKeysResult::from(crate::crypto::DerivedKeys {
            auth_key: [0xfb; 32],
            enc_key: GOOD_KEK,
        });
        assert_eq!(keys.auth_key, "+/v7".repeat(10) + "+/s=");
        assert_eq!(keys.enc_key, GOOD_KEK);
    }

    #[test]
    fn server_failures_map_like_the_app() {
        let status = |status, code: Option<&str>| AuthError::Status {
            status,
            code: code.map(str::to_string),
        };
        let cases = [
            (
                status(429, None),
                false,
                3,
                "Too many attempts — wait a minute and try again.",
            ),
            (status(403, None), false, 3, "Invalid email or password."),
            (status(500, None), false, 5, "Server error: 500"),
            (
                AuthError::Network("down".into()),
                false,
                5,
                "Network error — down",
            ),
            (AuthError::BadAnswer, false, 5, "Server login failed."),
            (
                status(429, Some("TWO_FACTOR_LOCKED")),
                true,
                3,
                "Too many wrong codes. Try again in 15 minutes.",
            ),
            (
                status(401, None),
                true,
                3,
                "This sign-in took too long. Start again.",
            ),
        ];
        for (e, second, code, message) in cases {
            let got = refusal(e, second);
            assert_eq!((got.exit_code(), got.to_string().as_str()), (code, message));
        }
    }

    #[test]
    fn a_two_step_code_is_trimmed_and_an_empty_entry_asks_again() {
        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["totp", "recovery"]);
        w.answers = vec![PASSWORD, "", "  ", "000000", " \t", " 123456 "];
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.result.unwrap();
        assert_eq!(o.asked.iter().filter(|l| *l == CODE_LABEL).count(), 5);
        let proofs: Vec<_> = w
            .auth
            .calls()
            .into_iter()
            .filter(|c| c.starts_with("2fa"))
            .collect();
        assert_eq!(
            proofs,
            [
                format!("2fa {:?}", Proof::Code("000000".into())),
                format!("2fa {:?}", Proof::Code(CODE.into())),
            ]
        );

        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["totp", "recovery"]);
        w.answers = vec![PASSWORD, " abcd-efgh-ijkl\t"];
        w.run(args(Some(SERVER), Some(EMAIL))).result.unwrap();
        assert_eq!(
            w.auth.calls().last().unwrap(),
            &format!("2fa {:?}", Proof::RecoveryCode(RECOVERY.into()))
        );
    }

    #[test]
    fn empty_entries_do_not_count_toward_three_wrong_codes() {
        let mut w = World::new();
        w.auth = FakeAuth::two_step(&["totp"]);
        w.answers = vec![PASSWORD, "", "000000", "", "111111", "", CODE];
        w.run(args(Some(SERVER), Some(EMAIL))).result.unwrap();
        assert_eq!(w.stored(), session_map(SERVER));
    }

    #[test]
    fn the_app_starting_mid_sign_in_stops_before_anything_is_changed() {
        let mut w = World::new();
        w.yes = true;
        w.app_starts_at_check = Some(2);
        let files = leave_data(&w);
        let o = w.run(args(Some(SERVER), Some(EMAIL)));
        o.refused(3, "Quit Voltius first; it holds this account's keys.");
        assert!(!w.auth.calls().is_empty());
        assert!(files.iter().all(|f| f.exists()));
        assert!(w.stored().is_empty());
    }

    #[test]
    fn a_failed_account_id_write_leaves_nothing() {
        let w = World::new();
        w.keys.refuse_writes("account_id");
        w.run(args(Some(SERVER), Some(EMAIL)))
            .refused(4, KEYCHAIN_UNREACHABLE);
        assert!(w.stored().is_empty(), "{:?}", w.stored());
    }

    #[test]
    fn a_rollback_keeps_remember_off() {
        let w = World::new();
        w.keys.set("master_password_forget", "1").unwrap();
        w.keys.refuse_writes("jwt");
        w.run(args(Some(SERVER), Some(EMAIL)))
            .refused(4, KEYCHAIN_UNREACHABLE);
        assert_eq!(
            w.stored(),
            [("master_password_forget".to_string(), "1".to_string())].into()
        );
    }

    fn queue_server(w: &World, url: &str) {
        crate::cli_state::pending::append(
            &w.path("config"),
            crate::cli_state::pending::Change::Server { url: url.into() },
        )
        .unwrap();
    }

    fn last_app_server(w: &World, url: &str) {
        crate::cli_state::mirror::write(
            &w.path("config"),
            &json!({"writtenAt": "t", "appVersion": "1", "settings": {}, "serverUrl": url, "plugins": []}),
        )
        .unwrap();
    }

    fn default_offered(w: &mut World) -> String {
        w.answers = vec![""];
        w.run(args(None, None)).asked[0].clone()
    }

    #[test]
    fn the_per_user_server_comes_after_the_pin_and_before_defaults_and_the_token() {
        let mut w = World::new();
        w.policy(&format!(
            r#"{{"version":1,"policy":{{"enrollment.token":"{}"}},"defaults":{{"server.url":"https://corp.example"}}}}"#,
            token_for("https://v.acme.com")
        ));
        last_app_server(&w, "https://last.example");
        assert_eq!(default_offered(&mut w), "Server [https://last.example]: ");

        queue_server(&w, "https://older.example");
        queue_server(&w, "https://queued.example");
        assert_eq!(default_offered(&mut w), "Server [https://queued.example]: ");

        w.policy(r#"{"version":1,"policy":{"server.url":"https://pinned.example"}}"#);
        w.answers = vec![EMAIL, PASSWORD];
        w.run(args(None, None)).result.unwrap();
        assert_eq!(w.stored()["server_url"], "https://pinned.example");
    }

    #[test]
    fn writes_the_login_session_fixture() {
        let input = "https://sync.example.com:8443/";
        let w = World::new();
        w.run(args(Some(input), Some(EMAIL))).result.unwrap();
        let doc = json!({
            "default_server": DEFAULT_SERVER_URL,
            "server_input": input,
            "keychain": w.stored(),
        });
        let text = serde_json::to_string_pretty(&doc).unwrap() + "\n";
        let path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("src/cli/fixtures/login_session.json");
        if !path.exists() {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &text).unwrap();
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
    }
}
