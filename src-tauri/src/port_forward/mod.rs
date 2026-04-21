pub mod poller;
pub mod tunnel;

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
    pub local_port: u16,
    pub remote_port: u16,
    pub remote_host: String,
    pub origin: TunnelOrigin,
    pub state: TunnelState,
    #[serde(default)]
    pub bytes_transferred: u64,
}

/// Internal tunnel entry — wraps `ActiveTunnel` with its cancellation token and bytes counter.
pub(crate) struct TunnelEntry {
    pub(crate) tunnel: ActiveTunnel,
    pub(crate) _cancel: CancellationToken,
    pub(crate) bytes: Arc<AtomicU64>,
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
}

impl std::fmt::Display for ForwardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PortInUse(port, attempts) => write!(f, "Port {port} already in use after {attempts} attempts"),
            Self::Io(e) => write!(f, "IO error: {e}"),
        }
    }
}

impl From<std::io::Error> for ForwardError {
    fn from(e: std::io::Error) -> Self { Self::Io(e) }
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
            None => PfSessionState { tunnels: vec![], suppressed_ports: vec![] },
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
        sessions.get(session_id).map(|s| s.auto_detect).unwrap_or(false)
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

        if enabled == state.auto_detect { return Ok(()); }

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
        self.open_tunnel(session_id, handle, port, port, "127.0.0.1".into(), TunnelOrigin::Auto).await
    }

    pub async fn open_tunnel(
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
            local_port: bound_port,
            remote_port,
            remote_host,
            origin,
            state: TunnelState::Active,
            bytes_transferred: 0,
        };

        let entry = TunnelEntry {
            tunnel: tunnel.clone(),
            _cancel: cancel,
            bytes,
        };

        {
            let mut sessions = self.sessions.lock().await;
            let state = sessions.entry(session_id.to_string()).or_insert_with(|| SessionPfState {
                tunnels: Vec::new(),
                auto_detect: false,
                poller_cancel: None,
                suppressed_ports: HashSet::new(),
            });
            // Un-suppress this port if user is manually re-enabling it
            state.suppressed_ports.remove(&remote_port);
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

        // Suppress auto-detected ports so the poller doesn't immediately re-open them
        if matches!(state.tunnels[pos].tunnel.origin, TunnelOrigin::Auto) {
            state.suppressed_ports.insert(state.tunnels[pos].tunnel.remote_port);
        }

        // Drop entry — CancellationToken cancels all bridges
        state.tunnels.remove(pos);

        let payload = PfStatePayload {
            session_id: session_id.to_string(),
            tunnels: state.tunnels.iter().map(snapshot_tunnel).collect(),
            suppressed_ports: state.suppressed_ports.iter().copied().collect(),
        };
        drop(sessions);

        let _ = self.app.emit("pf-state-changed", payload);
        Ok(())
    }

    pub async fn on_session_disconnect(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().await;
        if let Some(state) = sessions.remove(session_id) {
            if let Some(cancel) = state.poller_cancel {
                cancel.cancel();
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
    /// Rules with empty `connection_ids` are global and always activated.
    pub async fn auto_activate_rules(
        &self,
        session_id: &str,
        connection_id: &str,
        handle: Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
    ) {
        use crate::storage::config::load_port_forwarding_rules;
        let rules = load_port_forwarding_rules();
        for rule in rules {
            if rule.deleted_at.is_some() { continue; }
            // Skip scoped rules that don't include this connection
            if !rule.connection_ids.is_empty()
                && !rule.connection_ids.contains(&connection_id.to_string())
            {
                continue;
            }
            let _ = self.open_tunnel(
                session_id,
                Arc::clone(&handle),
                rule.local_port,
                rule.remote_port,
                rule.remote_host.clone(),
                TunnelOrigin::Rule { rule_id: rule.id, rule_name: rule.name },
            ).await;
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

/// Read live bytes from the atomic counter into the tunnel snapshot.
fn snapshot_tunnel(entry: &TunnelEntry) -> ActiveTunnel {
    let mut t = entry.tunnel.clone();
    t.bytes_transferred = entry.bytes.load(Ordering::Relaxed);
    t
}
