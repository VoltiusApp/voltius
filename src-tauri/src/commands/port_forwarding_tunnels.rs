use crate::port_forward::{ActiveTunnel, PfSessionState, PortForwardManager, TunnelOrigin};
use crate::ssh::session::SessionManager;

#[tauri::command]
pub async fn pf_get_state(
    pf: tauri::State<'_, PortForwardManager>,
    session_id: String,
) -> Result<PfSessionState, String> {
    Ok(pf.get_session_state(&session_id).await)
}

#[tauri::command]
pub async fn pf_tunnel_list(
    pf: tauri::State<'_, PortForwardManager>,
    session_id: String,
) -> Result<Vec<ActiveTunnel>, String> {
    Ok(pf.list_tunnels(&session_id).await)
}

#[tauri::command]
pub async fn pf_tunnel_open(
    state: tauri::State<'_, SessionManager>,
    pf: tauri::State<'_, PortForwardManager>,
    session_id: String,
    local_port: u16,
    remote_port: u16,
    remote_host: Option<String>,
    rule_id: Option<String>,
    rule_name: Option<String>,
) -> Result<ActiveTunnel, String> {
    let handle = state.get_handle(&session_id).await?;
    let host = remote_host.unwrap_or_else(|| "127.0.0.1".to_string());

    let origin = match rule_id {
        Some(rid) => TunnelOrigin::Rule {
            rule_id: rid,
            rule_name: rule_name.unwrap_or_default(),
        },
        None => TunnelOrigin::AdHoc,
    };

    pf.open_tunnel(&session_id, handle, local_port, remote_port, host, origin)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pf_tunnel_close(
    pf: tauri::State<'_, PortForwardManager>,
    session_id: String,
    tunnel_id: String,
) -> Result<(), String> {
    pf.close_tunnel(&session_id, &tunnel_id).await
}

/// Re-open a previously suppressed auto port — preserves TunnelOrigin::Auto.
#[tauri::command]
pub async fn pf_tunnel_resume_auto(
    state: tauri::State<'_, SessionManager>,
    pf: tauri::State<'_, PortForwardManager>,
    session_id: String,
    port: u16,
) -> Result<ActiveTunnel, String> {
    let handle = state.get_handle(&session_id).await?;
    pf.resume_auto_port(&session_id, handle, port)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pf_tunnel_get_auto(
    pf: tauri::State<'_, PortForwardManager>,
    session_id: String,
) -> Result<bool, String> {
    Ok(pf.get_auto_detect(&session_id).await)
}

#[tauri::command]
pub async fn pf_tunnel_set_auto(
    state: tauri::State<'_, SessionManager>,
    pf: tauri::State<'_, PortForwardManager>,
    session_id: String,
    enabled: bool,
) -> Result<(), String> {
    let handle = state.get_handle(&session_id).await?;
    pf.set_auto_detect(&session_id, enabled, handle).await
}
