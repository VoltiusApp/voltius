use crate::known_hosts::{
    ConflictAction, HostKeyConflictEvent, HostKeyStatus, KnownHostsStore, PendingConflicts,
};
use crate::port_forward::{RemoteRoute, RemoteRouteMap};
use russh::client;
use russh::keys::ssh_key::{HashAlg, PublicKey};
use russh::keys::PrivateKeyWithHashAlg;
use russh::ChannelMsg;
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
            },
            rejection_reason,
        )
    }

    /// Interactive constructor for the final SSH session.
    /// Returns an extra `RemoteRouteMap` that PortForwardManager uses to register routes.
    pub fn new_interactive(
        host: String,
        port: u16,
        known_hosts: Arc<KnownHostsStore>,
        app: AppHandle,
        session_id: String,
        pending_conflicts: Arc<PendingConflicts>,
    ) -> (Self, Arc<Mutex<Option<String>>>, RemoteRouteMap) {
        let rejection_reason = Arc::new(Mutex::new(None::<String>));
        let remote_routes: RemoteRouteMap = Arc::new(Mutex::new(HashMap::new()));
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
            },
            rejection_reason,
            remote_routes,
        )
    }
}

impl client::Handler for SshClient {
    type Error = russh::Error;

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
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let route: Option<RemoteRoute> = {
            let routes = self.remote_routes.lock().await;
            routes
                .get(&(connected_address.to_string(), connected_port as u16))
                .cloned()
        };

        if let Some(route) = route {
            tokio::spawn(bridge_remote_channel(channel, route));
        } else {
            let _ = channel.close().await;
        }
        Ok(())
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: russh::Channel<russh::client::Msg>,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
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
    /// Keeps intermediate jump-host SSH handles alive for the lifetime of this session.
    pub _jump_handles: Vec<Arc<client::Handle<SshClient>>>,
    /// Shared remote-forward route table for this session.
    pub remote_routes: RemoteRouteMap,
}

