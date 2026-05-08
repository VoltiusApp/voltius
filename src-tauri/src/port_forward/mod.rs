pub mod poller;
pub mod socks;
pub mod tunnel;

use crate::storage::config::TunnelType;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum TunnelOrigin {
    Auto,
    AdHoc,
    Rule { rule_id: String, rule_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelState {
    Active,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveTunnel {
    pub id: String,
    pub tunnel_type: TunnelType,
    pub local_port: u16,
    pub remote_port: u16,
    pub remote_host: String,
    /// Remote tunnels: server-side bind address
    #[serde(default)]
    pub bind_host: Option<String>,
    /// Remote/local tunnels: final target host
    #[serde(default)]
    pub target_host: Option<String>,
    pub origin: TunnelOrigin,
    pub state: TunnelState,
    #[serde(default)]
    pub bytes_transferred: u64,
}

/// Cleanup metadata needed to cancel a remote forward on the SSH server.
pub(crate) struct RemoteCleanup {
    pub(crate) bind_host: String,
    pub(crate) remote_port: u16,
    pub(crate) handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
    pub(crate) routes: RemoteRouteMap,
}

/// Internal tunnel entry — wraps `ActiveTunnel` with its cancellation token and bytes counter.
pub(crate) struct TunnelEntry {
    pub(crate) tunnel: ActiveTunnel,
    pub(crate) _cancel: CancellationToken,
    pub(crate) bytes: Arc<AtomicU64>,
    pub(crate) remote_cleanup: Option<RemoteCleanup>,
}

pub(crate) struct SessionPfState {
    pub(crate) tunnels: Vec<TunnelEntry>,
    pub(crate) auto_detect: bool,
    pub(crate) poller_cancel: Option<CancellationToken>,
    /// Ports the user has manually closed — poller won't re-open them.
    pub(crate) suppressed_ports: HashSet<u16>,
}

#[derive(Debug)]
pub enum ForwardError {
    PortInUse(u16, u8),
    Io(std::io::Error),
    Ssh(russh::Error),
}

impl std::fmt::Display for ForwardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PortInUse(port, attempts) => {
                write!(f, "Port {port} already in use after {attempts} attempts")
            }
            Self::Io(e) => write!(f, "IO error: {e}"),
            Self::Ssh(e) => write!(f, "SSH error: {e}"),
        }
    }
}

impl From<std::io::Error> for ForwardError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<russh::Error> for ForwardError {
    fn from(e: russh::Error) -> Self {
        Self::Ssh(e)
    }
}

/// Sent on every state change — tunnels + suppressed ports together.
#[derive(Clone, Serialize)]
pub(crate) struct PfStatePayload {
    pub(crate) session_id: String,
    pub(crate) tunnels: Vec<ActiveTunnel>,
    pub(crate) suppressed_ports: Vec<u16>,
}

/// Returned by `pf_get_state` command for initial load.
#[derive(Serialize)]
pub struct PfSessionState {
    pub tunnels: Vec<ActiveTunnel>,
    pub suppressed_ports: Vec<u16>,
}

/// Route entry used by the SSH client handler when a remote-forwarded connection arrives.
#[derive(Clone)]
pub struct RemoteRoute {
    pub target_host: String,
    pub target_port: u16,
    pub bytes: Arc<AtomicU64>,
}

/// Shared remote-forward route table for one SSH session.
pub type RemoteRouteMap = Arc<Mutex<HashMap<(String, u16), RemoteRoute>>>;

pub struct PortForwardManager {
    pub(crate) sessions: Arc<Mutex<HashMap<String, SessionPfState>>>,
    pub(crate) app: AppHandle,
}

