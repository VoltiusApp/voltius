use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use rand::Rng;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use tokio::task::JoinHandle;

pub const SERVICE_TYPE: &str = "_voltius._tcp.local.";
pub const ROTATE_EVERY: Duration = Duration::from_secs(15 * 60);
const OWN_NAMES_KEPT: usize = 2;

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

const EHOSTUNREACH_MACOS: i32 = 65;

pub fn instance_name() -> String {
    format!("{:016x}", rand::thread_rng().gen::<u64>())
}

pub fn txt_properties() -> Vec<(&'static str, &'static str)> {
    vec![("v", "1")]
}

fn map_error(e: &std::io::Error) -> DiscoveryError {
    if e.kind() == std::io::ErrorKind::PermissionDenied
        || e.raw_os_error() == Some(EHOSTUNREACH_MACOS)
    {
        DiscoveryError::Blocked
    } else {
        DiscoveryError::Other(e.to_string())
    }
}

fn map_mdns_error(e: &mdns_sd::Error) -> DiscoveryError {
    let text = e.to_string();
    if [
        "No route to host",
        "Permission denied",
        "Operation not permitted",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        DiscoveryError::Blocked
    } else {
        DiscoveryError::Other(text)
    }
}

type OwnNames = Arc<Mutex<Vec<String>>>;

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
    tasks: [JoinHandle<()>; 2],
}

pub fn start(port: u16, found: Sender<SocketAddr>) -> Result<Discovery, DiscoveryError> {
    let daemon = ServiceDaemon::new().map_err(|e| map_mdns_error(&e))?;
    let first = register_instance(&daemon, port, &instance_name())?;
    let own: OwnNames = Arc::new(Mutex::new(vec![first]));
    let events = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| map_mdns_error(&e))?;

    let browse = {
        let own = own.clone();
        tokio::spawn(async move {
            while let Ok(event) = events.recv_async().await {
                let ServiceEvent::ServiceResolved(service) = event else {
                    continue;
                };
                if own
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|n| n == service.get_fullname())
                {
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
                let Ok(fresh) = register_instance(&daemon, port, &instance_name()) else {
                    continue;
                };
                let old = {
                    let mut names = own.lock().unwrap();
                    let old = names.last().cloned();
                    names.push(fresh);
                    let excess = names.len().saturating_sub(OWN_NAMES_KEPT);
                    names.drain(..excess);
                    old
                };
                if let Some(old) = old {
                    let _ = daemon.unregister(&old);
                }
            }
        })
    };

    Ok(Discovery {
        daemon,
        own,
        tasks: [browse, rotate],
    })
}

impl Drop for Discovery {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
        if let Some(current) = self.own.lock().unwrap().last() {
            let _ = self.daemon.unregister(current);
        }
        let _ = self.daemon.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind};

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
    fn permission_denied_and_macos_unreachable_are_blocked() {
        assert_eq!(
            map_error(&Error::from(ErrorKind::PermissionDenied)),
            DiscoveryError::Blocked
        );
        assert_eq!(
            map_error(&Error::from_raw_os_error(65)),
            DiscoveryError::Blocked
        );
    }

    #[test]
    fn other_errors_keep_their_message() {
        let e = Error::new(ErrorKind::AddrInUse, "in use");
        assert_eq!(map_error(&e), DiscoveryError::Other(e.to_string()));
    }
}
