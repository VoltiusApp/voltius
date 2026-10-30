use super::addrs;
use super::discovery::{self, classify_mdns_error, Discovery, DiscoveryError};
use super::handshake::{
    handshake, ping_timer, HandshakeError, Session, SessionReader, SessionWriter, HANDSHAKE_TIMEOUT,
};
use super::identity::LocalIdentity;
use super::lock;
use super::peers::{now_secs, write_snapshot, PeerStore, PinDecision, PinPolicy, Rejection};
use super::protocol::{Caps, FilesReply, FilesRequest, Frame, Hello, Refusal, MAX_FRAME};
use super::route::{classify, Route};
use super::stream::SessionStream;
use crate::crypto::hex;
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
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);
const REDIAL_DELAY: Duration = Duration::from_secs(1);
const REMEMBERED: usize = 32;
const FLUSH_TIMEOUT: Duration = Duration::from_secs(2);
const CONTROL: usize = 4;
const FILES_REPLY_TIMEOUT: Duration = Duration::from_secs(90);
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
    pub device_key: String,
    pub files: bool,
}

#[async_trait::async_trait]
pub trait InboundFiles: Send + Sync {
    async fn serve(&self, session: Session, peer: Hello, route: Route, req: FilesRequest);
}

#[derive(thiserror::Error, Debug)]
pub enum FilesDialError {
    #[error("device is not listed")]
    NotListed,
    #[error("device is unreachable: {0}")]
    Unreachable(String),
    #[error("a different device answered")]
    WrongDevice,
    #[error(transparent)]
    Handshake(#[from] HandshakeError),
    #[error("file access refused: {0:?}")]
    Refused(Refusal),
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
    session: Session,
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
    Ok(Link {
        hello,
        addr,
        initiator,
        session_id,
        session,
    })
}

async fn first_frame(session: &mut Session, within: Duration) -> Result<Frame, HandshakeError> {
    timeout(within, session.recv_max(MAX_FRAME))
        .await
        .map_err(|_| HandshakeError::Timeout)?
}

async fn establish(
    shared: Arc<Shared>,
    stream: TcpStream,
    addr: SocketAddr,
    initiator: bool,
    permit: OwnedSemaphorePermit,
) -> Result<(), HandshakeError> {
    let mut link = secure(stream, addr, initiator, &shared).await?;
    let first = if initiator {
        None
    } else {
        Some(first_frame(&mut link.session, HANDSHAKE_TIMEOUT).await?)
    };
    match first {
        Some(Frame::Files(req)) => {
            drop(permit);
            shared.serve_files(link, req).await;
        }
        Some(Frame::Bye) => {}
        first => shared.adopt(link, first),
    }
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

async fn connect(addr: SocketAddr) -> Result<TcpStream, String> {
    match timeout(DIAL_TIMEOUT, TcpStream::connect(addr)).await {
        Ok(Ok(stream)) => Ok(stream),
        Ok(Err(e)) => Err(format!("dial {addr} failed: {e}")),
        Err(_) => Err(format!("dial {addr} timed out")),
    }
}

async fn dial(shared: Arc<Shared>, addr: SocketAddr, permit: OwnedSemaphorePermit) {
    let rejected = match connect(addr).await {
        Ok(stream) => match establish(shared.clone(), stream, addr, true, permit).await {
            Ok(()) => return,
            Err(e) => matches!(
                e,
                HandshakeError::NotTrusted
                    | HandshakeError::VersionMismatch(_)
                    | HandshakeError::Pinned(_)
            ),
        },
        Err(e) => {
            log::debug!("lan-sync: {e}");
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
    ip: IpAddr,
    port: Option<u16>,
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
    files: Option<Arc<dyn InboundFiles>>,
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
    policy: PinPolicy,
    saves: watch::Sender<Save>,
    flush: Notify,
    paused: AtomicBool,
    blocked: AtomicBool,
    caps: watch::Sender<Option<Caps>>,
    inbound: Arc<Semaphore>,
    outbound: Arc<Semaphore>,
    peers_changed: Notify,
    lost: Notify,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }

    fn store(&self) -> MutexGuard<'_, PeerStore> {
        lock(&self.store)
    }

    // Sent under the store lock so an older snapshot can never land after a newer one.
    fn persist(&self) {
        let store = self.store();
        if let Some(save) = store.snapshot() {
            self.saves.send_replace(Some(save));
        }
    }

    fn admit(&self, device_id: &str, key: &[u8; 32]) -> Result<(), Rejection> {
        let decision = self.store().decide(device_id, key, now_secs(), self.policy);
        match decision {
            PinDecision::Known => Ok(()),
            PinDecision::Pinned | PinDecision::Repinned => {
                if decision == PinDecision::Repinned {
                    log::info!("lan-sync: {device_id} presented a new device key, re-pinned");
                }
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
        // Dialed first: the address cap keeps the earliest of equally fresh entries.
        let reached: Vec<SocketAddr> = link
            .initiator
            .then_some(link.addr)
            .into_iter()
            .chain(link.hello.peer_addrs())
            .collect();
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
    fn adopt(self: &Arc<Self>, link: Link, first: Option<Frame>) {
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
            device_key: hex(&link.hello.device_key),
            files: false,
        };
        let (outbox, tasks) = self.spawn_peer(id.clone(), conn, link.session, first);
        outbox.nudge();
        state.peers.insert(
            id,
            Peer {
                info,
                ip: link.addr.ip(),
                port: None,
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
        session: Session,
        first: Option<Frame>,
    ) -> (Outbox, [AbortHandle; 2]) {
        let (mut reader, writer) = session.split_live();
        let (blob, latest) = watch::channel(None);
        let (control, nudges) = mpsc::channel(CONTROL);
        let mut caps = self.caps.subscribe();
        if caps.borrow().is_some() {
            caps.mark_changed();
        }
        let shared = self.clone();
        let from = id.clone();
        let write = tokio::spawn(async move {
            pump_out(writer, latest, caps, nudges).await;
            shared.release(&from, conn);
        });
        let shared = self.clone();
        let read = tokio::spawn(async move {
            if let Some(frame) = first {
                shared.on_frame(&id, frame).await;
            }
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
            Frame::Caps(caps) => {
                if let Some(peer) = self.lock().peers.get_mut(from) {
                    peer.info.files = caps.files;
                    peer.port = caps.port;
                }
                self.peers_changed.notify_one();
            }
            _ => {}
        }
    }

    async fn serve_files(&self, link: Link, req: FilesRequest) {
        let Some(svc) = self.lock().files.clone() else {
            return;
        };
        let route = classify(link.addr.ip());
        svc.serve(link.session, link.hello, route, req).await;
    }

    fn files_target(&self, id: &str) -> Result<(SocketAddr, String), FilesDialError> {
        let state = self.lock();
        let peer = state.peers.get(id).ok_or(FilesDialError::NotListed)?;
        let port = peer
            .port
            .or_else(|| {
                state
                    .dialable
                    .iter()
                    .find(|k| k.device.as_deref() == Some(id) && k.addr.ip() == peer.ip)
                    .map(|k| k.addr.port())
            })
            .ok_or_else(|| FilesDialError::Unreachable("listening port unknown".into()))?;
        Ok((SocketAddr::new(peer.ip, port), peer.info.device_key.clone()))
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

async fn fresh<T: Clone>(rx: &mut watch::Receiver<Option<T>>) -> Option<T> {
    loop {
        rx.changed().await.ok()?;
        if let Some(value) = rx.borrow_and_update().clone() {
            return Some(value);
        }
    }
}

async fn pump_out(
    mut writer: SessionWriter,
    mut latest: watch::Receiver<Latest>,
    mut caps: watch::Receiver<Option<Caps>>,
    mut control: mpsc::Receiver<Frame>,
) {
    let mut ping = ping_timer();
    loop {
        let frame = tokio::select! {
            nudge = control.recv() => {
                let Some(frame) = nudge else { return };
                Some(frame)
            }
            blob = fresh(&mut latest) => {
                let Some(blob) = blob else { return };
                Some(Frame::Blob(blob.to_vec()))
            }
            caps = fresh(&mut caps) => {
                let Some(caps) = caps else { return };
                Some(Frame::Caps(caps))
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

#[derive(Clone)]
pub struct FilesDialer(Arc<Shared>);

impl FilesDialer {
    pub async fn open_files(
        &self,
        device_id: &str,
        req: FilesRequest,
        pinned: Option<&str>,
    ) -> Result<(SessionStream, FilesReply, String), FilesDialError> {
        let (addr, key) = self.0.files_target(device_id)?;
        if pinned.is_some_and(|p| p != key) {
            return Err(FilesDialError::WrongDevice);
        }
        let permit = self.0.outbound_permit(true).await;
        let stream = connect(addr).await.map_err(FilesDialError::Unreachable)?;
        let mut link = secure(stream, addr, true, &self.0).await?;
        drop(permit);
        if hex(&link.hello.device_key) != key {
            return Err(FilesDialError::WrongDevice);
        }
        let lost = |e: HandshakeError| FilesDialError::Unreachable(e.to_string());
        link.session.send(&Frame::Files(req)).await.map_err(lost)?;
        let reply = first_frame(&mut link.session, FILES_REPLY_TIMEOUT)
            .await
            .map_err(lost)?;
        match reply {
            Frame::FilesReply(FilesReply::Refused { reason }) => {
                Err(FilesDialError::Refused(reason))
            }
            Frame::FilesReply(reply) => Ok((SessionStream::new(link.session), reply, key)),
            _ => Err(FilesDialError::Unreachable("unexpected frame".into())),
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
    policy: PinPolicy,
    events: mpsc::Sender<ManagerEvent>,
) -> Result<Manager, String> {
    let listener = bind().await.map_err(|e| e.to_string())?;
    me.addrs = addrs::interfaces(local_port(&listener)?);
    let mut manager = serve(listener, me, auth_keys, paused, store, policy, events).await?;
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
    policy: PinPolicy,
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
        policy,
        saves,
        flush: Notify::new(),
        paused: AtomicBool::new(paused),
        blocked: AtomicBool::new(false),
        caps: watch::channel(None).0,
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

    #[cfg(desktop)]
    pub fn set_file_service(&self, svc: Option<Arc<dyn InboundFiles>>) {
        self.shared.lock().files = svc;
    }

    #[cfg(desktop)]
    pub async fn set_caps(&self, mut caps: Caps) {
        caps.port = Some(self.port);
        self.shared.caps.send_replace(Some(caps));
    }

    pub fn files_dialer(&self) -> FilesDialer {
        FilesDialer(self.shared.clone())
    }

    fn shutdown(&mut self) {
        self.discovery = None;
        for task in self.tasks.drain(..) {
            task.abort();
        }
        let mut state = self.shared.lock();
        state.closed = true;
        state.files = None;
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
    use crate::lan_sync::handshake::initiate_with_hello;
    use crate::lan_sync::identity::{derive_auth_key, test_identity, DeviceKey};
    use crate::lan_sync::protocol::raw_hello_frame;
    use std::io::Write;
    use std::sync::atomic::AtomicUsize;

    async fn serve_as(
        me: LocalIdentity,
        account: u8,
        listener: TcpListener,
        probe: Option<Probe>,
        store: PeerStore,
        policy: PinPolicy,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        let (tx, rx) = mpsc::channel(64);
        let keys = Zeroizing::new(vec![derive_auth_key(&[account; 32])]);
        let mut manager = serve(listener, me, keys, false, store, policy, tx)
            .await
            .unwrap();
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
            PinPolicy::Repin,
        )
        .await
    }

    async fn spawn_as(
        me: LocalIdentity,
        store: PeerStore,
        policy: PinPolicy,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        serve_as(me, 1, bind().await.unwrap(), None, store, policy).await
    }

    fn file_store(dir: &tempfile::TempDir) -> PeerStore {
        PeerStore::open(dir.path(), "acct")
    }

    fn advertising(id: &str, addrs: &[&str]) -> LocalIdentity {
        let addrs: Vec<SocketAddr> = addrs.iter().map(|a| a.parse().unwrap()).collect();
        LocalIdentity {
            addrs: Arc::new(move || addrs.clone()),
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

    async fn raw_peer_first_as(
        m: &Manager,
        me: &LocalIdentity,
        first: Frame,
    ) -> (Session, std::net::TcpStream) {
        let raw = std::net::TcpStream::connect(local(m)).unwrap();
        let fd = raw.try_clone().unwrap();
        raw.set_nonblocking(true).unwrap();
        let stream = TcpStream::from_std(raw).unwrap();
        let keys = [derive_auth_key(&[1; 32])];
        let (mut session, _) = handshake(stream, true, me, &keys).await.unwrap();
        session.send(&first).await.unwrap();
        (session, fd)
    }

    async fn raw_peer_first(m: &Manager, id: &str, first: Frame) -> (Session, std::net::TcpStream) {
        raw_peer_first_as(m, &test_identity(id), first).await
    }

    async fn raw_peer_as(m: &Manager, me: &LocalIdentity) -> (Session, std::net::TcpStream) {
        raw_peer_first_as(m, me, Frame::Nudge).await
    }

    async fn raw_peer(m: &Manager, id: &str) -> (Session, std::net::TcpStream) {
        raw_peer_as(m, &test_identity(id)).await
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

    fn impostor_of(id: &str) -> LocalIdentity {
        LocalIdentity {
            key: DeviceKey::from_private([7; 32]),
            ..test_identity(id)
        }
    }

    fn rejected(e: &ManagerEvent) -> bool {
        matches!(e, ManagerEvent::Rejected { .. })
    }

    #[tokio::test]
    async fn key_change_repins_under_account_policy() {
        let dir = tempfile::tempdir().unwrap();
        let (a, mut ea) =
            spawn_as(test_identity("dev-a"), file_store(&dir), PinPolicy::Repin).await;
        let (old, old_fd) = raw_peer(&a, "dev-b").await;
        next_event(&mut ea, listed("dev-b")).await;
        drop((old, old_fd));
        next_event(&mut ea, no_peers).await;

        let reinstalled = impostor_of("dev-b");
        let (_session, _fd) = raw_peer_as(&a, &reinstalled).await;
        let seen = next_event(&mut ea, listed("dev-b")).await;
        assert!(!seen.iter().any(rejected), "{seen:?}");
        assert_eq!(rejections(&mut ea), vec![]);
        assert_eq!(
            a.record("dev-b").unwrap().device_key,
            reinstalled.key.public
        );
        a.stop().await;
        let reopened = file_store(&dir);
        assert_eq!(
            reopened.get("dev-b").unwrap().device_key,
            reinstalled.key.public
        );
    }

    #[tokio::test]
    async fn key_change_is_refused_until_forgotten() {
        let refuse = PinPolicy::Refuse;
        let (a, mut ea) = spawn_as(test_identity("dev-a"), PeerStore::memory(), refuse).await;
        let ephemeral = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await.unwrap();
        let (b, _eb) = spawn_on("dev-b", 1, ephemeral).await;
        a.connect(local(&b)).await;
        next_event(&mut ea, listed("dev-b")).await;
        b.stop().await;
        next_event(&mut ea, no_peers).await;

        let impostor = impostor_of("dev-b");
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
        let (_reader, mut writer) = session.split();
        writer.send(&Frame::Blob(vec![3; 4])).await.unwrap();
        next_event(&mut eb, blob_from("dev-a")).await;
        assert_eq!(b.take_blob("dev-a"), Some(vec![3; 4]));
        assert_eq!(b.peers()[0].device_id, "dev-a");
        assert!(addrs_of(&b, "dev-a").is_empty());
    }

    #[tokio::test]
    async fn adopt_records_advertised_and_dialed_addresses() {
        let memory = PeerStore::memory;
        let repin = PinPolicy::Repin;
        let (a, _ea) = spawn_as(advertising("dev-a", &["10.9.9.9:1234"]), memory(), repin).await;
        let (b, _eb) = spawn_as(advertising("dev-b", &["10.8.8.8:4321"]), memory(), repin).await;
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
    async fn dialed_address_survives_a_full_advertisement() {
        let many: Vec<String> = (1..=9).map(|i| format!("10.0.0.{i}:1")).collect();
        let many: Vec<&str> = many.iter().map(String::as_str).collect();
        let me = advertising("dev-a", &many);
        let (a, _ea) = spawn_as(me, PeerStore::memory(), PinPolicy::Repin).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        b.connect(local(&a)).await;
        both_listed(&a, &b).await;
        let on_b = addrs_of(&b, "dev-a");
        assert_eq!(on_b.len(), crate::lan_sync::peers::MAX_ADDRS);
        assert!(on_b.contains(&local(&a)), "{on_b:?}");
    }

    #[tokio::test]
    async fn writer_persists_latest_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let (a, _ea) = spawn_as(test_identity("dev-a"), file_store(&dir), PinPolicy::Repin).await;
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
            reopened.decide("x", &[48; 32], 0, PinPolicy::Repin),
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
        a.shared.adopt(link, None);
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

    #[derive(Default)]
    struct Recorder {
        served: Mutex<Vec<(String, Route, FilesRequest)>>,
        held: Mutex<Vec<Session>>,
    }

    #[async_trait::async_trait]
    impl InboundFiles for Recorder {
        async fn serve(&self, mut session: Session, peer: Hello, route: Route, req: FilesRequest) {
            self.served
                .lock()
                .unwrap()
                .push((peer.device_id, route, req));
            let reply = FilesReply::Accepted {
                read_only: true,
                grant: None,
            };
            session.send(&Frame::FilesReply(reply)).await.unwrap();
            self.held.lock().unwrap().push(session);
        }
    }

    fn served(svc: &Recorder) -> usize {
        svc.served.lock().unwrap().len()
    }

    async fn synced(a: &Manager, b: &Manager) {
        a.connect(local(b)).await;
        until("synced", || a.peers().len() == 1 && b.peers().len() == 1).await;
    }

    fn conn_of(m: &Manager, id: &str) -> Option<u64> {
        m.shared.lock().peers.get(id).map(|p| p.conn)
    }

    async fn open_err(m: &Manager, id: &str) -> FilesDialError {
        match m
            .files_dialer()
            .open_files(id, FilesRequest::default(), None)
            .await
        {
            Ok(_) => panic!("file connection to {id} opened"),
            Err(e) => e,
        }
    }

    fn files_on(id: &'static str) -> impl Fn(&ManagerEvent) -> bool {
        move |e| matches!(e, ManagerEvent::Peers(p) if p.iter().any(|p| p.device_id == id && p.files))
    }

    #[tokio::test]
    async fn file_connection_does_not_replace_sync_peer() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        let svc = Arc::new(Recorder::default());
        b.set_file_service(Some(svc.clone()));
        synced(&a, &b).await;
        let before = (conn_of(&a, "dev-b"), conn_of(&b, "dev-a"));

        let (_stream, reply, _) = a
            .files_dialer()
            .open_files("dev-b", FilesRequest::default(), None)
            .await
            .unwrap();
        assert_eq!(
            reply,
            FilesReply::Accepted {
                read_only: true,
                grant: None
            }
        );
        assert_eq!(
            svc.served.lock().unwrap()[..],
            [("dev-a".into(), Route::Lan, FilesRequest::default())]
        );
        until("handshake permits released", || idle(&a) && idle(&b)).await;
        assert_eq!((conn_of(&a, "dev-b"), conn_of(&b, "dev-a")), before);
        assert_eq!((a.peers().len(), b.peers().len()), (1, 1));
        a.broadcast(vec![3]).await;
        next_event(&mut eb, blob_from("dev-a")).await;
    }

    #[tokio::test]
    async fn open_file_stream_outlives_manager_stop() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        let svc = Arc::new(Recorder::default());
        b.set_file_service(Some(svc.clone()));
        synced(&a, &b).await;
        let (mut near, _, _) = a
            .files_dialer()
            .open_files("dev-b", FilesRequest::default(), None)
            .await
            .unwrap();
        until("the file session held", || {
            !svc.held.lock().unwrap().is_empty()
        })
        .await;
        let mut far = SessionStream::new(svc.held.lock().unwrap().pop().unwrap());
        a.stop().await;
        let mut got = [0u8; 4];
        near.write_all(b"ping").await.unwrap();
        far.read_exact(&mut got).await.unwrap();
        assert_eq!(&got, b"ping");
        far.write_all(b"pong").await.unwrap();
        near.read_exact(&mut got).await.unwrap();
        assert_eq!(&got, b"pong");
    }

    #[tokio::test]
    async fn first_sync_frame_is_not_lost() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (_session, _fd) = raw_peer_first(&b, "dev-a", Frame::Blob(vec![4])).await;
        next_event(&mut eb, blob_from("dev-a")).await;
        assert_eq!(b.take_blob("dev-a"), Some(vec![4]));
    }

    #[tokio::test]
    async fn peers_carry_the_proven_device_key() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        synced(&a, &b).await;
        let key = hex(&test_identity("dev-b").key.public);
        assert_eq!(a.peers()[0].device_key, key);
        assert!(!a.peers()[0].files);
    }

    #[tokio::test]
    async fn caps_reach_peer_and_update_listing() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        synced(&a, &b).await;
        b.set_caps(Caps {
            files: true,
            port: None,
        })
        .await;
        next_event(&mut ea, files_on("dev-b")).await;
        b.set_caps(Caps {
            files: false,
            port: None,
        })
        .await;
        until("caps off", || !a.peers()[0].files).await;
    }

    #[tokio::test]
    async fn caps_sent_to_later_peers() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        b.set_caps(Caps {
            files: true,
            port: None,
        })
        .await;
        synced(&a, &b).await;
        next_event(&mut ea, files_on("dev-b")).await;
    }

    #[tokio::test]
    async fn files_without_service_drops_the_link() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        synced(&a, &b).await;
        let before = conn_of(&b, "dev-a");
        assert!(matches!(
            open_err(&a, "dev-b").await,
            FilesDialError::Unreachable(_)
        ));
        assert_eq!(conn_of(&b, "dev-a"), before);
    }

    #[tokio::test]
    async fn open_files_rejects_key_mismatch() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        let (c, _ec) = spawn("dev-c", 1).await;
        let svc = Arc::new(Recorder::default());
        c.set_file_service(Some(svc.clone()));
        synced(&a, &b).await;
        tag(&a, local(&c), "dev-b");
        assert!(matches!(
            open_err(&a, "dev-b").await,
            FilesDialError::WrongDevice
        ));
        until("handshakes settle", || idle(&c)).await;
        assert_eq!(served(&svc), 0);
        assert!(c.peers().is_empty());
    }

    #[tokio::test]
    async fn untrusted_peer_cannot_open_files() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (s, _es) = spawn("dev-s", 2).await;
        let svc = Arc::new(Recorder::default());
        b.set_file_service(Some(svc.clone()));
        s.connect(local(&b)).await;
        assert!(matches!(
            open_err(&s, "dev-b").await,
            FilesDialError::NotListed
        ));

        let stream = TcpStream::connect(local(&b)).await.unwrap();
        let keys = [derive_auth_key(&[2; 32])];
        assert!(handshake(stream, true, &test_identity("dev-s"), &keys)
            .await
            .is_err());
        until("handshakes settle", || idle(&b)).await;
        assert_eq!(served(&svc), 0);
        assert!(b.peers().is_empty());
    }

    #[tokio::test]
    async fn open_files_reaches_inbound_only_peer() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        let svc = Arc::new(Recorder::default());
        a.set_file_service(Some(svc.clone()));
        a.set_caps(Caps {
            files: true,
            port: None,
        })
        .await;
        synced(&a, &b).await;
        next_event(&mut eb, files_on("dev-a")).await;
        assert!(dialable(&b).is_empty());

        let (_stream, _reply, _) = b
            .files_dialer()
            .open_files("dev-a", FilesRequest::default(), None)
            .await
            .unwrap();
        assert_eq!(served(&svc), 1);
    }

    #[tokio::test]
    async fn inbound_only_peer_without_known_port_is_unreachable() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        assert!(matches!(
            open_err(&b, "dev-a").await,
            FilesDialError::Unreachable(_)
        ));
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
