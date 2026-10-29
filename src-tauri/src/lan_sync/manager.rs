use super::addrs;
use super::discovery::{self, classify_mdns_error, Discovery, DiscoveryError};
use super::handshake::{handshake, HandshakeError, SessionReader, SessionWriter};
use super::identity::LocalIdentity;
use super::peers::{now_secs, write_snapshot, PeerStore, PinDecision, Rejection};
use super::protocol::{Frame, Hello};
use super::route::{classify, Route};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch, Notify, OwnedSemaphorePermit, Semaphore};
use tokio::task::{AbortHandle, JoinHandle};
use tokio::time::timeout;
use zeroize::Zeroizing;

pub const PREFERRED_PORT: u16 = 47391;
const MAX_INBOUND_HANDSHAKES: usize = 16;
const MAX_OUTBOUND_HANDSHAKES: usize = 4;
const RATE_MAX: usize = 5;
const RATE_WINDOW: Duration = Duration::from_secs(10);
const DIAL_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);
const REDIAL_DELAY: Duration = Duration::from_secs(1);
const REMEMBERED: usize = 32;
const FLUSH_TIMEOUT: Duration = Duration::from_secs(2);
const CONTROL: usize = 4;
const PING_EVERY: Duration = if cfg!(test) {
    Duration::from_millis(100)
} else {
    Duration::from_secs(10)
};
const IDLE_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_secs(3)
} else {
    Duration::from_secs(30)
};
const RETRY_FIRST: Duration = if cfg!(test) {
    Duration::from_millis(200)
} else {
    Duration::from_secs(30)
};
const RETRY_MAX: Duration = if cfg!(test) {
    Duration::from_secs(1)
} else {
    Duration::from_secs(300)
};
const PROBE_EVERY: Duration = if cfg!(test) {
    Duration::from_millis(100)
} else {
    Duration::from_secs(300)
};

pub type Probe = Arc<dyn Fn() -> std::io::Result<()> + Send + Sync>;
type Save = Option<(PathBuf, Vec<u8>)>;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub route: Route,
    pub address: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LanStatus {
    #[default]
    Running,
    Paused,
    Blocked,
    Stopped,
}

#[derive(Clone, Debug)]
pub enum ManagerEvent {
    Peers(Vec<PeerInfo>),
    BlobReady {
        device_id: String,
    },
    Status(LanStatus),
    Rejected {
        device_id: String,
        reason: Rejection,
    },
}

#[derive(Default)]
struct RateLimiter {
    attempts: HashMap<IpAddr, VecDeque<Instant>>,
}

impl RateLimiter {
    fn allow(&mut self, ip: IpAddr, now: Instant) -> bool {
        self.attempts.retain(|_, hits| {
            while hits
                .front()
                .is_some_and(|t| now.duration_since(*t) >= RATE_WINDOW)
            {
                hits.pop_front();
            }
            !hits.is_empty()
        });
        let hits = self.attempts.entry(ip).or_default();
        if hits.len() >= RATE_MAX {
            return false;
        }
        hits.push_back(now);
        true
    }
}

struct Link {
    hello: Hello,
    addr: SocketAddr,
    initiator: bool,
    session_id: Vec<u8>,
    reader: SessionReader,
    writer: SessionWriter,
}

async fn bind() -> std::io::Result<TcpListener> {
    match TcpListener::bind((Ipv4Addr::UNSPECIFIED, PREFERRED_PORT)).await {
        Ok(listener) => Ok(listener),
        Err(_) => TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await,
    }
}

fn local_port(listener: &TcpListener) -> Result<u16, String> {
    listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

fn guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

async fn secure(
    stream: TcpStream,
    addr: SocketAddr,
    initiator: bool,
    shared: &Shared,
) -> Result<Link, HandshakeError> {
    let (mut session, hello) = handshake(stream, initiator, &shared.me, &shared.auth_keys)
        .await
        .inspect_err(|e| log::debug!("lan-sync: handshake with {addr} failed: {e}"))?;
    if hello.device_id != shared.me.device_id {
        if let Err(reason) = shared.admit(&hello.device_id, &hello.device_key) {
            log::debug!("lan-sync: {addr} refused: {reason:?}");
            shared.rejected(&hello.device_id, reason).await;
            let _ = session.send(&Frame::Bye).await;
            return Err(HandshakeError::Pinned(reason));
        }
    }
    let session_id = session.handshake_hash().to_vec();
    let (mut reader, mut writer) = session.split();
    reader.set_idle_timeout(IDLE_TIMEOUT);
    writer.set_write_timeout(WRITE_TIMEOUT);
    Ok(Link {
        hello,
        addr,
        initiator,
        session_id,
        reader,
        writer,
    })
}

async fn establish(
    shared: Arc<Shared>,
    stream: TcpStream,
    addr: SocketAddr,
    initiator: bool,
    _permit: OwnedSemaphorePermit,
) -> Result<(), HandshakeError> {
    let link = secure(stream, addr, initiator, &shared).await?;
    shared.adopt(link);
    Ok(())
}

async fn accept_loop(listener: TcpListener, shared: Arc<Shared>) {
    let mut limiter = RateLimiter::default();
    loop {
        let (stream, addr) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                log::warn!("lan-sync: accept failed: {e}");
                tokio::time::sleep(ACCEPT_BACKOFF).await;
                continue;
            }
        };
        if !limiter.allow(addr.ip(), Instant::now()) {
            continue;
        }
        let Ok(permit) = shared.inbound.clone().try_acquire_owned() else {
            continue;
        };
        tokio::spawn(establish(shared.clone(), stream, addr, false, permit));
    }
}

async fn dial(shared: Arc<Shared>, addr: SocketAddr, permit: OwnedSemaphorePermit) {
    let rejected = match timeout(DIAL_TIMEOUT, TcpStream::connect(addr)).await {
        Ok(Ok(stream)) => match establish(shared.clone(), stream, addr, true, permit).await {
            Ok(()) => return,
            Err(e) => matches!(
                e,
                HandshakeError::NotTrusted
                    | HandshakeError::VersionMismatch(_)
                    | HandshakeError::Pinned(_)
            ),
        },
        Ok(Err(e)) => {
            log::debug!("lan-sync: dial {addr} failed: {e}");
            false
        }
        Err(_) => {
            log::debug!("lan-sync: dial {addr} timed out");
            false
        }
    };
    shared.note_failed_dial(addr, rejected);
}

async fn recv(reader: &mut SessionReader) -> Option<Frame> {
    match reader.recv().await {
        Ok(Frame::Bye) => None,
        Ok(frame) => Some(frame),
        Err(e) => {
            log::debug!("lan-sync: peer read ended: {e}");
            None
        }
    }
}

