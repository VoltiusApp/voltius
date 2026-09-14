use crate::port_forward::tunnel::create_tunnel;
use crate::port_forward::{
    cancel_entry, emit_state_for, event_targets_for_key, ActiveTunnel, SessionPfState, TunnelEntry,
    TunnelOrigin, TunnelState,
};
use crate::ssh::live_cells::read_cell;
use crate::ssh::session::SessionHandle;
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

/// Auto-forwards a host may hold before detection backs off. A remote churning
/// through ports would otherwise forward every one it ever opened.
const AUTO_FORWARD_CAP: usize = 20;

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

#[derive(Clone, Serialize)]
pub struct PfAutoForwardCappedPayload {
    pub session_id: String,
    pub cap: usize,
}

pub async fn start_poller(
    pf_key: String,
    handle: SessionHandle,
    sessions: Arc<Mutex<HashMap<String, SessionPfState>>>,
    session_keys: Arc<Mutex<HashMap<String, String>>>,
    app: AppHandle,
    cancel: CancellationToken,
) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_ports: HashSet<u16> = HashSet::new();
    let mut capped_notified = false;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = interval.tick() => {
                let detected = match poll_ports(Arc::clone(&handle)).await {
                    Ok(ports) => ports,
                    Err(_) => continue,
                };
                let detected_set: HashSet<u16> = detected.into_iter().collect();
                let liveness_changed = detected_set != last_ports;
                {
                    let mut s = sessions.lock().await;
                    let state = s.entry(pf_key.clone()).or_insert_with(|| SessionPfState::new(None, true));
                    state.detected_ports = Some(detected_set.clone());
                }

                let mut opened = 0usize;
                let new_ports: Vec<u16> = detected_set
                    .difference(&last_ports)
                    .copied()
                    .filter(|p| is_forwardable(*p))
                    .collect();
                let closed_ports: Vec<u16> = last_ports.difference(&detected_set).copied().collect();

                let auto_count = {
                    let s = sessions.lock().await;
                    s.get(&pf_key).map(auto_tunnel_count).unwrap_or(0)
                };
                if auto_count < AUTO_FORWARD_CAP {
                    capped_notified = false;
                }

                for port in new_ports {
                    if auto_count + opened >= AUTO_FORWARD_CAP {
                        if !capped_notified {
                            capped_notified = true;
                            for sid in event_targets_for_key(&session_keys, &pf_key).await {
                                let _ = app.emit("pf-auto-forward-capped", PfAutoForwardCappedPayload {
                                    session_id: sid,
                                    cap: AUTO_FORWARD_CAP,
                                });
                            }
                        }
                        break;
                    }
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
                                remote_listening: None,
                            };
                            let entry = TunnelEntry {
                                tunnel: tunnel.clone(),
                                _cancel: cancel_t.clone(),
                                bytes,
                                remote_cleanup: None,
                            };
                            // Re-check under the lock: the skip test above ran before
                            // the await, so a rebind's poller can have tunneled it since.
                            let added = {
                                let mut s = sessions.lock().await;
                                let state = s.entry(pf_key.clone()).or_insert_with(|| SessionPfState::new(None, true));
                                let dup = state.tunnels.iter().any(|e| e.tunnel.remote_port == port);
                                if !dup {
                                    state.tunnels.push(entry);
                                }
                                !dup
                            };
                            if !added {
                                cancel_t.cancel();
                                continue;
                            }
                            opened += 1;
                            emit_state_for(&sessions, &session_keys, &app, &pf_key).await;
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
                    // Reap the tunnel, don't just announce it: nothing else removes
                    // an auto entry, so every port ever seen used to pile up.
                    let reaped = {
                        let mut s = sessions.lock().await;
                        match s.get_mut(&pf_key) {
                            Some(st) => take_auto_tunnels(st, port),
                            None => Vec::new(),
                        }
                    };
                    if reaped.is_empty() { continue; }
                    for entry in &reaped {
                        cancel_entry(entry);
                    }
                    for sid in event_targets_for_key(&session_keys, &pf_key).await {
                        let _ = app.emit("pf-port-closed", PfPortClosedPayload {
                            session_id: sid,
                            port,
                        });
                    }
                    emit_state_for(&sessions, &session_keys, &app, &pf_key).await;
                }

                if liveness_changed {
                    emit_state_for(&sessions, &session_keys, &app, &pf_key).await;
                }

                last_ports = detected_set;
            }
        }
    }
}

