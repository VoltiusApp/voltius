use crate::port_forward::tunnel::create_tunnel;
use crate::port_forward::{
    ActiveTunnel, PfStatePayload, SessionPfState, TunnelEntry, TunnelOrigin, TunnelState,
};
use crate::ssh::client::SshClient;
use crate::storage::config::TunnelType;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;
use tokio::time::{Duration, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

const POLL_INTERVAL: Duration = Duration::from_secs(2);

const IGNORED_PORTS: &[u16] = &[22, 25, 110, 143, 445, 3306, 5432];

const DETECTION_COMMANDS: &[&str] = &[
    "ss -tlnp 2>/dev/null",
    "netstat -tlnp 2>/dev/null",
    "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null",
];

#[derive(Clone, Serialize)]
pub struct PfPortDetectedPayload {
    pub session_id: String,
    pub port: u16,
    pub tunnel_local_port: u16,
}

#[derive(Clone, Serialize)]
pub struct PfPortClosedPayload {
    pub session_id: String,
    pub port: u16,
}

/// Live terminal session ids attached to a host key — used to fan state events
/// out to every terminal sharing the host.
async fn live_sessions_for_key(
    session_keys: &Arc<Mutex<HashMap<String, String>>>,
    key: &str,
) -> Vec<String> {
    let live: Vec<String> = session_keys
        .lock()
        .await
        .iter()
        .filter(|(_, v)| v.as_str() == key)
        .map(|(k, _)| k.clone())
        .collect();
    if live.is_empty() {
        vec![key.to_string()]
    } else {
        live
    }
}

pub async fn start_poller(
    pf_key: String,
    handle: Arc<russh::client::Handle<SshClient>>,
    sessions: Arc<Mutex<HashMap<String, SessionPfState>>>,
    session_keys: Arc<Mutex<HashMap<String, String>>>,
    app: AppHandle,
    cancel: CancellationToken,
) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_ports: HashSet<u16> = HashSet::new();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = interval.tick() => {
                let detected = match poll_ports(Arc::clone(&handle)).await {
                    Ok(ports) => ports,
                    Err(_) => continue,
                };
                let detected_set: HashSet<u16> = detected.into_iter().collect();

                let new_ports: Vec<u16> = detected_set.difference(&last_ports).copied().collect();
                let closed_ports: Vec<u16> = last_ports.difference(&detected_set).copied().collect();

                for port in new_ports {
                    let skip = {
                        let s = sessions.lock().await;
                        s.get(&pf_key).map(|st| {
                            // Skip if already tunneled OR user suppressed this port
                            st.tunnels.iter().any(|e| e.tunnel.remote_port == port)
                                || st.suppressed_ports.contains(&port)
                        }).unwrap_or(false)
                    };
                    if skip { continue; }

                    let cancel_t = CancellationToken::new();
                    #[allow(clippy::single_match)]
                    match create_tunnel(Arc::clone(&handle), port, port, "127.0.0.1", cancel_t.clone()).await {
                        Ok((local_port, bytes)) => {
                            let tunnel = ActiveTunnel {
                                id: uuid::Uuid::new_v4().to_string(),
                                tunnel_type: TunnelType::Local,
                                local_port,
                                remote_port: port,
                                remote_host: "127.0.0.1".to_string(),
                                bind_host: None,
                                target_host: None,
                                origin: TunnelOrigin::Auto,
                                state: TunnelState::Active,
                                bytes_transferred: 0,
                            };
                            let entry = TunnelEntry {
                                tunnel: tunnel.clone(),
                                _cancel: cancel_t,
                                bytes,
                                remote_cleanup: None,
                            };
                            let (all_tunnels, all_suppressed) = {
                                let mut s = sessions.lock().await;
                                let state = s.entry(pf_key.clone()).or_insert_with(|| SessionPfState {
                                    tunnels: Vec::new(),
                                    auto_detect: true,
                                    poller_cancel: None,
                                    suppressed_ports: std::collections::HashSet::new(),
                                    owner_session: None,
                                });
                                state.tunnels.push(entry);
                                let t = state.tunnels.iter().map(|e| e.tunnel.clone()).collect::<Vec<_>>();
                                let sp = state.suppressed_ports.iter().copied().collect::<Vec<_>>();
                                (t, sp)
                            };
                            // Fan out shared state to every terminal of this host.
                            for sid in live_sessions_for_key(&session_keys, &pf_key).await {
                                let _ = app.emit("pf-state-changed", PfStatePayload {
                                    session_id: sid,
                                    tunnels: all_tunnels.clone(),
                                    suppressed_ports: all_suppressed.clone(),
                                });
                            }
                            let _ = app.emit("pf-port-detected", PfPortDetectedPayload {
                                session_id: pf_key.clone(),
                                port,
                                tunnel_local_port: local_port,
                            });
                        }
                        Err(_) => {} // Port conflict — skip
                    }
                }

                for port in closed_ports {
                    let has_auto = {
                        let s = sessions.lock().await;
                        s.get(&pf_key)
                            .map(|st| st.tunnels.iter().any(|e| {
                                e.tunnel.remote_port == port && matches!(e.tunnel.origin, TunnelOrigin::Auto)
                            }))
                            .unwrap_or(false)
                    };
                    if has_auto {
                        for sid in live_sessions_for_key(&session_keys, &pf_key).await {
                            let _ = app.emit("pf-port-closed", PfPortClosedPayload {
                                session_id: sid,
                                port,
                            });
                        }
                    }
                }

                last_ports = detected_set;
            }
        }
    }
}