async fn transmit(writer: &mut SessionWriter, frame: Option<&Frame>) -> bool {
    match frame {
        Some(frame) => writer.send(frame).await.is_ok(),
        None => writer.keepalive().await.is_ok(),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Rank {
    higher_initiated: bool,
    session_id: Vec<u8>,
}

type Latest = Option<Arc<Vec<u8>>>;

struct Outbox {
    blob: watch::Sender<Latest>,
    control: mpsc::Sender<Frame>,
}

impl Outbox {
    fn nudge(&self) {
        let _ = self.control.try_send(Frame::Nudge);
    }
}

struct Peer {
    info: PeerInfo,
    rank: Rank,
    conn: u64,
    adopted_at: Instant,
    outbox: Outbox,
    tasks: [AbortHandle; 2],
}

impl Drop for Peer {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Known {
    addr: SocketAddr,
    device: Option<String>,
}

#[derive(Default)]
struct State {
    peers: HashMap<String, Peer>,
    blobs: HashMap<String, Vec<u8>>,
    dialable: VecDeque<Known>,
    rejected: HashSet<(String, Rejection)>,
    next_conn: u64,
    closed: bool,
}

impl State {
    fn tag(&mut self, ip: IpAddr, id: &str) {
        for known in self.dialable.iter_mut().filter(|k| k.addr.ip() == ip) {
            known.device = Some(id.to_string());
        }
    }
}

struct Shared {
    me: LocalIdentity,
    auth_keys: Zeroizing<Vec<[u8; 32]>>,
    events: mpsc::Sender<ManagerEvent>,
    state: Mutex<State>,
    store: Mutex<PeerStore>,
    saves: watch::Sender<Save>,
    flush: Notify,
    paused: AtomicBool,
    blocked: AtomicBool,
    inbound: Arc<Semaphore>,
    outbound: Arc<Semaphore>,
    peers_changed: Notify,
    lost: Notify,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        guard(&self.state)
    }

    fn store(&self) -> MutexGuard<'_, PeerStore> {
        guard(&self.store)
    }

    // Sent under the store lock so an older snapshot can never land after a newer one.
    fn persist(&self) {
        let store = self.store();
        if let Some(save) = store.snapshot() {
            self.saves.send_replace(Some(save));
        }
    }

    fn admit(&self, device_id: &str, key: &[u8; 32]) -> Result<(), Rejection> {
        let decision = self.store().decide(device_id, key, now_secs());
        match decision {
            PinDecision::Known => Ok(()),
            PinDecision::Pinned => {
                self.persist();
                Ok(())
            }
            PinDecision::Rejected(reason) => Err(reason),
        }
    }

    async fn rejected(&self, device_id: &str, reason: Rejection) {
        if reason == Rejection::Blocked {
            return;
        }
        let first = self.lock().rejected.insert((device_id.to_string(), reason));
        if first {
            let device_id = device_id.to_string();
            let _ = self
                .events
                .send(ManagerEvent::Rejected { device_id, reason })
                .await;
        }
    }

    fn record_addrs(&self, link: &Link) {
        let mut reached = link.hello.peer_addrs();
        if link.initiator {
            reached.push(link.addr);
        }
        self.store()
            .record_addrs(&link.hello.device_id, &reached, now_secs());
        self.persist();
    }

    fn peers(&self) -> Vec<PeerInfo> {
        let mut peers: Vec<PeerInfo> = self.lock().peers.values().map(|p| p.info.clone()).collect();
        peers.sort_by(|a, b| a.device_id.cmp(&b.device_id));
        peers
    }

    fn worth_dialing(&self, addr: SocketAddr) -> bool {
        let ip = addr.ip().to_string();
        let state = self.lock();
        addr.is_ipv4() && !state.closed && !state.peers.values().any(|p| p.info.address == ip)
    }

    async fn outbound_permit(&self, wait: bool) -> Option<OwnedSemaphorePermit> {
        let permit = if wait {
            self.outbound.clone().acquire_owned().await.ok()
        } else {
            self.outbound.clone().try_acquire_owned().ok()
        };
        if permit.is_none() {
            log::debug!("lan-sync: dial refused, too many handshakes in flight");
        }
        permit
    }

    async fn dial_if_new(self: Arc<Self>, addr: SocketAddr, wait: bool) {
        if !self.worth_dialing(addr) {
            return;
        }
        let Some(permit) = self.outbound_permit(wait).await else {
            return;
        };
        if self.worth_dialing(addr) {
            dial(self, addr, permit).await;
        }
    }

    // Both ends must pick the same survivor, so the tie-break uses the shared handshake hash.
    fn rank(&self, link: &Link) -> Rank {
        let me = self.me.device_id.as_str();
        let peer = link.hello.device_id.as_str();
        Rank {
            higher_initiated: if link.initiator { me > peer } else { peer > me },
            session_id: link.session_id.clone(),
        }
    }

    // Lock order is store, then state, in adopt and forget.
    fn adopt(self: &Arc<Self>, link: Link) {
        self.record_addrs(&link);
        let rank = self.rank(&link);
        let id = link.hello.device_id.clone();
        let is_self = id == self.me.device_id;
        let store = self.store();
        if !is_self && store.get(&id).map(|r| r.device_key) != Some(link.hello.device_key) {
            return;
        }
        let mut state = self.lock();
        drop(store);
        state.tag(link.addr.ip(), &id);
        if is_self || state.closed || state.peers.get(&id).is_some_and(|p| p.rank <= rank) {
            return;
        }
        state.next_conn += 1;
        let conn = state.next_conn;
        let info = PeerInfo {
            device_id: id.clone(),
            device_name: link.hello.device_name,
            platform: link.hello.platform,
            route: classify(link.addr.ip()),
            address: link.addr.ip().to_string(),
        };
        let (outbox, tasks) = self.spawn_peer(id.clone(), conn, link.reader, link.writer);
        outbox.nudge();
        state.peers.insert(
            id,
            Peer {
                info,
                rank,
                conn,
                adopted_at: Instant::now(),
                outbox,
                tasks,
            },
        );
        drop(state);
        self.peers_changed.notify_one();
    }

    fn spawn_peer(
        self: &Arc<Self>,
        id: String,
        conn: u64,
        mut reader: SessionReader,
        writer: SessionWriter,
    ) -> (Outbox, [AbortHandle; 2]) {
        let (blob, latest) = watch::channel(None);
        let (control, nudges) = mpsc::channel(CONTROL);
        let shared = self.clone();
        let from = id.clone();
        let write = tokio::spawn(async move {
            pump_out(writer, latest, nudges).await;
            shared.release(&from, conn);
        });
        let shared = self.clone();
        let read = tokio::spawn(async move {
            while let Some(frame) = recv(&mut reader).await {
                shared.on_frame(&id, frame).await;
            }
            shared.release(&id, conn);
        });
        (
            Outbox { blob, control },
            [write.abort_handle(), read.abort_handle()],
        )
    }

    async fn on_frame(&self, from: &str, frame: Frame) {
        match frame {
            Frame::Blob(blob) if !self.paused.load(Ordering::Relaxed) => {
                self.lock().blobs.insert(from.to_string(), blob);
                let device_id = from.to_string();
                let _ = self
                    .events
                    .send(ManagerEvent::BlobReady { device_id })
                    .await;
            }
            Frame::Nudge => self.peers_changed.notify_one(),
            _ => {}
        }
    }

    fn remember(&self, addr: SocketAddr) {
        if !addr.is_ipv4() {
            return;
        }
        let mut state = self.lock();
        let device = state
            .dialable
            .iter()
            .find(|k| k.addr == addr)
            .and_then(|k| k.device.clone());
        state.dialable.retain(|k| k.addr.ip() != addr.ip());
        state.dialable.push_back(Known { addr, device });
        if state.dialable.len() > REMEMBERED {
            state.dialable.pop_front();
        }
    }

    fn note_failed_dial(&self, addr: SocketAddr, rejected: bool) {
        self.lock()
            .dialable
            .retain(|k| k.addr != addr || (k.device.is_some() && !rejected));
    }

    fn sweep_order(&self, lost: &str) -> Vec<SocketAddr> {
        let state = self.lock();
        let mut picks: Vec<&Known> = state
            .dialable
            .iter()
            .rev()
            .filter(|k| k.device.as_deref().is_none_or(|d| d == lost))
            .collect();
        picks.sort_by_key(|k| k.device.is_none());
        picks.into_iter().map(|k| k.addr).collect()
    }

    fn unlisted(&self) -> Vec<SocketAddr> {
        let state = self.lock();
        state
            .dialable
            .iter()
            .rev()
            .filter(|k| {
                k.device
                    .as_ref()
                    .is_some_and(|d| *d != self.me.device_id && !state.peers.contains_key(d))
            })
            .map(|k| k.addr)
            .collect()
    }

    fn release(self: &Arc<Self>, id: &str, conn: u64) {
        let mut state = self.lock();
        let Some(peer) = state.peers.get(id).filter(|p| p.conn == conn) else {
            return;
        };
        let lived = peer.adopted_at.elapsed() >= REDIAL_DELAY;
        state.peers.remove(id);
        drop(state);
        self.peers_changed.notify_one();
        self.lost.notify_one();
        if lived {
            tokio::spawn(redial(self.clone(), id.to_string()));
        }
    }

    async fn status(&self, status: LanStatus) {
        let _ = self.events.send(ManagerEvent::Status(status)).await;
    }

    async fn set_blocked(&self, blocked: bool) {
        if self.blocked.swap(blocked, Ordering::Relaxed) != blocked {
            let status = if blocked {
                LanStatus::Blocked
            } else {
                LanStatus::Running
            };
            self.status(status).await;
        }
    }

    async fn discovery_failed(&self, e: DiscoveryError) {
        log::warn!("lan-sync: discovery: {e}");
        if e == DiscoveryError::Blocked {
            self.set_blocked(true).await;
        }
    }
}

async fn pump_out(
    mut writer: SessionWriter,
    mut latest: watch::Receiver<Latest>,
    mut control: mpsc::Receiver<Frame>,
) {
    let mut ping = tokio::time::interval_at(tokio::time::Instant::now() + PING_EVERY, PING_EVERY);
    loop {
        let frame = tokio::select! {
            nudge = control.recv() => {
                let Some(frame) = nudge else { return };
                Some(frame)
            }
            changed = latest.changed() => {
                if changed.is_err() {
                    return;
                }
                let Some(blob) = latest.borrow_and_update().clone() else {
                    continue;
                };
                Some(Frame::Blob(blob.to_vec()))
            }
            _ = ping.tick() => None,
        };
        if !transmit(&mut writer, frame.as_ref()).await {
            return;
        }
    }
}

// Delayed so a dedupe loser's EOF doesn't re-dial before the winner is listed.
async fn redial(shared: Arc<Shared>, lost: String) {
    tokio::time::sleep(REDIAL_DELAY).await;
    for addr in shared.sweep_order(&lost) {
        if shared.lock().peers.contains_key(&lost) {
            return;
        }
        shared.clone().dial_if_new(addr, true).await;
    }
}

async fn retry_unlisted(shared: Arc<Shared>) {
    let mut delay = RETRY_FIRST;
    let mut deadline = tokio::time::Instant::now() + delay;
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {}
            _ = shared.lost.notified() => {
                delay = RETRY_FIRST;
                deadline = deadline.min(tokio::time::Instant::now() + RETRY_FIRST);
                continue;
            }
        }
        let missing = shared.unlisted();
        delay = if missing.is_empty() {
            RETRY_FIRST
        } else {
            for addr in missing {
                shared.clone().dial_if_new(addr, true).await;
            }
            (delay * 2).min(RETRY_MAX)
        };
        deadline = tokio::time::Instant::now() + delay;
    }
}

