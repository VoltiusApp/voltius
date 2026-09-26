use crate::known_hosts::{
    ConflictAction, HostKeyConflictEvent, HostKeyStatus, KnownHostsStore, PendingConflicts,
};
use crate::port_forward::{RemoteRoute, RemoteRouteMap};
use crate::proxy::{self, ProxyError, ProxySpec};
use russh::client::{self, AuthResult, KeyboardInteractiveAuthResponse, Prompt};
use russh::keys::ssh_key::{HashAlg, PublicKey};
use russh::keys::PrivateKeyWithHashAlg;
use russh::{ChannelMsg, MethodKind, MethodSet};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpHostConnect {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SshStep {
    TcpConnected,
    Handshake,
    Authenticating,
    OpeningShell,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshStepEvent {
    pub step: SshStep,
    pub detail: String,
}

// Optional context for interactive conflict resolution (absent in non-interactive/exec use).
struct ConflictContext {
    app: AppHandle,
    session_id: String,
    pending_conflicts: Arc<PendingConflicts>,
}

/// `new_interactive`'s return: the handler plus the shared slots `connect`
/// needs after the handshake (rejection reason, remote-forward routes, and the
/// server's SSH banner for Windows detection).
type InteractiveClient = (
    SshClient,
    Arc<Mutex<Option<String>>>,
    RemoteRouteMap,
    Arc<Mutex<Option<Vec<u8>>>>,
);

pub struct SshClient {
    host: String,
    port: u16,
    known_hosts: Arc<KnownHostsStore>,
    /// Set by `check_server_key` when the host key has changed without user approval.
    pub rejection_reason: Arc<Mutex<Option<String>>>,
    conflict_ctx: Option<ConflictContext>,
    /// Remote-forward route table: (bind_host, remote_port) → RemoteRoute.
    /// Populated by PortForwardManager before calling tcpip_forward.
    pub remote_routes: RemoteRouteMap,
    /// Server's SSH identification banner, captured in `kex_done`. Read after
    /// the handshake to detect Windows OpenSSH (see `is_windows_sshid`).
    remote_sshid: Arc<Mutex<Option<Vec<u8>>>>,
}

impl SshClient {
    /// Non-interactive constructor (exec commands, SFTP, jump hosts).
    pub fn new(
        host: String,
        port: u16,
        known_hosts: Arc<KnownHostsStore>,
    ) -> (Self, Arc<Mutex<Option<String>>>) {
        let rejection_reason = Arc::new(Mutex::new(None::<String>));
        let remote_routes: RemoteRouteMap = Arc::new(Mutex::new(HashMap::new()));
        (
            Self {
                host,
                port,
                known_hosts,
                rejection_reason: Arc::clone(&rejection_reason),
                conflict_ctx: None,
                remote_routes,
                remote_sshid: Arc::new(Mutex::new(None)),
            },
            rejection_reason,
        )
    }

    /// Interactive constructor for the final SSH session. Beyond the handler it
    /// hands back the rejection-reason slot, the `RemoteRouteMap`
    /// PortForwardManager registers routes in, and the remote SSH banner slot
    /// (`kex_done` fills it; `connect` reads it to detect Windows).
    pub fn new_interactive(
        host: String,
        port: u16,
        known_hosts: Arc<KnownHostsStore>,
        app: AppHandle,
        session_id: String,
        pending_conflicts: Arc<PendingConflicts>,
    ) -> InteractiveClient {
        let rejection_reason = Arc::new(Mutex::new(None::<String>));
        let remote_routes: RemoteRouteMap = Arc::new(Mutex::new(HashMap::new()));
        let remote_sshid = Arc::new(Mutex::new(None));
        (
            Self {
                host,
                port,
                known_hosts,
                rejection_reason: Arc::clone(&rejection_reason),
                conflict_ctx: Some(ConflictContext {
                    app,
                    session_id,
                    pending_conflicts,
                }),
                remote_routes: Arc::clone(&remote_routes),
                remote_sshid: Arc::clone(&remote_sshid),
            },
            rejection_reason,
            remote_routes,
            remote_sshid,
        )
    }
}

impl client::Handler for SshClient {
    type Error = russh::Error;

    // Capture the server's SSH identification banner once key exchange completes
    // (before we open the shell) so `connect` can detect Windows OpenSSH and
    // pick a shell path it can actually run.
    async fn kex_done(
        &mut self,
        _shared_secret: Option<&[u8]>,
        _names: &russh::Names,
        session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        *self.remote_sshid.lock().await = Some(session.remote_sshid().to_vec());
        Ok(())
    }

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fp = server_public_key.fingerprint(HashAlg::Sha256).to_string();

        match self.known_hosts.check(&self.host, self.port, &fp).await {
            HostKeyStatus::Known => Ok(true),

            HostKeyStatus::Unknown => {
                // Trust On First Use: accept and persist.
                self.known_hosts
                    .add_new(&self.host, self.port, fp, "personal")
                    .await;
                Ok(true)
            }

            HostKeyStatus::Changed { stored } => {
                if let Some(ctx) = &self.conflict_ctx {
                    // Interactive mode: pause and let the user decide.
                    let (tx, rx) = oneshot::channel::<ConflictAction>();
                    ctx.pending_conflicts
                        .0
                        .lock()
                        .await
                        .insert(ctx.session_id.clone(), tx);

                    let _ = ctx.app.emit(
                        &format!("ssh-host-key-conflict-{}", ctx.session_id),
                        HostKeyConflictEvent {
                            session_id: ctx.session_id.clone(),
                            host: self.host.clone(),
                            port: self.port,
                            stored_entries: stored,
                            new_fingerprint: fp.clone(),
                        },
                    );

                    match rx.await {
                        Ok(ConflictAction::AddNew) => {
                            self.known_hosts
                                .add_new(&self.host, self.port, fp, "personal")
                                .await;
                            Ok(true)
                        }
                        Ok(ConflictAction::Replace) => {
                            self.known_hosts
                                .replace_all(&self.host, self.port, fp, "personal")
                                .await;
                            Ok(true)
                        }
                        _ => {
                            *self.rejection_reason.lock().await =
                                Some("Connection aborted by user.".into());
                            Ok(false)
                        }
                    }
                } else {
                    // Non-interactive: reject with a descriptive message.
                    let stored_fps: Vec<String> =
                        stored.iter().map(|e| e.fingerprint.clone()).collect();
                    *self.rejection_reason.lock().await = Some(format!(
                        "WARNING: Host key changed for {}:{}!\n\
                         Stored   : {}\n\
                         Received : {}\n\n\
                         This may indicate a MITM attack. \
                         Remove the host from Known Hosts to reconnect.",
                        self.host,
                        self.port,
                        stored_fps.join(", "),
                        fp
                    ));
                    Ok(false)
                }
            }
        }
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let route: Option<RemoteRoute> = {
            let routes = self.remote_routes.lock().await;
            routes
                .get(&(connected_address.to_string(), connected_port as u16))
                .cloned()
        };

        if let Some(route) = route {
            reply.accept().await;
            tokio::spawn(bridge_remote_channel(channel, route));
        } else {
            reply.reject(russh::ChannelOpenFailure::ConnectFailed).await;
        }
        Ok(())
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: russh::Channel<russh::client::Msg>,
        reply: client::ChannelOpenHandle,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        #[cfg(unix)]
        {
            let sock_path = match std::env::var("SSH_AUTH_SOCK") {
                Ok(p) => p,
                Err(_) => return Ok(()),
            };

            tokio::spawn(async move {
                let Ok(mut sock) = tokio::net::UnixStream::connect(&sock_path).await else {
                    return;
                };
                let (mut chan_read, chan_write) = channel.split();
                let mut writer = chan_write.make_writer();
                let (mut sock_read, mut sock_write) = sock.split();
                let mut buf = [0u8; 4096];

                loop {
                    tokio::select! {
                        n = sock_read.read(&mut buf) => {
                            match n {
                                Ok(0) | Err(_) => break,
                                Ok(n) => { let _ = writer.write_all(&buf[..n]).await; }
                            }
                        }
                        msg = chan_read.wait() => {
                            match msg {
                                Some(ChannelMsg::Data { data }) => {
                                    let _ = sock_write.write_all(&data).await;
                                }
                                _ => break,
                            }
                        }
                    }
                }
            });
        }

        #[cfg(windows)]
        {
            tokio::spawn(async move {
                let Ok(sock) = tokio::net::windows::named_pipe::ClientOptions::new()
                    .open(r"\\.\pipe\openssh-ssh-agent")
                else {
                    return;
                };
                let (mut sock_read, mut sock_write) = tokio::io::split(sock);
                let (mut chan_read, chan_write) = channel.split();
                let mut writer = chan_write.make_writer();
                let mut buf = [0u8; 4096];

                loop {
                    tokio::select! {
                        n = sock_read.read(&mut buf) => {
                            match n {
                                Ok(0) | Err(_) => break,
                                Ok(n) => { let _ = writer.write_all(&buf[..n]).await; }
                            }
                        }
                        msg = chan_read.wait() => {
                            match msg {
                                Some(ChannelMsg::Data { data }) => {
                                    if sock_write.write_all(&data).await.is_err() { break; }
                                }
                                _ => break,
                            }
                        }
                    }
                }
            });
        }

        Ok(())
    }
}

pub struct ConnectedSession {
    pub handle: std::sync::Arc<client::Handle<SshClient>>,
    pub input_tx: tokio::sync::mpsc::Sender<SessionInput>,
    pub shutdown_tx: tokio::sync::mpsc::Sender<()>,
    /// If true, closing this session only stops the channel I/O loop;
    /// it does NOT disconnect the parent SSH handle (used for multiplexed exec sessions).
    pub channel_only: bool,
    /// True when the remote shell was wrapped in a persistent multiplexer
    /// (tmux/screen). A user-initiated disconnect kills that session.
    pub persist: bool,
    /// Keeps intermediate jump-host SSH handles alive for the lifetime of this session.
    pub _jump_handles: Vec<Arc<client::Handle<SshClient>>>,
    /// Shared remote-forward route table for this session.
    pub remote_routes: RemoteRouteMap,
}

/// Runs `cmd` on `channel` and collects stdout; `None` if the exec request fails,
/// otherwise the output and whether it reached EOF within `limit`.
async fn exec_collect(
    channel: russh::Channel<client::Msg>,
    cmd: &str,
    limit: std::time::Duration,
) -> Option<(Vec<u8>, bool)> {
    channel.exec(true, cmd).await.ok()?;
    let mut stream = channel.into_stream();
    let mut out: Vec<u8> = Vec::new();
    let completed = tokio::time::timeout(limit, async {
        let mut buf = [0u8; 8192];
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await
    .is_ok();
    Some((out, completed))
}

async fn bridge_remote_channel(channel: russh::Channel<client::Msg>, route: RemoteRoute) {
    let tcp = match TcpStream::connect((route.target_host.as_str(), route.target_port)).await {
        Ok(t) => t,
        Err(_) => {
            let _ = channel.close().await;
            return;
        }
    };

    crate::port_forward::pipe::pump(
        channel,
        tcp,
        tokio_util::sync::CancellationToken::new(),
        route.bytes,
    )
    .await;
}

pub enum SessionInput {
    Data(Vec<u8>),
    Resize(u32, u32),
}

fn emit_step(app: &AppHandle, session_id: &str, step: SshStep, detail: impl Into<String>) {
    let _ = app.emit(
        &format!("ssh-step-{}", session_id),
        SshStepEvent {
            step,
            detail: detail.into(),
        },
    );
}

/// A server that never answers a userauth request would otherwise leave the UI on
/// "Authenticating" forever — every other blocking step here is already bounded.
const AUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Pick the RSA signature hash from what the server advertised in `server-sig-algs`
/// (RFC 8308). `Some(inner)` means the server listed its algorithms and `inner` is
/// authoritative — including `None`, which is an explicit "ssh-rsa only", not a guess.
/// The outer `None` means the server said nothing at all, so we try the modern hash
/// and let the caller retry ssh-rsa if it's refused.
fn choose_rsa_hash(reported: Option<Option<HashAlg>>) -> Option<HashAlg> {
    reported.unwrap_or(Some(HashAlg::Sha256))
}

const KEY_REJECTED: &str = "Public key authentication rejected.";
const PASSWORD_REJECTED: &str =
    "Password authentication rejected — check the username and password.";
const KBD_INT_REJECTED: &str =
    "Keyboard-interactive authentication rejected — check the username and password.";
const KBD_INT_MAX_ROUNDS: usize = 8;

fn auth_err(e: russh::Error) -> String {
    format!("Auth failed: {}", e)
}

/// `None` on success, otherwise the methods the server still accepts.
fn rejected(res: AuthResult) -> Option<MethodSet> {
    match res {
        AuthResult::Success => None,
        AuthResult::Failure {
            remaining_methods, ..
        } => Some(remaining_methods),
    }
}

const PASSWORD_EXPIRED: &str =
    "The server requires a new password — sign in once from a terminal and change it there.";
const PASSWORD_WORDS: &[&str] = &[
    "password",
    "passwort",
    "mot de passe",
    "пароль",
    "parola",
    "şifre",
    "密码",
    "heslo",
];
// PAM's expired-password flow re-asks the current password before the new one.
const PASSWORD_CHANGE_WORDS: &[&str] = &[
    "new ",
    "retype",
    "again",
    "confirm",
    "current",
    "change",
    "expired",
    "neu",
    "aktuell",
    "nouveau",
    "actuel",
    "нов",
    "текущ",
    "смен",
    "yeni",
    "mevcut",
    "新",
    "当前",
    "nové",
    "současné",
];

enum PromptKind {
    Password,
    PasswordChange,
    Other,
}

fn classify_prompt(p: &Prompt) -> PromptKind {
    let text = p.prompt.to_lowercase();
    if p.echo || !PASSWORD_WORDS.iter().any(|w| text.contains(w)) {
        PromptKind::Other
    } else if PASSWORD_CHANGE_WORDS.iter().any(|w| text.contains(w)) {
        PromptKind::PasswordChange
    } else {
        PromptKind::Password
    }
}

// Only password prompts get an answer, and only once: being asked again means it was wrong.
fn answer_prompts(
    prompts: &[Prompt],
    password: &str,
    sent: &mut bool,
) -> Result<Vec<String>, String> {
    prompts
        .iter()
        .map(|p| match classify_prompt(p) {
            PromptKind::Other => Err(format!(
                "The server asked \"{}\", which can't be answered automatically.",
                p.prompt.trim()
            )),
            PromptKind::PasswordChange => Err(PASSWORD_EXPIRED.into()),
            PromptKind::Password if std::mem::replace(sent, true) => Err(KBD_INT_REJECTED.into()),
            PromptKind::Password => Ok(password.to_owned()),
        })
        .collect()
}

async fn authenticate_key<H: client::Handler>(
    handle: &mut client::Handle<H>,
    username: &str,
    key_str: &str,
    passphrase: Option<&str>,
) -> Result<AuthResult, String> {
    let key_pair = Arc::new(
        russh::keys::decode_secret_key(key_str, passphrase)
            .map_err(|e| format!("Invalid private key: {}", e))?,
    );
    let is_rsa = matches!(key_pair.algorithm(), russh::keys::Algorithm::Rsa { .. });

    // Only RSA has a choice of signature hash. Ask the server which it accepts
    // (`server-sig-algs`, RFC 8308) instead of assuming: dropbear before
    // 2020.79 — still shipping on plenty of OpenWrt routers — only supports
    // ssh-rsa, and rejects the rsa-sha2-256 we used to send unconditionally.
    let hash = if is_rsa {
        choose_rsa_hash(handle.best_supported_rsa_hash().await.ok().flatten())
    } else {
        None
    };

    let mut res = handle
        .authenticate_publickey(username, PrivateKeyWithHashAlg::new(key_pair.clone(), hash))
        .await
        .map_err(auth_err)?;

    // A server too old to advertise `server-sig-algs` is also too old to accept
    // rsa-sha2-*. Retrying costs one round trip and only on an already-failed auth.
    if !res.success() && is_rsa && hash.is_some() {
        res = handle
            .authenticate_publickey(username, PrivateKeyWithHashAlg::new(key_pair, None))
            .await
            .map_err(auth_err)?;
    }
    Ok(res)
}

// What `ssh` falls back to on `PasswordAuthentication no` + `UsePAM yes` (FreeBSD's default).
async fn authenticate_keyboard_interactive<H: client::Handler>(
    handle: &mut client::Handle<H>,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let mut reply = handle
        .authenticate_keyboard_interactive_start(username, None::<String>)
        .await
        .map_err(auth_err)?;
    let mut sent = false;
    for _ in 0..KBD_INT_MAX_ROUNDS {
        let prompts = match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(()),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Err(KBD_INT_REJECTED.into()),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => prompts,
        };
        let answers = answer_prompts(&prompts, password, &mut sent)?;
        reply = handle
            .authenticate_keyboard_interactive_respond(answers)
            .await
            .map_err(auth_err)?;
    }
    Err("Keyboard-interactive authentication gave up: the server kept prompting.".into())
}

/// Key, then password, or keyboard-interactive with the same password when the
/// server has no `password` method. Like `ssh`, a "none" request lists them first.
async fn authenticate_handle_inner<H: client::Handler>(
    handle: &mut client::Handle<H>,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    passphrase: Option<&str>,
) -> Result<(), String> {
    if password.is_none() && private_key.is_none() {
        return Err("No authentication method provided".into());
    }
    let Some(mut remaining) = rejected(handle.authenticate_none(username).await.map_err(auth_err)?)
    else {
        return Ok(());
    };
    let mut key_rejected = false;

    if let Some(key) = private_key.filter(|_| remaining.contains(&MethodKind::PublicKey)) {
        let Some(m) = rejected(authenticate_key(handle, username, key, passphrase).await?) else {
            return Ok(());
        };
        (remaining, key_rejected) = (m, true);
    }
    if let Some(pwd) = password {
        // A password rejected here would fail keyboard-interactive too; trying both
        // doubles the failures fail2ban/sshguard count against the host.
        if remaining.contains(&MethodKind::Password) {
            let res = handle
                .authenticate_password(username, pwd)
                .await
                .map_err(auth_err)?;
            return if res.success() {
                Ok(())
            } else {
                Err(PASSWORD_REJECTED.into())
            };
        }
        if remaining.contains(&MethodKind::KeyboardInteractive) {
            return authenticate_keyboard_interactive(handle, username, pwd).await;
        }
    }

    if key_rejected {
        return Err(KEY_REJECTED.into());
    }
    let accepted: Vec<&str> = remaining.iter().map(<&str>::from).collect();
    Err(format!(
        "No usable authentication method — the server only accepts: {}.",
        accepted.join(", ")
    ))
}

pub async fn authenticate_handle<H: client::Handler>(
    handle: &mut client::Handle<H>,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    passphrase: Option<&str>,
) -> Result<(), String> {
    tokio::time::timeout(
        AUTH_TIMEOUT,
        authenticate_handle_inner(handle, username, password, private_key, passphrase),
    )
    .await
    .map_err(|_| {
        format!(
            "Authentication timed out after {}s — the server accepted the connection but never \
             answered the authentication request. Some older SSH servers stall here; try the \
             host's \"Legacy algorithms\" option, or another authentication method.",
            AUTH_TIMEOUT.as_secs()
        )
    })?
}

// Retry transient connect failures: busy/throttling sshd often RSTs new connections.
const CONNECT_MAX_ATTEMPTS: u32 = 3;
const CONNECT_RETRY_BACKOFF_MS: u64 = 300;

/// Detect a Windows OpenSSH server from its SSH identification banner. Windows'
/// bundled sshd announces itself as e.g. `SSH-2.0-OpenSSH_for_Windows_9.5`.
/// Windows has no POSIX `sh`/`base64`/`tmux`, so our shell-integration and
/// persistence exec bootstraps (and `export` env injection) can't run there —
/// they leave a connected-but-blank terminal. Detecting the banner lets us fall
/// back to a plain interactive shell, which Windows OpenSSH serves over ConPTY.
/// The banner is shell-independent, so it works regardless of whether the
/// server's default ssh shell is cmd.exe or PowerShell.
fn is_windows_sshid(sshid: &[u8]) -> bool {
    String::from_utf8_lossy(sshid)
        .to_ascii_lowercase()
        .contains("windows")
}

// Host-key rejections set `rejection_reason` instead, so they never reach here.
fn is_transient_connect_error(e: &russh::Error) -> bool {
    match e {
        russh::Error::IO(io) => proxy::is_transient_io_kind(io.kind()),
        russh::Error::HUP | russh::Error::ConnectionTimeout => true,
        _ => false,
    }
}

pub(crate) enum HopError {
    Proxy(ProxyError),
    Ssh(russh::Error),
}

impl std::fmt::Display for HopError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Proxy(e) => write!(f, "{e}"),
            Self::Ssh(e) => write!(f, "{e}"),
        }
    }
}

