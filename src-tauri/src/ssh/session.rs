use crate::ssh::client::{ConnectedSession, SessionInput, SshClient};
use crate::ssh::exec::{nest, run_in, stdout_within, wrap};
use crate::ssh::live_cells::{Cell, LiveCells};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

#[derive(Debug, Default, Serialize)]
pub struct SystemInfo {
    pub pretty_name: String,
    pub version_id: String,
    pub kernel: String,
    pub arch: String,
}

/// A session's SSH handle, re-pointed in place whenever the session reconnects.
pub type SessionHandle = Cell<Arc<russh::client::Handle<SshClient>>>;

/// Where a tab's tool commands run: its SSH connection, behind `inside` when its shell is in an LXC.
#[derive(Clone)]
pub struct Machine {
    pub handle: Arc<russh::client::Handle<SshClient>>,
    pub inside: Option<String>,
}

impl Machine {
    pub fn wrap(&self, cmd: &str) -> String {
        wrap(self.inside.as_deref(), cmd)
    }

    pub fn run_in(&self, argv: &str) -> String {
        run_in(self.inside.as_deref(), argv)
    }

    pub fn nest(&self, prefix: String) -> String {
        nest(self.inside.as_deref(), prefix)
    }

    pub async fn stdout(&self, cmd: &str, limit: Duration) -> Result<String, String> {
        stdout_within(&self.handle, &self.wrap(cmd), limit).await
    }
}

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, ConnectedSession>>>,
    /// Live handle per session id. Deliberately never pruned on disconnect: a
    /// reconnect disconnects and re-adds under the same id, and dropping the
    /// cell in between would orphan every consumer holding it (that is the bug
    /// this exists to fix). At most one dead handle per id is retained.
    handles: Arc<LiveCells<Arc<russh::client::Handle<SshClient>>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            handles: Arc::new(LiveCells::new()),
        }
    }

    pub async fn add(&self, id: String, session: ConnectedSession) {
        self.handles.set(&id, Arc::clone(&session.handle)).await;
        self.sessions.lock().await.insert(id, session);
    }

    /// The session's live handle cell. Long-lived consumers (SFTP sessions,
    /// port forwards) must hold this rather than a snapshot from `get_handle`,
    /// so they follow the session across a reconnect.
    pub async fn get_session_handle(&self, id: &str) -> Result<SessionHandle, String> {
        self.handles
            .get(id)
            .await
            .ok_or_else(|| "Session not found".into())
    }

    async fn input_tx(&self, id: &str) -> Result<tokio::sync::mpsc::Sender<SessionInput>, String> {
        self.with_session(id, |s| s.input_tx.clone()).await
    }

    async fn send_input(&self, id: &str, input: SessionInput, what: &str) -> Result<(), String> {
        self.input_tx(id)
            .await?
            .send(input)
            .await
            .map_err(|e| format!("Failed to {what}: {e}"))
    }

    pub async fn send_data(&self, id: &str, data: &[u8]) -> Result<(), String> {
        self.send_input(id, SessionInput::Data(data.to_vec()), "send data")
            .await
    }

    pub async fn resize(&self, id: &str, cols: u32, rows: u32) -> Result<(), String> {
        self.send_input(id, SessionInput::Resize(cols, rows), "resize")
            .await
    }

    pub async fn set_output_paused(&self, id: &str, paused: bool) -> Result<(), String> {
        self.send_input(id, SessionInput::PauseOutput(paused), "pause output")
            .await
    }

    pub async fn set_terminal_colors(
        &self,
        id: &str,
        colors: crate::ssh::control_mode::TerminalColors,
    ) -> Result<(), String> {
        if !colors.is_valid() {
            return Err("Invalid terminal colors".into());
        }
        let (persist, handle) = self
            .with_session(id, |s| (s.persist, Arc::clone(&s.handle)))
            .await?;
        let style = crate::shell_integration::legacy_mode_style_command(&colors);
        self.send_input(id, SessionInput::Colors(colors), "set colors")
            .await?;
        if persist {
            crate::ssh::client::spawn_exec(handle, style, Duration::from_secs(10));
        }
        Ok(())
    }

    /// Latency of an SSH global-request round-trip on an existing session.
    /// None when the session is unknown, the peer never replies, or the
    /// connection is gone — callers treat that as "not measurable here".
    pub async fn ping(&self, id: &str) -> Option<u32> {
        let handle = self.get_handle(id).await.ok()?;
        let start = std::time::Instant::now();
        timeout(Duration::from_secs(5), handle.send_ping())
            .await
            .ok()?
            .ok()?;
        Some(start.elapsed().as_millis() as u32)
    }

    pub async fn detect_distro(&self, id: &str) -> Result<String, String> {
        let text = self
            .get_machine(id)
            .await?
            .stdout("{ cat /etc/os-release 2>/dev/null || echo 'ID=linux'; }; test -d /etc/pve && echo 'PROXMOX_VE=1'; test -d /etc/proxmox-backup && echo 'PBS_DETECTED=1'; true", Duration::from_secs(5))
            .await?;
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
        let text = self
            .get_machine(id)
            .await?
            .stdout("grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release 2>/dev/null; uname -srm 2>/dev/null; pveversion 2>/dev/null | head -1; proxmox-backup-manager versions 2>/dev/null | grep '^proxmox-backup-server:' | head -1", Duration::from_secs(5))
            .await?;
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

    async fn with_session<T>(
        &self,
        id: &str,
        f: impl FnOnce(&ConnectedSession) -> T,
    ) -> Result<T, String> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(id)
            .map(f)
            .ok_or_else(|| "Session not found".into())
    }

    pub async fn get_handle(
        &self,
        id: &str,
    ) -> Result<Arc<russh::client::Handle<SshClient>>, String> {
        self.with_session(id, |s| Arc::clone(&s.handle)).await
    }

    pub async fn get_machine(&self, id: &str) -> Result<Machine, String> {
        self.with_session(id, |s| Machine {
            handle: Arc::clone(&s.handle),
            inside: s.machine.clone(),
        })
        .await
    }

    pub async fn get_remote_routes(
        &self,
        id: &str,
    ) -> Result<crate::port_forward::RemoteRouteMap, String> {
        self.with_session(id, |s| Arc::clone(&s.remote_routes))
            .await
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
                let cap = Duration::from_secs(3);
                killed = timeout(cap, stdout_within(&session.handle, &kill, cap))
                    .await
                    .is_ok_and(|out| out.is_ok_and(|o| o.contains("VOLTIUS_KILLED")));
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

#[cfg(test)]
mod tests {
    use super::SessionManager;

    #[tokio::test]
    async fn ping_unknown_session_returns_none() {
        let mgr = SessionManager::new();
        assert_eq!(mgr.ping("no-such-session").await, None);
    }
}