async fn probe_loop(shared: Arc<Shared>, probe: Probe) {
    let mut ticker = tokio::time::interval(PROBE_EVERY);
    loop {
        ticker.tick().await;
        if !shared.lock().peers.is_empty() {
            continue;
        }
        match probe() {
            Ok(()) => shared.set_blocked(false).await,
            Err(e) => {
                shared
                    .discovery_failed(classify_mdns_error(&e.to_string()))
                    .await
            }
        }
    }
}

async fn write_saves(shared: Arc<Shared>, mut saves: watch::Receiver<Save>) {
    loop {
        let last = tokio::select! {
            changed = saves.changed() => {
                if changed.is_err() {
                    return;
                }
                false
            }
            _ = shared.flush.notified() => true,
        };
        if last && !saves.has_changed().unwrap_or(false) {
            return;
        }
        let Some((path, bytes)) = saves.borrow_and_update().clone() else {
            continue;
        };
        let written = tokio::task::spawn_blocking(move || write_snapshot(&path, &bytes)).await;
        if let Ok(Err(e)) = written {
            log::warn!("lan-sync: saving peers failed: {e}");
        }
        if last {
            return;
        }
    }
}

async fn emit_peers(shared: Arc<Shared>) {
    loop {
        shared.peers_changed.notified().await;
        let peers = shared.peers();
        if !peers.is_empty() {
            shared.set_blocked(false).await;
        }
        if shared
            .events
            .send(ManagerEvent::Peers(peers))
            .await
            .is_err()
        {
            return;
        }
    }
}

