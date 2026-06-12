use crate::ssh::client::{ConnectedSession, SessionInput};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

#[derive(Debug, Default, Serialize)]
pub struct SystemInfo {
    pub pretty_name: String,
    pub version_id: String,
    pub kernel: String,
    pub arch: String,
}

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, ConnectedSession>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn add(&self, id: String, session: ConnectedSession) {
        self.sessions.lock().await.insert(id, session);
    }

    pub async fn send_data(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let session = sessions.get(id).ok_or("Session not found")?;
        session
            .input_tx
            .send(SessionInput::Data(data.to_vec()))
            .await
            .map_err(|e| format!("Failed to send data: {}", e))
    }

    pub async fn resize(&self, id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let session = sessions.get(id).ok_or("Session not found")?;
        session
            .input_tx
            .send(SessionInput::Resize(cols, rows))
            .await
            .map_err(|e| format!("Failed to resize: {}", e))
    }

    pub async fn detect_distro(&self, id: &str) -> Result<String, String> {
        let handle = {
            let sessions = self.sessions.lock().await;
            let session = sessions.get(id).ok_or("Session not found")?;
            Arc::clone(&session.handle)
        };

        let channel: russh::Channel<russh::client::Msg> = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel error: {}", e))?;

        channel
            .exec(true, "{ cat /etc/os-release 2>/dev/null || echo 'ID=linux'; }; test -d /etc/pve && echo 'PROXMOX_VE=1'; test -d /etc/proxmox-backup && echo 'PBS_DETECTED=1'; true")
            .await
            .map_err(|e| format!("Exec error: {}", e))?;

        let mut stream = channel.into_stream();
        let mut output = Vec::new();

        let read_result = timeout(Duration::from_secs(5), async {
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => output.extend_from_slice(&buf[..n]),
                }
            }
        })
        .await;

        if read_result.is_err() {
            return Ok("linux".to_string());
        }

        let text = String::from_utf8_lossy(&output);
        let mut id_value = String::new();
        let mut is_proxmox = false;
        let mut is_pbs = false;
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("ID=") {
                id_value = rest.trim().trim_matches('"').to_lowercase();
            } else if line.trim() == "PROXMOX_VE=1" {
                is_proxmox = true;
            } else if line.trim() == "PBS_DETECTED=1" {
                is_pbs = true;
            }
        }

        if is_proxmox {
            return Ok("proxmox".to_string());
        }
        if is_pbs {
            return Ok("pbs".to_string());
        }

        if !id_value.is_empty() {
            return Ok(normalize_distro(&id_value));
        }

        Ok("linux".to_string())
    }

    pub async fn get_system_info(&self, id: &str) -> Result<SystemInfo, String> {
        let handle = {
            let sessions = self.sessions.lock().await;
            let session = sessions.get(id).ok_or("Session not found")?;
            Arc::clone(&session.handle)
        };

        let channel: russh::Channel<russh::client::Msg> = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel error: {}", e))?;

        channel
            .exec(true, "grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release 2>/dev/null; uname -srm 2>/dev/null; pveversion 2>/dev/null | head -1; proxmox-backup-manager versions 2>/dev/null | grep '^proxmox-backup-server:' | head -1")
            .await
            .map_err(|e| format!("Exec error: {}", e))?;

        let mut stream = channel.into_stream();
        let mut output = Vec::new();

        let _ = timeout(Duration::from_secs(5), async {
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => output.extend_from_slice(&buf[..n]),
                }
            }
        })
        .await;

        let text = String::from_utf8_lossy(&output);
        let mut info = SystemInfo::default();
        for line in text.lines() {
            if let Some(v) = line.strip_prefix("PRETTY_NAME=") {
                info.pretty_name = v.trim().trim_matches('"').to_string();
            } else if let Some(v) = line.strip_prefix("VERSION_ID=") {
                info.version_id = v.trim().trim_matches('"').to_string();
            } else if line.starts_with("Linux ") {
                let parts: Vec<&str> = line.splitn(3, ' ').collect();
                if parts.len() == 3 {
                    info.kernel = parts[1].to_string();
                    info.arch = parts[2].trim().to_string();
                }
            } else if line.starts_with("pve-manager/") {
                // e.g. "pve-manager/8.2.4/43f4d7ca (running kernel: 6.8.12-5-pve)"
                if let Some(version) = line.split('/').nth(1) {
                    info.pretty_name = format!(
                        "Proxmox VE {}",
                        version.split_whitespace().next().unwrap_or(version)
                    );
                }
            } else if let Some(rest) = line.strip_prefix("proxmox-backup-server:") {
                // e.g. "proxmox-backup-server: 3.2.4-1"
                let version = rest.trim().split('-').next().unwrap_or(rest.trim());
                info.pretty_name = format!("Proxmox BS {}", version);
            }
        }
        Ok(info)
    }

    pub async fn get_handle(
        &self,
        id: &str,
    ) -> Result<std::sync::Arc<russh::client::Handle<super::client::SshClient>>, String> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(id)
            .map(|s| std::sync::Arc::clone(&s.handle))
            .ok_or_else(|| "Session not found".into())
    }

    pub async fn get_remote_routes(
        &self,
        id: &str,
    ) -> Result<crate::port_forward::RemoteRouteMap, String> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(id)
            .map(|s| std::sync::Arc::clone(&s.remote_routes))
            .ok_or_else(|| "Session not found".into())
    }

    /// Returns whether the persistent multiplexer session was confirmed killed
    /// (VOLTIUS_KILLED sentinel), so the caller can publish a tombstone only
    /// for real closures. `attached` = this session's own channel is still
    /// attached, which sets the shared-session kill threshold (1 vs 0 clients).
    pub async fn disconnect(
        &self,
        id: &str,
        post_command: Option<String>,
        kill_persistent: bool,
        attached: bool,
    ) -> Result<bool, String> {
        let session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(id)
        };
        let mut killed = false;
        if let Some(session) = session {
            if kill_persistent && session.persist {
                let kill = crate::shell_integration::persistent_kill_command(
                    &crate::shell_integration::tmux_session_key(id),
                    if attached { 1 } else { 0 },
                );
                // The kill is awaited (3 s cap) because its sentinel decides the
                // tombstone; the frontend removes the tab optimistically, so this
                // blocks no UI. Channel teardown stays spawned.
                let handle = Arc::clone(&session.handle);
                let _ = timeout(Duration::from_secs(3), async {
                    if let Ok(channel) = handle.channel_open_session().await {
                        if channel.exec(true, kill.as_str()).await.is_ok() {
                            let mut stream = channel.into_stream();
                            let mut out: Vec<u8> = Vec::new();
                            let mut buf = [0u8; 256];
                            while let Ok(n) = stream.read(&mut buf).await {
                                if n == 0 {
                                    break;
                                }
                                out.extend_from_slice(&buf[..n]);
                            }
                            killed = String::from_utf8_lossy(&out).contains("VOLTIUS_KILLED");
                        }
                    }
                })
                .await;
                tokio::spawn(async move {
                    if let Some(cmd) = post_command {
                        let data = format!("{}\n", cmd).into_bytes();
                        let _ = session.input_tx.send(SessionInput::Data(data)).await;
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                    let _ = session.shutdown_tx.send(()).await;
                    if !session.channel_only {
                        let _ = session
                            .handle
                            .disconnect(russh::Disconnect::ByApplication, "User disconnected", "en")
                            .await;
                    }
                });
            } else {
                if let Some(cmd) = post_command {
                    let data = format!("{}\n", cmd).into_bytes();
                    let _ = session.input_tx.send(SessionInput::Data(data)).await;
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                let _ = session.shutdown_tx.send(()).await;
                if !session.channel_only {
                    let _ = session
                        .handle
                        .disconnect(russh::Disconnect::ByApplication, "User disconnected", "en")
                        .await;
                }
            }
        }
        Ok(killed)
    }
}

fn normalize_distro(id: &str) -> String {
    match id {
        "ubuntu" => "ubuntu",
        "debian" => "debian",
        "fedora" => "fedora",
        "centos" => "centos",
        "rhel" | "redhatenterprise" | "redhat" => "rhel",
        "arch" | "archlinux" => "arch",
        "opensuse" | "opensuse-leap" | "opensuse-tumbleweed" | "sles" => "opensuse",
        "alpine" => "alpine",
        "kali" => "kali",
        "manjaro" => "manjaro",
        "raspbian" => "raspbian",
        "pop" => "pop",
        "mint" | "linuxmint" => "mint",
        "elementary" => "elementary",
        "zorin" => "zorin",
        "nixos" => "nixos",
        "void" => "void",
        "gentoo" => "gentoo",
        "proxmox" | "pve" => "proxmox",
        "pbs" => "pbs",
        _ => "linux",
    }
    .to_string()
}
