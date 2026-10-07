use crate::known_hosts::KnownHostsStore;
use crate::proxy::ProxySpec;
use crate::ssh::client::{chain_jumps, HopRoute, JumpHostConnect};
use crate::ssh::session::SessionManager;
use russh::client;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PingOutcome {
    Up(u32),
    Down,
    KnockClosed,
}

impl PingOutcome {
    fn from_latency(ms: Option<u32>) -> Self {
        ms.map_or(Self::Down, Self::Up)
    }
}

#[tauri::command]
pub async fn ping_host(
    host: String,
    port: u16,
    proxy: Option<ProxySpec>,
    knock_window_secs: Option<u64>,
) -> PingOutcome {
    if crate::knock::closed(&host, port, knock_window_secs) {
        return PingOutcome::KnockClosed;
    }
    PingOutcome::from_latency(probe(&host, port, proxy.as_ref()).await)
}

async fn probe(host: &str, port: u16, proxy: Option<&ProxySpec>) -> Option<u32> {
    let limit = if matches!(proxy, None | Some(&ProxySpec::Direct)) {
        1500
    } else {
        5000
    };
    let start = std::time::Instant::now();
    tokio::time::timeout(
        Duration::from_millis(limit),
        crate::proxy::dial(proxy, host, port),
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
    knock_window_secs: Option<u64>,
) -> Result<PingOutcome, ()> {
    let gate = jump_hosts
        .first()
        .map_or((host.as_str(), port), |j| (j.host.as_str(), j.port));
    if crate::knock::closed(gate.0, gate.1, knock_window_secs) {
        return Ok(PingOutcome::KnockClosed);
    }
    let kh = Arc::clone(&*known_hosts);
    let start = std::time::Instant::now();
    let reachable = tokio::time::timeout(
        Duration::from_secs(8),
        ping_via_chain(host, port, jump_hosts, kh, proxy),
    )
    .await
    .unwrap_or(false);
    Ok(PingOutcome::from_latency(
        reachable.then(|| start.elapsed().as_millis() as u32),
    ))
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
        .connect_first(&config, &HopRoute { proxy, knock: None }, &known_hosts, 1)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knock::KnockSpec;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn gated_host_outside_its_window_is_not_dialed() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let out = ping_host("localhost".into(), port, None, Some(60)).await;
        assert!(matches!(out, PingOutcome::KnockClosed));
        assert!(tokio::time::timeout(Duration::from_millis(100), l.accept())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn gated_host_inside_its_window_is_probed() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let spec = KnockSpec {
            steps: vec![],
            delay_ms: 0,
            settle_ms: 0,
        };
        crate::knock::knock(&spec, None, "127.0.0.1", port)
            .await
            .unwrap();
        let out = ping_host("127.0.0.1".into(), port, None, Some(60)).await;
        assert!(matches!(out, PingOutcome::Up(_)));
    }

    #[tokio::test]
    async fn ungated_host_probes_as_before() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        assert!(matches!(
            ping_host("127.0.0.1".into(), port, None, None).await,
            PingOutcome::Up(_)
        ));
    }

    #[test]
    fn outcome_wire_shape() {
        assert_eq!(
            serde_json::to_string(&PingOutcome::Up(12)).unwrap(),
            r#"{"up":12}"#
        );
        assert_eq!(
            serde_json::to_string(&PingOutcome::KnockClosed).unwrap(),
            r#""knock_closed""#
        );
    }
}
