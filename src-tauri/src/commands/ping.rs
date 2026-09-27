use crate::known_hosts::KnownHostsStore;
use crate::proxy::ProxySpec;
use crate::ssh::client::{chain_jumps, JumpHostConnect};
use crate::ssh::session::SessionManager;
use russh::client;
use std::sync::Arc;
use std::time::Duration;

#[tauri::command]
pub async fn ping_host(host: String, port: u16, proxy: Option<ProxySpec>) -> Option<u32> {
    let limit = if matches!(proxy, None | Some(ProxySpec::Direct)) {
        1500
    } else {
        5000
    };
    let start = std::time::Instant::now();
    tokio::time::timeout(
        Duration::from_millis(limit),
        crate::proxy::dial(proxy.as_ref(), &host, port),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .map(|_| start.elapsed().as_millis() as u32)
}

#[tauri::command]
pub async fn ping_host_via_jumps(
    host: String,
    port: u16,
    jump_hosts: Vec<JumpHostConnect>,
    known_hosts: tauri::State<'_, Arc<KnownHostsStore>>,
    proxy: Option<ProxySpec>,
) -> Result<Option<u32>, ()> {
    let kh = Arc::clone(&*known_hosts);
    let start = std::time::Instant::now();
    let reachable = tokio::time::timeout(
        Duration::from_secs(8),
        ping_via_chain(host, port, jump_hosts, kh, proxy),
    )
    .await
    .unwrap_or(false);
    Ok(reachable.then(|| start.elapsed().as_millis() as u32))
}

async fn ping_via_chain(
    host: String,
    port: u16,
    jump_hosts: Vec<JumpHostConnect>,
    known_hosts: Arc<KnownHostsStore>,
    proxy: Option<ProxySpec>,
) -> bool {
    let config = Arc::new(client::Config::default());

    // No jumps — plain TCP (or proxied)
    if jump_hosts.is_empty() {
        return crate::proxy::dial(proxy.as_ref(), &host, port)
            .await
            .is_ok();
    }

    let first = &jump_hosts[0];
    let Ok((mut current, _)) = first
        .connect_first(&config, proxy.as_ref(), &known_hosts, 1)
        .await
    else {
        return false;
    };
    if first.authenticate(&mut current).await.is_err() {
        return false;
    }
    let Ok((current, _passed)) =
        chain_jumps(current, &jump_hosts[1..], &config, &known_hosts, |_| {}).await
    else {
        return false;
    };

    // Probe the final host via direct-tcpip — success means it's reachable
    current
        .channel_open_direct_tcpip(host.as_str(), port as u32, "127.0.0.1", 0)
        .await
        .is_ok()
}

#[tauri::command]
pub async fn ping_session(
    session_id: String,
    sessions: tauri::State<'_, SessionManager>,
) -> Result<Option<u32>, ()> {
    Ok(sessions.ping(&session_id).await)
}