pub struct Manager {
    shared: Arc<Shared>,
    port: u16,
    tasks: Vec<JoinHandle<()>>,
    writer: Option<JoinHandle<()>>,
    discovery: Option<Discovery>,
}

pub async fn start(
    mut me: LocalIdentity,
    auth_keys: Zeroizing<Vec<[u8; 32]>>,
    paused: bool,
    discovery: bool,
    store: PeerStore,
    events: mpsc::Sender<ManagerEvent>,
) -> Result<Manager, String> {
    let listener = bind().await.map_err(|e| e.to_string())?;
    me.addrs = addrs::interfaces(local_port(&listener)?);
    let mut manager = serve(listener, me, auth_keys, paused, store, events).await?;
    if discovery {
        manager.spawn_probe(Arc::new(discovery::probe_multicast));
        manager.start_discovery().await;
    }
    Ok(manager)
}

async fn serve(
    listener: TcpListener,
    me: LocalIdentity,
    auth_keys: Zeroizing<Vec<[u8; 32]>>,
    paused: bool,
    store: PeerStore,
    events: mpsc::Sender<ManagerEvent>,
) -> Result<Manager, String> {
    let port = local_port(&listener)?;
    let (saves, saved) = watch::channel(None);
    let shared = Arc::new(Shared {
        me,
        auth_keys,
        events,
        state: Mutex::default(),
        store: Mutex::new(store),
        saves,
        flush: Notify::new(),
        paused: AtomicBool::new(paused),
        blocked: AtomicBool::new(false),
        inbound: Arc::new(Semaphore::new(MAX_INBOUND_HANDSHAKES)),
        outbound: Arc::new(Semaphore::new(MAX_OUTBOUND_HANDSHAKES)),
        peers_changed: Notify::new(),
        lost: Notify::new(),
    });
    let manager = Manager {
        port,
        tasks: vec![
            tokio::spawn(accept_loop(listener, shared.clone())),
            tokio::spawn(emit_peers(shared.clone())),
            tokio::spawn(retry_unlisted(shared.clone())),
        ],
        writer: Some(tokio::spawn(write_saves(shared.clone(), saved))),
        discovery: None,
        shared,
    };
    manager.shared.status(LanStatus::Running).await;
    Ok(manager)
}

impl Manager {
    fn spawn_probe(&mut self, probe: Probe) {
        let shared = self.shared.clone();
        self.tasks.push(tokio::spawn(probe_loop(shared, probe)));
    }

    async fn start_discovery(&mut self) {
        let (found, mut found_rx) = mpsc::channel(32);
        let (errors, mut errors_rx) = mpsc::channel(8);
        let shared = self.shared.clone();
        self.tasks.push(tokio::spawn(async move {
            while let Some(addr) = found_rx.recv().await {
                shared.remember(addr);
                tokio::spawn(shared.clone().dial_if_new(addr, false));
            }
        }));
        let shared = self.shared.clone();
        self.tasks.push(tokio::spawn(async move {
            while let Some(e) = errors_rx.recv().await {
                shared.discovery_failed(e).await;
            }
        }));
        match discovery::start(self.port, found, errors) {
            Ok(d) => self.discovery = Some(d),
            Err(e) => self.shared.discovery_failed(e).await,
        }
    }

    #[cfg(test)]
    pub fn port(&self) -> u16 {
        self.port
    }

    #[cfg(test)]
    pub async fn connect(&self, addr: SocketAddr) {
        self.shared.remember(addr);
        if let Some(permit) = self.shared.outbound_permit(false).await {
            dial(self.shared.clone(), addr, permit).await;
        }
    }

    pub async fn broadcast(&self, blob: Vec<u8>) {
        if self.shared.paused.load(Ordering::Relaxed) {
            return;
        }
        let blob = Arc::new(blob);
        for peer in self.shared.lock().peers.values() {
            peer.outbox.blob.send_replace(Some(blob.clone()));
        }
    }

    pub fn take_blob(&self, device_id: &str) -> Option<Vec<u8>> {
        self.shared.lock().blobs.remove(device_id)
    }

    pub fn peers(&self) -> Vec<PeerInfo> {
        self.shared.peers()
    }

    #[cfg(test)]
    pub fn record(&self, device_id: &str) -> Option<super::peers::PeerRecord> {
        self.shared.store().get(device_id).cloned()
    }

    pub fn forget(&self, device_id: &str) -> bool {
        let mut store = self.shared.store();
        let forgotten = store.forget(device_id, now_secs());
        let dropped = {
            let mut state = self.shared.lock();
            drop(store);
            state.rejected.retain(|(id, _)| id != device_id);
            state.peers.remove(device_id)
        };
        if dropped.is_some() {
            self.shared.peers_changed.notify_one();
        }
        self.shared.persist();
        forgotten
    }

    pub fn set_paused(&self, paused: bool) {
        let was = self.shared.paused.swap(paused, Ordering::Relaxed);
        if was && !paused {
            for peer in self.shared.lock().peers.values() {
                peer.outbox.nudge();
            }
        }
    }

    fn shutdown(&mut self) {
        self.discovery = None;
        for task in self.tasks.drain(..) {
            task.abort();
        }
        let mut state = self.shared.lock();
        state.closed = true;
        state.peers.clear();
    }

    pub async fn stop(mut self) {
        self.shutdown();
        if let Some(writer) = self.writer.take() {
            self.shared.flush.notify_one();
            let abort = writer.abort_handle();
            if timeout(FLUSH_TIMEOUT, writer).await.is_err() {
                log::warn!("lan-sync: peers file not flushed before stop");
                abort.abort();
            }
        }
        self.shared.status(LanStatus::Stopped).await;
    }
}

