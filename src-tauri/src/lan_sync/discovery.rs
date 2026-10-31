use super::lock;
use mdns_sd::{DaemonEvent, Receiver, ServiceDaemon, ServiceEvent, ServiceInfo, TxtProperties};
use rand::Rng;
use std::collections::{HashMap, VecDeque};
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use tokio::task::JoinHandle;

pub const SERVICE_TYPE: &str = "_voltius._tcp.local.";
pub const ROTATE_EVERY: Duration = Duration::from_secs(15 * 60);
const OWN_NAMES_KEPT: usize = 2;
const MDNS_GROUP: (Ipv4Addr, u16) = (Ipv4Addr::new(224, 0, 0, 251), 5353);
const OVERHEAR_EVERY: Duration = Duration::from_secs(30);
const OVERHEAR_READ: Duration = Duration::from_secs(1);

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

pub fn txt_properties(pairable: bool) -> Vec<(&'static str, &'static str)> {
    let mut txt = vec![("v", "1")];
    if pairable {
        txt.push(("p", "1"));
    }
    txt
}

fn is_pairable(txt: &TxtProperties) -> bool {
    txt.get_property_val_str("p") == Some("1")
}

#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub addr: SocketAddr,
    pub instance: String,
    pub pairable: bool,
}

impl Found {
    fn each<'a>(
        instance: &'a str,
        addrs: impl IntoIterator<Item = SocketAddr> + 'a,
        pairable: bool,
    ) -> impl Iterator<Item = Found> + 'a {
        addrs.into_iter().map(move |addr| Found {
            addr,
            instance: instance.to_string(),
            pairable,
        })
    }
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
type Pairable = Arc<Mutex<Option<String>>>;

// Resolved events fire only when a record changes, so a peer's open window is remembered, not re-announced.
#[derive(Default)]
struct Sightings(HashMap<String, Vec<SocketAddr>>);

impl Sightings {
    fn resolved(&mut self, instance: &str, addrs: &[SocketAddr], pairable: bool) {
        if pairable {
            self.0.insert(instance.to_string(), addrs.to_vec());
        } else {
            self.0.remove(instance);
        }
    }

    fn removed(&mut self, instance: &str) {
        self.0.remove(instance);
    }

    fn pairable(&self) -> Vec<Found> {
        self.0
            .iter()
            .flat_map(|(instance, addrs)| Found::each(instance, addrs.iter().copied(), true))
            .collect()
    }
}

pub trait Advertiser: Send {
    fn set_pairable(&self, on: bool) -> Result<Option<String>, DiscoveryError>;
    fn pairable_peers(&self) -> Vec<Found>;
}

fn service_info(port: u16, name: &str, pairable: bool) -> Result<ServiceInfo, DiscoveryError> {
    ServiceInfo::new(
        SERVICE_TYPE,
        name,
        &format!("{name}.local."),
        (),
        port,
        &txt_properties(pairable)[..],
    )
    .map(ServiceInfo::enable_addr_auto)
    .map_err(|e| map_mdns_error(&e))
}

fn register_instance(
    daemon: &ServiceDaemon,
    port: u16,
    pairable: bool,
) -> Result<String, DiscoveryError> {
    let info = service_info(port, &instance_name(), pairable)?;
    let fullname = info.get_fullname().to_string();
    daemon.register(info).map_err(|e| map_mdns_error(&e))?;
    Ok(fullname)
}

pub struct Discovery {
    daemon: ServiceDaemon,
    port: Option<u16>,
    own: OwnNames,
    pairable: Pairable,
    seen: Arc<Mutex<Sightings>>,
    tasks: Vec<JoinHandle<()>>,
}

struct Sink {
    own: OwnNames,
    pairable: Pairable,
    seen: Arc<Mutex<Sightings>>,
    found: Sender<Found>,
}