impl HopError {
    fn is_transient(&self) -> bool {
        match self {
            Self::Proxy(e) => e.is_transient(),
            Self::Ssh(e) => is_transient_connect_error(e),
        }
    }
}

/// The returned `Option<String>` is the proxy's `via` label.
pub(crate) async fn connect_first_hop<H>(
    config: Arc<client::Config>,
    proxy: Option<&ProxySpec>,
    host: &str,
    port: u16,
    handler: H,
) -> Result<(client::Handle<H>, Option<String>), HopError>
where
    H: client::Handler<Error = russh::Error> + Send + 'static,
{
    let dialed = proxy::dial(proxy, host, port)
        .await
        .map_err(HopError::Proxy)?;
    let handle = client::connect_stream(config, dialed.stream, handler)
        .await
        .map_err(HopError::Ssh)?;
    Ok((handle, dialed.via))
}

pub(crate) fn hop_detail(host: &str, port: u16, suffix: &str, via: Option<&str>) -> String {
    match via {
        Some(v) => format!("{host}:{port}{suffix} via {v}"),
        None => format!("{host}:{port}{suffix}"),
    }
}

/// The handler is rebuilt each attempt because `connect_stream` consumes it;
/// a set rejection reason (host-key/abort) is deliberate and never retried.
pub(crate) async fn connect_first_hop_retrying<H, T>(
    config: &Arc<client::Config>,
    proxy: Option<&ProxySpec>,
    host: &str,
    port: u16,
    max_attempts: u32,
    mut make: impl FnMut() -> (H, Arc<Mutex<Option<String>>>, T),
    fail: impl Fn(&HopError) -> String,
) -> Result<(client::Handle<H>, Option<String>, T), String>
where
    H: client::Handler<Error = russh::Error> + Send + 'static,
{
    let mut attempt = 1;
    loop {
        let (handler, rejection_reason, extra) = make();
        match connect_first_hop(Arc::clone(config), proxy, host, port, handler).await {
            Ok((h, via)) => return Ok((h, via, extra)),
            Err(e) => {
                let reason = rejection_reason.lock().await.take();
                if reason.is_none() && attempt < max_attempts && e.is_transient() {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        CONNECT_RETRY_BACKOFF_MS * attempt as u64,
                    ))
                    .await;
                    attempt += 1;
                    continue;
                }
                return Err(reason.unwrap_or_else(|| fail(&e)));
            }
        }
    }
}