impl Drop for Manager {
    fn drop(&mut self) {
        self.shutdown();
        if let Some(writer) = &self.writer {
            writer.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan_sync::handshake::{initiate_with_hello, Session};
    use crate::lan_sync::identity::{derive_auth_key, test_identity, DeviceKey};
    use crate::lan_sync::protocol::{raw_hello_frame, MAX_FRAME};
    use std::io::Write;
    use std::sync::atomic::AtomicUsize;

    async fn serve_as(
        me: LocalIdentity,
        account: u8,
        listener: TcpListener,
        probe: Option<Probe>,
        store: PeerStore,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        let (tx, rx) = mpsc::channel(64);
        let keys = Zeroizing::new(vec![derive_auth_key(&[account; 32])]);
        let mut manager = serve(listener, me, keys, false, store, tx).await.unwrap();
        if let Some(probe) = probe {
            manager.spawn_probe(probe);
        }
        (manager, rx)
    }

    async fn spawn_with(
        id: &str,
        account: u8,
        listener: TcpListener,
        probe: Option<Probe>,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        serve_as(
            test_identity(id),
            account,
            listener,
            probe,
            PeerStore::memory(),
        )
        .await
    }

    async fn spawn_as(
        me: LocalIdentity,
        store: PeerStore,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        serve_as(me, 1, bind().await.unwrap(), None, store).await
    }

    fn file_store(dir: &tempfile::TempDir) -> PeerStore {
        PeerStore::open(dir.path(), "acct")
    }

    fn advertising(id: &str, addr: &str) -> LocalIdentity {
        let addr: SocketAddr = addr.parse().unwrap();
        LocalIdentity {
            addrs: Arc::new(move || vec![addr]),
            ..test_identity(id)
        }
    }

    fn addrs_of(m: &Manager, id: &str) -> Vec<SocketAddr> {
        m.record(id).unwrap().addrs.iter().map(|s| s.addr).collect()
    }

    fn rejections(rx: &mut mpsc::Receiver<ManagerEvent>) -> Vec<(String, Rejection)> {
        std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|e| match e {
                ManagerEvent::Rejected { device_id, reason } => Some((device_id, reason)),
                _ => None,
            })
            .collect()
    }

    async fn spawn_on(
        id: &str,
        account: u8,
        listener: TcpListener,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        spawn_with(id, account, listener, None).await
    }

    async fn spawn(id: &str, account: u8) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        spawn_on(id, account, bind().await.unwrap()).await
    }

    fn tag(m: &Manager, addr: SocketAddr, id: &str) {
        m.shared.remember(addr);
        m.shared.lock().tag(addr.ip(), id);
    }

    fn tags(m: &Manager) -> Vec<Option<String>> {
        m.shared
            .lock()
            .dialable
            .iter()
            .map(|k| k.device.clone())
            .collect()
    }

    fn local(m: &Manager) -> SocketAddr {
        (Ipv4Addr::LOCALHOST, m.port()).into()
    }

    fn idle(m: &Manager) -> bool {
        m.shared.inbound.available_permits() == MAX_INBOUND_HANDSHAKES
            && m.shared.outbound.available_permits() == MAX_OUTBOUND_HANDSHAKES
    }

    async fn raw_peer(m: &Manager, id: &str) -> (Session, std::net::TcpStream) {
        raw_peer_as(m, &test_identity(id)).await
    }

    async fn raw_peer_as(m: &Manager, me: &LocalIdentity) -> (Session, std::net::TcpStream) {
        let raw = std::net::TcpStream::connect(local(m)).unwrap();
        let fd = raw.try_clone().unwrap();
        raw.set_nonblocking(true).unwrap();
        let stream = TcpStream::from_std(raw).unwrap();
        let keys = [derive_auth_key(&[1; 32])];
        let (session, _) = handshake(stream, true, me, &keys).await.unwrap();
        (session, fd)
    }

    fn dialable(m: &Manager) -> Vec<SocketAddr> {
        m.shared.lock().dialable.iter().map(|k| k.addr).collect()
    }

    fn rank_of(m: &Manager, id: &str) -> Option<Rank> {
        m.shared.lock().peers.get(id).map(|p| p.rank.clone())
    }

    fn listed(id: &'static str) -> impl Fn(&ManagerEvent) -> bool {
        move |e| matches!(e, ManagerEvent::Peers(p) if p.iter().any(|p| p.device_id == id))
    }

    async fn until(what: &str, mut cond: impl FnMut() -> bool) {
        let poll = async {
            while !cond() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        if timeout(Duration::from_secs(10), poll).await.is_err() {
            panic!("timed out waiting for {what}");
        }
    }

    async fn both_listed(a: &Manager, b: &Manager) {
        until("both peers", || {
            a.peers().len() == 1 && b.peers().len() == 1
        })
        .await;
    }

    async fn next_event(
        rx: &mut mpsc::Receiver<ManagerEvent>,
        wanted: impl Fn(&ManagerEvent) -> bool,
    ) -> Vec<ManagerEvent> {
        let mut seen = Vec::new();
        let collect = async {
            while let Some(e) = rx.recv().await {
                let done = wanted(&e);
                seen.push(e);
                if done {
                    return;
                }
            }
        };
        if timeout(Duration::from_secs(10), collect).await.is_err() {
            panic!("timed out; saw {seen:?}");
        }
        seen
    }

    fn blob_from(id: &'static str) -> impl Fn(&ManagerEvent) -> bool {
        move |e| matches!(e, ManagerEvent::BlobReady { device_id } if device_id == id)
    }

    fn no_peers(e: &ManagerEvent) -> bool {
        matches!(e, ManagerEvent::Peers(p) if p.is_empty())
    }

    #[tokio::test]
    async fn trusted_peers_see_each_other_and_exchange_blobs() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        a.connect(local(&b)).await;
        both_listed(&a, &b).await;
        let seen_by_b = &b.peers()[0];
        assert_eq!(seen_by_b.device_id, "dev-a");
        assert_eq!(seen_by_b.device_name, "dev-a name");
        assert_eq!(seen_by_b.route, Route::Lan);
        assert_eq!(seen_by_b.address, "127.0.0.1");
        assert_eq!(a.peers()[0].device_id, "dev-b");

        a.broadcast(vec![9; 10]).await;
        next_event(&mut eb, blob_from("dev-a")).await;
        assert_eq!(b.take_blob("dev-a"), Some(vec![9; 10]));
        assert_eq!(b.take_blob("dev-a"), None);
    }