impl Sink {
    async fn take(&self, event: ServiceEvent) -> bool {
        let service = match event {
            ServiceEvent::ServiceResolved(service) => service,
            ServiceEvent::ServiceRemoved(_, instance) => {
                lock(&self.seen).removed(&instance);
                return true;
            }
            _ => return true,
        };
        let instance = service.get_fullname();
        let ours = lock_names(&self.own).iter().any(|n| n == instance)
            || lock(&self.pairable).as_deref() == Some(instance);
        if ours {
            return true;
        }
        let is_open = is_pairable(service.get_properties());
        let addrs: Vec<SocketAddr> = service
            .get_addresses()
            .iter()
            .map(|ip| SocketAddr::new(ip.to_ip_addr(), service.get_port()))
            .collect();
        lock(&self.seen).resolved(instance, &addrs, is_open);
        for found_one in Found::each(instance, addrs, is_open) {
            if self.found.send(found_one).await.is_err() {
                return false;
            }
        }
        true
    }
}

async fn listen(events: Receiver<ServiceEvent>, sink: Sink) {
    while let Ok(event) = events.recv_async().await {
        if !sink.take(event).await {
            return;
        }
    }
}

// Reads only what others announced; ending each read before the next keeps the daemon from refreshing it.
async fn overhear(daemon: ServiceDaemon, sink: Sink) {
    let mut ticker = tokio::time::interval(OVERHEAR_EVERY);
    loop {
        ticker.tick().await;
        let Ok(events) = daemon.browse_cache(SERVICE_TYPE) else {
            continue;
        };
        while let Ok(Ok(event)) = tokio::time::timeout(OVERHEAR_READ, events.recv_async()).await {
            if matches!(event, ServiceEvent::SearchStopped(_)) {
                break;
            }
            if !sink.take(event).await {
                return;
            }
        }
        let _ = daemon.stop_browse(SERVICE_TYPE);
    }
}