impl PortForwardManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            app,
        }
    }

    pub async fn get_session_state(&self, session_id: &str) -> PfSessionState {
        let sessions = self.sessions.lock().await;
        match sessions.get(session_id) {
            Some(s) => PfSessionState {
                tunnels: s.tunnels.iter().map(snapshot_tunnel).collect(),
                suppressed_ports: s.suppressed_ports.iter().copied().collect(),
            },
            None => PfSessionState {
                tunnels: vec![],
                suppressed_ports: vec![],
            },
        }
    }

    pub async fn list_tunnels(&self, session_id: &str) -> Vec<ActiveTunnel> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(session_id)
            .map(|s| s.tunnels.iter().map(snapshot_tunnel).collect())
            .unwrap_or_default()
    }

    pub async fn get_auto_detect(&self, session_id: &str) -> bool {
        let sessions = self.sessions.lock().await;
        sessions
            .get(session_id)
            .map(|s| s.auto_detect)
            .unwrap_or(false)
    }

    pub async fn set_auto_detect(
        &self,
        session_id: &str,
        enabled: bool,
        handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        let state = sessions
            .entry(session_id.to_string())
            .or_insert_with(|| SessionPfState {
                tunnels: Vec::new(),
                auto_detect: false,
                poller_cancel: None,
                suppressed_ports: HashSet::new(),
            });

        if enabled == state.auto_detect {
            return Ok(());
        }

        if let Some(cancel) = state.poller_cancel.take() {
            cancel.cancel();
        }

        state.auto_detect = enabled;

        if enabled {
            let cancel = CancellationToken::new();
            state.poller_cancel = Some(cancel.clone());
            let sessions_arc = Arc::clone(&self.sessions);
            let app = self.app.clone();
            let sid = session_id.to_string();
            tokio::spawn(poller::start_poller(sid, handle, sessions_arc, app, cancel));
        }

        Ok(())
    }

    /// Re-open a previously suppressed auto-detected port, preserving `TunnelOrigin::Auto`.
    pub async fn resume_auto_port(
        &self,
        session_id: &str,
        handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
        port: u16,
    ) -> Result<ActiveTunnel, ForwardError> {
        self.open_local_tunnel(
            session_id,
            handle,
            port,
            port,
            "127.0.0.1".into(),
            TunnelOrigin::Auto,
        )
        .await
    }

    pub async fn open_local_tunnel(
        &self,
        session_id: &str,
        handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
        local_port: u16,
        remote_port: u16,
        remote_host: String,
        origin: TunnelOrigin,
    ) -> Result<ActiveTunnel, ForwardError> {
        let cancel = CancellationToken::new();
        let (bound_port, bytes) = tunnel::create_tunnel(
            Arc::clone(&handle),
            local_port,
            remote_port,
            &remote_host,
            cancel.clone(),
        )
        .await?;

        let tunnel = ActiveTunnel {
            id: uuid::Uuid::new_v4().to_string(),
            tunnel_type: TunnelType::Local,
            local_port: bound_port,
            remote_port,
            remote_host,
            bind_host: None,
            target_host: None,
            origin,
            state: TunnelState::Active,
            bytes_transferred: 0,
        };

        let entry = TunnelEntry {
            tunnel: tunnel.clone(),
            _cancel: cancel,
            bytes,
            remote_cleanup: None,
        };

        {
            let mut sessions = self.sessions.lock().await;
            let state = sessions
                .entry(session_id.to_string())
                .or_insert_with(|| SessionPfState {
                    tunnels: Vec::new(),
                    auto_detect: false,
                    poller_cancel: None,
                    suppressed_ports: HashSet::new(),
                });
            state.suppressed_ports.remove(&remote_port);
            state.tunnels.push(entry);
        }

        self.emit_state(session_id).await;
        Ok(tunnel)
    }

    pub async fn open_remote_tunnel(
        &self,
        session_id: &str,
        handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
        routes: RemoteRouteMap,
        bind_host: String,
        remote_port: u16,
        target_host: String,
        local_port: u16,
        origin: TunnelOrigin,
    ) -> Result<ActiveTunnel, ForwardError> {
        let bytes = Arc::new(AtomicU64::new(0));

        let route = RemoteRoute {
            target_host: target_host.clone(),
            target_port: local_port,
            bytes: Arc::clone(&bytes),
        };

        // Register route BEFORE sending tcpip_forward to avoid a race.
        {
            let mut map = routes.lock().await;
            map.insert((bind_host.clone(), remote_port), route);
        }

        match handle.tcpip_forward(&bind_host, remote_port as u32).await {
            Ok(_) => {}
            Err(e) => {
                // Roll back route registration on failure.
                routes.lock().await.remove(&(bind_host.clone(), remote_port));
                return Err(ForwardError::Ssh(e));
            }
        }

        let tunnel = ActiveTunnel {
            id: uuid::Uuid::new_v4().to_string(),
            tunnel_type: TunnelType::Remote,
            local_port,
            remote_port,
            remote_host: target_host.clone(),
            bind_host: Some(bind_host.clone()),
            target_host: Some(target_host),
            origin,
            state: TunnelState::Active,
            bytes_transferred: 0,
        };

        let cancel = CancellationToken::new();
        let entry = TunnelEntry {
            tunnel: tunnel.clone(),
            _cancel: cancel,
            bytes,
            remote_cleanup: Some(RemoteCleanup {
                bind_host: bind_host.clone(),
                remote_port,
                handle: Arc::clone(&handle),
                routes,
            }),
        };

        {
            let mut sessions = self.sessions.lock().await;
            let state = sessions
                .entry(session_id.to_string())
                .or_insert_with(|| SessionPfState {
                    tunnels: Vec::new(),
                    auto_detect: false,
                    poller_cancel: None,
                    suppressed_ports: HashSet::new(),
                });
            state.tunnels.push(entry);
        }

        self.emit_state(session_id).await;
        Ok(tunnel)
    }

    pub async fn open_dynamic_tunnel(
        &self,
        session_id: &str,
        handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
        local_port: u16,
        origin: TunnelOrigin,
    ) -> Result<ActiveTunnel, ForwardError> {
        let cancel = CancellationToken::new();
        let (bound_port, bytes) =
            socks::create_socks_tunnel(Arc::clone(&handle), local_port, cancel.clone()).await?;

        let tunnel = ActiveTunnel {
            id: uuid::Uuid::new_v4().to_string(),
            tunnel_type: TunnelType::Dynamic,
            local_port: bound_port,
            remote_port: 0,
            remote_host: String::new(),
            bind_host: None,
            target_host: None,
            origin,
            state: TunnelState::Active,
            bytes_transferred: 0,
        };

        let entry = TunnelEntry {
            tunnel: tunnel.clone(),
            _cancel: cancel,
            bytes,
            remote_cleanup: None,
        };

        {
            let mut sessions = self.sessions.lock().await;
            let state = sessions
                .entry(session_id.to_string())
                .or_insert_with(|| SessionPfState {
                    tunnels: Vec::new(),
                    auto_detect: false,
                    poller_cancel: None,
                    suppressed_ports: HashSet::new(),
                });
            state.tunnels.push(entry);
        }

        self.emit_state(session_id).await;
        Ok(tunnel)
    }

    pub async fn close_tunnel(&self, session_id: &str, tunnel_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        let state = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        let pos = state
            .tunnels
            .iter()
            .position(|e| e.tunnel.id == tunnel_id)
            .ok_or_else(|| format!("Tunnel not found: {}", tunnel_id))?;

        if matches!(state.tunnels[pos].tunnel.origin, TunnelOrigin::Auto) {
            state
                .suppressed_ports
                .insert(state.tunnels[pos].tunnel.remote_port);
        }

        let entry = state.tunnels.remove(pos);

        let payload = PfStatePayload {
            session_id: session_id.to_string(),
            tunnels: state.tunnels.iter().map(snapshot_tunnel).collect(),
            suppressed_ports: state.suppressed_ports.iter().copied().collect(),
        };
        drop(sessions);

        // Best-effort remote forward cancellation (after releasing lock).
        if let Some(rc) = entry.remote_cleanup {
            rc.routes.lock().await.remove(&(rc.bind_host.clone(), rc.remote_port));
            let _ = rc.handle.cancel_tcpip_forward(&rc.bind_host, rc.remote_port as u32).await;
        }

        let _ = self.app.emit("pf-state-changed", payload);
        Ok(())
    }

    pub async fn on_session_disconnect(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().await;
        if let Some(state) = sessions.remove(session_id) {
            if let Some(cancel) = state.poller_cancel {
                cancel.cancel();
            }
            // Clear remote route registrations (SSH session is gone, so no cancel_tcpip_forward).
            for entry in &state.tunnels {
                if let Some(rc) = &entry.remote_cleanup {
                    let _ = rc.routes.lock().await.remove(&(rc.bind_host.clone(), rc.remote_port));
                }
            }
            // TunnelEntry._cancel fields dropped here → all bridges stop
        }
        drop(sessions);

        let _ = self.app.emit(
            "pf-state-changed",
            PfStatePayload {
                session_id: session_id.to_string(),
                tunnels: vec![],
                suppressed_ports: vec![],
            },
        );
    }

    /// Auto-activate port forwarding rules matching `connection_id` for a newly connected session.
    pub async fn auto_activate_rules(
        &self,
        session_id: &str,
        connection_id: &str,
        handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
        routes: RemoteRouteMap,
    ) {
        use crate::storage::config::{load_port_forwarding_rules, TunnelType as CfgTunnelType};
        let rules = load_port_forwarding_rules();
        for rule in rules {
            if rule.deleted_at.is_some() {
                continue;
            }
            if !rule.connection_ids.is_empty()
                && !rule.connection_ids.contains(&connection_id.to_string())
            {
                continue;
            }
            let origin = TunnelOrigin::Rule {
                rule_id: rule.id.clone(),
                rule_name: rule.name.clone(),
            };
            let result = match rule.tunnel_type {
                CfgTunnelType::Local => {
                    self.open_local_tunnel(
                        session_id,
                        Arc::clone(&handle),
                        rule.local_port,
                        rule.remote_port,
                        rule.remote_host.clone(),
                        origin,
                    )
                    .await
                    .map(|_| ())
                }
                CfgTunnelType::Remote => {
                    self.open_remote_tunnel(
                        session_id,
                        Arc::clone(&handle),
                        Arc::clone(&routes),
                        rule.bind_host.clone(),
                        rule.remote_port,
                        rule.target_host.clone(),
                        rule.local_port,
                        origin,
                    )
                    .await
                    .map(|_| ())
                }
                CfgTunnelType::Dynamic => {
                    self.open_dynamic_tunnel(
                        session_id,
                        Arc::clone(&handle),
                        rule.local_port,
                        origin,
                    )
                    .await
                    .map(|_| ())
                }
            };
            if let Err(e) = result {
                // Record a visible error entry for saved-rule activation failures.
                let err_tunnel = ActiveTunnel {
                    id: uuid::Uuid::new_v4().to_string(),
                    tunnel_type: rule.tunnel_type,
                    local_port: rule.local_port,
                    remote_port: rule.remote_port,
                    remote_host: rule.remote_host,
                    bind_host: Some(rule.bind_host),
                    target_host: Some(rule.target_host),
                    origin: TunnelOrigin::Rule {
                        rule_id: rule.id,
                        rule_name: rule.name,
                    },
                    state: TunnelState::Error(e.to_string()),
                    bytes_transferred: 0,
                };
                let err_entry = TunnelEntry {
                    tunnel: err_tunnel,
                    _cancel: CancellationToken::new(),
                    bytes: Arc::new(AtomicU64::new(0)),
                    remote_cleanup: None,
                };
                let mut s = self.sessions.lock().await;
                let state = s.entry(session_id.to_string()).or_insert_with(|| SessionPfState {
                    tunnels: Vec::new(),
                    auto_detect: false,
                    poller_cancel: None,
                    suppressed_ports: HashSet::new(),
                });
                state.tunnels.push(err_entry);
                drop(s);
                self.emit_state(session_id).await;
            }
        }
    }

    async fn emit_state(&self, session_id: &str) {
        let sessions = self.sessions.lock().await;
        let payload = match sessions.get(session_id) {
            Some(s) => PfStatePayload {
                session_id: session_id.to_string(),
                tunnels: s.tunnels.iter().map(snapshot_tunnel).collect(),
                suppressed_ports: s.suppressed_ports.iter().copied().collect(),
            },
            None => PfStatePayload {
                session_id: session_id.to_string(),
                tunnels: vec![],
                suppressed_ports: vec![],
            },
        };
        drop(sessions);
        let _ = self.app.emit("pf-state-changed", payload);
    }
}

fn snapshot_tunnel(entry: &TunnelEntry) -> ActiveTunnel {
    let mut t = entry.tunnel.clone();
    t.bytes_transferred = entry.bytes.load(Ordering::Relaxed);
    t
}