    #[tokio::test]
    async fn untrusted_peer_is_never_listed() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 2).await;
        a.connect(local(&b)).await;
        until("handshakes settle", || idle(&a) && idle(&b)).await;
        a.broadcast(vec![1]).await;
        assert!(a.peers().is_empty() && b.peers().is_empty());
        for rx in [&mut ea, &mut eb] {
            while let Ok(e) = rx.try_recv() {
                assert!(
                    matches!(e, ManagerEvent::Status(LanStatus::Running)),
                    "{e:?}"
                );
            }
        }
    }

    #[tokio::test]
    async fn connecting_to_self_is_ignored() {
        let (a, _ea) = spawn("dev-a", 1).await;
        a.connect(local(&a)).await;
        until("handshakes settle", || idle(&a)).await;
        assert!(a.peers().is_empty());
        assert!(a.record("dev-a").is_none());
    }

    #[tokio::test]
    async fn first_contact_pins_the_device_key() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        a.connect(local(&b)).await;
        both_listed(&a, &b).await;
        let pinned = |m: &Manager, id| m.record(id).unwrap().device_key;
        assert_eq!(pinned(&a, "dev-b"), test_identity("dev-b").key.public);
        assert_eq!(pinned(&b, "dev-a"), test_identity("dev-a").key.public);
    }

    #[tokio::test]
    async fn key_change_is_refused_until_forgotten() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let ephemeral = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await.unwrap();
        let (b, _eb) = spawn_on("dev-b", 1, ephemeral).await;
        a.connect(local(&b)).await;
        next_event(&mut ea, listed("dev-b")).await;
        b.stop().await;
        next_event(&mut ea, no_peers).await;

        let impostor = LocalIdentity {
            key: DeviceKey::from_private([7; 32]),
            ..test_identity("dev-b")
        };
        for _ in 0..2 {
            let (mut session, _fd) = raw_peer_as(&a, &impostor).await;
            assert_eq!(session.recv().await.unwrap(), Frame::Bye);
        }
        until("handshakes settle", || idle(&a)).await;
        assert!(a.peers().is_empty());
        assert_eq!(
            rejections(&mut ea),
            vec![("dev-b".to_string(), Rejection::KeyChanged)]
        );

        assert!(a.forget("dev-b"));
        let (_session, _fd) = raw_peer_as(&a, &impostor).await;
        next_event(&mut ea, listed("dev-b")).await;
        assert_eq!(a.record("dev-b").unwrap().device_key, impostor.key.public);
    }

    #[tokio::test]
    async fn forgotten_device_is_dropped_and_refused() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (_live, _live_fd) = raw_peer(&a, "dev-b").await;
        next_event(&mut ea, listed("dev-b")).await;
        assert!(a.forget("dev-b"));
        next_event(&mut ea, no_peers).await;
        assert!(a.record("dev-b").is_none());
        assert!(!a.forget("dev-b"));

        let (mut session, _fd) = raw_peer(&a, "dev-b").await;
        assert_eq!(session.recv().await.unwrap(), Frame::Bye);
        until("handshakes settle", || idle(&a)).await;
        assert!(a.peers().is_empty());
        assert_eq!(rejections(&mut ea), vec![]);
    }

    fn part1_hello(h: Hello) -> Vec<u8> {
        let json = serde_json::json!({
            "device_id": h.device_id, "device_name": h.device_name, "platform": h.platform,
            "device_key": h.device_key, "device_sig": h.device_sig,
        })
        .to_string();
        raw_hello_frame(&json)
    }

    #[tokio::test]
    async fn part1_shaped_hello_still_syncs() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let stream = TcpStream::connect(local(&b)).await.unwrap();
        let keys = [derive_auth_key(&[1; 32])];
        let (session, seen) =
            initiate_with_hello(stream, &test_identity("dev-a"), &keys, part1_hello).await;
        assert!(matches!(&seen[..], [Frame::Auth(_), Frame::Hello(_)]));
        next_event(&mut eb, listed("dev-a")).await;
        assert!(addrs_of(&b, "dev-a").is_empty());

        let (_reader, mut writer) = session.split();
        writer.send(&Frame::Blob(vec![3; 4])).await.unwrap();
        next_event(&mut eb, blob_from("dev-a")).await;
        assert_eq!(b.take_blob("dev-a"), Some(vec![3; 4]));
    }

    #[tokio::test]
    async fn adopt_records_advertised_and_dialed_addresses() {
        let memory = PeerStore::memory;
        let (a, _ea) = spawn_as(advertising("dev-a", "10.9.9.9:1234"), memory()).await;
        let (b, _eb) = spawn_as(advertising("dev-b", "10.8.8.8:4321"), memory()).await;
        b.connect(local(&a)).await;
        both_listed(&a, &b).await;
        let on_b = addrs_of(&b, "dev-a");
        assert!(on_b.contains(&"10.9.9.9:1234".parse().unwrap()), "{on_b:?}");
        assert!(on_b.contains(&local(&a)), "{on_b:?}");
        assert_eq!(
            addrs_of(&a, "dev-b"),
            vec!["10.8.8.8:4321".parse().unwrap()]
        );
    }

    #[tokio::test]
    async fn writer_persists_latest_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let (a, _ea) = spawn_as(test_identity("dev-a"), file_store(&dir)).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        a.connect(local(&b)).await;
        until("a lists b", || a.peers().len() == 1).await;
        for i in 0..50u8 {
            let id = format!("dev-{i}");
            assert_eq!(a.shared.admit(&id, &[i; 32]), Ok(()));
            if i % 2 == 0 {
                assert!(a.forget(&id));
            }
        }
        let shared = a.shared.clone();
        a.stop().await;

        let mut reopened = file_store(&dir);
        let store = shared.store();
        assert_eq!(store.records().count(), 26);
        assert!(reopened.records().eq(store.records()));
        assert_eq!(
            reopened.decide("x", &[48; 32], 0),
            PinDecision::Rejected(Rejection::Blocked)
        );
    }

    #[tokio::test]
    async fn forget_between_admit_and_adopt_leaves_the_peer_unlisted() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        let stream = TcpStream::connect(local(&b)).await.unwrap();
        let link = secure(stream, local(&b), true, &a.shared).await.unwrap();
        assert!(a.forget("dev-b"));
        a.shared.adopt(link);
        assert!(a.peers().is_empty());
    }

    #[tokio::test]
    async fn untrusted_peer_is_never_pinned() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 2).await;
        a.connect(local(&b)).await;
        until("handshakes settle", || idle(&a) && idle(&b)).await;
        assert!(a.record("dev-b").is_none() && b.record("dev-a").is_none());
    }

    #[tokio::test]
    async fn simultaneous_dial_keeps_one_connection() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        tokio::join!(
            a.connect(local(&b)),
            a.connect(local(&b)),
            b.connect(local(&a))
        );
        until("dials settle", || idle(&a) && idle(&b)).await;
        let on_a = rank_of(&a, "dev-b").expect("a lost b");
        assert!(!on_a.higher_initiated);
        assert_eq!(Some(on_a), rank_of(&b, "dev-a"));

        a.broadcast(vec![1]).await;
        b.broadcast(vec![2]).await;
        next_event(&mut eb, blob_from("dev-a")).await;
        next_event(&mut ea, blob_from("dev-b")).await;
        assert_eq!(b.take_blob("dev-a"), Some(vec![1]));
        assert_eq!(a.take_blob("dev-b"), Some(vec![2]));
        assert_eq!((a.peers().len(), b.peers().len()), (1, 1));
    }

    #[tokio::test]
    async fn peer_drop_mid_frame_removes_peer() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (session, mut fd) = raw_peer(&a, "dev-b").await;
        next_event(&mut ea, listed("dev-b")).await;

        fd.write_all(&[0x40, 0x00, 1, 2, 3]).unwrap();
        drop(session);
        drop(fd);
        next_event(&mut ea, no_peers).await;
        assert!(a.peers().is_empty());
    }

    #[tokio::test]
    async fn paused_manager_ignores_blobs() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        b.set_paused(true);
        let (mut session, fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;

        session.send(&Frame::Blob(vec![5; 10])).await.unwrap();
        drop(session);
        drop(fd);
        let seen = next_event(&mut eb, no_peers).await;
        assert!(!seen.iter().any(blob_from("dev-a")), "{seen:?}");
        assert_eq!(b.take_blob("dev-a"), None);
    }

    #[tokio::test]
    async fn unknown_frame_kind_is_ignored_after_auth() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        let (_reader, mut writer) = session.split();
        writer.send_raw(&[0, 0, 0, 3, 0xEE, 1, 2]).await.unwrap();
        writer.send(&Frame::Blob(vec![7])).await.unwrap();
        let seen = next_event(&mut eb, blob_from("dev-a")).await;
        assert!(!seen.iter().any(no_peers), "{seen:?}");
        assert_eq!(b.peers()[0].device_id, "dev-a");
        assert_eq!(b.take_blob("dev-a"), Some(vec![7]));
    }

    #[tokio::test]
    async fn resume_nudges_peers() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (mut session, _fd) = raw_peer(&b, "dev-a").await;
        assert_eq!(session.recv().await.unwrap(), Frame::Nudge);
        b.set_paused(true);
        b.set_paused(false);
        let resumed = timeout(Duration::from_secs(1), session.recv()).await;
        assert_eq!(resumed.unwrap().unwrap(), Frame::Nudge);
    }

    #[tokio::test]
    async fn broadcast_never_waits_for_a_stalled_peer() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (c, mut ec) = spawn("dev-c", 1).await;
        let (_stalled, _fd) = raw_peer(&b, "dev-a").await;
        c.connect(local(&b)).await;
        until("both peers on b", || b.peers().len() == 2).await;

        b.broadcast(vec![0; MAX_FRAME - 1]).await;
        let started = Instant::now();
        for i in 1..=20u8 {
            b.broadcast(vec![i; 16]).await;
        }
        assert!(started.elapsed() < Duration::from_millis(500));
        while c.take_blob("dev-b") != Some(vec![20; 16]) {
            next_event(&mut ec, blob_from("dev-b")).await;
        }
    }

    #[tokio::test]
    async fn stop_closes_connections_without_draining() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (mut session, fd) = raw_peer(&b, "dev-a").await;
        assert_eq!(session.recv().await.unwrap(), Frame::Nudge);

        b.broadcast(vec![1; MAX_FRAME - 1]).await;
        let mut buf = vec![0u8; 1 << 20];
        until("blob in flight", || {
            fd.peek(&mut buf).is_ok_and(|n| n > 100_000)
        })
        .await;
        b.stop().await;
        let drained = timeout(Duration::from_secs(5), async {
            let mut frames = Vec::new();
            while let Ok(frame) = session.recv().await {
                frames.push(frame);
            }
            frames
        })
        .await
        .expect("no EOF after stop");
        assert!(drained.is_empty(), "{drained:?}");
    }

    #[tokio::test]
    async fn silent_incumbent_gives_way_to_a_new_connection() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (a, _ea) = spawn("dev-a", 1).await;
        let (_silent, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        let incumbent = rank_of(&b, "dev-a").unwrap();
        for i in 1..=6 {
            b.shared.remember(SocketAddr::from(([192, 0, 2, i], 9)));
        }

        b.connect(local(&a)).await;
        assert_eq!(rank_of(&b, "dev-a"), Some(incumbent));
        until("reconnected without a second dial", || {
            rank_of(&b, "dev-a").is_some_and(|r| r.higher_initiated) && a.peers().len() == 1
        })
        .await;
    }

    #[tokio::test]
    async fn worth_dialing_skips_ipv6_known_peers_and_stopped() {
        let (mut b, mut eb) = spawn("dev-b", 1).await;
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        assert!(!b.shared.worth_dialing("127.0.0.1:4000".parse().unwrap()));
        assert!(!b.shared.worth_dialing("[fe80::1]:4000".parse().unwrap()));
        assert!(b.shared.worth_dialing("10.0.0.9:4000".parse().unwrap()));
        b.shutdown();
        assert!(!b.shared.worth_dialing("10.0.0.9:4000".parse().unwrap()));
    }

    #[tokio::test]
    async fn remembered_addresses_are_unique_per_ip_and_bounded() {
        let (b, _eb) = spawn("dev-b", 1).await;
        b.shared.remember("10.0.0.1:1".parse().unwrap());
        b.shared.remember("10.0.0.1:2".parse().unwrap());
        for i in 2..=40u8 {
            b.shared.remember(SocketAddr::from(([10, 0, 0, i], 3)));
        }
        b.shared.remember("[fe80::1]:3".parse().unwrap());
        let known = dialable(&b);
        assert_eq!(known.len(), REMEMBERED);
        assert_eq!(known.last(), Some(&"10.0.0.40:3".parse().unwrap()));
        assert!(!known.contains(&"10.0.0.1:2".parse().unwrap()));
    }

    #[tokio::test]
    async fn dial_outcomes_tag_or_forget_addresses() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (a, _ea) = spawn("dev-a", 1).await;
        let (stranger, _es) = spawn("dev-s", 2).await;
        let hangup = std::net::TcpListener::bind((Ipv4Addr::new(127, 0, 0, 6), 0)).unwrap();
        let tagged_hangup = hangup.local_addr().unwrap();
        std::thread::spawn(move || {
            for conn in hangup.incoming() {
                drop(conn);
            }
        });
        let foreign = SocketAddr::from(([127, 0, 0, 2], stranger.port()));
        let closed = SocketAddr::from(([127, 0, 0, 3], 1));
        let tagged_closed = SocketAddr::from(([127, 0, 0, 4], 1));
        let tagged_foreign = SocketAddr::from(([127, 0, 0, 5], stranger.port()));
        tag(&b, tagged_closed, "dev-x");
        tag(&b, tagged_foreign, "dev-y");
        tag(&b, tagged_hangup, "dev-z");
        for addr in [
            foreign,
            closed,
            tagged_closed,
            tagged_foreign,
            tagged_hangup,
            local(&a),
        ] {
            b.connect(addr).await;
        }
        assert_eq!(dialable(&b), vec![tagged_closed, tagged_hangup, local(&a)]);
        assert_eq!(
            tags(&b),
            vec![
                Some("dev-x".into()),
                Some("dev-z".into()),
                Some("dev-a".into())
            ]
        );
    }

    #[tokio::test]
    async fn inbound_link_tags_its_address() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        tag(&b, "127.0.0.1:1".parse().unwrap(), "dev-old");
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        assert_eq!(tags(&b), vec![Some("dev-a".into())]);
    }

    #[tokio::test]
    async fn sweep_tries_the_lost_device_first() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let addr = |i: u8| SocketAddr::from(([10, 0, 0, i], 1));
        tag(&b, addr(1), "dev-a");
        tag(&b, addr(2), "dev-c");
        b.shared.remember(addr(3));
        tag(&b, addr(4), "dev-a");
        b.shared.remember(addr(5));
        assert_eq!(
            b.shared.sweep_order("dev-a"),
            vec![addr(4), addr(1), addr(5), addr(3)]
        );
    }

    #[tokio::test]
    async fn sweep_waits_for_an_outbound_permit() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (a, _ea) = spawn("dev-a", 1).await;
        tag(&b, local(&a), "dev-a");
        let busy = b
            .shared
            .outbound
            .clone()
            .acquire_many_owned(MAX_OUTBOUND_HANDSHAKES as u32)
            .await
            .unwrap();
        tokio::spawn(async move {
            tokio::time::sleep(REDIAL_DELAY * 2).await;
            drop(busy);
        });
        redial(b.shared.clone(), "dev-a".into()).await;
        assert_eq!(b.peers().len(), 1);
    }

    #[tokio::test]
    async fn lost_peer_is_retried_on_its_tagged_address() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (a, _ea) = spawn("dev-a", 1).await;
        let addr = local(&a);
        b.connect(addr).await;
        next_event(&mut eb, listed("dev-a")).await;
        tokio::time::sleep(REDIAL_DELAY).await;
        drop(a);
        next_event(&mut eb, no_peers).await;
        tokio::time::sleep(REDIAL_DELAY * 2).await;
        assert!(b.peers().is_empty());
        assert_eq!(dialable(&b), vec![addr]);

        let rebind = async {
            loop {
                match TcpListener::bind(addr).await {
                    Ok(listener) => return listener,
                    Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
                }
            }
        };
        let listener = timeout(Duration::from_secs(5), rebind).await.unwrap();
        let (_a, _ea) = spawn_on("dev-a", 1, listener).await;
        next_event(&mut eb, listed("dev-a")).await;
    }

    fn status(wanted: LanStatus) -> impl Fn(&ManagerEvent) -> bool {
        move |e| matches!(e, ManagerEvent::Status(s) if *s == wanted)
    }

    fn fake_probe(denied: Arc<AtomicBool>, calls: Arc<AtomicUsize>) -> Probe {
        Arc::new(move || {
            calls.fetch_add(1, Ordering::Relaxed);
            if denied.load(Ordering::Relaxed) {
                Err(std::io::Error::other(
                    "send failed: No route to host (os error 65)",
                ))
            } else {
                Ok(())
            }
        })
    }

    #[tokio::test]
    async fn denied_probe_blocks_and_a_later_success_clears_it() {
        let denied = Arc::new(AtomicBool::new(true));
        let probe = fake_probe(denied.clone(), Arc::default());
        let (_b, mut eb) = spawn_with("dev-b", 1, bind().await.unwrap(), Some(probe)).await;
        next_event(&mut eb, status(LanStatus::Blocked)).await;
        denied.store(false, Ordering::Relaxed);
        next_event(&mut eb, status(LanStatus::Running)).await;
    }

    #[tokio::test]
    async fn unrelated_probe_errors_do_not_block() {
        let probe: Probe = Arc::new(|| Err(std::io::Error::other("Network is unreachable")));
        let (_b, mut eb) = spawn_with("dev-b", 1, bind().await.unwrap(), Some(probe)).await;
        tokio::time::sleep(PROBE_EVERY * 3).await;
        while let Ok(e) = eb.try_recv() {
            assert!(!status(LanStatus::Blocked)(&e), "{e:?}");
        }
    }

    #[tokio::test]
    async fn an_adopted_peer_clears_blocked_and_pauses_probing() {
        let calls = Arc::new(AtomicUsize::new(0));
        let probe = fake_probe(Arc::new(AtomicBool::new(true)), calls.clone());
        let (b, mut eb) = spawn_with("dev-b", 1, bind().await.unwrap(), Some(probe)).await;
        next_event(&mut eb, status(LanStatus::Blocked)).await;
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        let seen = next_event(&mut eb, listed("dev-a")).await;
        assert!(seen.iter().any(status(LanStatus::Running)), "{seen:?}");
        let probed = calls.load(Ordering::Relaxed);
        tokio::time::sleep(PROBE_EVERY * 5).await;
        assert!(calls.load(Ordering::Relaxed) <= probed + 1);
        assert!(!std::iter::from_fn(|| eb.try_recv().ok()).any(|e| status(LanStatus::Blocked)(&e)));
    }

    #[tokio::test]
    async fn resumed_peer_gets_changes_made_while_it_was_paused() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        a.connect(local(&b)).await;
        both_listed(&a, &b).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        while ea.try_recv().is_ok() {}

        b.set_paused(true);
        a.broadcast(vec![4; 8]).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(b.take_blob("dev-a"), None);

        b.set_paused(false);
        next_event(&mut ea, listed("dev-b")).await;
        a.broadcast(vec![4; 8]).await;
        next_event(&mut eb, blob_from("dev-a")).await;
        assert_eq!(b.take_blob("dev-a"), Some(vec![4; 8]));
    }

    #[test]
    fn rate_limiter_allows_five_per_ten_seconds() {
        let mut limiter = RateLimiter::default();
        let (ip, other): (IpAddr, IpAddr) =
            ("10.0.0.2".parse().unwrap(), "10.0.0.3".parse().unwrap());
        let t0 = Instant::now();
        for i in 0..5 {
            assert!(
                limiter.allow(ip, t0 + Duration::from_secs(i)),
                "attempt {i}"
            );
        }
        assert!(!limiter.allow(ip, t0 + Duration::from_secs(9)));
        assert!(limiter.allow(other, t0 + Duration::from_secs(9)));
        assert!(limiter.allow(ip, t0 + RATE_WINDOW));
        assert!(!limiter.allow(ip, t0 + RATE_WINDOW));
        assert!(limiter.allow(ip, t0 + RATE_WINDOW + Duration::from_secs(1)));
    }
}
