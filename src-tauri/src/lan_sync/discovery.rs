use mdns_sd::{DaemonEvent, ServiceDaemon, ServiceEvent, ServiceInfo};
use rand::Rng;
use std::collections::VecDeque;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use tokio::task::JoinHandle;

pub const SERVICE_TYPE: &str = "_voltius._tcp.local.";
pub const ROTATE_EVERY: Duration = Duration::from_secs(15 * 60);
const OWN_NAMES_KEPT: usize = 2;
const MDNS_GROUP: (Ipv4Addr, u16) = (Ipv4Addr::new(224, 0, 0, 251), 5353);

#[derive(Debug, Clone, PartialEq)]
pub enum DiscoveryError {
    Blocked,
    Other(String),
}

impl std::fmt::Display for DiscoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Blocked => write!(f, "local network access is blocked"),
            Self::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for DiscoveryError {}

pub fn instance_name() -> String {
    format!("{:016x}", rand::thread_rng().gen::<u64>())
}

pub fn txt_properties() -> Vec<(&'static str, &'static str)> {
    vec![("v", "1")]
}

pub(crate) fn classify_mdns_error(msg: &str) -> DiscoveryError {
    const BLOCKED: [&str; 4] = [
        "No route to host",
        "os error 65",
        "Permission denied",
        "Operation not permitted",
    ];
    if BLOCKED.iter().any(|needle| msg.contains(needle)) {
        DiscoveryError::Blocked
    } else {
        DiscoveryError::Other(msg.to_string())
    }
}

fn map_mdns_error(e: &mdns_sd::Error) -> DiscoveryError {
    classify_mdns_error(&e.to_string())
}

fn probe_query() -> Vec<u8> {
    let mut packet = vec![0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    for label in SERVICE_TYPE.trim_end_matches('.').split('.') {
        packet.push(label.len() as u8);
        packet.extend_from_slice(label.as_bytes());
    }
    packet.extend_from_slice(&[0, 0, 12, 0, 1]);
    packet
}

// A denied macOS Local Network permission only shows when a datagram is sent; mdns-sd just logs it.
pub fn probe_multicast() -> std::io::Result<()> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?;
    socket.send_to(&probe_query(), MDNS_GROUP).map(drop)
}

fn lock_names(own: &OwnNames) -> std::sync::MutexGuard<'_, VecDeque<String>> {
    own.lock().unwrap_or_else(|e| e.into_inner())
}

// Keeps the previous instance too: peers may still resolve it for a while after rotation.
fn rotate_own(names: &mut VecDeque<String>, new: String) -> Option<String> {
    let previous = names.back().cloned();
    names.push_back(new);
    while names.len() > OWN_NAMES_KEPT {
        names.pop_front();
    }
    previous
}

type OwnNames = Arc<Mutex<VecDeque<String>>>;

fn register_instance(
    daemon: &ServiceDaemon,
    port: u16,
    name: &str,
) -> Result<String, DiscoveryError> {
    let info = ServiceInfo::new(
        SERVICE_TYPE,
        name,
        &format!("{name}.local."),
        (),
        port,
        &txt_properties()[..],
    )
    .map_err(|e| map_mdns_error(&e))?
    .enable_addr_auto();
    let fullname = info.get_fullname().to_string();
    daemon.register(info).map_err(|e| map_mdns_error(&e))?;
    Ok(fullname)
}

pub struct Discovery {
    daemon: ServiceDaemon,
    own: OwnNames,
    tasks: [JoinHandle<()>; 3],
}

pub fn start(
    port: u16,
    found: Sender<SocketAddr>,
    errors: Sender<DiscoveryError>,
) -> Result<Discovery, DiscoveryError> {
    let daemon = ServiceDaemon::new().map_err(|e| map_mdns_error(&e))?;
    let first = register_instance(&daemon, port, &instance_name())?;
    let own: OwnNames = Arc::new(Mutex::new(VecDeque::from([first])));
    let events = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| map_mdns_error(&e))?;
    let monitor = daemon.monitor().map_err(|e| map_mdns_error(&e))?;

    let watch = {
        let errors = errors.clone();
        tokio::spawn(async move {
            while let Ok(event) = monitor.recv_async().await {
                if let DaemonEvent::Error(e) = event {
                    if errors.send(map_mdns_error(&e)).await.is_err() {
                        return;
                    }
                }
            }
        })
    };

    let browse = {
        let own = own.clone();
        tokio::spawn(async move {
            while let Ok(event) = events.recv_async().await {
                let ServiceEvent::ServiceResolved(service) = event else {
                    continue;
                };
                if lock_names(&own).iter().any(|n| n == service.get_fullname()) {
                    continue;
                }
                for ip in service.get_addresses() {
                    let addr = SocketAddr::new(ip.to_ip_addr(), service.get_port());
                    if found.send(addr).await.is_err() {
                        return;
                    }
                }
            }
        })
    };

    let rotate = {
        let daemon = daemon.clone();
        let own = own.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(ROTATE_EVERY);
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let fresh = match register_instance(&daemon, port, &instance_name()) {
                    Ok(fresh) => fresh,
                    Err(e) => {
                        log::warn!("lan-sync: mdns re-registration failed: {e}");
                        let _ = errors.send(e).await;
                        continue;
                    }
                };
                let old = rotate_own(&mut lock_names(&own), fresh);
                if let Some(old) = old {
                    let _ = daemon.unregister(&old);
                }
            }
        })
    };

    Ok(Discovery {
        daemon,
        own,
        tasks: [browse, rotate, watch],
    })
}

impl Drop for Discovery {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
        if let Some(current) = lock_names(&self.own).back() {
            let _ = self.daemon.unregister(current);
        }
        let _ = self.daemon.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_name_is_16_lowercase_hex_and_random() {
        let a = instance_name();
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        assert_ne!(a, instance_name());
    }

    #[test]
    fn txt_is_version_only() {
        assert_eq!(txt_properties(), vec![("v", "1")]);
    }

    #[test]
    fn blocked_messages_classify_as_blocked() {
        for msg in [
            "send failed: No route to host (os error 65)",
            "Permission denied",
            "Operation not permitted (os error 1)",
            "os error 65",
        ] {
            assert_eq!(classify_mdns_error(msg), DiscoveryError::Blocked, "{msg}");
        }
    }

    #[test]
    fn other_messages_are_kept() {
        assert_eq!(
            classify_mdns_error("address in use"),
            DiscoveryError::Other("address in use".into())
        );
    }

    #[test]
    fn probe_is_a_ptr_question_for_our_service() {
        let mut expected = vec![0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
        expected.extend_from_slice(b"\x08_voltius\x04_tcp\x05local\x00");
        expected.extend_from_slice(&[0, 12, 0, 1]);
        assert_eq!(probe_query(), expected);
    }

    #[test]
    fn rotate_own_returns_previous_and_caps() {
        let mut names = VecDeque::from(["a".to_string()]);
        assert_eq!(rotate_own(&mut names, "b".into()), Some("a".into()));
        assert_eq!(names, ["a", "b"]);
        assert_eq!(rotate_own(&mut names, "c".into()), Some("b".into()));
        assert_eq!(names, ["b", "c"]);
        assert_eq!(rotate_own(&mut VecDeque::new(), "x".into()), None);
    }

    #[tokio::test]
    async fn start_and_drop_do_not_panic() {
        let (found, _found_rx) = tokio::sync::mpsc::channel(4);
        let (errors, _errors_rx) = tokio::sync::mpsc::channel(4);
        if let Ok(discovery) = start(4242, found, errors) {
            drop(discovery);
        }
    }
}
