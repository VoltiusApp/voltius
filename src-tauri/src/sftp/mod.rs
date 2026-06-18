pub mod docker_fs;

use crate::known_hosts::KnownHostsStore;
use crate::ssh::client::{authenticate_handle, JumpHostConnect, SshClient};
use docker_fs::DockerFs;
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SftpStep {
    TcpConnected,
    Handshake,
    Authenticating,
    SftpSubsystem,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpStepEvent {
    pub step: SftpStep,
    pub detail: String,
}

fn emit_step(app: &AppHandle, connect_id: &str, step: SftpStep, detail: impl Into<String>) {
    let _ = app.emit(
        &format!("sftp-step-{}", connect_id),
        SftpStepEvent {
            step,
            detail: detail.into(),
        },
    );
}

/// The transport behind an `sftpId`. Most sessions speak real SFTP; container
/// sessions whose image lacks an sftp-server binary use a `docker exec` shim.
#[derive(Clone)]
pub enum SftpBackend {
    Real(Arc<Mutex<SftpSession>>),
    Docker(DockerFs),
}

struct SftpEntry {
    backend: SftpBackend,
    handle: Arc<Handle<SshClient>>,
    cancel: CancellationToken,
    _jump_handles: Vec<Arc<Handle<SshClient>>>,
}

pub struct SftpManager {
    sessions: Arc<Mutex<HashMap<String, SftpEntry>>>,
    /// Active transfer cancellation tokens, keyed by transfer_id
    transfers: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            transfers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Open SFTP by exec-ing an sftp-server command on the remote host (e.g. `docker exec -i <id> sftp-server`).
    pub async fn open_exec(
        &self,
        handle: Arc<Handle<SshClient>>,
        cmd: &str,
    ) -> Result<String, String> {
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel error: {e}"))?;
        channel
            .exec(true, cmd)
            .await
            .map_err(|e| format!("Exec error: {e}"))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("SFTP session error: {e}"))?;
        let id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            id.clone(),
            SftpEntry {
                backend: SftpBackend::Real(Arc::new(Mutex::new(sftp))),
                handle,
                cancel: CancellationToken::new(),
                _jump_handles: vec![],
            },
        );
        Ok(id)
    }

    /// Register a `docker exec`-based filesystem backend for a container that has
    /// no sftp-server binary. `handle` is the host SSH connection.
    pub async fn open_docker(
        &self,
        handle: Arc<Handle<SshClient>>,
        container_id: String,
    ) -> Result<String, String> {
        let fs = DockerFs::new(Arc::clone(&handle), container_id);
        let id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            id.clone(),
            SftpEntry {
                backend: SftpBackend::Docker(fs),
                handle,
                cancel: CancellationToken::new(),
                _jump_handles: vec![],
            },
        );
        Ok(id)
    }

    pub async fn open(&self, handle: Arc<Handle<SshClient>>) -> Result<String, String> {
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel error: {e}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("SFTP subsystem error: {e}"))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("SFTP session error: {e}"))?;
        let id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            id.clone(),
            SftpEntry {
                backend: SftpBackend::Real(Arc::new(Mutex::new(sftp))),
                handle,
                cancel: CancellationToken::new(),
                _jump_handles: vec![],
            },
        );
        Ok(id)
    }

    pub async fn connect(
        &self,
        app: &AppHandle,
        connect_id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        passphrase: Option<&str>,
        jump_hosts: Vec<JumpHostConnect>,
        known_hosts: Arc<KnownHostsStore>,
        keepalive_interval_secs: u64,
        keepalive_max: usize,
    ) -> Result<String, String> {
        // Honor the host/global keepalive preset (same as terminal sessions).
        // interval 0 = keepalive disabled.
        let config = Arc::new(russh::client::Config {
            keepalive_interval: (keepalive_interval_secs > 0)
                .then(|| std::time::Duration::from_secs(keepalive_interval_secs)),
            keepalive_max,
            ..Default::default()
        });

        let mut jump_handles: Vec<Arc<Handle<SshClient>>> = Vec::new();

        let mut final_handle: Handle<SshClient> = if jump_hosts.is_empty() {
            let (ssh_client, rejection_reason) =
                SshClient::new(host.to_string(), port, Arc::clone(&known_hosts));
            emit_step(
                app,
                connect_id,
                SftpStep::TcpConnected,
                format!("{}:{}", host, port),
            );
            match russh::client::connect(Arc::clone(&config), (host, port), ssh_client).await {
                Ok(h) => h,
                Err(e) => {
                    let reason = rejection_reason.lock().await.take();
                    return Err(reason.unwrap_or_else(|| format!("SSH connection failed: {e}")));
                }
            }
        } else {
            let first = &jump_hosts[0];
            let (first_client, rejection_reason) =
                SshClient::new(first.host.clone(), first.port, Arc::clone(&known_hosts));
            let mut current_handle = match russh::client::connect(
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
                app,
                connect_id,
                SftpStep::TcpConnected,
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

            for (i, jump) in jump_hosts[1..].iter().enumerate() {
                let channel = current_handle
                    .channel_open_direct_tcpip(&jump.host, jump.port as u32, "127.0.0.1", 0)
                    .await
                    .map_err(|e| format!("Failed to open tunnel to {}: {}", jump.host, e))?;
                let (next_client, _) =
                    SshClient::new(jump.host.clone(), jump.port, Arc::clone(&known_hosts));
                let mut next_handle = russh::client::connect_stream(
                    Arc::clone(&config),
                    channel.into_stream(),
                    next_client,
                )
                .await
                .map_err(|e| format!("Jump host {} SSH handshake failed: {}", jump.host, e))?;
                authenticate_handle(
                    &mut next_handle,
                    &jump.username,
                    jump.password.as_deref(),
                    jump.private_key.as_deref(),
                    jump.passphrase.as_deref(),
                )
                .await
                .map_err(|e| format!("Jump host {} auth failed: {}", jump.host, e))?;
                let prev = std::mem::replace(&mut current_handle, next_handle);
                jump_handles.push(Arc::new(prev));
                emit_step(
                    app,
                    connect_id,
                    SftpStep::TcpConnected,
                    format!("{}:{} (jump {})", jump.host, jump.port, i + 2),
                );
            }

            let channel = current_handle
                .channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0)
                .await
                .map_err(|e| format!("Failed to open tunnel to final host {}: {}", host, e))?;
            let (final_client, _) =
                SshClient::new(host.to_string(), port, Arc::clone(&known_hosts));
            let h = russh::client::connect_stream(
                Arc::clone(&config),
                channel.into_stream(),
                final_client,
            )
            .await
            .map_err(|e| format!("Final host {} SSH handshake failed: {}", host, e))?;
            jump_handles.push(Arc::new(current_handle));
            emit_step(
                app,
                connect_id,
                SftpStep::TcpConnected,
                format!("{}:{}", host, port),
            );
            h
        };

        emit_step(
            app,
            connect_id,
            SftpStep::Handshake,
            "Negotiating algorithms",
        );
        emit_step(
            app,
            connect_id,
            SftpStep::Authenticating,
            format!("{}@{}", username, host),
        );
        authenticate_handle(
            &mut final_handle,
            username,
            password,
            private_key,
            passphrase,
        )
        .await?;

        emit_step(
            app,
            connect_id,
            SftpStep::SftpSubsystem,
            "Requesting SFTP subsystem",
        );
        let channel = final_handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel error: {e}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("SFTP subsystem error: {e}"))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("SFTP session error: {e}"))?;

        let handle = Arc::new(final_handle);
        let sftp_arc = Arc::new(Mutex::new(sftp));
        let cancel = CancellationToken::new();
        let id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            id.clone(),
            SftpEntry {
                backend: SftpBackend::Real(Arc::clone(&sftp_arc)),
                handle: Arc::clone(&handle),
                cancel: cancel.clone(),
                _jump_handles: jump_handles,
            },
        );

        // Monitor for connection loss by probing a lightweight channel, paced to
        // the keepalive preset: probe every `interval`, declare the link dead only
        // after `max` consecutive failures (≈ interval × max detection, matching the
        // terminal preset semantics). Disabled when keepalive is "off".
        if keepalive_interval_secs > 0 && keepalive_max > 0 {
            let monitor_handle = Arc::clone(&handle);
            let monitor_app = app.clone();
            let monitor_id = id.clone();
            let probe_every = Duration::from_secs(keepalive_interval_secs);
            let probe_timeout = Duration::from_secs(keepalive_interval_secs.max(2));
            tokio::spawn(async move {
                let mut failures = 0usize;
                loop {
                    tokio::select! {
                        _ = cancel.cancelled() => break,
                        _ = tokio::time::sleep(probe_every) => {}
                    }
                    let result =
                        tokio::time::timeout(probe_timeout, monitor_handle.channel_open_session())
                            .await;
                    match result {
                        Ok(Ok(ch)) => {
                            let _ = ch.close().await;
                            failures = 0;
                        }
                        _ => {
                            failures += 1;
                            if failures >= keepalive_max {
                                let _ =
                                    monitor_app.emit(&format!("sftp-closed-{}", monitor_id), ());
                                break;
                            }
                        }
                    }
                }
            });
        }

        Ok(id)
    }

    /// Fetch the real SFTP session for an id. Returns None for docker-exec
    /// backends (callers that need docker should use `backend`).
    pub async fn get(&self, id: &str) -> Option<Arc<Mutex<SftpSession>>> {
        self.sessions
            .lock()
            .await
            .get(id)
            .and_then(|e| match &e.backend {
                SftpBackend::Real(s) => Some(Arc::clone(s)),
                SftpBackend::Docker(_) => None,
            })
    }

    /// Fetch the backend (real SFTP or docker-exec) for an id.
    pub async fn backend(&self, id: &str) -> Option<SftpBackend> {
        self.sessions
            .lock()
            .await
            .get(id)
            .map(|e| e.backend.clone())
    }

    pub async fn close(&self, id: &str) {
        let entry = self.sessions.lock().await.remove(id);
        if let Some(e) = entry {
            e.cancel.cancel();
            if let SftpBackend::Real(s) = &e.backend {
                let _ = s.lock().await.close().await;
            }
        }
    }

    /// Register a transfer and return its cancellation token.
    pub async fn register_transfer(&self, transfer_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.transfers
            .lock()
            .await
            .insert(transfer_id.to_string(), token.clone());
        token
    }

    /// Cancel a transfer by ID. No-op if not found.
    pub async fn cancel_transfer(&self, transfer_id: &str) {
        if let Some(token) = self.transfers.lock().await.remove(transfer_id) {
            token.cancel();
        }
    }

    /// Remove a completed/failed transfer token.
    pub async fn finish_transfer(&self, transfer_id: &str) {
        self.transfers.lock().await.remove(transfer_id);
    }

    /// Run a shell command on the remote host associated with an SFTP session.
    /// The command should append `; echo __TF_EXIT__:$?` to capture exit code.
    pub async fn exec_command(&self, sftp_id: &str, cmd: &str) -> Result<(), String> {
        let handle = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(sftp_id)
                .ok_or_else(|| format!("SFTP session '{}' not found", sftp_id))?
                .handle
                .clone()
        };

        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel error: {e}"))?;
        channel
            .exec(true, cmd)
            .await
            .map_err(|e| format!("Exec error: {e}"))?;

        let mut stream = channel.into_stream();
        let mut output = Vec::new();
        let _ = timeout(Duration::from_secs(120), async {
            let mut buf = vec![0u8; 4096];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => output.extend_from_slice(&buf[..n]),
                }
            }
        })
        .await;

        let text = String::from_utf8_lossy(&output);
        for line in text.lines().rev() {
            if let Some(code_str) = line.strip_prefix("__TF_EXIT__:") {
                let code: i32 = code_str.trim().parse().unwrap_or(1);
                if code != 0 {
                    let msg = text
                        .lines()
                        .filter(|l| !l.starts_with("__TF_EXIT__:"))
                        .collect::<Vec<_>>()
                        .join("\n");
                    return Err(msg.trim().to_string());
                }
                return Ok(());
            }
        }

        // No exit marker — check for obvious error patterns
        if text.contains("command not found") || text.contains("No such file") {
            return Err(text.trim().to_string());
        }

        Ok(())
    }
}