async fn poll_ports(handle: SessionHandle) -> Result<Vec<u16>, String> {
    // Re-read each poll so the probe follows the session across a reconnect.
    let handle = read_cell(&handle);
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

        // Raw: IGNORED_PORTS gates auto-forwarding only, not liveness.
        return Ok(parse_for_cmd(cmd, &String::from_utf8_lossy(&output)));
    }
    // Not "nothing is listening": no probe ran. Reporting an empty set here would
    // reap every auto tunnel on one dropped connection.
    Err("no detection command produced output".into())
}

fn is_forwardable(port: u16) -> bool {
    !IGNORED_PORTS.contains(&port)
}

fn auto_tunnel_count(state: &SessionPfState) -> usize {
    state
        .tunnels
        .iter()
        .filter(|e| matches!(e.tunnel.origin, TunnelOrigin::Auto))
        .count()
}

/// Remove a host's auto-detected tunnels for `port`, returning them for cancelling.
fn take_auto_tunnels(state: &mut SessionPfState, port: u16) -> Vec<TunnelEntry> {
    let (gone, kept): (Vec<_>, Vec<_>) =
        std::mem::take(&mut state.tunnels)
            .into_iter()
            .partition(|e| {
                e.tunnel.remote_port == port && matches!(e.tunnel.origin, TunnelOrigin::Auto)
            });
    state.tunnels = kept;
    gone
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    fn entry(port: u16, origin: TunnelOrigin) -> TunnelEntry {
        TunnelEntry {
            tunnel: ActiveTunnel {
                id: format!("{port}-{origin:?}"),
                tunnel_type: TunnelType::Local,
                local_port: port,
                remote_port: port,
                remote_host: "127.0.0.1".into(),
                bind_host: None,
                target_host: None,
                origin,
                state: TunnelState::Active,
                bytes_transferred: 0,
                remote_listening: None,
            },
            _cancel: CancellationToken::new(),
            bytes: Arc::new(AtomicU64::new(0)),
            remote_cleanup: None,
        }
    }

    /// Regression: a closed port only emitted an event nothing listened for, so
    /// every port the host ever opened left a tunnel behind for good.
    #[test]
    fn a_closed_port_drops_its_auto_tunnel() {
        let mut state = SessionPfState::new(None, true);
        state.tunnels = vec![
            entry(3000, TunnelOrigin::Auto),
            entry(8080, TunnelOrigin::Auto),
        ];

        let reaped = take_auto_tunnels(&mut state, 3000);

        assert_eq!(reaped.len(), 1);
        assert_eq!(state.tunnels.len(), 1);
        assert_eq!(state.tunnels[0].tunnel.remote_port, 8080);
    }

    /// Only auto tunnels follow the remote listener — a rule or an ad-hoc forward
    /// is the user's, and stays up even while nothing answers on the far end.
    #[test]
    fn a_closed_port_keeps_user_owned_tunnels() {
        let mut state = SessionPfState::new(None, true);
        state.tunnels = vec![
            entry(3000, TunnelOrigin::AdHoc),
            entry(
                3000,
                TunnelOrigin::Rule {
                    rule_id: "r".into(),
                    rule_name: "dev".into(),
                },
            ),
        ];

        assert!(take_auto_tunnels(&mut state, 3000).is_empty());
        assert_eq!(state.tunnels.len(), 2);
    }

    #[test]
    fn auto_detect_skips_ignored_ports() {
        assert!(is_forwardable(8080));
        assert!(is_forwardable(33826));
        assert!(!is_forwardable(22));
    }

    /// The cap counts auto tunnels only — saved rules and ad-hoc forwards are the
    /// user's own and must not push detection into backing off.
    #[test]
    fn the_cap_counts_only_auto_tunnels() {
        let mut state = SessionPfState::new(None, true);
        state.tunnels = vec![
            entry(3000, TunnelOrigin::Auto),
            entry(8080, TunnelOrigin::AdHoc),
            entry(
                9090,
                TunnelOrigin::Rule {
                    rule_id: "r".into(),
                    rule_name: "dev".into(),
                },
            ),
        ];

        assert_eq!(auto_tunnel_count(&state), 1);
    }
}