pub async fn connect(
    app: AppHandle,
    session_id: String,
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    passphrase: Option<&str>,
    jump_hosts: Vec<JumpHostConnect>,
    env_vars: Vec<(String, String)>,
    agent_forwarding: bool,
    pre_command: Option<String>,
    shell_integration: bool,
    known_hosts: Arc<KnownHostsStore>,
    pending_conflicts: Arc<PendingConflicts>,
    keepalive_interval_secs: u64,
    keepalive_max: usize,
    persist: bool,
    restore: bool,
    attach_only: bool,
    pty_cols: u32,
    pty_rows: u32,
    legacy_algorithms: bool,
    initial_cwd: Option<String>,
    proxy: Option<ProxySpec>,
) -> Result<ConnectedSession, String> {
    let config = Arc::new(client_config(
        keepalive_interval_secs,
        keepalive_max,
        legacy_algorithms,
    ));

    // Build the chain: jump_hosts[0] → jump_hosts[1] → ... → final host
    // Each hop opens a direct-tcpip channel to the next host, layering SSH over it.
    let mut jump_handles: Vec<Arc<client::Handle<SshClient>>> = Vec::new();

    #[allow(unused_assignments)]
    let mut final_routes: RemoteRouteMap = Arc::new(Mutex::new(HashMap::new()));
    #[allow(unused_assignments)]
    let mut final_sshid: Arc<Mutex<Option<Vec<u8>>>> = Arc::new(Mutex::new(None));

    let mut final_handle: client::Handle<SshClient> = if jump_hosts.is_empty() {
        let (h, via, (routes, sshid)) = connect_first_hop_retrying(
            &config,
            proxy.as_ref(),
            host,
            port,
            CONNECT_MAX_ATTEMPTS,
            || {
                let (c, reason, routes, sshid) = SshClient::new_interactive(
                    host.to_string(),
                    port,
                    Arc::clone(&known_hosts),
                    app.clone(),
                    session_id.clone(),
                    Arc::clone(&pending_conflicts),
                );
                (c, reason, (routes, sshid))
            },
            |e| format!("Connection failed: {e}"),
        )
        .await?;
        final_routes = routes;
        final_sshid = sshid;
        emit_step(
            &app,
            &session_id,
            SshStep::TcpConnected,
            hop_detail(host, port, "", via.as_deref()),
        );
        h
    } else {
        let first = &jump_hosts[0];
        let (mut current_handle, via, ()) = connect_first_hop_retrying(
            &config,
            proxy.as_ref(),
            &first.host,
            first.port,
            CONNECT_MAX_ATTEMPTS,
            || {
                let (c, reason) =
                    SshClient::new(first.host.clone(), first.port, Arc::clone(&known_hosts));
                (c, reason, ())
            },
            |e| format!("Jump host {} connection failed: {}", first.host, e),
        )
        .await?;
        emit_step(
            &app,
            &session_id,
            SshStep::TcpConnected,
            hop_detail(&first.host, first.port, " (jump 1)", via.as_deref()),
        );
        authenticate_handle(
            &mut current_handle,
            &first.username,
            first.password.as_deref(),
            first.private_key.as_deref(),
            first.passphrase.as_deref(),
        )
        .await
        .map_err(|e| format!("Jump host {} auth failed: {}", first.host, e))?;

        // Chain through remaining jump hosts
        for (i, jump) in jump_hosts[1..].iter().enumerate() {
            let next_host = jump.host.as_str();
            let next_port = jump.port;
            let channel = current_handle
                .channel_open_direct_tcpip(next_host, next_port as u32, "127.0.0.1", 0)
                .await
                .map_err(|e| format!("Failed to open tunnel to {}: {}", next_host, e))?;
            let stream = channel.into_stream();

            let (next_client, _) =
                SshClient::new(next_host.to_string(), next_port, Arc::clone(&known_hosts));
            let mut next_handle = client::connect_stream(Arc::clone(&config), stream, next_client)
                .await
                .map_err(|e| format!("Jump host {} SSH handshake failed: {}", next_host, e))?;

            authenticate_handle(
                &mut next_handle,
                &jump.username,
                jump.password.as_deref(),
                jump.private_key.as_deref(),
                jump.passphrase.as_deref(),
            )
            .await
            .map_err(|e| format!("Jump host {} auth failed: {}", next_host, e))?;

            let prev = std::mem::replace(&mut current_handle, next_handle);
            jump_handles.push(Arc::new(prev));
            emit_step(
                &app,
                &session_id,
                SshStep::TcpConnected,
                format!("{}:{} (jump {})", next_host, next_port, i + 2),
            );
        }

        // Open tunnel from last jump host to the final target
        let channel = current_handle
            .channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| format!("Failed to open tunnel to final host {}: {}", host, e))?;
        let stream = channel.into_stream();

        let (final_client, rejection_reason, routes, sshid) = SshClient::new_interactive(
            host.to_string(),
            port,
            Arc::clone(&known_hosts),
            app.clone(),
            session_id.clone(),
            Arc::clone(&pending_conflicts),
        );
        final_routes = routes;
        final_sshid = sshid;
        let h = client::connect_stream(Arc::clone(&config), stream, final_client)
            .await
            .map_err(|e| {
                let _ = rejection_reason;
                format!("Final host {} SSH handshake failed: {}", host, e)
            })?;

        jump_handles.push(Arc::new(current_handle));
        emit_step(
            &app,
            &session_id,
            SshStep::TcpConnected,
            format!("{}:{}", host, port),
        );
        h
    };

    // Key exchange is done by russh internally during connect()
    emit_step(
        &app,
        &session_id,
        SshStep::Handshake,
        "Negotiating encryption",
    );

    // Authentication on the final host
    emit_step(
        &app,
        &session_id,
        SshStep::Authenticating,
        format!("as {}", username),
    );
    authenticate_handle(
        &mut final_handle,
        username,
        password,
        private_key,
        passphrase,
    )
    .await?;

    // Windows OpenSSH has no POSIX `sh`/`base64`/`tmux`, so the shell-integration
    // and persistence exec bootstraps (and the `export` env injection below) can't
    // run there and leave a connected-but-blank terminal. Detect it from the SSH
    // banner captured in `kex_done` and fall back to a plain interactive shell,
    // which Windows serves fine over ConPTY.
    let remote_is_windows = final_sshid
        .lock()
        .await
        .as_deref()
        .map(is_windows_sshid)
        .unwrap_or(false);
    let shell_integration = shell_integration && !remote_is_windows;
    let persist = persist && !remote_is_windows;
    let restore = restore && !remote_is_windows;

    // Attach-only (reconnect/join): verify the multiplexer session still exists
    // before attaching — attaching never creates, so a dead session must fail
    // fast with the stable SESSION_ENDED error the frontend tears down on. An
    // inconclusive probe (timeout, channel failure) falls through to the attach,
    // whose own guard exits if the session is truly gone.
    if persist && attach_only {
        let key = crate::shell_integration::tmux_session_key(&session_id);
        let probe = crate::shell_integration::persistent_probe_command(&key);
        if let Ok(probe_channel) = final_handle.channel_open_session().await {
            if let Some((out, completed)) =
                exec_collect(probe_channel, &probe, std::time::Duration::from_secs(5)).await
            {
                if completed && !String::from_utf8_lossy(&out).contains("VOLTIUS_PRESENT") {
                    return Err("SESSION_ENDED".to_string());
                }
            }
        }
    }

    // Open channel + shell
    emit_step(&app, &session_id, SshStep::OpeningShell, "Requesting PTY");

    let channel = final_handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    channel
        .request_pty(false, "xterm-256color", pty_cols, pty_rows, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {}", e))?;

    if agent_forwarding {
        channel
            .agent_forward(false)
            .await
            .map_err(|e| format!("Agent forwarding request failed: {}", e))?;
    }

    // Workspace restore of a persistent session: replay the multiplexer's
    // scrollback history (tmux or screen) into the frontend terminal BEFORE the
    // attach below redraws the live screen. Runs on its own exec channel;
    // ordering is guaranteed because the shell channel hasn't been exec'd yet.
    // If the multiplexer or session is gone (host rebooted), the capture is
    // empty and we skip.
    if restore && persist {
        let key = crate::shell_integration::tmux_session_key(&session_id);
        let capture = crate::shell_integration::capture_history_command(&key, pty_rows);
        if let Ok(cap_channel) = final_handle.channel_open_session().await {
            if let Some((history, _)) =
                exec_collect(cap_channel, &capture, std::time::Duration::from_secs(5)).await
            {
                if !history.iter().all(|b| b.is_ascii_whitespace()) {
                    // capture-pane emits bare LF; the PTY-less exec channel
                    // does no ONLCR translation, so normalize for xterm.
                    let mut out: Vec<u8> =
                        Vec::with_capacity(history.len() + (pty_rows as usize) * 2);
                    for b in history {
                        if b == b'\n' {
                            out.push(b'\r');
                        }
                        out.push(b);
                    }
                    // Scroll the history fully into xterm's scrollback so the
                    // attach redraw below paints a clean viewport.
                    for _ in 0..pty_rows {
                        out.extend_from_slice(b"\r\n");
                    }
                    let _ = app.emit(&format!("ssh-output-{}", session_id), out.as_slice());
                }
            }
        }
    }

    // `cd` into the starting directory from inside the exec'd command rather than
    // by writing to the shell's stdin: no line in the scrollback, no entry in the
    // shell's history, and no race with the shell (or the multiplexer) coming up.
    // The persistent wrappers embed their inner command in a double-quoted
    // assignment, so a path the outer shell would expand is dropped rather than
    // mangled — the session then just starts in the default directory.
    let cd_prefix = initial_cwd
        .filter(|p| !p.is_empty() && !p.contains(['"', '$', '`', '\\', '\n', '\r']))
        .map(|p| format!("cd {} 2>/dev/null; ", shell_escape(&p)))
        .unwrap_or_default();

    // When shell integration is enabled we replace the standard shell channel
    // request with an exec of our wrapper script. The wrapper detects the
    // remote $SHELL and execs into it with OSC 7 emission already hooked
    // (writes a temp rcfile under /tmp). Falling back to request_shell keeps
    // the historical behavior available via the setting.
    let exec_cmd = if shell_integration {
        let inner = crate::shell_integration::ssh_exec_command(&cd_prefix);
        Some(if persist {
            let key = crate::shell_integration::tmux_session_key(&session_id);
            if attach_only {
                crate::shell_integration::persistent_attach_command(&key)
            } else {
                crate::shell_integration::persistent_exec_command(&key, &inner)
            }
        } else {
            inner
        })
    } else if persist {
        // Persistence without shell integration: bare login shell. `inner` must
        // have no double quotes (embedded in the multiplexer's quoted command),
        // so SHELL is left unquoted. MOTD runs inside the inner so tmux's redraw
        // on attach doesn't wipe it.
        let key = crate::shell_integration::tmux_session_key(&session_id);
        let inner = format!(
            "{}{}; exec ${{SHELL:-/bin/sh}} -l",
            cd_prefix,
            crate::shell_integration::MOTD_PREAMBLE
        );
        Some(if attach_only {
            crate::shell_integration::persistent_attach_command(&key)
        } else {
            crate::shell_integration::persistent_exec_command(&key, &inner)
        })
    } else {
        None
    };

    // dropbear aborts the whole connection with "String too long" once an SSH
    // string passes its 9000-byte MAX_STRING_LEN, which reads as a hang right
    // after authentication rather than an error (#85). Servers that small are
    // better served by a plain shell than by a session that never opens.
    let exec_cmd = exec_cmd.filter(|c| c.len() <= crate::shell_integration::MAX_EXEC_COMMAND_LEN);
    // A plain `request_shell` has nowhere to carry the prefix, so it goes in over
    // stdin below instead.
    let cd_over_stdin = exec_cmd.is_none() && !cd_prefix.is_empty();
    match exec_cmd {
        Some(cmd) => channel
            .exec(false, cmd.as_bytes())
            .await
            .map_err(|e| format!("Shell exec failed: {}", e))?,
        None => channel
            .request_shell(false)
            .await
            .map_err(|e| format!("Shell request failed: {}", e))?,
    }

    // I/O loop
    let (read_half, write_half) = channel.split();
    let mut writer = write_half.make_writer();

    // `export KEY=val` is POSIX syntax; on a Windows cmd.exe/PowerShell shell it
    // would just echo errors, so skip it there (see `remote_is_windows`).
    if !env_vars.is_empty() && !remote_is_windows {
        let mut exports = String::new();
        for (key, value) in &env_vars {
            exports.push_str(&format!("export {}={}\n", key, shell_escape(value)));
        }
        let _ = writer.write_all(exports.as_bytes()).await;
    }

    // Before pre_command: a host command that changes directory itself must win.
    if cd_over_stdin && !remote_is_windows {
        let _ = writer.write_all(cd_prefix.trim_end().as_bytes()).await;
        let _ = writer.write_all(b"\n").await;
    }

    if let Some(cmd) = pre_command {
        let _ = writer.write_all(format!("{}\n", cmd).as_bytes()).await;
    }

    let handle = Arc::new(final_handle);

    // Persistent sessions run inside tmux/screen, and neither forwards the
    // shell's OSC 7 to the outer terminal (screen drops it; tmux keeps it for
    // itself), so the frontend's OSC 7 handler never sees a cwd. Poll the
    // multiplexer for the active pane's cwd and push it to the same store the
    // SFTP panel's "follow cwd" reads. Non-persistent sessions get cwd straight
    // from OSC 7 and need no polling.
    if persist {
        let poll_handle = Arc::clone(&handle);
        let poll_app = app.clone();
        let key = crate::shell_integration::tmux_session_key(&session_id);
        let keys_handle = Arc::clone(&handle);
        let keys_cmd = crate::shell_integration::persistent_copy_mode_keys_command(&key);
        tokio::spawn(async move {
            if let Ok(channel) = keys_handle.channel_open_session().await {
                let _ = exec_collect(channel, &keys_cmd, std::time::Duration::from_secs(30)).await;
            }
        });
        let cwd_cmd = crate::shell_integration::cwd_probe_command(&key);
        let cwd_event = format!("ssh-cwd-{}", session_id);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
            let mut last: Option<String> = None;
            let mut failures = 0u32;
            loop {
                interval.tick().await;
                // The session handle is explicitly disconnected on teardown, so
                // a run of failed channel opens means it's gone — stop polling.
                let channel = match poll_handle.channel_open_session().await {
                    Ok(c) => c,
                    Err(_) => {
                        failures += 1;
                        if failures >= 3 {
                            break;
                        }
                        continue;
                    }
                };
                failures = 0;
                let Some((out, _)) =
                    exec_collect(channel, &cwd_cmd, std::time::Duration::from_secs(3)).await
                else {
                    continue;
                };
                let path = String::from_utf8_lossy(&out).trim().to_string();
                if crate::shell_integration::is_live_probe_cwd(&path)
                    && Some(&path) != last.as_ref()
                {
                    let _ = poll_app.emit(&cwd_event, path.clone());
                    last = Some(path);
                }
            }
        });
    }

    let io =
        crate::ssh::channel_io::spawn_channel_io_split(app, &session_id, read_half, write_half);

    Ok(ConnectedSession {
        handle,
        input_tx: io.input_tx,
        shutdown_tx: io.shutdown_tx,
        channel_only: false,
        persist,
        _jump_handles: jump_handles,
        remote_routes: final_routes,
    })
}