async fn poll_ports(handle: Arc<russh::client::Handle<SshClient>>) -> Result<Vec<u16>, String> {
    for cmd in DETECTION_COMMANDS {
        let channel = match handle.channel_open_session().await {
            Ok(c) => c,
            Err(_) => continue,
        };
        if channel.exec(true, *cmd).await.is_err() {
            continue;
        }

        let mut stream = channel.into_stream();
        let mut output = Vec::new();
        let timed_out = tokio::time::timeout(Duration::from_secs(5), async {
            let mut buf = [0u8; 65536];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => output.extend_from_slice(&buf[..n]),
                }
            }
        })
        .await
        .is_err();

        if timed_out || output.is_empty() {
            continue;
        }

        let text = String::from_utf8_lossy(&output);
        let ports = parse_for_cmd(cmd, &text);
        let filtered: Vec<u16> = ports
            .into_iter()
            .filter(|p| !IGNORED_PORTS.contains(p))
            .collect();
        return Ok(filtered);
    }
    Ok(vec![])
}

fn parse_for_cmd(cmd: &str, output: &str) -> Vec<u16> {
    if cmd.starts_with("ss") {
        parse_ss(output)
    } else if cmd.starts_with("netstat") {
        parse_netstat(output)
    } else {
        parse_proc_net_tcp(output)
    }
}

fn parse_ss(output: &str) -> Vec<u16> {
    // ss uses: 127.0.0.1:PORT, 0.0.0.0:PORT, *:PORT (any IPv4), [::1]:PORT, [::]:PORT (any IPv6)
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            line.split_whitespace().find_map(|col| {
                if col.starts_with("127.0.0.1:")
                    || col.starts_with("0.0.0.0:")
                    || col.starts_with("*:")
                    || col.starts_with("[::1]:")
                    || col.starts_with("[::]:")
                {
                    col.rsplit_once(':')
                        .and_then(|(_, p)| p.parse::<u16>().ok())
                } else {
                    None
                }
            })
        })
        .collect()
}

fn parse_netstat(output: &str) -> Vec<u16> {
    // Proto Recv-Q Send-Q Local Foreign State PID/Program
    // Local can be: 127.0.0.1:PORT, 0.0.0.0:PORT, :::PORT (IPv6 any)
    output
        .lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 6 {
                return None;
            }
            if cols[5] != "LISTEN" {
                return None;
            }
            let local = cols[3];
            if !local.starts_with("127.0.0.1:")
                && !local.starts_with("0.0.0.0:")
                && !local.starts_with("::1:")
                && !local.starts_with(":::")
            {
                return None;
            }
            local
                .rsplit_once(':')
                .and_then(|(_, p)| p.parse::<u16>().ok())
        })
        .collect()
}

fn parse_proc_net_tcp(output: &str) -> Vec<u16> {
    // sl  local_address  rem_address  st  ...
    // 0A = LISTEN, local_address = HEX_IP:HEX_PORT (little-endian)
    // IPv4: 0100007F = 127.0.0.1, 00000000 = 0.0.0.0
    // IPv6: 00000000000000000000000001000000 = ::1, 00000000000000000000000000000000 = ::
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.get(3)? != &"0A" {
                return None;
            }
            let local = cols.get(1)?;
            let (addr_hex, port_hex) = local.split_once(':')?;
            let is_local_or_any = matches!(
                addr_hex,
                "0100007F"
                    | "00000000"
                    | "00000000000000000000000001000000"
                    | "00000000000000000000000000000000"
            );
            if !is_local_or_any {
                return None;
            }
            u16::from_str_radix(port_hex, 16).ok()
        })
        .collect()
}