/// Without a port nothing is registered and no query is sent: the device only overhears announcements.
pub fn start(
    port: Option<u16>,
    found: Sender<Found>,
    errors: Sender<DiscoveryError>,
) -> Result<Discovery, DiscoveryError> {
    let daemon = ServiceDaemon::new().map_err(|e| map_mdns_error(&e))?;
    let first = port
        .map(|port| register_instance(&daemon, port, false))
        .transpose()?;
    let own: OwnNames = Arc::new(Mutex::new(first.into_iter().collect()));
    let pairable = Pairable::default();
    let seen = Arc::new(Mutex::new(Sightings::default()));
    let sink = Sink {
        own: own.clone(),
        pairable: pairable.clone(),
        seen: seen.clone(),
        found,
    };
    let monitor = daemon.monitor().map_err(|e| map_mdns_error(&e))?;
    let browse = match port {
        Some(_) => {
            let events = daemon
                .browse(SERVICE_TYPE)
                .map_err(|e| map_mdns_error(&e))?;
            tokio::spawn(listen(events, sink))
        }
        None => {
            daemon
                .accept_unsolicited(true)
                .map_err(|e| map_mdns_error(&e))?;
            tokio::spawn(overhear(daemon.clone(), sink))
        }
    };

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

    let rotate = port.map(|port| {
        let daemon = daemon.clone();
        let own = own.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(ROTATE_EVERY);
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let fresh = match register_instance(&daemon, port, false) {
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
    });

    Ok(Discovery {
        daemon,
        port,
        own,
        pairable,
        seen,
        tasks: [Some(browse), rotate, Some(watch)]
            .into_iter()
            .flatten()
            .collect(),
    })
}

impl Advertiser for Discovery {
    // Each opening registers a fresh random instance so a pairing window is never linkable to the device.
    fn set_pairable(&self, on: bool) -> Result<Option<String>, DiscoveryError> {
        let mut pairable = lock(&self.pairable);
        if let Some(old) = pairable.take() {
            let _ = self.daemon.unregister(&old);
        }
        if let Some(port) = self.port.filter(|_| on) {
            *pairable = Some(register_instance(&self.daemon, port, true)?);
        }
        Ok(pairable.clone())
    }

    fn pairable_peers(&self) -> Vec<Found> {
        lock(&self.seen).pairable()
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
        let current = lock_names(&self.own).back().cloned();
        for name in current.iter().chain(lock(&self.pairable).iter()) {
            let _ = self.daemon.unregister(name);
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
        assert_eq!(txt_properties(false), vec![("v", "1")]);
    }

    #[test]
    fn sightings_keep_open_windows_until_they_close() {
        let addr = |i: u8| SocketAddr::from(([10, 0, 0, i], 1));
        let mut seen = Sightings::default();
        seen.resolved("a", &[addr(1), addr(2)], true);
        seen.resolved("b", &[addr(3)], false);
        seen.resolved("c", &[addr(4)], true);
        let mut peers: Vec<(String, SocketAddr)> = seen
            .pairable()
            .into_iter()
            .map(|f| (f.instance, f.addr))
            .collect();
        peers.sort();
        assert_eq!(
            peers,
            [
                ("a".into(), addr(1)),
                ("a".into(), addr(2)),
                ("c".into(), addr(4))
            ]
        );
        seen.removed("a");
        seen.resolved("c", &[addr(4)], false);
        assert!(seen.pairable().is_empty());
    }

    #[test]
    fn pairable_instance_is_separate() {
        let normal = service_info(4242, &instance_name(), false).unwrap();
        let pairable = service_info(4242, &instance_name(), true).unwrap();
        assert_ne!(normal.get_fullname(), pairable.get_fullname());
        assert_eq!(pairable.get_property_val_str("p"), Some("1"));
        assert!(is_pairable(pairable.get_properties()));
        assert!(normal.get_property("p").is_none());
        assert!(!is_pairable(normal.get_properties()));
        assert_eq!(pairable.get_properties().len(), 2);
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
    async fn browsing_only_registers_nothing() {
        let (found, _found_rx) = tokio::sync::mpsc::channel(4);
        let (errors, _errors_rx) = tokio::sync::mpsc::channel(4);
        if let Ok(discovery) = start(None, found, errors) {
            assert!(lock_names(&discovery.own).is_empty());
            assert_eq!(discovery.tasks.len(), 2);
            assert_eq!(discovery.set_pairable(true).unwrap(), None);
        }
    }

    #[tokio::test]
    async fn without_a_port_no_query_is_ever_sent() {
        let (found, _found_rx) = tokio::sync::mpsc::channel(4);
        let (errors, _errors_rx) = tokio::sync::mpsc::channel(4);
        let Ok(discovery) = start(None, found, errors) else {
            return;
        };
        tokio::time::sleep(Duration::from_millis(300)).await;
        let metrics = discovery.daemon.get_metrics().unwrap();
        let metrics = metrics.recv_async().await.unwrap();
        let asked = ["browse", "cache-refresh-ptr", "cache-refresh-srv-txt"];
        let sent: i64 = asked.iter().filter_map(|k| metrics.get(*k)).sum();
        assert_eq!(sent, 0, "{metrics:?}");
    }

    #[tokio::test]
    async fn start_and_drop_do_not_panic() {
        let (found, _found_rx) = tokio::sync::mpsc::channel(4);
        let (errors, _errors_rx) = tokio::sync::mpsc::channel(4);
        if let Ok(discovery) = start(Some(4242), found, errors) {
            let own = lock_names(&discovery.own).back().cloned();
            let pairable = discovery.set_pairable(true).unwrap();
            assert!(pairable.is_some() && pairable != own);
            assert_ne!(discovery.set_pairable(true).unwrap(), pairable);
            assert_eq!(discovery.set_pairable(false).unwrap(), None);
            drop(discovery);
        }
    }
}