/// `keepalive_interval_secs == 0` disables keepalive.
pub fn client_config(
    keepalive_interval_secs: u64,
    keepalive_max: usize,
    legacy_algorithms: bool,
) -> client::Config {
    client::Config {
        keepalive_interval: (keepalive_interval_secs > 0)
            .then(|| std::time::Duration::from_secs(keepalive_interval_secs)),
        keepalive_max,
        preferred: if legacy_algorithms {
            legacy_preferred()
        } else {
            Default::default()
        },
        ..Default::default()
    }
}

/// One-shot connect + auth for headless commands (no PTY, no jump hosts).
pub async fn connect_authenticated(
    known_hosts: Arc<KnownHostsStore>,
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    passphrase: Option<&str>,
    legacy_algorithms: bool,
    proxy: Option<&ProxySpec>,
) -> Result<client::Handle<SshClient>, String> {
    let config = Arc::new(client_config(
        0,
        client::Config::default().keepalive_max,
        legacy_algorithms,
    ));
    let (mut handle, _via, ()) = connect_first_hop_retrying(
        &config,
        proxy,
        host,
        port,
        1,
        || {
            let (c, reason) = SshClient::new(host.to_string(), port, Arc::clone(&known_hosts));
            (c, reason, ())
        },
        |e| format!("Connection failed: {e}"),
    )
    .await?;
    authenticate_handle(&mut handle, username, password, private_key, passphrase).await?;
    Ok(handle)
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// russh's safe defaults plus legacy/weak algorithms appended (OpenSSH `+algo`
/// semantics): strong algorithms still negotiate first, but old devices — e.g.
/// legacy Cisco IOS that only offers `diffie-hellman-group1-sha1` / `3des-cbc`
/// / `hmac-sha1` — can still connect. `ssh-rsa` host keys are already accepted
/// by russh's default, so only kex/cipher/mac need extending here.
fn legacy_preferred() -> russh::Preferred {
    use russh::{cipher, kex, mac};

    let base = russh::Preferred::DEFAULT;

    // None of these are present in russh's safe defaults, so plain appends keep
    // the secure-first ordering without duplicates.
    let mut kex_algos = base.kex.to_vec();
    kex_algos.extend([kex::DH_GEX_SHA1, kex::DH_G14_SHA1, kex::DH_G1_SHA1]);

    let mut ciphers = base.cipher.to_vec();
    ciphers.extend([
        cipher::AES_256_CBC,
        cipher::AES_192_CBC,
        cipher::AES_128_CBC,
        cipher::TRIPLE_DES_CBC,
    ]);

    let mut macs = base.mac.to_vec();
    macs.extend([mac::HMAC_SHA1_ETM, mac::HMAC_SHA1]);

    russh::Preferred {
        kex: kex_algos.into(),
        cipher: ciphers.into(),
        mac: macs.into(),
        key: base.key,
        compression: base.compression,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        answer_prompts, authenticate_handle, choose_rsa_hash, client, client_config,
        connect_first_hop_retrying, is_windows_sshid, legacy_preferred, Arc, Mutex, AUTH_TIMEOUT,
        KBD_INT_REJECTED, KEY_REJECTED, PASSWORD_EXPIRED, PASSWORD_REJECTED,
    };
    use crate::port_forward::test_ssh::TestClient;
    use russh::client::Prompt;
    use russh::keys::ssh_key::HashAlg;
    use russh::server::{Auth, Response};
    use russh::MethodKind::{self, KeyboardInteractive, Password, PublicKey};
    use std::borrow::Cow;
    use std::sync::atomic::{AtomicU32, Ordering};

    const SECRET: &str = "s3cret";

    fn prompt(text: &str, echo: bool) -> Prompt {
        Prompt {
            prompt: text.into(),
            echo,
        }
    }

    #[test]
    fn only_password_prompts_are_answered_once() {
        for text in [
            "Password:",
            "Password for root@fbsd:",
            "Parola:",
            "Mot de passe :",
            "Пароль:",
            "密码：",
            "Heslo:",
        ] {
            let got = answer_prompts(&[prompt(text, false)], SECRET, &mut false);
            assert_eq!(got, Ok(vec![SECRET.to_string()]), "{text}");
        }
        for text in [
            "You are required to change your password immediately (administrator enforced).\n\
             Changing password for bob.\nCurrent password: ",
            "(current) UNIX password:",
            "New password:",
            "Retype new password:",
            "Nouveau mot de passe :",
            "Новый пароль:",
            "Yeni parola:",
            "Nové heslo:",
        ] {
            let got = answer_prompts(&[prompt(text, false)], SECRET, &mut false);
            assert_eq!(got, Err(PASSWORD_EXPIRED.to_string()), "{text}");
        }
        for p in [
            prompt("Verification code:", false),
            prompt("Password:", true),
        ] {
            let err = answer_prompts(&[p], SECRET, &mut false).unwrap_err();
            assert!(err.contains("can't be answered"), "{err}");
        }
        let again = answer_prompts(&[prompt("Password:", false)], SECRET, &mut true);
        assert_eq!(again, Err(KBD_INT_REJECTED.to_string()));
        assert_eq!(answer_prompts(&[], SECRET, &mut false), Ok(vec![]));
    }

    /// Like sshd: a disabled method always fails, and every rejection relists the enabled ones.
    struct AuthServer {
        methods: &'static [MethodKind],
        kbd_prompt: &'static str,
        accept_key: bool,
    }

    impl AuthServer {
        fn decide(&self, method: MethodKind, ok: bool) -> Auth {
            if ok && self.methods.contains(&method) {
                return Auth::Accept;
            }
            Auth::Reject {
                proceed_with_methods: Some(self.methods.into()),
                partial_success: false,
            }
        }
    }

    impl russh::server::Handler for AuthServer {
        type Error = russh::Error;

        async fn auth_password(&mut self, _: &str, password: &str) -> Result<Auth, Self::Error> {
            Ok(self.decide(Password, password == SECRET))
        }

        async fn auth_publickey(
            &mut self,
            _: &str,
            _: &russh::keys::ssh_key::PublicKey,
        ) -> Result<Auth, Self::Error> {
            Ok(self.decide(PublicKey, self.accept_key))
        }

        async fn auth_keyboard_interactive<'a>(
            &'a mut self,
            _: &str,
            _: &str,
            response: Option<Response<'a>>,
        ) -> Result<Auth, Self::Error> {
            Ok(match response {
                None if self.methods.contains(&KeyboardInteractive) => Auth::Partial {
                    name: Cow::Borrowed(""),
                    instructions: Cow::Borrowed(""),
                    prompts: Cow::Owned(vec![(Cow::Borrowed(self.kbd_prompt), false)]),
                },
                None => self.decide(KeyboardInteractive, false),
                Some(mut r) => self.decide(
                    KeyboardInteractive,
                    r.next().as_deref() == Some(SECRET.as_bytes()),
                ),
            })
        }
    }

    async fn auth(
        server: AuthServer,
        password: Option<&str>,
        key: Option<&str>,
    ) -> Result<(), String> {
        use crate::port_forward::test_ssh::{serve_one, TestClient};
        let config = russh::server::Config {
            methods: server.methods.into(),
            auth_rejection_time: std::time::Duration::ZERO,
            auth_rejection_time_initial: Some(std::time::Duration::ZERO),
            ..Default::default()
        };
        let port = serve_one(config, server).await;
        let addr = ("127.0.0.1", port);
        let mut handle = russh::client::connect(Default::default(), addr, TestClient)
            .await
            .unwrap();
        authenticate_handle(&mut handle, "root", password, key, None).await
    }

    #[tokio::test]
    async fn auth_falls_back_key_password_keyboard_interactive() {
        let key: russh::keys::PrivateKey =
            russh::keys::ssh_key::private::Ed25519Keypair::from_seed(&[7; 32]).into();
        let key = key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap();
        let key = Some(key.as_str());
        // FreeBSD: UsePAM yes, PasswordAuthentication no, KbdInteractiveAuthentication yes.
        const PAM: &[MethodKind] = &[PublicKey, KeyboardInteractive];
        const ALL: &[MethodKind] = &[PublicKey, Password, KeyboardInteractive];
        const PWD: &[MethodKind] = &[Password];
        const KEY: &[MethodKind] = &[PublicKey];
        const PW: &str = "Password for root@fbsd:";
        const OTP: &str = "Verification code:";
        let (ok, bad) = (Some(SECRET), Some("wrong"));
        let otp = "The server asked \"Verification code:\", which can't be answered automatically.";
        let no_method = "No usable authentication method — the server only accepts: publickey.";

        let cases = [
            (PAM, PW, false, ok, None, Ok(())),
            (PAM, PW, false, bad, None, Err(KBD_INT_REJECTED)),
            (PAM, PW, false, ok, key, Ok(())),
            (PAM, OTP, false, ok, None, Err(otp)),
            (PWD, PW, false, ok, None, Ok(())),
            (PWD, PW, false, bad, None, Err(PASSWORD_REJECTED)),
            (ALL, PW, false, ok, None, Ok(())),
            (ALL, PW, false, bad, None, Err(PASSWORD_REJECTED)),
            (KEY, PW, true, None, key, Ok(())),
            (KEY, PW, false, None, key, Err(KEY_REJECTED)),
            (KEY, PW, false, ok, None, Err(no_method)),
        ];
        for (i, (methods, kbd_prompt, accept_key, password, key, want)) in
            cases.into_iter().enumerate()
        {
            let server = AuthServer {
                methods,
                kbd_prompt,
                accept_key,
            };
            assert_eq!(
                auth(server, password, key).await,
                want.map_err(String::from),
                "case {i}"
            );
        }
    }

    #[test]
    fn server_advertised_rsa_hash_is_honoured() {
        assert_eq!(
            choose_rsa_hash(Some(Some(HashAlg::Sha512))),
            Some(HashAlg::Sha512)
        );
        assert_eq!(
            choose_rsa_hash(Some(Some(HashAlg::Sha256))),
            Some(HashAlg::Sha256)
        );
    }

    #[test]
    fn server_without_rsa_sha2_gets_ssh_rsa() {
        // dropbear < 2020.79 lists its algorithms without any rsa-sha2-*. Sending
        // rsa-sha2-256 there rejects a key the server would otherwise accept.
        assert_eq!(choose_rsa_hash(Some(None)), None);
    }

    #[test]
    fn silent_server_gets_sha256_then_falls_back() {
        // No server-sig-algs at all: optimistic, with the caller's ssh-rsa retry behind it.
        assert_eq!(choose_rsa_hash(None), Some(HashAlg::Sha256));
    }

    #[test]
    fn auth_timeout_is_bounded() {
        // The bug this guards: an unanswered userauth left the UI spinning forever.
        assert!(AUTH_TIMEOUT.as_secs() > 0 && AUTH_TIMEOUT.as_secs() <= 60);
    }

    #[test]
    fn windows_openssh_banner_is_detected() {
        // Windows' bundled sshd, regardless of default shell (cmd/PowerShell).
        assert!(is_windows_sshid(b"SSH-2.0-OpenSSH_for_Windows_9.5"));
        assert!(is_windows_sshid(b"SSH-2.0-OpenSSH_for_Windows_8.1"));
        // Case-insensitive, in case a vendor rebrands the banner.
        assert!(is_windows_sshid(b"SSH-2.0-Foo_WINDOWS_1.0"));
    }

    #[test]
    fn posix_banners_are_not_windows() {
        assert!(!is_windows_sshid(b"SSH-2.0-OpenSSH_9.6"));
        assert!(!is_windows_sshid(
            b"SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.4"
        ));
        assert!(!is_windows_sshid(b"SSH-2.0-dropbear_2022.83"));
        assert!(!is_windows_sshid(b""));
    }

    #[tokio::test]
    async fn legacy_toggle_negotiates_with_sha1_only_server() {
        use crate::port_forward::test_ssh::{connect_to_server, Behavior};
        use russh::{cipher, kex, mac};
        use std::borrow::Cow;

        // No AEAD cipher, so the MAC actually has to negotiate.
        let openssh_5_3 = || russh::Preferred {
            kex: Cow::Borrowed(&[kex::DH_GEX_SHA256, kex::DH_G14_SHA1, kex::DH_G1_SHA1]),
            cipher: Cow::Borrowed(&[
                cipher::AES_128_CTR,
                cipher::AES_256_CTR,
                cipher::AES_128_CBC,
                cipher::TRIPLE_DES_CBC,
            ]),
            mac: Cow::Borrowed(&[mac::HMAC_SHA1]),
            ..Default::default()
        };
        let connect = |legacy| {
            connect_to_server(
                client_config(0, 3, legacy),
                openssh_5_3(),
                Behavior::GreetThenClose,
            )
        };
        assert!(matches!(
            connect(false).await,
            Err(russh::Error::NoCommonAlgo {
                kind: russh::AlgorithmKind::Mac,
                ..
            })
        ));
        assert!(connect(true).await.is_ok());
    }

    #[test]
    fn legacy_preferred_includes_weak_algorithms() {
        let p = legacy_preferred();
        let kex: Vec<&str> = p.kex.iter().map(|n| n.as_ref()).collect();
        let cipher: Vec<&str> = p.cipher.iter().map(|n| n.as_ref()).collect();
        let mac: Vec<&str> = p.mac.iter().map(|n| n.as_ref()).collect();

        // The exact algorithms the legacy Cisco in issue #17 offers.
        assert!(kex.contains(&"diffie-hellman-group1-sha1"));
        assert!(cipher.contains(&"3des-cbc"));
        assert!(mac.contains(&"hmac-sha1"));

        // Strong defaults still negotiate first.
        assert_eq!(kex.first().copied(), Some("mlkem768x25519-sha256"));
        assert_eq!(
            cipher.first().copied(),
            Some("chacha20-poly1305@openssh.com")
        );
    }

    /// Returns how many times `make` ran.
    async fn run_retrying(max_attempts: u32, rejection: Option<&str>) -> (u32, Result<(), String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let calls = Arc::new(AtomicU32::new(0));
        let calls2 = Arc::clone(&calls);
        let rejection = rejection.map(str::to_string);
        let result = connect_first_hop_retrying(
            &Arc::new(client::Config::default()),
            None,
            "127.0.0.1",
            port,
            max_attempts,
            move || {
                calls2.fetch_add(1, Ordering::SeqCst);
                (TestClient, Arc::new(Mutex::new(rejection.clone())), ())
            },
            |e| format!("boom: {e}"),
        )
        .await
        .map(|_| ());
        (calls.load(Ordering::SeqCst), result)
    }

    #[tokio::test]
    async fn retrying_helper_retries_transient_failures_up_to_max_attempts() {
        let (calls, result) = run_retrying(3, None).await;
        assert_eq!(calls, 3);
        assert!(result.unwrap_err().starts_with("boom: "));
    }

    #[tokio::test]
    async fn retrying_helper_does_not_retry_a_deliberate_rejection() {
        let (calls, result) = run_retrying(3, Some("host key rejected")).await;
        assert_eq!(calls, 1);
        assert_eq!(result.unwrap_err(), "host key rejected");
    }

    #[tokio::test]
    async fn retrying_helper_max_attempts_one_never_retries() {
        let (calls, _result) = run_retrying(1, None).await;
        assert_eq!(calls, 1);
    }
}
