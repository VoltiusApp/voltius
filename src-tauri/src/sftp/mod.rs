use crate::known_hosts::KnownHostsStore;
use crate::ssh::client::SshClient;
use russh::client::Handle;
use russh::keys::PrivateKeyWithHashAlg;
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
        SftpStepEvent { step, detail: detail.into() },
    );
}

struct SftpEntry {
    sftp: Arc<Mutex<SftpSession>>,
    handle: Arc<Handle<SshClient>>,
    cancel: CancellationToken,
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
                sftp: Arc::new(Mutex::new(sftp)),
                handle,
                cancel: CancellationToken::new(),
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
        known_hosts: Arc<KnownHostsStore>,
    ) -> Result<String, String> {
        let config = russh::client::Config {
            keepalive_interval: Some(std::time::Duration::from_secs(2)),
            keepalive_max: 2,
            ..Default::default()
        };
        let (ssh_client, rejection_reason) = SshClient::new(host.to_string(), port, known_hosts);
        emit_step(app, connect_id, SftpStep::TcpConnected, format!("{}:{}", host, port));
        let mut handle =
            match russh::client::connect(Arc::new(config), (host, port), ssh_client).await {
                Ok(h) => h,
                Err(e) => {
                    let reason = rejection_reason.lock().await.take();
                    return Err(reason.unwrap_or_else(|| format!("SSH connection failed: {e}")));
                }
            };

        emit_step(app, connect_id, SftpStep::Handshake, "Negotiating algorithms");
        emit_step(app, connect_id, SftpStep::Authenticating, format!("{}@{}", username, host));
        let auth = if let Some(key_str) = private_key {
            let key = russh::keys::decode_secret_key(key_str, None)
                .map_err(|e| format!("Invalid private key: {e}"))?;
            let kwa = PrivateKeyWithHashAlg::new(Arc::new(key), Some(russh::keys::ssh_key::HashAlg::Sha256));
            handle.authenticate_publickey(username, kwa).await
        } else if let Some(pwd) = password {
            handle.authenticate_password(username, pwd).await
        } else {
            return Err("No authentication method provided".into());
        }
        .map_err(|e| format!("Auth failed: {e}"))?;

        if !auth.success() {
            return Err("Authentication failed".into());
        }

        emit_step(app, connect_id, SftpStep::SftpSubsystem, "Requesting SFTP subsystem");
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

        let handle = Arc::new(handle);
        let sftp_arc = Arc::new(Mutex::new(sftp));
        let cancel = CancellationToken::new();
        let id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            id.clone(),
            SftpEntry {
                sftp: Arc::clone(&sftp_arc),
                handle: Arc::clone(&handle),
                cancel: cancel.clone(),
            },
        );

        // Monitor for connection loss: keepalives will kill the handle after ~4s;
        // we detect that by trying to open a lightweight channel.
        let monitor_handle = Arc::clone(&handle);
        let monitor_app = app.clone();
        let monitor_id = id.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                }
                let result = tokio::time::timeout(
                    Duration::from_secs(3),
                    monitor_handle.channel_open_session(),
                ).await;
                match result {
                    Ok(Ok(ch)) => { let _ = ch.close().await; }
                    _ => {
                        let _ = monitor_app.emit(&format!("sftp-closed-{}", monitor_id), ());
                        break;
                    }
                }
            }
        });

        Ok(id)
    }

    pub async fn get(&self, id: &str) -> Option<Arc<Mutex<SftpSession>>> {
        self.sessions
            .lock()
            .await
            .get(id)
            .map(|e| Arc::clone(&e.sftp))
    }

    pub async fn close(&self, id: &str) {
        let entry = self.sessions.lock().await.remove(id);
        if let Some(e) = entry {
            e.cancel.cancel();
            let _ = e.sftp.lock().await.close().await;
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