async fn bridge_remote_channel(channel: russh::Channel<client::Msg>, route: RemoteRoute) {
    use std::sync::atomic::Ordering;

    let tcp = match TcpStream::connect((route.target_host.as_str(), route.target_port)).await {
        Ok(t) => t,
        Err(_) => {
            let _ = channel.close().await;
            return;
        }
    };

    let (mut ch_read, ch_write) = channel.split();
    let mut ch_writer = ch_write.make_writer();
    let (mut tcp_r, mut tcp_w) = tokio::io::split(tcp);

    let bytes_up = Arc::clone(&route.bytes);
    let tcp_to_ssh = tokio::spawn(async move {
        let mut buf = [0u8; 65536];
        loop {
            match tcp_r.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if ch_writer.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                    bytes_up.fetch_add(n as u64, Ordering::Relaxed);
                }
            }
        }
    });

    let bytes_down = route.bytes;
    let ssh_to_tcp = tokio::spawn(async move {
        loop {
            match ch_read.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    if tcp_w.write_all(&data).await.is_err() {
                        break;
                    }
                    bytes_down.fetch_add(data.len() as u64, Ordering::Relaxed);
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
    });

    let _ = tokio::join!(tcp_to_ssh, ssh_to_tcp);
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

pub async fn authenticate_handle(
    handle: &mut client::Handle<SshClient>,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    passphrase: Option<&str>,
) -> Result<(), String> {
    let authenticated = if let Some(key_str) = private_key {
        let key_pair = russh::keys::decode_secret_key(key_str, passphrase)
            .map_err(|e| format!("Invalid private key: {}", e))?;
        let key = PrivateKeyWithHashAlg::new(Arc::new(key_pair), Some(HashAlg::Sha256));
        handle
            .authenticate_publickey(username, key)
            .await
            .map_err(|e| format!("Auth failed: {}", e))?
    } else if let Some(pwd) = password {
        handle
            .authenticate_password(username, pwd)
            .await
            .map_err(|e| format!("Auth failed: {}", e))?
    } else {
        return Err("No authentication method provided".into());
    };

    if !authenticated.success() {
        return Err("Authentication failed".into());
    }
    Ok(())
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
) -> Result<ConnectedSession, String> {
    let config = Arc::new(client::Config {
        keepalive_interval: Some(std::time::Duration::from_secs(2)),
        keepalive_max: 2,
        ..Default::default()
    });

    // Build the chain: jump_hosts[0] → jump_hosts[1] → ... → final host
    // Each hop opens a direct-tcpip channel to the next host, layering SSH over it.
    let mut jump_handles: Vec<Arc<client::Handle<SshClient>>> = Vec::new();

    #[allow(unused_assignments)]
    let mut final_routes: RemoteRouteMap = Arc::new(Mutex::new(HashMap::new()));

    let mut final_handle: client::Handle<SshClient> = if jump_hosts.is_empty() {
        // Direct TCP connection
        let (ssh_client, rejection_reason, routes) = SshClient::new_interactive(
            host.to_string(),
            port,
            Arc::clone(&known_hosts),
            app.clone(),
            session_id.clone(),
            Arc::clone(&pending_conflicts),
        );
        final_routes = routes;
        match client::connect(Arc::clone(&config), (host, port), ssh_client).await {
            Ok(h) => {
                emit_step(
                    &app,
                    &session_id,
                    SshStep::TcpConnected,
                    format!("{}:{}", host, port),
                );
                h
            }
            Err(e) => {
                let reason = rejection_reason.lock().await.take();
                return Err(reason.unwrap_or_else(|| format!("Connection failed: {}", e)));
            }
        }
    } else {
        // Connect to the first jump host via TCP
        let first = &jump_hosts[0];
        let (first_client, rejection_reason) =
            SshClient::new(first.host.clone(), first.port, Arc::clone(&known_hosts));
        let mut current_handle = match client::connect(
            Arc::clone(&config),
            (first.host.as_str(), first.port),
            first_client,
        )
        .await
        {
            Ok(h) => h,
            Err(e) => {
                let reason = rejection_reason.lock().await.take();
                return Err(reason.unwrap_or_else(|| {
                    format!("Jump host {} connection failed: {}", first.host, e)
                }));
            }
        };
        emit_step(
            &app,
            &session_id,
            SshStep::TcpConnected,
            format!("{}:{} (jump 1)", first.host, first.port),
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

        let (final_client, rejection_reason, routes) = SshClient::new_interactive(
            host.to_string(),
            port,
            Arc::clone(&known_hosts),
            app.clone(),
            session_id.clone(),
            Arc::clone(&pending_conflicts),
        );
        final_routes = routes;
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

    // Open channel + shell
    emit_step(&app, &session_id, SshStep::OpeningShell, "Requesting PTY");

    let channel = final_handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    channel
        .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {}", e))?;

    if agent_forwarding {
        channel
            .agent_forward(false)
            .await
            .map_err(|e| format!("Agent forwarding request failed: {}", e))?;
    }

    // When shell integration is enabled we replace the standard shell channel
    // request with an exec of our wrapper script. The wrapper detects the
    // remote $SHELL and execs into it with OSC 7 emission already hooked
    // (writes a temp rcfile under /tmp). Falling back to request_shell keeps
    // the historical behavior available via the setting.
    if shell_integration {
        let exec_cmd = crate::shell_integration::ssh_exec_command();
        channel
            .exec(false, exec_cmd.as_bytes())
            .await
            .map_err(|e| format!("Shell exec failed: {}", e))?;
    } else {
        channel
            .request_shell(false)
            .await
            .map_err(|e| format!("Shell request failed: {}", e))?;
    }

    // I/O loop
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<SessionInput>(256);
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);

    let event_name = format!("ssh-output-{}", session_id);
    let close_event = format!("ssh-closed-{}", session_id);

    let (mut read_half, write_half) = channel.split();
    let mut writer = write_half.make_writer();

    if !env_vars.is_empty() {
        let mut exports = String::new();
        for (key, value) in &env_vars {
            exports.push_str(&format!("export {}={}\n", key, shell_escape(value)));
        }
        let _ = writer.write_all(exports.as_bytes()).await;
    }

    if let Some(cmd) = pre_command {
        let _ = writer.write_all(format!("{}\n", cmd).as_bytes()).await;
    }

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => break,
                input = input_rx.recv() => {
                    match input {
                        Some(SessionInput::Data(data)) => {
                            if writer.write_all(&data).await.is_err() { break; }
                        }
                        Some(SessionInput::Resize(cols, rows)) => {
                            let _ = write_half.window_change(cols, rows, 0, 0).await;
                        }
                        None => break,
                    }
                }
                msg = read_half.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let _ = app.emit(&event_name, data.as_ref());
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            let _ = app.emit(&close_event, ());
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    Ok(ConnectedSession {
        handle: Arc::new(final_handle),
        input_tx,
        shutdown_tx,
        channel_only: false,
        _jump_handles: jump_handles,
        remote_routes: final_routes,
    })
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
