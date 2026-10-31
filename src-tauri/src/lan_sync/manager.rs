use super::addrs;
use super::discovery::{self, classify_mdns_error, Advertiser, DiscoveryError, Found};
use super::handshake::{
    handshake_with, ping_timer, Handshake, HandshakeError, Mode, Session, SessionReader,
    SessionWriter, HANDSHAKE_TIMEOUT,
};
use super::identity::LocalIdentity;
use super::lock;
use super::pairing::{
    emit, run_pair, PairAction, PairCall, PairEnd, PairEvent, PairRefusal, PAIR_ATTEMPTS,
    PAIR_RATE, PAIR_RATE_WINDOW, PAIR_WINDOW,
};
use super::peers::{now_secs, write_snapshot, PeerStore, PinDecision, PinPolicy, Rejection};
use super::protocol::{
    wire_addrs, Addrs, Caps, FilesReply, FilesRequest, Frame, GroupGrant, Hello, PairInfo,
    Presence, PresenceState, Refusal, MAX_FRAME,
};
use super::route::{classify, Route};
use super::stream::SessionStream;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use super::tailscale;
use crate::crypto::hex;
use serde::Serialize;
use socket2::{Domain, Protocol, Socket, Type};
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::Hash;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, watch, Notify, OwnedSemaphorePermit, Semaphore};
use tokio::task::{AbortHandle, JoinHandle};
use tokio::time::timeout;
use tokio_util::task::AbortOnDropHandle;
use zeroize::Zeroizing;

pub const PREFERRED_PORT: u16 = 47391;
const MAX_INBOUND_HANDSHAKES: usize = 16;
const MAX_OUTBOUND_HANDSHAKES: usize = 4;
const RATE_MAX: usize = 5;
const RATE_WINDOW: Duration = Duration::from_secs(10);
const DIAL_TIMEOUT: Duration = Duration::from_secs(5);
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);
const REDIAL_DELAY: Duration = Duration::from_secs(1);
const CANDIDATES: usize = 64;
const STALE_AFTER: u64 = 30 * 24 * 60 * 60;
const FLUSH_TIMEOUT: Duration = Duration::from_secs(2);
pub(super) const LINGER: Duration = Duration::from_secs(2);
const LINGER_MAX: usize = 1024;
const CONTROL: usize = 4;
const FILES_REPLY_TIMEOUT: Duration = Duration::from_secs(90);
const FILE_DIAL_ATTEMPTS: usize = 4;
const DIAL_BUDGET: usize = 30;
const DIAL_WINDOW: Duration = Duration::from_secs(60);
const RETRY_FIRST: Duration = if cfg!(test) {
    Duration::from_millis(200)
} else {
    Duration::from_secs(5)
};
const RETRY_MAX: Duration = if cfg!(test) {
    Duration::from_secs(8)
} else {
    Duration::from_secs(300)
};
const CANDIDATE_TTL: Duration = if cfg!(test) {
    Duration::from_secs(5)
} else {
    Duration::from_secs(300)
};
const ADDR_POLL: Duration = if cfg!(test) {
    Duration::from_millis(100)
} else {
    Duration::from_secs(60)
};
const PROBE_EVERY: Duration = if cfg!(test) {
    Duration::from_millis(100)
} else {
    Duration::from_secs(300)
};
const PAIR_REDIAL: Duration = if cfg!(test) {
    Duration::from_millis(50)
} else {
    Duration::from_secs(2)
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
    pub presence: PresenceState,
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
    #[error(transparent)]
    Handshake(#[from] HandshakeError),
    #[error("file access refused: {0:?}")]
    Refused(Refusal),
}

impl FilesDialError {
    pub fn refused_peer(&self) -> Option<&str> {
        match self {
            Self::Handshake(e) => e.refused_peer(),
            _ => None,
        }
    }
}

pub struct Trust {
    pub keys: Zeroizing<Vec<[u8; 32]>>,
    pub members: Option<Vec<Member>>,
    pub farewell: Option<Farewell>,
}

pub struct Farewell {
    pub key: [u8; 32],
    pub state: PresenceState,
}

impl Trust {
    #[cfg(test)]
    pub fn policed(keys: Zeroizing<Vec<[u8; 32]>>, policy: PinPolicy) -> Self {
        Self {
            keys,
            members: (policy == PinPolicy::Refuse).then(Vec::new),
            farewell: None,
        }
    }

    fn kind(&self) -> Kind {
        match (
            self.keys.is_empty(),
            self.farewell.is_some(),
            self.members.is_some(),
        ) {
            (true, true, _) => Kind::Farewell,
            (true, false, false) => Kind::Pairing,
            (true, false, true) => Kind::Inert,
            (false, _, true) => Kind::Group,
            (false, _, false) => Kind::Account,
        }
    }
}

#[cfg(test)]
pub(crate) fn test_keys(secrets: &[u8]) -> Zeroizing<Vec<[u8; 32]>> {
    let derive = |s: &u8| super::identity::derive_auth_key(&[*s; 32]);
    Zeroizing::new(secrets.iter().map(derive).collect())
}

#[cfg(test)]
impl Trust {
    pub(crate) fn grouped(epochs: &[u8], members: &[&str]) -> Self {
        let member = |id: &&str| Member {
            device_id: id.to_string(),
            key: super::identity::test_identity(id).key.public,
        };
        Self {
            keys: test_keys(epochs),
            members: Some(members.iter().map(member).collect()),
            farewell: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Account,
    Group,
    Pairing,
    Farewell,
    Inert,
}

// Farewell only says goodbye, invisibly and outbound; Inert is a group without a secret and does nothing.
impl Kind {
    fn listens(self) -> bool {
        matches!(self, Self::Account | Self::Group | Self::Pairing)
    }

    fn dials(self) -> bool {
        matches!(self, Self::Account | Self::Group | Self::Farewell)
    }

    fn policy(self) -> PinPolicy {
        match self {
            Self::Account | Self::Pairing => PinPolicy::Repin,
            Self::Group | Self::Farewell | Self::Inert => PinPolicy::Refuse,
        }
    }

    #[cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]
    fn polls_tailnet(self) -> bool {
        matches!(self, Self::Account | Self::Group)
    }

    fn learns(self) -> bool {
        self == Self::Account
    }

    fn serves_files(self) -> bool {
        self == Self::Account
    }

    fn pairs(self) -> bool {
        matches!(self, Self::Account | Self::Group | Self::Pairing)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Member {
    pub device_id: String,
    pub key: [u8; 32],
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DialOutcome {
    Connected,
    Unreachable,
    Refused,
    Rejected,
    Skipped,
    Throttled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Mdns,
    Remembered,
    #[cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]
    Tailscale,
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
    OwnAddrs(Vec<SocketAddr>),
    Presence {
        device_id: String,
        state: PresenceState,
    },
    FarewellSent {
        device_id: String,
    },
    Pair(PairEvent),
}

#[derive(Debug)]
enum LinkRefusal {
    Farewell,
    NotMember,
    Pin(Rejection),
}

fn presence_frame(state: PresenceState) -> Frame {
    Frame::Presence(Presence { state })
}

fn presence_of(paused: bool) -> PresenceState {
    if paused {
        PresenceState::Paused
    } else {
        PresenceState::Live
    }
}

struct RateLimiter<K> {
    max: usize,
    window: Duration,
    attempts: HashMap<K, VecDeque<Instant>>,
}

impl<K: Hash + Eq> RateLimiter<K> {
    fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            attempts: HashMap::new(),
        }
    }

    fn allow(&mut self, key: K, now: Instant) -> bool {
        let window = self.window;
        self.attempts.retain(|_, hits| {
            while hits
                .front()
                .is_some_and(|t| now.duration_since(*t) >= window)
            {
                hits.pop_front();
            }
            !hits.is_empty()
        });
        let hits = self.attempts.entry(key).or_default();
        if hits.len() >= self.max {
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

fn rate_key(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => {
            let s = v6.segments();
            IpAddr::V6(Ipv6Addr::new(s[0], s[1], s[2], s[3], 0, 0, 0, 0))
        }
        v4 => v4,
    }
}

fn inbound_allowed(ip: IpAddr) -> bool {
    !matches!(ip, IpAddr::V6(v6) if addrs::is_global_v6(&v6))
}

fn bind_dual(port: u16) -> std::io::Result<std::net::TcpListener> {
    let socket = Socket::new(Domain::IPV6, Type::STREAM, Some(Protocol::TCP))?;
    socket.set_only_v6(false)?;
    #[cfg(unix)]
    socket.set_reuse_address(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&SocketAddr::new(Ipv6Addr::UNSPECIFIED.into(), port).into())?;
    socket.listen(128)?;
    Ok(socket.into())
}

async fn bind() -> std::io::Result<TcpListener> {
    bind_with(bind_dual).await
}

async fn bind_with(
    dual: impl Fn(u16) -> std::io::Result<std::net::TcpListener>,
) -> std::io::Result<TcpListener> {
    for port in [PREFERRED_PORT, 0] {
        match dual(port) {
            Ok(listener) => return TcpListener::from_std(listener),
            Err(e) => log::debug!("lan-sync: dual-stack bind on port {port} failed: {e}"),
        }
    }
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

// Holds the socket open until the peer's first frame so our Bye is not lost to a reset.
async fn part(mut session: Session) {
    let _ = session.send(&Frame::Bye).await;
    let _ = timeout(LINGER, session.recv_max(LINGER_MAX)).await;
}

async fn shake(
    stream: TcpStream,
    addr: SocketAddr,
    mode: Mode<'_>,
    shared: &Shared,
) -> Result<Handshake, HandshakeError> {
    let initiator = !matches!(mode, Mode::Accept { .. });
    handshake_with(stream, initiator, &shared.me, mode)
        .await
        .inspect_err(|e| log::debug!("lan-sync: handshake with {addr} failed: {e}"))
}

// Dialed first: the address cap keeps the earliest of equally fresh entries.
fn reached(hello: &Hello, addr: SocketAddr, initiator: bool) -> Vec<SocketAddr> {
    initiator
        .then_some(addr)
        .into_iter()
        .chain(hello.peer_addrs())
        .collect()
}

async fn secure(
    shaken: Handshake,
    addr: SocketAddr,
    initiator: bool,
    shared: &Shared,
) -> Result<Link, HandshakeError> {
    let Handshake {
        session,
        peer: hello,
        matched,
        ..
    } = shaken;
    if let Err(refusal) = shared.vet(&hello, matched) {
        log::debug!("lan-sync: {addr} refused: {refusal:?}");
        if !matches!(refusal, LinkRefusal::Farewell) {
            shared.note_unlinked(&hello.device_id, reached(&hello, addr, initiator));
        }
        return Err(shared.refuse(session, &hello.device_id, refusal).await);
    }
    let session_id = session.handshake_hash().to_vec();
    Ok(Link {
        hello,
        addr: addrs::canonical(addr),
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

async fn greet(
    shared: &Shared,
    link: &mut Link,
    first: Option<Frame>,
) -> Result<Option<(PresenceState, Frame)>, HandshakeError> {
    let sent = shared.presence();
    link.session.send(&presence_frame(sent)).await?;
    let first = match first {
        Some(frame) => frame,
        None => first_frame(&mut link.session, HANDSHAKE_TIMEOUT).await?,
    };
    match first {
        Frame::Bye => Ok(None),
        Frame::Presence(Presence {
            state: state @ (PresenceState::Moved | PresenceState::Left),
        }) => {
            let hello = &link.hello;
            let exact = |m: &Member| m.device_id == hello.device_id && m.key == hello.device_key;
            if state == PresenceState::Moved || shared.listed(exact) == Some(true) {
                shared.announce(&hello.device_id, state).await;
            }
            Err(HandshakeError::NotTrusted)
        }
        first => Ok(Some((sent, first))),
    }
}

async fn establish(
    shared: Arc<Shared>,
    stream: TcpStream,
    addr: SocketAddr,
    initiator: bool,
    permit: OwnedSemaphorePermit,
) -> Result<(), HandshakeError> {
    let keys = &shared.auth_keys[..];
    let mode = if initiator {
        Mode::Keys(keys)
    } else {
        Mode::Accept {
            keys,
            pairing: shared.pairing_open(),
        }
    };
    let shaken = shake(stream, addr, mode, &shared).await?;
    if shaken.sas.is_some() {
        drop(permit);
        shared.accept_pair(shaken, addr).await;
        return Ok(());
    }
    let mut link = secure(shaken, addr, initiator, &shared).await?;
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
        first => {
            if let Some((sent, first)) = greet(&shared, &mut link, first).await? {
                shared.adopt(link, sent, first);
                if !initiator {
                    shared.retry_soon();
                }
            }
        }
    }
    Ok(())
}

async fn accept_loop(listener: TcpListener, shared: Arc<Shared>) {
    let mut limiter = RateLimiter::new(RATE_MAX, RATE_WINDOW);
    loop {
        let (stream, addr) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                log::warn!("lan-sync: accept failed: {e}");
                tokio::time::sleep(ACCEPT_BACKOFF).await;
                continue;
            }
        };
        let addr = addrs::canonical(addr);
        if !inbound_allowed(addr.ip()) || !limiter.allow(rate_key(addr.ip()), Instant::now()) {
            continue;
        }
        let Ok(permit) = shared.inbound.clone().try_acquire_owned() else {
            continue;
        };
        tokio::spawn(establish(shared.clone(), stream, addr, false, permit));
    }
}

async fn connect(addr: SocketAddr) -> std::io::Result<TcpStream> {
    timeout(DIAL_TIMEOUT, TcpStream::connect(addr))
        .await
        .unwrap_or_else(|_| Err(std::io::ErrorKind::TimedOut.into()))
}

async fn dial(shared: Arc<Shared>, addr: SocketAddr, permit: OwnedSemaphorePermit) -> DialOutcome {
    let outcome = match connect(addr).await {
        Ok(stream) => match establish(shared.clone(), stream, addr, true, permit).await {
            Ok(()) => return DialOutcome::Connected,
            Err(
                HandshakeError::NotTrusted
                | HandshakeError::VersionMismatch(_)
                | HandshakeError::Pinned(..)
                | HandshakeError::Excluded(_),
            ) => DialOutcome::Rejected,
            Err(_) => DialOutcome::Unreachable,
        },
        Err(e) => {
            log::debug!("lan-sync: dial {addr} failed: {e}");
            if e.kind() == std::io::ErrorKind::ConnectionRefused {
                DialOutcome::Refused
            } else {
                DialOutcome::Unreachable
            }
        }
    };
    shared.note_failed_dial(addr, outcome);
    outcome
}

// Claims the session before dialing so a second resolved address never starts a parallel attempt.
async fn dial_pair(shared: Arc<Shared>, addr: SocketAddr) {
    let Some(claim) = shared.claim() else {
        return;
    };
    let shaken = async {
        let _permit = shared.outbound_permit(false).await?;
        let stream = connect(addr).await.ok()?;
        shake(stream, addr, Mode::Pair, &shared).await.ok()
    }
    .await;
    match shaken {
        Some(shaken) => shared.pair_session(claim, shaken, true).await,
        None => shared.free_session(claim.window),
    }
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
    presence: watch::Sender<PresenceState>,
    control: mpsc::Sender<Frame>,
}

impl Outbox {
    fn send(&self, frame: Frame) -> bool {
        self.control.try_send(frame).is_ok()
    }

    fn nudge(&self) {
        self.send(Frame::Nudge);
    }

    fn announce(&self, state: PresenceState) {
        self.presence.send_if_modified(|sent| {
            let changed = *sent != state;
            *sent = state;
            changed
        });
    }
}

struct Peer {
    info: PeerInfo,
    ip: IpAddr,
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
    failed: Option<Instant>,
}

impl Known {
    fn expired(&self, now: Instant) -> bool {
        self.device.is_none()
            && self
                .failed
                .is_some_and(|t| now.duration_since(t) >= CANDIDATE_TTL)
    }
}

#[derive(Default)]
struct State {
    peers: HashMap<String, Peer>,
    blobs: HashMap<String, Vec<u8>>,
    dialable: VecDeque<Known>,
    swept: HashMap<SocketAddr, Instant>,
    own: Vec<SocketAddr>,
    rejected: HashSet<(String, Rejection)>,
    told: HashSet<String>,
    unlinked: VecDeque<(String, Vec<SocketAddr>)>,
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

    fn prune(&mut self) {
        let now = Instant::now();
        self.dialable.retain(|k| !k.expired(now));
    }

    fn may_dial(&self, addr: &SocketAddr) -> bool {
        addrs::dial_target(addr) && !self.closed && !self.own.contains(addr)
    }
}

fn fresh_addrs(store: &PeerStore, wanted: impl Fn(&str) -> bool) -> Vec<SocketAddr> {
    let since = now_secs().saturating_sub(STALE_AFTER);
    let mut seen: Vec<_> = store
        .records()
        .filter(|(id, _)| wanted(id.as_str()))
        .flat_map(|(_, r)| &r.addrs)
        .filter(|s| s.last_seen >= since)
        .collect();
    seen.sort_by_key(|s| Reverse(s.last_seen));
    seen.into_iter().map(|s| s.addr).collect()
}

fn holds_pin(store: &PeerStore, hello: &Hello) -> bool {
    store.get(&hello.device_id).map(|r| r.device_key) == Some(hello.device_key)
}

pub(super) fn dedupe(addrs: impl IntoIterator<Item = SocketAddr>) -> Vec<SocketAddr> {
    let mut seen = HashSet::new();
    addrs.into_iter().filter(|a| seen.insert(*a)).collect()
}

pub(super) struct Shared {
    me: LocalIdentity,
    kind: Kind,
    auth_keys: Zeroizing<Vec<[u8; 32]>>,
    farewell_index: usize,
    farewell_state: PresenceState,
    members: Option<Mutex<Vec<Member>>>,
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
    budget: Mutex<RateLimiter<()>>,
    peers_changed: Notify,
    retry: watch::Sender<()>,
    pairing: Mutex<Option<PairWindow>>,
    pair_limiter: Mutex<RateLimiter<IpAddr>>,
    windows: AtomicU64,
    discovery: Mutex<Option<Box<dyn Advertiser>>>,
}

struct PairWindow {
    id: u64,
    info: PairInfo,
    attempts: u32,
    instance: Option<String>,
    session: Option<mpsc::Sender<PairAction>>,
    _expiry: AbortOnDropHandle<()>,
}

struct Claim {
    window: u64,
    info: PairInfo,
    actions: mpsc::Receiver<PairAction>,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }

    fn store(&self) -> MutexGuard<'_, PeerStore> {
        lock(&self.store)
    }

    fn listed(&self, wanted: impl Fn(&Member) -> bool) -> Option<bool> {
        let members = self.members.as_ref()?;
        Some(lock(members).iter().any(wanted))
    }

    fn lists(&self, key: &[u8; 32]) -> Option<bool> {
        self.listed(|m| m.key == *key)
    }

    // A refused device dropped its dial entries, so nothing would reach it again before a restart.
    fn vouch(self: &Arc<Self>, members: &[Member]) {
        let (vouched, mut addrs) = {
            let mut store = self.store();
            let mut vouched = Vec::new();
            let mut addrs = Vec::new();
            for m in members {
                if !store.vouch(&m.device_id, &m.key) {
                    continue;
                }
                let record = store.get(&m.device_id).into_iter();
                addrs.extend(record.flat_map(|r| r.addrs.iter().map(|s| s.addr)));
                vouched.push(m.device_id.as_str());
            }
            (vouched, addrs)
        };
        if vouched.is_empty() {
            return;
        }
        {
            let mut state = self.lock();
            state
                .rejected
                .retain(|(id, _)| !vouched.contains(&id.as_str()));
            state.told.retain(|id| !vouched.contains(&id.as_str()));
            state.unlinked.retain(|(id, seen)| {
                let keep = !vouched.contains(&id.as_str());
                if !keep {
                    addrs.extend(seen);
                }
                keep
            });
        }
        self.persist();
        for addr in addrs {
            self.remember(addr, None);
            tokio::spawn(
                self.clone()
                    .dial_from(addr, Source::Remembered, true, false),
            );
        }
    }

    // Sent under the store lock so an older snapshot can never land after a newer one.
    fn persist(&self) {
        let store = self.store();
        if let Some(save) = store.snapshot() {
            self.saves.send_replace(Some(save));
        }
    }

    // Farewell first so a moved device never pins group members into its account store.
    fn vet(&self, hello: &Hello, matched: Option<usize>) -> Result<(), LinkRefusal> {
        if matched == Some(self.farewell_index) {
            return Err(LinkRefusal::Farewell);
        }
        if matched != Some(0) && self.lists(&hello.device_key) == Some(false) {
            return Err(LinkRefusal::NotMember);
        }
        if hello.device_id == self.me.device_id {
            return Ok(());
        }
        self.admit(&hello.device_id, &hello.device_key)
            .map_err(LinkRefusal::Pin)
    }

    async fn refuse(
        &self,
        mut session: Session,
        device_id: &str,
        refusal: LinkRefusal,
    ) -> HandshakeError {
        let error = match refusal {
            LinkRefusal::Farewell => {
                let _ = session.send(&presence_frame(self.farewell_state)).await;
                let device_id = device_id.to_string();
                self.lock().told.insert(device_id.clone());
                let _ = self
                    .events
                    .send(ManagerEvent::FarewellSent {
                        device_id: device_id.clone(),
                    })
                    .await;
                HandshakeError::Excluded(device_id)
            }
            LinkRefusal::NotMember => HandshakeError::Excluded(device_id.to_string()),
            LinkRefusal::Pin(reason) => {
                self.rejected(device_id, reason).await;
                HandshakeError::Pinned(device_id.to_string(), reason)
            }
        };
        part(session).await;
        error
    }

    fn presence(&self) -> PresenceState {
        presence_of(self.paused.load(Ordering::Relaxed))
    }

    async fn announce(&self, device_id: &str, state: PresenceState) {
        let device_id = device_id.to_string();
        let _ = self
            .events
            .send(ManagerEvent::Presence { device_id, state })
            .await;
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

    fn note_addrs(&self, device_id: &str, addrs: &[SocketAddr]) {
        self.store().record_addrs(device_id, addrs, now_secs());
        self.persist();
    }

    fn record_addrs(&self, link: &Link) {
        let reached = reached(&link.hello, link.addr, link.initiator);
        self.note_addrs(&link.hello.device_id, &reached);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub(super) fn remembered(&self) -> Vec<SocketAddr> {
        fresh_addrs(&self.store(), |_| true)
    }

    fn push_addrs(&self, own: &[SocketAddr]) -> bool {
        let frame = Frame::Addrs(Addrs {
            addrs: wire_addrs(own),
        });
        let state = self.lock();
        let sent: Vec<bool> = state
            .peers
            .values()
            .map(|p| p.outbox.send(frame.clone()))
            .collect();
        sent.into_iter().all(|ok| ok)
    }

    fn note_unlinked(&self, device_id: &str, addrs: Vec<SocketAddr>) {
        let mut state = self.lock();
        let held = state.unlinked.iter().position(|(id, _)| id == device_id);
        let mut known = held
            .and_then(|i| state.unlinked.remove(i))
            .map_or_else(Vec::new, |(_, seen)| seen);
        for addr in addrs {
            if !known.contains(&addr) {
                known.push(addr);
            }
        }
        known.truncate(CANDIDATES);
        state.unlinked.push_back((device_id.to_string(), known));
        if state.unlinked.len() > CANDIDATES {
            state.unlinked.pop_front();
        }
    }

    fn peers(&self) -> Vec<PeerInfo> {
        let mut peers: Vec<PeerInfo> = self.lock().peers.values().map(|p| p.info.clone()).collect();
        peers.sort_by(|a, b| a.device_id.cmp(&b.device_id));
        peers
    }

    fn worth_dialing(&self, addr: SocketAddr) -> bool {
        let ip = addr.ip().to_string();
        let store = self.store();
        let state = self.lock();
        let listed = |id: &String, peer: &Peer| {
            peer.info.address == ip
                || store
                    .get(id)
                    .is_some_and(|r| r.addrs.iter().any(|s| s.addr == addr))
        };
        state.may_dial(&addr) && !state.peers.iter().any(|(id, p)| listed(id, p))
    }

    fn charge(&self, addr: SocketAddr) -> bool {
        let allowed = lock(&self.budget).allow((), Instant::now());
        if !allowed {
            log::debug!("lan-sync: dial budget spent, {addr} skipped");
        }
        allowed
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

    pub(super) async fn dial_candidate(
        self: Arc<Self>,
        addr: SocketAddr,
        source: Source,
        wait: bool,
    ) -> DialOutcome {
        self.dial_from(addr, source, wait, source != Source::Mdns)
            .await
    }

    async fn dial_from(
        self: Arc<Self>,
        addr: SocketAddr,
        source: Source,
        wait: bool,
        charged: bool,
    ) -> DialOutcome {
        if !self.kind.dials() {
            return DialOutcome::Skipped;
        }
        let addr = addrs::canonical(addr);
        let resighted = source == Source::Mdns && !self.remember(addr, None);
        if !self.worth_dialing(addr) {
            return DialOutcome::Skipped;
        }
        if resighted {
            self.retry_soon();
        }
        let Some(permit) = self.outbound_permit(wait).await else {
            self.note_failed_dial(addr, DialOutcome::Skipped);
            return DialOutcome::Skipped;
        };
        if !self.worth_dialing(addr) {
            return DialOutcome::Skipped;
        }
        if charged && !self.charge(addr) {
            return DialOutcome::Throttled;
        }
        dial(self, addr, permit).await
    }

    fn retry_soon(&self) {
        self.retry.send_replace(());
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
    fn adopt(self: &Arc<Self>, link: Link, sent: PresenceState, first: Frame) {
        self.record_addrs(&link);
        let rank = self.rank(&link);
        let id = link.hello.device_id.clone();
        let is_self = id == self.me.device_id;
        let store = self.store();
        if !is_self && !holds_pin(&store, &link.hello) {
            return;
        }
        let mut state = self.lock();
        drop(store);
        state.tag(link.addr.ip(), &id);
        state.told.remove(&id);
        if is_self || state.closed || state.peers.get(&id).is_some_and(|p| p.rank <= rank) {
            return;
        }
        state.next_conn += 1;
        let conn = state.next_conn;
        let (presence, replay) = match first {
            Frame::Presence(p) => (p.state, None),
            other => (PresenceState::Live, Some(other)),
        };
        let info = PeerInfo {
            device_id: id.clone(),
            device_name: link.hello.device_name,
            platform: link.hello.platform,
            route: classify(link.addr.ip()),
            address: link.addr.ip().to_string(),
            device_key: hex(&link.hello.device_key),
            files: false,
            presence,
        };
        let (outbox, tasks) = self.spawn_peer(id.clone(), conn, link.session, replay, sent);
        outbox.announce(self.presence());
        outbox.nudge();
        state.peers.insert(
            id,
            Peer {
                info,
                ip: link.addr.ip(),
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
        replay: Option<Frame>,
        sent: PresenceState,
    ) -> (Outbox, [AbortHandle; 2]) {
        let (mut reader, writer) = session.split_live();
        let (blob, latest) = watch::channel(None);
        let (presence, presence_rx) = watch::channel(sent);
        let (control, nudges) = mpsc::channel(CONTROL);
        let mut caps = self.caps.subscribe();
        if caps.borrow().is_some() {
            caps.mark_changed();
        }
        let shared = self.clone();
        let from = id.clone();
        let write = tokio::spawn(async move {
            pump_out(writer, latest, caps, presence_rx, nudges).await;
            shared.release(&from, conn);
        });
        let shared = self.clone();
        let read = tokio::spawn(async move {
            if let Some(frame) = replay {
                shared.on_frame(&id, frame).await;
            }
            while let Some(frame) = recv(&mut reader).await {
                shared.on_frame(&id, frame).await;
            }
            shared.release(&id, conn);
        });
        (
            Outbox {
                blob,
                presence,
                control,
            },
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
                }
                self.peers_changed.notify_one();
            }
            Frame::Addrs(Addrs { addrs }) => self.note_addrs(from, &addrs::sanitize(&addrs)),
            Frame::Presence(Presence { state }) => {
                if let Some(peer) = self.lock().peers.get_mut(from) {
                    peer.info.presence = state;
                }
                self.announce(from, state).await;
            }
            _ => {}
        }
    }

    async fn serve_files(&self, link: Link, req: FilesRequest) {
        if !holds_pin(&self.store(), &link.hello) {
            return;
        }
        let Some(svc) = self.lock().files.clone() else {
            return;
        };
        let route = classify(link.addr.ip());
        svc.serve(link.session, link.hello, route, req).await;
    }

    fn files_targets(&self, id: &str) -> Result<Vec<SocketAddr>, FilesDialError> {
        if self.store().get(id).is_none() {
            return Err(FilesDialError::NotListed);
        }
        let order = self.sweep_order(id);
        let state = self.lock();
        let at_listed = state
            .peers
            .get(id)
            .map(|p| p.ip)
            .into_iter()
            .flat_map(|ip| order.iter().map(move |a| SocketAddr::new(ip, a.port())));
        Ok(dedupe(at_listed.chain(order.iter().copied()))
            .into_iter()
            .filter(|a| state.may_dial(a))
            .take(FILE_DIAL_ATTEMPTS)
            .collect())
    }

    async fn files_link(&self, addr: SocketAddr, id: &str) -> Result<Link, FilesDialError> {
        let permit = self.outbound_permit(true).await;
        let stream = connect(addr)
            .await
            .map_err(|e| FilesDialError::Unreachable(format!("dial {addr} failed: {e}")))?;
        let other =
            || FilesDialError::Unreachable(format!("a different device answered at {addr}"));
        let keys = &self.auth_keys[..self.farewell_index];
        let shaken = shake(stream, addr, Mode::Keys(keys), self).await?;
        let link = secure(shaken, addr, true, self)
            .await
            .map_err(|e| match e.refused_peer() {
                Some(answered) if answered != id => other(),
                _ => e.into(),
            })?;
        drop(permit);
        if link.hello.device_id != id {
            return Err(other());
        }
        Ok(link)
    }

    async fn reach_files(&self, id: &str) -> Result<Link, FilesDialError> {
        let mut failed = FilesDialError::Unreachable("no known address".into());
        for addr in self.files_targets(id)? {
            match self.files_link(addr, id).await {
                Ok(link) => return Ok(link),
                Err(e) => {
                    if failed.refused_peer().is_none() {
                        failed = e;
                    }
                }
            }
        }
        Err(failed)
    }

    fn remember(&self, addr: SocketAddr, device: Option<&str>) -> bool {
        let addr = addrs::canonical(addr);
        if !addrs::dial_target(&addr) {
            return false;
        }
        let mut state = self.lock();
        let known = state
            .dialable
            .iter()
            .find(|k| k.addr == addr)
            .map(|k| k.device.clone());
        let fresh = match (&known, device) {
            (None, _) => true,
            (Some(tagged), Some(d)) => tagged.as_deref() != Some(d),
            (Some(_), None) => false,
        };
        let device = device.map(str::to_string).or(known.flatten());
        state.dialable.retain(|k| k.addr.ip() != addr.ip());
        state.dialable.push_back(Known {
            addr,
            device,
            failed: None,
        });
        if state.dialable.len() > CANDIDATES {
            state.dialable.pop_front();
        }
        fresh
    }

    fn note_failed_dial(&self, addr: SocketAddr, outcome: DialOutcome) {
        let mut state = self.lock();
        if outcome == DialOutcome::Rejected {
            state.dialable.retain(|k| k.addr != addr);
            return;
        }
        let candidate = state
            .dialable
            .iter_mut()
            .find(|k| k.addr == addr && k.device.is_none());
        if let Some(k) = candidate.filter(|k| k.failed.is_none()) {
            k.failed = Some(Instant::now());
            drop(state);
            self.retry_soon();
        }
    }

    fn sweep_order(&self, lost: &str) -> Vec<SocketAddr> {
        let store = self.store();
        let mut state = self.lock();
        state.prune();
        let tagged = state
            .dialable
            .iter()
            .rev()
            .filter(|k| k.device.as_deref() == Some(lost))
            .map(|k| k.addr);
        dedupe(
            fresh_addrs(&store, |id| id == lost)
                .into_iter()
                .chain(tagged),
        )
    }

    fn unlisted(&self) -> Vec<SocketAddr> {
        let store = self.store();
        let mut state = self.lock();
        state.prune();
        let missing = |id: &str| {
            id != self.me.device_id
                && !state.peers.contains_key(id)
                && !(self.kind == Kind::Farewell && state.told.contains(id))
        };
        let candidates = state
            .dialable
            .iter()
            .rev()
            .filter(|k| match &k.device {
                Some(d) => missing(d.as_str()),
                None => k.failed.is_some(),
            })
            .map(|k| k.addr);
        let mut order = dedupe(candidates.chain(fresh_addrs(&store, missing)));
        let listed: HashSet<SocketAddr> = order.iter().copied().collect();
        state.swept.retain(|addr, _| listed.contains(addr));
        order.sort_by_key(|addr| state.swept.get(addr).copied());
        order
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
        if lived {
            self.retry_soon();
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

    fn pairing(&self) -> MutexGuard<'_, Option<PairWindow>> {
        lock(&self.pairing)
    }

    fn pairing_open(&self) -> bool {
        self.pairing().is_some()
    }

    fn advertise_pairable(&self, on: bool) -> Result<Option<String>, DiscoveryError> {
        lock(&self.discovery)
            .as_ref()
            .map_or(Ok(None), |d| d.set_pairable(on))
    }

    // Lock order is pairing, then discovery.
    fn open_window(self: &Arc<Self>, info: PairInfo, lasts: Duration) -> Result<(), String> {
        let mut pairing = self.pairing();
        if let Some(window) = pairing.as_mut() {
            window.info = info;
            return Ok(());
        }
        let instance = self.advertise_pairable(true).map_err(|e| e.to_string())?;
        let id = self.windows.fetch_add(1, Ordering::Relaxed);
        let shared = self.clone();
        let expiry = tokio::spawn(async move {
            tokio::time::sleep(lasts).await;
            shared.close_window(id, PairRefusal::TimedOut).await;
        });
        *pairing = Some(PairWindow {
            id,
            info,
            attempts: 0,
            instance,
            session: None,
            _expiry: AbortOnDropHandle::new(expiry),
        });
        drop(pairing);
        self.dial_seen_windows();
        Ok(())
    }

    // mdns-sd reports a window once, so a window still open after a failed attempt dials it again.
    fn dial_seen_windows(self: &Arc<Self>) {
        let seen = lock(&self.discovery)
            .as_ref()
            .map(|d| d.pairable_peers())
            .unwrap_or_default();
        self.pair_with_any(seen);
    }

    fn pair_with_any(self: &Arc<Self>, seen: impl IntoIterator<Item = Found>) {
        for found in seen {
            if self.pairs_with(&found) {
                tokio::spawn(dial_pair(self.clone(), found.addr));
            }
        }
    }

    fn take_window(&self, id: Option<u64>) -> Option<PairWindow> {
        let mut pairing = self.pairing();
        let window = pairing.take_if(|w| id.is_none_or(|id| w.id == id))?;
        if let Err(e) = self.advertise_pairable(false) {
            log::warn!("lan-sync: hiding the pairing instance failed: {e}");
        }
        Some(window)
    }

    // The window is held until the event is out: dropping it may abort the calling task.
    async fn close_window(&self, id: u64, reason: PairRefusal) {
        let Some(_window) = self.take_window(Some(id)) else {
            return;
        };
        emit(&self.events, PairEvent::Closed { reason }).await;
    }

    fn pairs_with(&self, found: &Found) -> bool {
        let pairing = self.pairing();
        let Some(window) = pairing.as_ref() else {
            return false;
        };
        let after_ours = window
            .instance
            .as_deref()
            .is_some_and(|ours| found.instance.as_str() > ours);
        found.addr.is_ipv4() && window.session.is_none() && after_ours
    }

    fn session_actions(&self) -> Option<mpsc::Sender<PairAction>> {
        self.pairing().as_ref()?.session.clone()
    }

    fn claim(&self) -> Option<Claim> {
        let mut pairing = self.pairing();
        let window = pairing.as_mut().filter(|w| w.session.is_none())?;
        let (tx, actions) = mpsc::channel(CONTROL);
        window.session = Some(tx);
        Some(Claim {
            window: window.id,
            info: window.info.clone(),
            actions,
        })
    }

    fn free_session(&self, id: u64) {
        if let Some(window) = self.pairing().as_mut().filter(|w| w.id == id) {
            window.session = None;
        }
    }

    async fn accept_pair(self: &Arc<Self>, shaken: Handshake, addr: SocketAddr) {
        if !lock(&self.pair_limiter).allow(rate_key(addr.ip()), Instant::now()) {
            log::debug!("lan-sync: pair attempt from {addr} over the rate limit");
            return;
        }
        match self.claim() {
            Some(claim) => self.pair_session(claim, shaken, false).await,
            None => part(shaken.session).await,
        }
    }

    async fn pair_session(self: &Arc<Self>, claim: Claim, shaken: Handshake, initiator: bool) {
        let Some(sas) = shaken.sas else {
            return self.free_session(claim.window);
        };
        let mine = PairInfo {
            reverify: self.lists(&shaken.peer.device_key) == Some(false),
            ..claim.info.clone()
        };
        let peer = Member {
            device_id: shaken.peer.device_id.clone(),
            key: shaken.peer.device_key,
        };
        let peer_addrs = shaken.peer.peer_addrs();
        let call = PairCall {
            my_id: &self.me.device_id,
            mine: &mine,
            peer: &shaken.peer,
            sas,
        };
        let end = run_pair(shaken.session, call, claim.actions, &self.events).await;
        if end == PairEnd::Paired {
            self.note_unlinked(&peer.device_id, peer_addrs);
            self.vouch(&[peer]);
        }
        self.finish_pair(claim.window, end, initiator).await;
    }

    async fn finish_pair(self: &Arc<Self>, id: u64, end: PairEnd, initiator: bool) {
        let paired = end == PairEnd::Paired;
        let failed = matches!(end, PairEnd::Failed(_));
        let (ended, exhausted) = {
            let mut pairing = self.pairing();
            let Some(window) = pairing.as_mut().filter(|w| w.id == id) else {
                return;
            };
            window.session = None;
            match end {
                PairEnd::Paired => (None, false),
                PairEnd::Unanswered => (initiator.then_some(PairRefusal::Busy), false),
                PairEnd::Refused(reason) => (Some(reason), false),
                PairEnd::Failed(reason) => {
                    window.attempts += 1;
                    (Some(reason), window.attempts >= PAIR_ATTEMPTS)
                }
            }
        };
        if let Some(reason) = ended {
            emit(&self.events, PairEvent::Ended { reason }).await;
        }
        if exhausted {
            self.close_window(id, PairRefusal::TooManyAttempts).await;
        } else if paired {
            self.take_window(Some(id));
        } else if failed {
            let shared = self.clone();
            tokio::spawn(async move {
                tokio::time::sleep(PAIR_REDIAL).await;
                shared.dial_seen_windows();
            });
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
    mut presence: watch::Receiver<PresenceState>,
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
            changed = presence.changed() => {
                if changed.is_err() {
                    return;
                }
                Some(presence_frame(*presence.borrow_and_update()))
            }
            _ = ping.tick() => None,
        };
        if !transmit(&mut writer, frame.as_ref()).await {
            return;
        }
    }
}

// Delayed so a dedupe loser's EOF doesn't re-dial before the winner is listed.
// Kept apart from the retry sweep: it stops once `lost` is back and is never budgeted.
async fn redial(shared: Arc<Shared>, lost: String) {
    tokio::time::sleep(REDIAL_DELAY).await;
    for addr in shared.sweep_order(&lost) {
        if shared.lock().peers.contains_key(&lost) {
            return;
        }
        shared
            .clone()
            .dial_from(addr, Source::Remembered, true, false)
            .await;
    }
}

async fn retry_unlisted(shared: Arc<Shared>) {
    let kicks = shared.retry.subscribe();
    retry_ladder(kicks, || {
        let shared = shared.clone();
        async move {
            let missing = shared.unlisted();
            for &addr in &missing {
                let outcome = shared
                    .clone()
                    .dial_candidate(addr, Source::Remembered, true)
                    .await;
                if outcome == DialOutcome::Throttled {
                    break;
                }
                shared.lock().swept.insert(addr, Instant::now());
            }
            !missing.is_empty()
        }
    })
    .await;
}

async fn retry_ladder<F: std::future::Future<Output = bool>>(
    mut kicks: watch::Receiver<()>,
    mut sweep: impl FnMut() -> F,
) {
    let mut delay = RETRY_FIRST;
    let mut deadline = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {}
            kicked = kicks.changed() => {
                if kicked.is_err() {
                    return;
                }
                delay = RETRY_FIRST;
                deadline = deadline.min(tokio::time::Instant::now() + RETRY_FIRST);
                continue;
            }
        }
        if !sweep().await {
            delay = RETRY_FIRST;
            deadline = tokio::time::Instant::now() + delay;
            continue;
        }
        deadline = tokio::time::Instant::now() + delay;
        delay = (delay * 2).min(RETRY_MAX);
    }
}

async fn watch_addrs(shared: Arc<Shared>) {
    let mut ticker = tokio::time::interval(ADDR_POLL);
    let mut seen: Option<Vec<SocketAddr>> = None;
    let mut delivered = true;
    loop {
        ticker.tick().await;
        let own = (shared.me.addrs)();
        let mut sorted = own.clone();
        sorted.sort();
        if seen.as_ref() != Some(&sorted) {
            shared.lock().own = own.clone();
            let event = ManagerEvent::OwnAddrs(own.clone());
            if shared.events.send(event).await.is_err() {
                return;
            }
            seen = Some(sorted);
            delivered = false;
        }
        if !delivered {
            delivered = shared.push_addrs(&own);
        }
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
    ) -> Result<(SessionStream, FilesReply, String), FilesDialError> {
        let mut link = self.0.reach_files(device_id).await?;
        if !holds_pin(&self.0.store(), &link.hello) {
            return Err(FilesDialError::NotListed);
        }
        let key = hex(&link.hello.device_key);
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
            Frame::Bye => Err(FilesDialError::Refused(Refusal::Denied)),
            _ => Err(FilesDialError::Unreachable("unexpected frame".into())),
        }
    }
}

pub struct Manager {
    shared: Arc<Shared>,
    port: Option<u16>,
    tasks: Vec<JoinHandle<()>>,
    writer: Option<JoinHandle<()>>,
}

pub async fn start(
    mut me: LocalIdentity,
    trust: Trust,
    paused: bool,
    discovery: bool,
    store: PeerStore,
    events: mpsc::Sender<ManagerEvent>,
) -> Result<Manager, String> {
    let kind = trust.kind();
    let listener = if kind.listens() {
        let listener = bind().await.map_err(|e| e.to_string())?;
        me.addrs = addrs::interfaces(local_port(&listener)?);
        Some(listener)
    } else {
        None
    };
    let mut manager = serve(listener, me, trust, kind, paused, store, events).await?;
    if discovery {
        manager.spawn(|s| probe_loop(s, Arc::new(discovery::probe_multicast)));
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if kind.polls_tailnet() {
            manager.spawn(|s| tailscale::poll_loop(s, tailscale::local_status()));
        }
        manager.start_discovery().await;
    }
    Ok(manager)
}

async fn serve(
    listener: Option<TcpListener>,
    me: LocalIdentity,
    trust: Trust,
    kind: Kind,
    paused: bool,
    store: PeerStore,
    events: mpsc::Sender<ManagerEvent>,
) -> Result<Manager, String> {
    let port = listener.as_ref().map(local_port).transpose()?;
    let (saves, saved) = watch::channel(None);
    let Trust {
        keys,
        members,
        farewell,
    } = trust;
    let farewell_index = keys.len();
    let farewell_state = farewell.as_ref().map_or(PresenceState::Moved, |f| f.state);
    let mut auth_keys = Zeroizing::new(Vec::with_capacity(keys.len() + 1));
    auth_keys.extend_from_slice(&keys);
    auth_keys.extend(farewell.map(|f| f.key));
    let shared = Arc::new(Shared {
        me,
        kind,
        auth_keys,
        farewell_index,
        farewell_state,
        members: members.clone().map(Mutex::new),
        events,
        state: Mutex::default(),
        store: Mutex::new(store),
        policy: kind.policy(),
        saves,
        flush: Notify::new(),
        paused: AtomicBool::new(paused),
        blocked: AtomicBool::new(false),
        caps: watch::channel(None).0,
        inbound: Arc::new(Semaphore::new(MAX_INBOUND_HANDSHAKES)),
        outbound: Arc::new(Semaphore::new(MAX_OUTBOUND_HANDSHAKES)),
        budget: Mutex::new(RateLimiter::new(DIAL_BUDGET, DIAL_WINDOW)),
        peers_changed: Notify::new(),
        retry: watch::channel(()).0,
        pairing: Mutex::default(),
        pair_limiter: Mutex::new(RateLimiter::new(PAIR_RATE, PAIR_RATE_WINDOW)),
        windows: AtomicU64::new(0),
        discovery: Mutex::default(),
    });
    if let Some(members) = &members {
        shared.vouch(members);
    }
    let mut tasks = vec![tokio::spawn(emit_peers(shared.clone()))];
    if kind.dials() {
        tasks.push(tokio::spawn(retry_unlisted(shared.clone())));
    }
    if let Some(listener) = listener {
        tasks.push(tokio::spawn(accept_loop(listener, shared.clone())));
        tasks.push(tokio::spawn(watch_addrs(shared.clone())));
    }
    let manager = Manager {
        port,
        tasks,
        writer: Some(tokio::spawn(write_saves(shared.clone(), saved))),
        shared,
    };
    manager.shared.status(LanStatus::Running).await;
    Ok(manager)
}

impl Manager {
    fn spawn<F>(&mut self, task: impl FnOnce(Arc<Shared>) -> F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        self.tasks.push(tokio::spawn(task(self.shared.clone())));
    }

    async fn start_discovery(&mut self) {
        let (found, mut found_rx) = mpsc::channel::<Found>(32);
        let (errors, mut errors_rx) = mpsc::channel(8);
        let shared = self.shared.clone();
        self.tasks.push(tokio::spawn(async move {
            while let Some(found) = found_rx.recv().await {
                if found.pairable {
                    shared.pair_with_any([found]);
                } else {
                    tokio::spawn(
                        shared
                            .clone()
                            .dial_candidate(found.addr, Source::Mdns, false),
                    );
                }
            }
        }));
        let shared = self.shared.clone();
        self.tasks.push(tokio::spawn(async move {
            while let Some(e) = errors_rx.recv().await {
                shared.discovery_failed(e).await;
            }
        }));
        match discovery::start(self.port, found, errors) {
            Ok(d) => *lock(&self.shared.discovery) = Some(Box::new(d)),
            Err(e) => self.shared.discovery_failed(e).await,
        }
    }

    #[cfg(test)]
    pub fn port(&self) -> u16 {
        self.port.expect("a listening manager")
    }

    #[cfg(test)]
    pub async fn connect(&self, addr: SocketAddr, source: Source) -> DialOutcome {
        self.shared.clone().dial_candidate(addr, source, true).await
    }

    pub fn learn(&self, device_id: &str, addrs: &[SocketAddr]) {
        if !self.shared.kind.learns() {
            return;
        }
        let mut changed = false;
        for &addr in addrs {
            changed |= self.shared.remember(addr, Some(device_id));
        }
        if changed {
            self.shared.retry_soon();
        }
    }

    #[cfg(test)]
    pub fn connect_pair(&self, addr: SocketAddr) -> JoinHandle<()> {
        tokio::spawn(dial_pair(self.shared.clone(), addr))
    }

    pub async fn open_pairing(&self, info: PairInfo) -> Result<(), String> {
        if !self.shared.kind.pairs() {
            return Err("a device saying farewell does not pair".into());
        }
        self.shared.open_window(info, PAIR_WINDOW)
    }

    pub fn close_pairing(&self) {
        self.shared.take_window(None);
    }

    pub async fn confirm_pairing(&self, grant: Option<GroupGrant>) -> Result<(), String> {
        let ended = || "pairing ended".to_string();
        let actions = self.shared.session_actions().ok_or_else(ended)?;
        let (reply, answer) = oneshot::channel();
        let confirm = PairAction::Confirm(grant, reply);
        actions.send(confirm).await.map_err(|_| ended())?;
        answer.await.map_err(|_| ended())?
    }

    pub fn cancel_pairing(&self) {
        if let Some(actions) = self.shared.session_actions() {
            let _ = actions.try_send(PairAction::Cancel);
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
    pub fn spend_budget(&self) {
        while lock(&self.shared.budget).allow((), Instant::now()) {}
    }

    #[cfg(test)]
    pub fn candidates(&self) -> Vec<SocketAddr> {
        self.shared.lock().dialable.iter().map(|k| k.addr).collect()
    }

    #[cfg(test)]
    pub fn remember_at(&self, device_id: &str, addrs: &[SocketAddr]) {
        self.shared.note_addrs(device_id, addrs);
    }

    #[cfg(test)]
    pub fn record(&self, device_id: &str) -> Option<super::peers::PeerRecord> {
        self.shared.store().get(device_id).cloned()
    }

    pub fn forget(&self, device_id: &str) -> Option<[u8; 32]> {
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

    pub fn set_members(&self, members: Vec<Member>) {
        if let Some(listed) = &self.shared.members {
            self.shared.vouch(&members);
            *lock(listed) = members;
        }
    }

    // Swapped under the state lock so adopt never misses a change made mid-handshake.
    pub fn set_paused(&self, paused: bool) {
        let state = self.shared.lock();
        let resumed = self.shared.paused.swap(paused, Ordering::Relaxed) && !paused;
        for peer in state.peers.values() {
            peer.outbox.announce(presence_of(paused));
            if resumed {
                peer.outbox.nudge();
            }
        }
    }

    #[cfg(desktop)]
    pub fn set_file_service(&self, svc: Option<Arc<dyn InboundFiles>>) {
        self.shared.lock().files = svc;
    }

    #[cfg(desktop)]
    pub async fn set_caps(&self, caps: Caps) {
        self.shared.caps.send_replace(Some(caps));
    }

    pub fn serves_files(&self) -> bool {
        self.shared.kind.serves_files()
    }

    pub fn files_dialer(&self) -> FilesDialer {
        FilesDialer(self.shared.clone())
    }

    fn shutdown(&mut self) {
        self.shared.take_window(None);
        let discovery = lock(&self.shared.discovery).take();
        drop(discovery);
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
    use crate::lan_sync::handshake::{handshake, initiate_with_hello};
    use crate::lan_sync::identity::{derive_auth_key, test_identity, DeviceKey};
    use crate::lan_sync::pairing::{PairRefusal, Role, PAIR_ATTEMPTS, PAIR_RATE};
    use crate::lan_sync::peers::encode_hex32;
    use crate::lan_sync::protocol::{raw_hello_frame, EpochSecret, Pair};
    use crate::lan_sync::reserved;
    use std::io::Write;
    use std::sync::atomic::AtomicUsize;

    fn on_account(account: u8) -> Trust {
        Trust {
            keys: test_keys(&[account]),
            members: None,
            farewell: None,
        }
    }

    fn farewell(group: u8, state: PresenceState) -> Option<Farewell> {
        let key = derive_auth_key(&[group; 32]);
        Some(Farewell { key, state })
    }

    fn moved_to_account(account: u8, group: u8) -> Trust {
        Trust {
            farewell: farewell(group, PresenceState::Moved),
            ..on_account(account)
        }
    }

    fn left_group(group: u8) -> Trust {
        Trust {
            farewell: farewell(group, PresenceState::Left),
            ..Trust::grouped(&[], &[])
        }
    }

    async fn serve_as(
        me: LocalIdentity,
        trust: Trust,
        listener: TcpListener,
        probe: Option<Probe>,
        store: PeerStore,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        let (tx, rx) = mpsc::channel(64);
        let kind = trust.kind();
        let mut manager = serve(Some(listener), me, trust, kind, false, store, tx)
            .await
            .unwrap();
        if let Some(probe) = probe {
            manager.spawn(|s| probe_loop(s, probe));
        }
        (manager, rx)
    }

    async fn spawn_with(
        id: &str,
        account: u8,
        listener: TcpListener,
        probe: Option<Probe>,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        let trust = on_account(account);
        serve_as(
            test_identity(id),
            trust,
            listener,
            probe,
            PeerStore::memory(),
        )
        .await
    }

    async fn spawn_as(
        me: LocalIdentity,
        store: PeerStore,
        trust: Trust,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        serve_as(me, trust, bind().await.unwrap(), None, store).await
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
        m.shared.remember(addr, Some(id));
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

    async fn raw_link(
        m: &Manager,
        me: &LocalIdentity,
        secrets: &[u8],
    ) -> Result<(Session, std::net::TcpStream), HandshakeError> {
        let raw = std::net::TcpStream::connect(local(m)).unwrap();
        let fd = raw.try_clone().unwrap();
        raw.set_nonblocking(true).unwrap();
        let stream = TcpStream::from_std(raw).unwrap();
        let (session, _) = handshake(stream, true, me, &test_keys(secrets)).await?;
        Ok((session, fd))
    }

    async fn sent_first(
        m: &Manager,
        me: &LocalIdentity,
        secrets: &[u8],
        first: Frame,
    ) -> (Session, std::net::TcpStream) {
        let (mut session, fd) = raw_link(m, me, secrets).await.unwrap();
        session.send(&first).await.unwrap();
        (session, fd)
    }

    async fn greeted(
        m: &Manager,
        me: &LocalIdentity,
        secrets: &[u8],
    ) -> (Session, std::net::TcpStream) {
        sent_first(m, me, secrets, presence_frame(PresenceState::Live)).await
    }

    async fn raw_peer_first_as(
        m: &Manager,
        me: &LocalIdentity,
        first: Frame,
    ) -> (Session, std::net::TcpStream) {
        sent_first(m, me, &[1], first).await
    }

    async fn raw_peer_first(m: &Manager, id: &str, first: Frame) -> (Session, std::net::TcpStream) {
        raw_peer_first_as(m, &test_identity(id), first).await
    }

    async fn raw_peer_as(m: &Manager, me: &LocalIdentity) -> (Session, std::net::TcpStream) {
        greeted(m, me, &[1]).await
    }

    async fn raw_peer(m: &Manager, id: &str) -> (Session, std::net::TcpStream) {
        raw_peer_as(m, &test_identity(id)).await
    }

    async fn recv_until(session: &mut Session, wanted: Frame) -> Vec<Frame> {
        let mut seen = Vec::new();
        let read = async {
            loop {
                let frame = session.recv().await.unwrap();
                let done = frame == wanted;
                seen.push(frame);
                if done {
                    return;
                }
            }
        };
        if timeout(Duration::from_secs(5), read).await.is_err() {
            panic!("never received {wanted:?}; saw {seen:?}");
        }
        seen
    }
    fn dialable(m: &Manager) -> Vec<SocketAddr> {
        m.candidates()
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
        a.connect(local(&b), Source::Mdns).await;
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
        a.connect(local(&b), Source::Mdns).await;
        until("handshakes settle", || idle(&a) && idle(&b)).await;
        a.broadcast(vec![1]).await;
        assert!(a.peers().is_empty() && b.peers().is_empty());
        for rx in [&mut ea, &mut eb] {
            while let Ok(e) = rx.try_recv() {
                assert!(
                    matches!(
                        e,
                        ManagerEvent::Status(LanStatus::Running) | ManagerEvent::OwnAddrs(_)
                    ),
                    "{e:?}"
                );
            }
        }
    }

    #[tokio::test]
    async fn connecting_to_self_is_ignored() {
        let (a, _ea) = spawn("dev-a", 1).await;
        a.connect(local(&a), Source::Mdns).await;
        until("handshakes settle", || idle(&a)).await;
        assert!(a.peers().is_empty());
        assert!(a.record("dev-a").is_none());
    }

    #[tokio::test]
    async fn first_contact_pins_the_device_key() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        a.connect(local(&b), Source::Mdns).await;
        both_listed(&a, &b).await;
        let pinned = |m: &Manager, id| m.record(id).unwrap().device_key;
        assert_eq!(pinned(&a, "dev-b"), test_identity("dev-b").key.public);
        assert_eq!(pinned(&b, "dev-a"), test_identity("dev-a").key.public);
    }

    fn key_of(me: &LocalIdentity) -> String {
        hex(&me.key.public)
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
        let (a, mut ea) = spawn_as(test_identity("dev-a"), file_store(&dir), on_account(1)).await;
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
        let group = Trust::grouped(&[1], &[]);
        let (a, mut ea) = spawn_as(test_identity("dev-a"), PeerStore::memory(), group).await;
        let ephemeral = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).await.unwrap();
        let (b, _eb) = spawn_on("dev-b", 1, ephemeral).await;
        a.connect(local(&b), Source::Mdns).await;
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

        assert!(a.forget("dev-b").is_some());
        let (_session, _fd) = raw_peer_as(&a, &impostor).await;
        next_event(&mut ea, listed("dev-b")).await;
        assert_eq!(a.record("dev-b").unwrap().device_key, impostor.key.public);
    }

    #[tokio::test]
    async fn forgotten_device_is_dropped_and_refused() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (_live, _live_fd) = raw_peer(&a, "dev-b").await;
        next_event(&mut ea, listed("dev-b")).await;
        let key = test_identity("dev-b").key.public;
        assert_eq!(a.forget("dev-b"), Some(key));
        next_event(&mut ea, no_peers).await;
        assert!(a.record("dev-b").is_none());
        assert_eq!(a.forget("dev-b"), None);

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

    async fn part1_peer(b: &Manager) -> (SessionReader, SessionWriter) {
        let stream = TcpStream::connect(local(b)).await.unwrap();
        let keys = [derive_auth_key(&[1; 32])];
        let (session, seen) =
            initiate_with_hello(stream, &test_identity("dev-a"), &keys, part1_hello).await;
        assert!(matches!(&seen[..], [Frame::Auth(_), Frame::Hello(_)]));
        session.split()
    }

    #[tokio::test]
    async fn part1_shaped_hello_still_syncs() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (_reader, mut writer) = part1_peer(&b).await;
        writer.send(&Frame::Nudge).await.unwrap();
        next_event(&mut eb, listed("dev-a")).await;
        assert!(addrs_of(&b, "dev-a").is_empty());

        writer.send(&Frame::Blob(vec![3; 4])).await.unwrap();
        next_event(&mut eb, blob_from("dev-a")).await;
        assert_eq!(b.take_blob("dev-a"), Some(vec![3; 4]));
        assert_eq!(b.peers()[0].device_id, "dev-a");
        assert!(addrs_of(&b, "dev-a").is_empty());
    }

    #[tokio::test]
    async fn part1_peer_whose_first_frame_is_a_blob_still_syncs() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (_reader, mut writer) = part1_peer(&b).await;
        writer.send(&Frame::Blob(vec![3; 4])).await.unwrap();
        next_event(&mut eb, blob_from("dev-a")).await;
        assert_eq!(b.take_blob("dev-a"), Some(vec![3; 4]));
        assert_eq!(b.peers()[0].device_id, "dev-a");
    }

    #[tokio::test]
    async fn adopt_records_advertised_and_dialed_addresses() {
        let memory = PeerStore::memory;
        let (a, _ea) = spawn_as(
            advertising("dev-a", &["10.9.9.9:1234"]),
            memory(),
            on_account(1),
        )
        .await;
        let (b, _eb) = spawn_as(
            advertising("dev-b", &["10.8.8.8:4321"]),
            memory(),
            on_account(1),
        )
        .await;
        b.connect(local(&a), Source::Mdns).await;
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
        let (a, _ea) = spawn_as(me, PeerStore::memory(), on_account(1)).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        b.connect(local(&a), Source::Mdns).await;
        both_listed(&a, &b).await;
        let on_b = addrs_of(&b, "dev-a");
        assert_eq!(on_b.len(), crate::lan_sync::peers::MAX_ADDRS);
        assert!(on_b.contains(&local(&a)), "{on_b:?}");
    }

    #[tokio::test]
    async fn writer_persists_latest_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let (a, _ea) = spawn_as(test_identity("dev-a"), file_store(&dir), on_account(1)).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        a.connect(local(&b), Source::Mdns).await;
        until("a lists b", || a.peers().len() == 1).await;
        for i in 0..50u8 {
            let id = format!("dev-{i}");
            assert_eq!(a.shared.admit(&id, &[i; 32]), Ok(()));
            if i % 2 == 0 {
                assert!(a.forget(&id).is_some());
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
        let keys = &a.shared.auth_keys[..];
        let shaken = shake(stream, local(&b), Mode::Keys(keys), &a.shared);
        let link = secure(shaken.await.unwrap(), local(&b), true, &a.shared)
            .await
            .unwrap();
        assert!(a.forget("dev-b").is_some());
        a.shared.adopt(link, PresenceState::Live, Frame::Nudge);
        assert!(a.peers().is_empty());
    }

    #[tokio::test]
    async fn untrusted_peer_is_never_pinned() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 2).await;
        a.connect(local(&b), Source::Mdns).await;
        until("handshakes settle", || idle(&a) && idle(&b)).await;
        assert!(a.record("dev-b").is_none() && b.record("dev-a").is_none());
    }

    #[tokio::test]
    async fn simultaneous_dial_keeps_one_connection() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        tokio::join!(
            a.connect(local(&b), Source::Mdns),
            a.connect(local(&b), Source::Mdns),
            b.connect(local(&a), Source::Mdns)
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
        let greeting = recv_until(&mut session, Frame::Nudge).await;
        assert_eq!(greeting[0], presence_frame(PresenceState::Live));
        b.set_paused(true);
        b.set_paused(false);
        recv_until(&mut session, Frame::Nudge).await;
    }

    #[tokio::test]
    async fn broadcast_never_waits_for_a_stalled_peer() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (c, mut ec) = spawn("dev-c", 1).await;
        let (_stalled, _fd) = raw_peer(&b, "dev-a").await;
        c.connect(local(&b), Source::Mdns).await;
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
        recv_until(&mut session, Frame::Nudge).await;

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
            b.shared
                .remember(SocketAddr::from(([192, 0, 2, i], 9)), None);
        }

        b.shared.remember(local(&a), None);
        let permit = b.shared.outbound_permit(false).await.unwrap();
        dial(b.shared.clone(), local(&a), permit).await;
        assert_eq!(rank_of(&b, "dev-a"), Some(incumbent));
        until("reconnected without a second dial", || {
            rank_of(&b, "dev-a").is_some_and(|r| r.higher_initiated) && a.peers().len() == 1
        })
        .await;
    }

    #[tokio::test]
    async fn worth_dialing_skips_link_local_known_peers_and_stopped() {
        let (mut b, mut eb) = spawn("dev-b", 1).await;
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        assert!(!b.shared.worth_dialing("127.0.0.1:4000".parse().unwrap()));
        assert!(!b.shared.worth_dialing("[fe80::1]:4000".parse().unwrap()));
        assert!(b
            .shared
            .worth_dialing("[fd7a:115c:a1e0::5]:4000".parse().unwrap()));
        assert!(b.shared.worth_dialing("10.0.0.9:4000".parse().unwrap()));
        b.shutdown();
        assert!(!b.shared.worth_dialing("10.0.0.9:4000".parse().unwrap()));
    }

    #[tokio::test]
    async fn remembered_addresses_are_unique_per_ip_and_bounded() {
        let (b, _eb) = spawn("dev-b", 1).await;
        b.shared.remember("10.0.0.1:1".parse().unwrap(), None);
        b.shared.remember("10.0.0.1:2".parse().unwrap(), None);
        for i in 2..=80u8 {
            b.shared
                .remember(SocketAddr::from(([10, 0, 0, i], 3)), None);
        }
        b.shared.remember("[fe80::1]:3".parse().unwrap(), None);
        let known = dialable(&b);
        assert_eq!(known.len(), CANDIDATES);
        assert_eq!(known.last(), Some(&"10.0.0.80:3".parse().unwrap()));
        assert!(!known.contains(&"10.0.0.1:2".parse().unwrap()));
    }

    #[tokio::test]
    async fn dial_outcomes_tag_keep_or_forget_addresses() {
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
            b.connect(addr, Source::Mdns).await;
        }
        assert_eq!(
            dialable(&b),
            vec![closed, tagged_closed, tagged_hangup, local(&a)]
        );
        assert_eq!(
            tags(&b),
            vec![
                None,
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
    async fn redial_tries_only_the_lost_devices_addresses() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let addr = |i: u8| SocketAddr::from(([10, 0, 0, i], 1));
        tag(&b, addr(1), "dev-a");
        tag(&b, addr(2), "dev-c");
        b.shared.remember(addr(3), None);
        tag(&b, addr(4), "dev-a");
        b.shared.remember(addr(5), None);
        b.shared
            .store()
            .seed("dev-a", &[addr(6), addr(4)], now_secs());
        assert_eq!(
            b.shared.sweep_order("dev-a"),
            vec![addr(6), addr(4), addr(1)]
        );
    }

    #[tokio::test]
    async fn unlisted_puts_candidates_first_then_fresh_store_addresses_newest_first() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (_session, _fd) = raw_peer(&b, "dev-e").await;
        next_event(&mut eb, listed("dev-e")).await;
        let addr = |i: u8| SocketAddr::from(([192, 0, 2, i], 1));
        let now = now_secs();
        {
            let mut store = b.shared.store();
            store.seed("dev-a", &[addr(1)], now - 10);
            store.seed("dev-a", &[addr(2)], now);
            store.seed("dev-c", &[addr(3)], now - 5);
            store.seed("dev-c", &[addr(4)], now - 31 * DAY);
            store.seed("dev-e", &[addr(7)], now);
        }
        tag(&b, addr(5), "dev-d");
        tag(&b, addr(2), "dev-a");
        b.shared.remember(addr(6), None);
        assert_eq!(
            b.shared.unlisted(),
            vec![addr(2), addr(5), addr(3), addr(1)]
        );
    }

    #[tokio::test]
    async fn account_manager_does_not_skip_a_device_it_refused_as_a_farewell() {
        let (m, mut em) = spawn_as(
            test_identity("dev-m"),
            PeerStore::memory(),
            moved_to_account(1, 9),
        )
        .await;
        let (_session, _fd) = raw_link(&m, &test_identity("dev-x"), &[9]).await.unwrap();
        next_event(&mut em, farewell_sent("dev-x")).await;
        let addr = SocketAddr::from(([192, 0, 2, 9], 1));
        m.shared.store().seed("dev-x", &[addr], now_secs());
        assert_eq!(m.shared.unlisted(), vec![addr]);
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
        b.connect(addr, Source::Mdns).await;
        next_event(&mut eb, listed("dev-a")).await;
        tokio::time::sleep(REDIAL_DELAY).await;
        drop(a);
        next_event(&mut eb, no_peers).await;
        tokio::time::sleep(REDIAL_DELAY * 2).await;
        assert!(b.peers().is_empty());
        assert_eq!(dialable(&b), vec![addr]);

        let (_a, _ea) = spawn_on("dev-a", 1, rebind(addr).await).await;
        next_event(&mut eb, listed("dev-a")).await;
    }

    fn seed_refusing(m: &Manager, devices: u8) -> Vec<SocketAddr> {
        let mut store = m.shared.store();
        (0..devices)
            .flat_map(|d| {
                let addrs: Vec<SocketAddr> = (1..=crate::lan_sync::peers::MAX_ADDRS as u8)
                    .map(|i| SocketAddr::from(([127, 0, 10 + d, i], 1)))
                    .collect();
                store.seed(&format!("dev-s{d}"), &addrs, now_secs());
                addrs
            })
            .collect()
    }

    #[tokio::test]
    async fn sweep_dials_candidates_before_failing_store_addresses() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        assert!(seed_refusing(&a, 5).len() > DIAL_BUDGET);
        a.learn("dev-b", &[local(&b)]);
        next_event(&mut ea, listed("dev-b")).await;
    }

    #[tokio::test]
    async fn throttled_sweep_resumes_at_the_tail() {
        let (a, _ea) = spawn("dev-a", 1).await;
        seed_refusing(&a, 5);
        let first = a.shared.unlisted();
        until("budget spent on a sweep", || {
            a.shared.lock().swept.len() == DIAL_BUDGET
        })
        .await;
        tokio::time::sleep(RETRY_FIRST * 2).await;
        assert_eq!(a.shared.lock().swept.len(), DIAL_BUDGET);
        assert_eq!(a.shared.unlisted()[..10], first[DIAL_BUDGET..]);
    }

    #[tokio::test]
    async fn own_addresses_are_not_dialed() {
        let me = advertising("dev-a", &["10.0.0.5:4000"]);
        let (a, _ea) = spawn_as(me, PeerStore::memory(), on_account(1)).await;
        until("own addresses sampled", || {
            !a.shared.worth_dialing("10.0.0.5:4000".parse().unwrap())
        })
        .await;
        assert!(a.shared.worth_dialing("10.0.0.5:4001".parse().unwrap()));
        assert!(a.shared.worth_dialing("10.0.0.6:4000".parse().unwrap()));
    }

    async fn rebind(addr: SocketAddr) -> TcpListener {
        let rebind = async {
            loop {
                match TcpListener::bind(addr).await {
                    Ok(listener) => return listener,
                    Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
                }
            }
        };
        timeout(Duration::from_secs(5), rebind).await.unwrap()
    }

    fn listening(socket: Socket) -> TcpListener {
        socket.listen(128).unwrap();
        socket.set_nonblocking(true).unwrap();
        TcpListener::from_std(socket.into()).unwrap()
    }

    const DAY: u64 = 86_400;

    async fn remembering(
        b: SocketAddr,
        last_seen: u64,
    ) -> (Manager, mpsc::Receiver<ManagerEvent>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let mut store = file_store(&dir);
        store.seed("dev-b", &[b], last_seen);
        let (a, ea) = spawn_as(test_identity("dev-a"), store, on_account(1)).await;
        (a, ea, dir)
    }

    #[tokio::test]
    async fn remembered_addresses_are_dialed_at_start() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (_a, mut ea, _dir) = remembering(local(&b), now_secs()).await;
        let listing = next_event(&mut ea, listed("dev-b"));
        timeout(Duration::from_secs(2), listing)
            .await
            .expect("b not listed within 2 s");
    }

    #[tokio::test]
    async fn stale_addresses_are_not_dialed() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (a, _ea, _dir) = remembering(local(&b), now_secs() - 31 * DAY).await;
        tokio::time::sleep(RETRY_FIRST * 5).await;
        assert!(a.peers().is_empty() && b.peers().is_empty());
    }

    #[tokio::test]
    async fn dial_budget_caps_non_mdns_attempts() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let closed = |i: u8| SocketAddr::from(([127, 0, 0, i], 1));
        let charged = [Source::Tailscale, Source::Remembered];
        let mut dialed = 0;
        for i in 10..50 {
            let source = charged[usize::from(i) % charged.len()];
            if a.connect(closed(i), source).await != DialOutcome::Throttled {
                dialed += 1;
            }
        }
        assert_eq!(dialed, DIAL_BUDGET);
        for i in 10..50 {
            let outcome = a.connect(closed(i), Source::Mdns).await;
            assert_eq!(outcome, DialOutcome::Refused, "{i}");
        }
    }

    #[tokio::test]
    async fn connect_reports_outcomes() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (stranger, _es) = spawn("dev-s", 2).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        let remembered = |addr| a.connect(addr, Source::Remembered);
        let closed = SocketAddr::from(([127, 0, 0, 3], 1));
        assert_eq!(remembered(closed).await, DialOutcome::Refused);
        assert_eq!(remembered(local(&stranger)).await, DialOutcome::Rejected);
        assert_eq!(remembered(local(&b)).await, DialOutcome::Connected);
        assert_eq!(remembered(local(&b)).await, DialOutcome::Skipped);
    }

    #[tokio::test]
    async fn learned_addresses_are_tagged_and_retried() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (socket, addr) = reserved();
        let kicks = a.shared.retry.subscribe();
        a.learn("dev-b", &[addr]);
        assert_eq!(tags(&a), vec![Some("dev-b".into())]);
        assert!(kicks.has_changed().unwrap());
        let kicks = a.shared.retry.subscribe();
        a.learn("dev-b", &[addr]);
        assert!(!kicks.has_changed().unwrap());
        tokio::time::sleep(RETRY_FIRST * 2).await;
        let (_b, _eb) = spawn_on("dev-b", 1, listening(socket)).await;
        next_event(&mut ea, listed("dev-b")).await;
    }

    #[tokio::test]
    async fn listed_device_addresses_are_not_redialed() {
        let ula: SocketAddr = "[fd00::9]:4000".parse().unwrap();
        let me = advertising("dev-b", &["[fd00::9]:4000"]);
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn_as(me, PeerStore::memory(), on_account(1)).await;
        assert_eq!(
            a.connect(local(&b), Source::Mdns).await,
            DialOutcome::Connected
        );
        assert!(addrs_of(&a, "dev-b").contains(&ula));
        assert_eq!(
            a.connect(ula, Source::Remembered).await,
            DialOutcome::Skipped
        );
        assert_eq!(a.connect(ula, Source::Mdns).await, DialOutcome::Skipped);
    }

    #[tokio::test]
    async fn failed_first_contact_is_kept_and_retried() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (socket, addr) = reserved();
        assert_eq!(a.connect(addr, Source::Mdns).await, DialOutcome::Refused);
        assert_eq!(dialable(&a), vec![addr]);
        let (_b, _eb) = spawn_on("dev-b", 1, listening(socket)).await;
        next_event(&mut ea, listed("dev-b")).await;
    }

    #[tokio::test]
    async fn failed_first_contact_expires() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (_socket, addr) = reserved();
        assert_eq!(a.connect(addr, Source::Mdns).await, DialOutcome::Refused);
        assert_eq!(dialable(&a), vec![addr]);
        until("candidate expired", || dialable(&a).is_empty()).await;
    }

    #[tokio::test]
    async fn mdns_kicks_the_ladder_on_news_only() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        let other = TcpListener::bind((Ipv4Addr::new(127, 0, 0, 9), 0))
            .await
            .unwrap();
        let (c, _ec) = spawn_on("dev-c", 1, other).await;
        let (_socket, refused) = reserved();
        let kicks = a.shared.retry.subscribe();
        assert_eq!(a.connect(refused, Source::Mdns).await, DialOutcome::Refused);
        assert!(kicks.has_changed().unwrap());
        let kicks = a.shared.retry.subscribe();
        let c_addr = SocketAddr::from(([127, 0, 0, 9], c.port()));
        assert_eq!(
            a.connect(c_addr, Source::Mdns).await,
            DialOutcome::Connected
        );
        assert!(!kicks.has_changed().unwrap());
        a.shared.remember(local(&b), None);
        let kicks = a.shared.retry.subscribe();
        assert_eq!(
            a.connect(local(&b), Source::Mdns).await,
            DialOutcome::Connected
        );
        assert!(kicks.has_changed().unwrap());
        let kicks = a.shared.retry.subscribe();
        assert_eq!(
            a.connect(local(&b), Source::Mdns).await,
            DialOutcome::Skipped
        );
        assert!(!kicks.has_changed().unwrap());
    }

    #[tokio::test]
    async fn failed_first_contact_resets_a_backed_off_ladder() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let dead = std::net::TcpListener::bind((Ipv4Addr::new(127, 0, 0, 8), 0)).unwrap();
        tag(&a, dead.local_addr().unwrap(), "dev-x");
        let sweeps = Arc::new(AtomicUsize::new(0));
        let seen = sweeps.clone();
        std::thread::spawn(move || {
            for conn in dead.incoming() {
                seen.fetch_add(1, Ordering::SeqCst);
                drop(conn);
            }
        });
        until("ladder backed off", || sweeps.load(Ordering::SeqCst) >= 6).await;
        let (socket, addr) = reserved();
        assert_eq!(a.connect(addr, Source::Mdns).await, DialOutcome::Refused);
        let failed = Instant::now();
        let (_b, _eb) = spawn_on("dev-b", 1, listening(socket)).await;
        next_event(&mut ea, listed("dev-b")).await;
        assert!(
            failed.elapsed() < Duration::from_secs(4),
            "{:?}",
            failed.elapsed()
        );
    }

    #[tokio::test]
    async fn address_change_is_pushed_to_peers() {
        let own = Arc::new(Mutex::new(Vec::<SocketAddr>::new()));
        let source = own.clone();
        let me = LocalIdentity {
            addrs: Arc::new(move || lock(&source).clone()),
            ..test_identity("dev-a")
        };
        let (a, mut ea) = spawn_as(me, PeerStore::memory(), on_account(1)).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        a.connect(local(&b), Source::Mdns).await;
        both_listed(&a, &b).await;
        let moved: SocketAddr = "10.7.7.7:47391".parse().unwrap();
        let ranked = vec![moved, "10.1.1.1:47391".parse().unwrap()];
        *lock(&own) = ranked.clone();
        until("b learns the new address", || {
            b.record("dev-a")
                .is_some_and(|r| r.addrs.iter().any(|s| s.addr == moved))
        })
        .await;
        let seen = next_event(
            &mut ea,
            |e| matches!(e, ManagerEvent::OwnAddrs(v) if *v == ranked),
        )
        .await;
        assert!(!seen.is_empty());
    }

    #[tokio::test]
    async fn resighting_without_a_permit_stays_in_sweeps() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (_socket, addr) = reserved();
        let fresh = SocketAddr::from(([127, 0, 0, 7], 1));
        assert_eq!(a.connect(addr, Source::Mdns).await, DialOutcome::Refused);
        let busy = a
            .shared
            .outbound
            .clone()
            .acquire_many_owned(MAX_OUTBOUND_HANDSHAKES as u32)
            .await
            .unwrap();
        for sighted in [addr, fresh] {
            let outcome = a
                .shared
                .clone()
                .dial_candidate(sighted, Source::Mdns, false)
                .await;
            assert_eq!(outcome, DialOutcome::Skipped);
        }
        assert_eq!(a.shared.unlisted(), vec![fresh, addr]);
        drop(busy);
    }

    #[tokio::test]
    async fn lost_peer_is_redialed_with_the_budget_spent() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        b.connect(local(&a), Source::Mdns).await;
        next_event(&mut eb, listed("dev-a")).await;
        tokio::time::sleep(REDIAL_DELAY).await;
        a.spend_budget();
        b.spend_budget();
        a.shared.lock().peers.clear();
        next_event(&mut eb, no_peers).await;
        let back = next_event(&mut eb, listed("dev-a"));
        timeout(Duration::from_secs(5), back)
            .await
            .expect("lost peer not redialed");
    }

    #[tokio::test]
    async fn a_peer_that_says_bye_at_once_is_redialed_with_backoff() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let dials = Arc::new(Mutex::new(Vec::new()));
        let seen = dials.clone();
        tokio::spawn(async move {
            let keys = [derive_auth_key(&[1; 32])];
            let me = test_identity("dev-a");
            while let Ok((stream, _)) = listener.accept().await {
                seen.lock().unwrap().push(Instant::now());
                if let Ok((mut session, _)) = handshake(stream, false, &me, &keys).await {
                    let _ = session.send(&Frame::Bye).await;
                }
            }
        });
        let (b, _eb) = spawn("dev-b", 1).await;
        b.learn("dev-a", &[addr]);
        tokio::time::sleep(RETRY_FIRST * 20).await;
        let at = dials.lock().unwrap().clone();
        let gaps: Vec<Duration> = at.windows(2).map(|w| w[1] - w[0]).collect();
        assert!(gaps.len() >= 3, "{gaps:?}");
        assert!(gaps.windows(2).all(|w| w[1] > w[0]), "{gaps:?}");
    }

    #[tokio::test]
    async fn inbound_link_kicks_the_retry_ladder() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let kicks = b.shared.retry.subscribe();
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        until("kick", || kicks.has_changed().unwrap()).await;
    }

    #[tokio::test(start_paused = true)]
    async fn retry_ladder_sweeps_at_once_doubles_and_resets_on_a_kick() {
        let (kick, kicks) = watch::channel(());
        let start = tokio::time::Instant::now();
        let sweeps = Arc::new(Mutex::new(Vec::new()));
        let log = sweeps.clone();
        let ladder = tokio::spawn(retry_ladder(kicks, move || {
            log.lock().unwrap().push(start.elapsed().as_millis());
            async { true }
        }));
        tokio::time::sleep(Duration::from_millis(21_000)).await;
        kick.send_replace(());
        tokio::time::sleep(Duration::from_millis(1000)).await;
        ladder.abort();
        assert_eq!(
            *sweeps.lock().unwrap(),
            vec![0, 200, 600, 1400, 3000, 6200, 12600, 20600, 21200, 21400, 21800]
        );
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
        a.connect(local(&b), Source::Mdns).await;
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

    fn recording(m: &Manager) -> Arc<Recorder> {
        let svc = Arc::new(Recorder::default());
        m.set_file_service(Some(svc.clone()));
        svc
    }

    fn served(svc: &Recorder) -> usize {
        svc.served.lock().unwrap().len()
    }

    async fn synced(a: &Manager, b: &Manager) {
        a.connect(local(b), Source::Mdns).await;
        until("synced", || a.peers().len() == 1 && b.peers().len() == 1).await;
    }

    fn conn_of(m: &Manager, id: &str) -> Option<u64> {
        m.shared.lock().peers.get(id).map(|p| p.conn)
    }

    async fn open(m: &Manager, id: &str) -> Result<String, FilesDialError> {
        m.files_dialer()
            .open_files(id, FilesRequest::default())
            .await
            .map(|(_, _, key)| key)
    }

    async fn open_err(m: &Manager, id: &str) -> FilesDialError {
        open(m, id).await.expect_err("file connection opened")
    }

    fn files_on(id: &'static str) -> impl Fn(&ManagerEvent) -> bool {
        move |e| matches!(e, ManagerEvent::Peers(p) if p.iter().any(|p| p.device_id == id && p.files))
    }

    #[tokio::test]
    async fn file_connection_does_not_replace_sync_peer() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        let svc = recording(&b);
        synced(&a, &b).await;
        let before = (conn_of(&a, "dev-b"), conn_of(&b, "dev-a"));

        let (_stream, reply, _) = a
            .files_dialer()
            .open_files("dev-b", FilesRequest::default())
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
        let svc = recording(&b);
        synced(&a, &b).await;
        let (mut near, _, _) = a
            .files_dialer()
            .open_files("dev-b", FilesRequest::default())
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
        let key = key_of(&test_identity("dev-b"));
        assert_eq!(a.peers()[0].device_key, key);
        assert!(!a.peers()[0].files);
    }

    #[tokio::test]
    async fn caps_reach_peer_and_update_listing() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        synced(&a, &b).await;
        b.set_caps(Caps { files: true }).await;
        next_event(&mut ea, files_on("dev-b")).await;
        b.set_caps(Caps { files: false }).await;
        until("caps off", || !a.peers()[0].files).await;
    }

    #[tokio::test]
    async fn caps_sent_to_later_peers() {
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        b.set_caps(Caps { files: true }).await;
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
    async fn open_files_rejects_a_different_device() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        let (c, _ec) = spawn("dev-c", 1).await;
        let svc = recording(&c);
        synced(&b, &a).await;
        tag(&a, local(&c), "dev-b");
        assert!(matches!(
            open_err(&a, "dev-b").await,
            FilesDialError::Unreachable(_)
        ));
        until("handshakes settle", || idle(&c)).await;
        assert_eq!(served(&svc), 0);
        assert!(c.peers().is_empty());
    }

    #[tokio::test]
    async fn untrusted_peer_cannot_open_files() {
        let (b, _eb) = spawn("dev-b", 1).await;
        let (s, _es) = spawn("dev-s", 2).await;
        let svc = recording(&b);
        s.connect(local(&b), Source::Mdns).await;
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
    async fn open_files_uses_advertised_port_without_caps_port() {
        let listener = bind().await.unwrap();
        let advertised = format!("192.0.2.9:{}", local_port(&listener).unwrap());
        let me = advertising("dev-a", &[&advertised]);
        let (a, _ea) = serve_as(me, on_account(1), listener, None, PeerStore::memory()).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        let svc = recording(&a);
        synced(&a, &b).await;
        assert!(dialable(&b).is_empty());

        open(&b, "dev-a").await.unwrap();
        assert_eq!(served(&svc), 1);
    }

    #[tokio::test]
    async fn pinned_device_without_an_address_is_unreachable() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        assert!(matches!(
            open_err(&b, "dev-a").await,
            FilesDialError::Unreachable(_)
        ));
    }

    async fn assert_files_refused(m: &Manager, svc: &Recorder, me: &LocalIdentity) {
        let files = Frame::Files(FilesRequest::default());
        let (mut session, _fd) = raw_peer_first_as(m, me, files).await;
        let reply = session.recv().await;
        assert!(!matches!(reply, Ok(Frame::FilesReply(_))), "{reply:?}");
        until("handshakes settle", || idle(m)).await;
        assert_eq!(served(svc), 0);
    }

    async fn serving(policy: PinPolicy) -> (Manager, Arc<Recorder>) {
        let (b, mut eb) = spawn_as(
            test_identity("dev-b"),
            PeerStore::memory(),
            Trust::policed(test_keys(&[1]), policy),
        )
        .await;
        let svc = recording(&b);
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        (b, svc)
    }

    #[tokio::test]
    async fn forgotten_device_cannot_open_files() {
        let (b, svc) = serving(PinPolicy::Repin).await;
        assert!(b.forget("dev-a").is_some());
        assert_files_refused(&b, &svc, &test_identity("dev-a")).await;
    }

    #[tokio::test]
    async fn pin_mismatch_cannot_open_files() {
        let (b, svc) = serving(PinPolicy::Refuse).await;
        assert_files_refused(&b, &svc, &impostor_of("dev-a")).await;
    }

    #[tokio::test]
    async fn own_device_id_cannot_open_files() {
        let (b, svc) = serving(PinPolicy::Repin).await;
        assert_files_refused(&b, &svc, &impostor_of("dev-b")).await;
    }

    #[tokio::test]
    async fn open_files_refuses_a_forgotten_device() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, _eb) = spawn("dev-b", 1).await;
        synced(&a, &b).await;
        assert!(a.forget("dev-b").is_some());
        assert!(matches!(
            open_err(&a, "dev-b").await,
            FilesDialError::NotListed
        ));
    }

    async fn rekeyed(
        policy: PinPolicy,
    ) -> (
        Manager,
        [Manager; 2],
        Arc<Recorder>,
        Result<String, FilesDialError>,
    ) {
        let (a, _) = spawn_as(
            test_identity("dev-a"),
            PeerStore::memory(),
            Trust::policed(test_keys(&[1]), policy),
        )
        .await;
        let (b, _) = spawn("dev-b", 1).await;
        let (c, _) = spawn_as(impostor_of("dev-b"), PeerStore::memory(), on_account(1)).await;
        let svc = recording(&c);
        synced(&b, &a).await;
        tag(&a, local(&c), "dev-b");
        let dialed = open(&a, "dev-b").await;
        (a, [b, c], svc, dialed)
    }

    fn pinned_key(m: &Manager, id: &str) -> Option<String> {
        m.record(id).map(|r| hex(&r.device_key))
    }

    #[tokio::test]
    async fn repinned_device_file_dial_succeeds() {
        let (a, _others, svc, dialed) = rekeyed(PinPolicy::Repin).await;
        let fresh = key_of(&impostor_of("dev-b"));
        assert_eq!(dialed.unwrap(), fresh);
        assert_eq!(pinned_key(&a, "dev-b"), Some(fresh));
        assert_eq!(served(&svc), 1);
    }

    #[tokio::test]
    async fn refuse_policy_key_change_file_dial_is_denied() {
        let (a, _others, svc, dialed) = rekeyed(PinPolicy::Refuse).await;
        assert!(matches!(
            dialed,
            Err(FilesDialError::Handshake(HandshakeError::Pinned(
                ref id,
                Rejection::KeyChanged
            ))) if id == "dev-b"
        ));
        assert_eq!(served(&svc), 0);
        assert_eq!(a.peers().len(), 1);
        let first = key_of(&test_identity("dev-b"));
        assert_eq!(pinned_key(&a, "dev-b"), Some(first));
    }

    async fn remembered_b(before: &[SocketAddr]) -> (Manager, Manager, Arc<Recorder>) {
        let (a, _) = spawn("dev-a", 1).await;
        let (b, _) = spawn("dev-b", 1).await;
        let svc = recording(&b);
        a.spend_budget();
        let now = now_secs();
        let mut store = a.shared.store();
        for (age, addr) in before.iter().copied().chain([local(&b)]).enumerate() {
            store.seed("dev-b", &[addr], now - age as u64);
        }
        drop(store);
        (a, b, svc)
    }

    fn budget_used(m: &Manager) -> usize {
        lock(&m.shared.budget)
            .attempts
            .values()
            .map(VecDeque::len)
            .sum()
    }

    #[tokio::test]
    async fn open_files_reaches_an_unlisted_device_by_its_remembered_address() {
        let (a, _b, svc) = remembered_b(&[]).await;
        assert!(a.peers().is_empty());
        let key = key_of(&test_identity("dev-b"));
        assert_eq!(open(&a, "dev-b").await.unwrap(), key);
        assert_eq!(served(&svc), 1);
    }

    #[tokio::test]
    async fn open_files_tries_next_address_when_first_fails() {
        let (_socket, refusing) = reserved();
        let (a, b, svc) = remembered_b(&[refusing]).await;
        assert_eq!(a.shared.sweep_order("dev-b"), [refusing, local(&b)]);
        open(&a, "dev-b").await.unwrap();
        assert_eq!(served(&svc), 1);
    }

    #[tokio::test]
    async fn a_blocked_device_at_a_stale_address_does_not_stop_the_dial() {
        let (x, _ex) = spawn("dev-x", 1).await;
        let (a, _b, svc) = remembered_b(&[local(&x)]).await;
        a.shared.store().seed("dev-x", &[], now_secs());
        assert!(a.forget("dev-x").is_some());
        assert_eq!(
            open(&a, "dev-b").await.unwrap(),
            key_of(&test_identity("dev-b"))
        );
        assert_eq!(served(&svc), 1);
    }

    #[tokio::test]
    async fn file_dials_do_not_charge_the_dial_budget() {
        let (a, _b, svc) = remembered_b(&[]).await;
        assert_eq!(budget_used(&a), DIAL_BUDGET);
        open(&a, "dev-b").await.unwrap();
        assert_eq!(budget_used(&a), DIAL_BUDGET);
        assert_eq!(served(&svc), 1);
    }

    #[tokio::test]
    async fn file_dial_never_lists_or_records() {
        let (a, b, _svc) = remembered_b(&[]).await;
        let recorded = |m: &Manager, id| m.record(id).map(|r| r.addrs);
        let before = (recorded(&a, "dev-b"), a.candidates());
        open(&a, "dev-b").await.unwrap();
        until("handshakes settle", || idle(&a) && idle(&b)).await;
        assert!(a.peers().is_empty() && b.peers().is_empty());
        assert_eq!((recorded(&a, "dev-b"), a.candidates()), before);
        assert_eq!(recorded(&b, "dev-a"), Some(vec![]));
    }

    fn presence_is(id: &'static str, state: PresenceState) -> impl Fn(&ManagerEvent) -> bool {
        move |e| matches!(e, ManagerEvent::Presence { device_id, state: s } if device_id == id && *s == state)
    }

    fn farewell_sent(id: &'static str) -> impl Fn(&ManagerEvent) -> bool {
        move |e| matches!(e, ManagerEvent::FarewellSent { device_id } if device_id == id)
    }

    #[tokio::test]
    async fn group_scope_never_accepts_vault_key() {
        let group = Trust::grouped(&[9], &["dev-a"]);
        let (m, _em) = spawn_as(test_identity("dev-m"), PeerStore::memory(), group).await;
        let refused = raw_link(&m, &test_identity("dev-a"), &[1]).await;
        assert!(matches!(refused, Err(HandshakeError::NotTrusted)));

        let (a, _ea) = spawn("dev-a", 1).await;
        a.connect(local(&m), Source::Mdns).await;
        until("handshakes settle", || idle(&a) && idle(&m)).await;
        assert!(m.peers().is_empty() && a.peers().is_empty());
        assert!(m.record("dev-a").is_none());

        let (_session, _fd) = greeted(&m, &test_identity("dev-a"), &[9]).await;
        until("group member listed", || m.peers().len() == 1).await;
    }

    #[tokio::test]
    async fn old_epoch_only_from_listed_members() {
        let group = Trust::grouped(&[2, 3], &["dev-l"]);
        let (m, mut em) = spawn_as(test_identity("dev-m"), PeerStore::memory(), group).await;
        let (mut unlisted, _fd) = raw_link(&m, &test_identity("dev-u"), &[3]).await.unwrap();
        assert_eq!(unlisted.recv().await.unwrap(), Frame::Bye);
        drop(unlisted);

        let (_member, _fd) = greeted(&m, &test_identity("dev-l"), &[3]).await;
        next_event(&mut em, listed("dev-l")).await;
        let (_newcomer, _fd) = greeted(&m, &test_identity("dev-n"), &[2]).await;
        next_event(&mut em, listed("dev-n")).await;
        until("handshakes settle", || idle(&m)).await;
        assert!(m.record("dev-u").is_none());
        assert_eq!(rejections(&mut em), vec![]);

        m.set_members(vec![member_of(&test_identity("dev-u"))]);
        let (_readmitted, _fd) = greeted(&m, &test_identity("dev-u"), &[3]).await;
        next_event(&mut em, listed("dev-u")).await;
    }

    async fn gone_and_member(
        leaver: Trust,
    ) -> (
        (Manager, mpsc::Receiver<ManagerEvent>),
        (Manager, mpsc::Receiver<ManagerEvent>),
    ) {
        let l = spawn_as(test_identity("dev-l"), PeerStore::memory(), leaver).await;
        let group = Trust::grouped(&[9], &["dev-l"]);
        let m = spawn_as(test_identity("dev-m"), PeerStore::memory(), group).await;
        (l, m)
    }

    #[tokio::test]
    async fn farewell_link_says_moved_and_leaves() {
        let ((l, mut el), (m, mut em)) = gone_and_member(moved_to_account(1, 9)).await;
        l.connect(local(&m), Source::Mdns).await;
        next_event(&mut el, farewell_sent("dev-m")).await;
        let mut seen = next_event(&mut em, presence_is("dev-l", PresenceState::Moved)).await;
        until("handshakes settle", || idle(&l) && idle(&m)).await;
        seen.extend(std::iter::from_fn(|| em.try_recv().ok()));
        assert!(!seen.iter().any(listed("dev-l")), "{seen:?}");
        assert!(m.peers().is_empty() && l.peers().is_empty());
    }

    async fn left_device() -> (Manager, mpsc::Receiver<ManagerEvent>) {
        let (tx, rx) = mpsc::channel(64);
        let me = test_identity("dev-l");
        let store = PeerStore::memory();
        let l = start(me, left_group(9), false, false, store, tx)
            .await
            .unwrap();
        (l, rx)
    }

    async fn member_listing(
        device_id: &str,
        key: [u8; 32],
    ) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        let member = Member {
            device_id: device_id.into(),
            key,
        };
        let trust = Trust {
            members: Some(vec![member]),
            ..Trust::grouped(&[9], &[])
        };
        spawn_as(test_identity("dev-m"), PeerStore::memory(), trust).await
    }

    #[tokio::test]
    async fn a_device_that_left_listens_nowhere_yet_tells_a_member_it_left() {
        let (l, mut el) = left_device().await;
        assert!(l.port.is_none());
        assert_eq!(l.tasks.len(), 2, "no accept loop");
        let (m, mut em) = member_listing("dev-l", test_identity("dev-l").key.public).await;
        l.connect(local(&m), Source::Mdns).await;
        next_event(&mut el, farewell_sent("dev-m")).await;
        let mut seen = next_event(&mut em, presence_is("dev-l", PresenceState::Left)).await;
        until("handshakes settle", || idle(&l) && idle(&m)).await;
        seen.extend(std::iter::from_fn(|| em.try_recv().ok()));
        assert!(!seen.iter().any(listed("dev-l")), "{seen:?}");
        assert!(!seen.iter().any(presence_is("dev-l", PresenceState::Moved)));
        assert!(l.record("dev-m").is_none());
        assert!(m.peers().is_empty() && l.peers().is_empty());
    }

    async fn left_with_remembered_member() -> (Manager, Events, Manager, Events) {
        let (m, em) = member_listing("dev-l", test_identity("dev-l").key.public).await;
        let mut store = PeerStore::memory();
        store.seed("dev-m", &[local(&m)], now_secs());
        let (tx, el) = mpsc::channel(64);
        let l = start(
            test_identity("dev-l"),
            left_group(9),
            false,
            false,
            store,
            tx,
        )
        .await
        .unwrap();
        (l, el, m, em)
    }

    #[tokio::test]
    async fn a_device_that_left_says_farewell_at_a_remembered_address_without_listening() {
        let (l, mut el, _m, mut em) = left_with_remembered_member().await;
        assert!(l.port.is_none());
        assert!(l.shared.me.addrs.as_ref()().is_empty());
        next_event(&mut el, farewell_sent("dev-m")).await;
        next_event(&mut em, presence_is("dev-l", PresenceState::Left)).await;
        let seen: Vec<_> = std::iter::from_fn(|| el.try_recv().ok()).collect();
        assert!(!seen.iter().any(|e| matches!(e, ManagerEvent::OwnAddrs(_))));
    }

    #[tokio::test]
    async fn a_member_that_heard_the_farewell_is_not_dialed_again() {
        let (_l, mut el, _m, _em) = left_with_remembered_member().await;
        next_event(&mut el, farewell_sent("dev-m")).await;
        tokio::time::sleep(RETRY_FIRST * 6).await;
        let again: Vec<_> = std::iter::from_fn(|| el.try_recv().ok()).collect();
        assert!(!again.iter().any(farewell_sent("dev-m")), "{again:?}");
    }

    #[tokio::test]
    async fn a_manager_without_sync_keys_never_dials() {
        let (b, _eb) = spawn("dev-b", 1).await;
        for trust in [unpaired(), Trust::grouped(&[], &["dev-b"])] {
            let (tx, _rx) = mpsc::channel(64);
            let store = PeerStore::memory();
            let m = start(test_identity("dev-p"), trust, false, false, store, tx)
                .await
                .unwrap();
            assert_eq!(
                m.connect(local(&b), Source::Mdns).await,
                DialOutcome::Skipped
            );
        }
    }

    #[tokio::test]
    async fn a_group_without_epochs_neither_listens_nor_pairs() {
        let (tx, _rx) = mpsc::channel(64);
        let trust = Trust::grouped(&[], &["dev-a"]);
        let m = start(
            test_identity("dev-g"),
            trust,
            false,
            false,
            PeerStore::memory(),
            tx,
        )
        .await
        .unwrap();
        assert!(m.port.is_none());
        assert!(m.open_pairing(pair_info(None, 0)).await.is_err());
    }

    #[tokio::test]
    async fn left_counts_only_from_the_key_listed_for_that_device() {
        let (l, mut el) = left_device().await;
        let (m, mut em) = member_listing("dev-l", test_identity("dev-x").key.public).await;
        l.connect(local(&m), Source::Mdns).await;
        next_event(&mut el, farewell_sent("dev-m")).await;
        until("handshakes settle", || idle(&l) && idle(&m)).await;
        let seen: Vec<_> = std::iter::from_fn(|| em.try_recv().ok()).collect();
        assert!(
            !seen.iter().any(presence_is("dev-l", PresenceState::Left)),
            "{seen:?}"
        );
    }

    #[tokio::test]
    async fn farewell_link_pins_nothing() {
        let ((l, mut el), (m, mut em)) = gone_and_member(moved_to_account(1, 9)).await;
        m.connect(local(&l), Source::Mdns).await;
        next_event(&mut el, farewell_sent("dev-m")).await;
        next_event(&mut em, presence_is("dev-l", PresenceState::Moved)).await;
        until("handshakes settle", || idle(&l) && idle(&m)).await;
        assert!(l.record("dev-m").is_none());
        assert!(dialable(&m).is_empty());
        assert!(m.peers().is_empty() && l.peers().is_empty());
    }

    #[tokio::test]
    async fn paused_presence_reaches_peer() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        a.connect(local(&b), Source::Mdns).await;
        both_listed(&a, &b).await;
        assert_eq!(b.peers()[0].presence, PresenceState::Live);

        a.set_paused(true);
        next_event(&mut eb, presence_is("dev-a", PresenceState::Paused)).await;
        let row = serde_json::to_value(&b.peers()[0]).unwrap();
        assert_eq!(row["presence"], "paused");

        let (mut c, _fd) = raw_peer(&a, "dev-c").await;
        assert_eq!(
            c.recv().await.unwrap(),
            presence_frame(PresenceState::Paused)
        );
        until("paused manager lists c", || a.peers().len() == 2).await;

        a.set_paused(false);
        next_event(&mut eb, presence_is("dev-a", PresenceState::Live)).await;
        assert_eq!(b.peers()[0].presence, PresenceState::Live);
    }

    type Events = mpsc::Receiver<ManagerEvent>;

    fn unpaired() -> Trust {
        Trust {
            keys: test_keys(&[]),
            members: None,
            farewell: None,
        }
    }

    fn pair_info(group: Option<&str>, entities: u32) -> PairInfo {
        PairInfo {
            mode: "none".into(),
            group: group.map(Into::into),
            entities,
            members: 0,
            reverify: false,
        }
    }

    fn grant() -> GroupGrant {
        GroupGrant {
            group_id: "g".into(),
            vault_key: "ab".repeat(32),
            secrets: vec![EpochSecret {
                epoch: 1,
                secret: "cd".repeat(32),
            }],
            host_name: "dev-a name".into(),
        }
    }

    async fn idle_pairing(id: &str) -> (Manager, Events) {
        spawn_as(test_identity(id), PeerStore::memory(), unpaired()).await
    }

    async fn pairing(id: &str, info: PairInfo) -> (Manager, Events) {
        let (m, rx) = idle_pairing(id).await;
        m.open_pairing(info).await.unwrap();
        (m, rx)
    }

    async fn until_pair(rx: &mut Events, wanted: impl Fn(&PairEvent) -> bool) -> Vec<ManagerEvent> {
        next_event(rx, |e| matches!(e, ManagerEvent::Pair(p) if wanted(p))).await
    }

    async fn pair_event(rx: &mut Events, wanted: impl Fn(&PairEvent) -> bool) -> PairEvent {
        match until_pair(rx, wanted).await.pop() {
            Some(ManagerEvent::Pair(p)) => p,
            other => unreachable!("{other:?}"),
        }
    }

    fn any_pair(_: &PairEvent) -> bool {
        true
    }

    fn is_code(e: &PairEvent) -> bool {
        matches!(e, PairEvent::Code { .. })
    }

    fn ended(reason: PairRefusal) -> PairEvent {
        PairEvent::Ended { reason }
    }

    fn no_pair_events(rx: &mut Events) -> bool {
        !std::iter::from_fn(|| rx.try_recv().ok()).any(|e| matches!(e, ManagerEvent::Pair(_)))
    }

    async fn codes(
        d: &Manager,
        ed: &mut Events,
        c: &Manager,
        ec: &mut Events,
    ) -> (PairEvent, PairEvent) {
        d.connect_pair(local(c));
        (pair_event(ed, is_code).await, pair_event(ec, is_code).await)
    }

    async fn cancelled_attempt(d: &Manager, ed: &mut Events, c: &Manager, ec: &mut Events) {
        codes(d, ed, c, ec).await;
        d.cancel_pairing();
        let cancelled = ended(PairRefusal::Cancelled);
        assert_eq!(pair_event(ed, any_pair).await, cancelled);
        assert_eq!(pair_event(ec, any_pair).await, cancelled);
    }

    fn closed(reason: PairRefusal) -> PairEvent {
        PairEvent::Closed { reason }
    }

    struct FakeMdns {
        name: &'static str,
        seen: Vec<Found>,
    }

    impl Advertiser for FakeMdns {
        fn set_pairable(&self, on: bool) -> Result<Option<String>, DiscoveryError> {
            Ok(on.then(|| self.name.to_string()))
        }

        fn pairable_peers(&self) -> Vec<Found> {
            self.seen.clone()
        }
    }

    fn advertise(m: &Manager, name: &'static str, seen: Vec<Found>) {
        *lock(&m.shared.discovery) = Some(Box::new(FakeMdns { name, seen }));
    }

    fn sighting(instance: &str, addr: SocketAddr) -> Found {
        Found {
            addr,
            instance: instance.into(),
            pairable: true,
        }
    }

    async fn confirm_both(
        host: &Manager,
        eh: &mut Events,
        joiner: &Manager,
        ej: &mut Events,
    ) -> Vec<ManagerEvent> {
        host.confirm_pairing(Some(grant())).await.unwrap();
        assert_eq!(pair_event(ej, any_pair).await, PairEvent::PeerConfirmed);
        joiner.confirm_pairing(None).await.unwrap();
        let mut seen = until_pair(ej, |e| matches!(e, PairEvent::Granted { .. })).await;
        let granted = PairEvent::Granted { grant: grant() };
        assert!(matches!(seen.last(), Some(ManagerEvent::Pair(p)) if *p == granted));
        seen.extend(until_pair(eh, |e| *e == PairEvent::Done).await);
        seen
    }

    async fn raw_pair(m: &Manager, id: &str, info: PairInfo) -> Session {
        let stream = TcpStream::connect(local(m)).await.unwrap();
        let shaken = handshake_with(stream, true, &test_identity(id), Mode::Pair).await;
        let mut session = shaken.unwrap().session;
        session.send(&Frame::Pair(Pair::Info(info))).await.unwrap();
        assert!(matches!(
            session.recv().await.unwrap(),
            Frame::Pair(Pair::Info(_))
        ));
        session
    }

    fn attempts(m: &Manager) -> u32 {
        m.shared.pairing().as_ref().map_or(0, |w| w.attempts)
    }

    fn member_of(me: &LocalIdentity) -> Member {
        Member {
            device_id: me.device_id.clone(),
            key: me.key.public,
        }
    }

    fn pinned(id: &LocalIdentity, forgotten: bool) -> PeerStore {
        let mut store = PeerStore::memory();
        store.decide(&id.device_id, &id.key.public, 1, PinPolicy::Refuse);
        if forgotten {
            assert!(store.forget(&id.device_id, 2).is_some());
        }
        store
    }

    async fn refused_link(m: &Manager, me: &LocalIdentity) {
        let (mut session, _fd) = raw_link(m, me, &[1]).await.unwrap();
        assert_eq!(session.recv().await.unwrap(), Frame::Bye);
        until("handshakes settle", || idle(m)).await;
    }

    async fn group_pairing(
        me: LocalIdentity,
        store: PeerStore,
        members: &[&str],
        entities: u32,
    ) -> (Manager, Events) {
        let (m, rx) = spawn_as(me, store, Trust::grouped(&[1], members)).await;
        m.open_pairing(pair_info(Some("g"), entities))
            .await
            .unwrap();
        (m, rx)
    }

    fn role_of(e: &PairEvent) -> (Role, bool) {
        match e {
            PairEvent::Code { role, reverify, .. } => (*role, *reverify),
            other => unreachable!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn re_pairing_a_key_changed_member_re_pins_it() {
        let rebooted = impostor_of("dev-p");
        let pins = pinned(&test_identity("dev-p"), false);
        let (m, mut em) = group_pairing(test_identity("dev-m"), pins, &["dev-p"], 5).await;
        refused_link(&m, &rebooted).await;
        assert_eq!(
            rejections(&mut em),
            vec![("dev-p".to_string(), Rejection::KeyChanged)]
        );
        let (p, mut ep) =
            group_pairing(impostor_of("dev-p"), PeerStore::memory(), &["dev-m"], 3).await;

        let (on_p, on_m) = codes(&p, &mut ep, &m, &mut em).await;
        assert_eq!(
            (role_of(&on_m), role_of(&on_p)),
            ((Role::Host, true), (Role::Joiner, true))
        );
        confirm_both(&m, &mut em, &p, &mut ep).await;

        assert_eq!(m.record("dev-p").unwrap().device_key, rebooted.key.public);
        let (_session, _fd) = raw_peer_as(&m, &rebooted).await;
        next_event(&mut em, listed("dev-p")).await;
    }

    #[tokio::test]
    async fn a_cancelled_re_pairing_leaves_the_pin_alone() {
        let rebooted = impostor_of("dev-p");
        let pins = pinned(&test_identity("dev-p"), false);
        let (m, mut em) = group_pairing(test_identity("dev-m"), pins, &["dev-p"], 5).await;
        let (p, mut ep) =
            group_pairing(impostor_of("dev-p"), PeerStore::memory(), &["dev-m"], 3).await;

        cancelled_attempt(&p, &mut ep, &m, &mut em).await;

        assert_eq!(
            m.record("dev-p").unwrap().device_key,
            test_identity("dev-p").key.public
        );
        refused_link(&m, &rebooted).await;
    }

    #[tokio::test]
    async fn re_pairing_a_forgotten_member_unblocks_it() {
        let forgotten = test_identity("dev-f");
        let blocked = pinned(&forgotten, true);
        let (m, mut em) = group_pairing(test_identity("dev-m"), blocked, &[], 5).await;
        refused_link(&m, &forgotten).await;
        let (f, mut ef) =
            group_pairing(test_identity("dev-f"), PeerStore::memory(), &["dev-m"], 3).await;

        let (on_f, on_m) = codes(&f, &mut ef, &m, &mut em).await;
        assert_eq!(
            (role_of(&on_m), role_of(&on_f)),
            ((Role::Host, true), (Role::Joiner, true))
        );
        confirm_both(&m, &mut em, &f, &mut ef).await;

        let (_session, _fd) = raw_peer_as(&m, &forgotten).await;
        next_event(&mut em, listed("dev-f")).await;
    }

    #[tokio::test]
    async fn listed_members_with_matching_keys_stay_already_paired() {
        let (m, mut em) =
            group_pairing(test_identity("dev-m"), PeerStore::memory(), &["dev-n"], 5).await;
        let (n, mut en) =
            group_pairing(test_identity("dev-n"), PeerStore::memory(), &["dev-m"], 3).await;

        n.connect_pair(local(&m));

        let refused = ended(PairRefusal::AlreadyPaired);
        assert_eq!(pair_event(&mut em, any_pair).await, refused);
        assert_eq!(pair_event(&mut en, any_pair).await, refused);
    }

    #[tokio::test]
    async fn a_member_entry_vouches_a_changed_or_forgotten_key() {
        let rebooted = impostor_of("dev-p");
        let forgotten = test_identity("dev-f");
        let mut store = pinned(&test_identity("dev-p"), false);
        store.decide("dev-f", &forgotten.key.public, 1, PinPolicy::Refuse);
        assert!(store.forget("dev-f", 2).is_some());
        let (e, mut ee) = spawn_as(
            test_identity("dev-e"),
            store,
            Trust::grouped(&[1], &["dev-p"]),
        )
        .await;
        refused_link(&e, &rebooted).await;
        refused_link(&e, &forgotten).await;

        e.set_members(vec![member_of(&rebooted), member_of(&forgotten)]);

        let (_p, _fp) = raw_peer_as(&e, &rebooted).await;
        next_event(&mut ee, listed("dev-p")).await;
        let (_f, _ff) = raw_peer_as(&e, &forgotten).await;
        next_event(&mut ee, listed("dev-f")).await;
    }

    #[tokio::test]
    async fn the_host_links_a_re_paired_device_without_a_restart() {
        let pins = pinned(&test_identity("dev-p"), false);
        let (m, mut em) = group_pairing(test_identity("dev-m"), pins, &["dev-p"], 5).await;
        let (p, mut ep) =
            group_pairing(impostor_of("dev-p"), PeerStore::memory(), &["dev-m"], 3).await;
        m.connect(local(&p), Source::Mdns).await;
        next_event(&mut em, rejected).await;
        until("refused dial settles", || idle(&m)).await;

        codes(&p, &mut ep, &m, &mut em).await;
        confirm_both(&m, &mut em, &p, &mut ep).await;

        next_event(&mut em, listed("dev-p")).await;
    }

    #[tokio::test]
    async fn a_member_links_a_device_once_its_entry_vouches_it() {
        let rebooted = impostor_of("dev-p");
        let pins = pinned(&test_identity("dev-p"), false);
        let (b, mut eb) = spawn_as(
            test_identity("dev-b"),
            pins,
            Trust::grouped(&[1], &["dev-p"]),
        )
        .await;
        let (p, _ep) = spawn_as(
            impostor_of("dev-p"),
            PeerStore::memory(),
            Trust::grouped(&[1], &["dev-b"]),
        )
        .await;
        b.connect(local(&p), Source::Mdns).await;
        next_event(&mut eb, rejected).await;
        until("refused dial settles", || idle(&b)).await;

        b.set_members(vec![member_of(&rebooted)]);

        next_event(&mut eb, listed("dev-p")).await;
    }

    #[tokio::test]
    async fn a_vouched_device_is_reported_again_if_its_key_changes_again() {
        let rebooted = impostor_of("dev-p");
        let again = LocalIdentity {
            key: DeviceKey::from_private([9; 32]),
            ..test_identity("dev-p")
        };
        let pins = pinned(&test_identity("dev-p"), false);
        let (e, mut ee) = spawn_as(
            test_identity("dev-e"),
            pins,
            Trust::grouped(&[1], &["dev-p"]),
        )
        .await;
        refused_link(&e, &rebooted).await;
        assert_eq!(
            rejections(&mut ee),
            vec![("dev-p".to_string(), Rejection::KeyChanged)]
        );

        e.set_members(vec![member_of(&rebooted)]);
        refused_link(&e, &again).await;

        assert_eq!(
            rejections(&mut ee),
            vec![("dev-p".to_string(), Rejection::KeyChanged)]
        );
    }

    #[tokio::test]
    async fn members_listed_at_start_are_vouched() {
        let rebooted = impostor_of("dev-p");
        let forgotten = test_identity("dev-f");
        let mut store = pinned(&test_identity("dev-p"), false);
        store.decide("dev-f", &forgotten.key.public, 1, PinPolicy::Refuse);
        assert!(store.forget("dev-f", 2).is_some());
        let trust = Trust {
            members: Some(vec![member_of(&rebooted), member_of(&forgotten)]),
            ..Trust::grouped(&[1], &[])
        };
        let (e, mut ee) = spawn_as(test_identity("dev-e"), store, trust).await;

        let (_p, _fp) = raw_peer_as(&e, &rebooted).await;
        next_event(&mut ee, listed("dev-p")).await;
        assert_eq!(e.record("dev-p").unwrap().device_key, rebooted.key.public);
        let (_f, _ff) = raw_peer_as(&e, &forgotten).await;
        next_event(&mut ee, listed("dev-f")).await;
    }

    #[tokio::test]
    async fn pairing_shows_same_code_and_grants_joiner() {
        let (a, mut ea) = pairing("dev-a", pair_info(Some("g"), 5)).await;
        let (b, mut eb) = pairing("dev-b", pair_info(None, 3)).await;
        let (on_b, on_a) = codes(&b, &mut eb, &a, &mut ea).await;
        let PairEvent::Code { sas, .. } = on_a else {
            panic!("{on_a:?}")
        };
        assert_eq!(
            on_a,
            PairEvent::Code {
                sas,
                role: Role::Host,
                peer_id: "dev-b".into(),
                peer_key: encode_hex32(&test_identity("dev-b").key.public),
                peer_name: "dev-b name".into(),
                peer_platform: "linux".into(),
                peer_entities: 3,
                reverify: false,
            }
        );
        assert_eq!(
            on_b,
            PairEvent::Code {
                sas,
                role: Role::Joiner,
                peer_id: "dev-a".into(),
                peer_key: encode_hex32(&test_identity("dev-a").key.public),
                peer_name: "dev-a name".into(),
                peer_platform: "linux".into(),
                peer_entities: 5,
                reverify: false,
            }
        );

        let mut bad = grant();
        bad.vault_key = "zz".into();
        assert!(a.confirm_pairing(Some(bad)).await.is_err());
        assert!(a.confirm_pairing(None).await.is_err());
        assert!(b.confirm_pairing(Some(grant())).await.is_err());
        confirm_both(&a, &mut ea, &b, &mut eb).await;
        until("both windows close", || {
            !a.shared.pairing_open() && !b.shared.pairing_open()
        })
        .await;
    }

    #[tokio::test]
    async fn pair_refused_without_window() {
        let (a, mut ea) = idle_pairing("dev-a").await;
        let (b, mut eb) = pairing("dev-b", pair_info(None, 0)).await;
        b.connect_pair(local(&a)).await.unwrap();
        until("handshakes settle", || idle(&a) && idle(&b)).await;
        assert!(no_pair_events(&mut ea) && no_pair_events(&mut eb));
        assert!(a.peers().is_empty() && b.peers().is_empty());

        a.open_pairing(pair_info(None, 1)).await.unwrap();
        codes(&b, &mut eb, &a, &mut ea).await;
    }

    #[tokio::test]
    async fn second_pair_session_gets_bye() {
        let (a, mut ea) = pairing("dev-a", pair_info(Some("g"), 5)).await;
        let (b, mut eb) = pairing("dev-b", pair_info(None, 3)).await;
        let (c, mut ec) = pairing("dev-c", pair_info(None, 0)).await;
        codes(&b, &mut eb, &a, &mut ea).await;
        c.connect_pair(local(&a)).await.unwrap();
        assert_eq!(
            pair_event(&mut ec, any_pair).await,
            ended(PairRefusal::Busy)
        );

        let seen = confirm_both(&a, &mut ea, &b, &mut eb).await;
        let stray = |e: &ManagerEvent| {
            matches!(
                e,
                ManagerEvent::Pair(PairEvent::Code { .. } | PairEvent::Ended { .. })
            )
        };
        assert!(!seen.iter().any(stray), "{seen:?}");
    }

    #[tokio::test]
    async fn pair_rate_limit_per_ip() {
        let (a, mut ea) = pairing("dev-a", pair_info(None, 0)).await;
        let (b, mut eb) = pairing("dev-b", pair_info(None, 0)).await;
        for _ in 0..PAIR_RATE {
            cancelled_attempt(&b, &mut eb, &a, &mut ea).await;
        }
        b.connect_pair(local(&a)).await.unwrap();
        assert_eq!(
            pair_event(&mut eb, any_pair).await,
            ended(PairRefusal::Busy)
        );
        until("handshakes settle", || idle(&a)).await;
        assert!(no_pair_events(&mut ea));
        assert_eq!(attempts(&a), PAIR_RATE as u32);
    }

    #[tokio::test]
    async fn too_many_attempts_closes_window() {
        let (a, mut ea) = pairing("dev-a", pair_info(None, 0)).await;
        let (b, mut eb) = pairing("dev-b", pair_info(None, 0)).await;
        for i in 1..=PAIR_ATTEMPTS {
            // Alternating who dials keeps both sides under the per-IP pair rate.
            if i % 2 == 1 {
                cancelled_attempt(&b, &mut eb, &a, &mut ea).await;
            } else {
                cancelled_attempt(&a, &mut ea, &b, &mut eb).await;
            }
        }
        let too_many = closed(PairRefusal::TooManyAttempts);
        assert_eq!(pair_event(&mut ea, any_pair).await, too_many);
        assert_eq!(pair_event(&mut eb, any_pair).await, too_many);
        assert!(!a.shared.pairing_open() && !b.shared.pairing_open());
    }

    #[tokio::test]
    async fn pair_link_never_listed_as_peer() {
        let (a, mut ea) = pairing("dev-a", pair_info(Some("g"), 5)).await;
        let (b, mut eb) = pairing("dev-b", pair_info(None, 3)).await;
        codes(&b, &mut eb, &a, &mut ea).await;
        let mut seen = confirm_both(&a, &mut ea, &b, &mut eb).await;
        until("handshakes settle", || idle(&a) && idle(&b)).await;
        seen.extend(std::iter::from_fn(|| ea.try_recv().ok()));
        seen.extend(std::iter::from_fn(|| eb.try_recv().ok()));
        let listing = |e: &ManagerEvent| matches!(e, ManagerEvent::Peers(p) if !p.is_empty());
        assert!(!seen.iter().any(listing), "{seen:?}");
        assert!(a.peers().is_empty() && b.peers().is_empty());
        assert!(a.record("dev-b").is_none() && b.record("dev-a").is_none());
        assert!(dialable(&a).is_empty() && dialable(&b).is_empty());
    }

    #[tokio::test]
    async fn unconfirmed_code_times_out() {
        let (a, mut ea) = pairing("dev-a", pair_info(None, 0)).await;
        let mut silent = raw_pair(&a, "dev-s", pair_info(None, 1)).await;
        pair_event(&mut ea, is_code).await;
        assert_eq!(silent.recv().await.unwrap(), Frame::Pair(Pair::Cancel));
        assert_eq!(
            pair_event(&mut ea, any_pair).await,
            ended(PairRefusal::TimedOut)
        );
        assert_eq!(attempts(&a), 1);
        assert!(a.shared.pairing_open());
        assert!(no_pair_events(&mut ea));
    }

    #[tokio::test]
    async fn joiner_cancel_after_confirm_is_not_done_on_the_host() {
        let (a, mut ea) = pairing("dev-a", pair_info(Some("g"), 5)).await;
        let mut joiner = raw_pair(&a, "dev-j", pair_info(None, 0)).await;
        pair_event(&mut ea, is_code).await;
        a.confirm_pairing(Some(grant())).await.unwrap();
        assert_eq!(joiner.recv().await.unwrap(), Frame::Pair(Pair::Confirm));
        joiner.send(&Frame::Pair(Pair::Confirm)).await.unwrap();
        joiner.send(&Frame::Pair(Pair::Cancel)).await.unwrap();
        assert!(matches!(joiner.recv().await.unwrap(), Frame::Group(_)));
        let seen = until_pair(&mut ea, |e| matches!(e, PairEvent::Ended { .. })).await;
        let cancelled = ended(PairRefusal::Cancelled);
        assert!(matches!(seen.last(), Some(ManagerEvent::Pair(p)) if *p == cancelled));
        let done = |e: &ManagerEvent| matches!(e, ManagerEvent::Pair(PairEvent::Done));
        assert!(!seen.iter().any(done), "{seen:?}");
        assert!(a.shared.pairing_open());
        assert_eq!(attempts(&a), 1);
    }

    #[tokio::test]
    async fn pairs_with_dials_only_later_free_ipv4_windows() {
        let (m, _em) = idle_pairing("dev-m").await;
        let v4: SocketAddr = "10.0.0.2:1".parse().unwrap();
        let v6: SocketAddr = "[fe80::2]:1".parse().unwrap();
        let pairs = |instance, addr| m.shared.pairs_with(&sighting(instance, addr));
        assert!(!pairs("n", v4));
        advertise(&m, "m", vec![]);
        m.open_pairing(pair_info(None, 0)).await.unwrap();
        assert!(pairs("n", v4));
        assert!(!pairs("l", v4) && !pairs("m", v4) && !pairs("n", v6));
        let claim = m.shared.claim().unwrap();
        assert!(!pairs("n", v4));
        m.shared.free_session(claim.window);
        assert!(pairs("n", v4));
        m.close_pairing();
        assert!(!pairs("n", v4));
    }

    #[tokio::test]
    async fn opening_a_window_dials_a_window_seen_before() {
        let (b, mut eb) = pairing("dev-b", pair_info(None, 0)).await;
        let (a, mut ea) = idle_pairing("dev-a").await;
        advertise(&a, "a-window", vec![sighting("b-window", local(&b))]);
        a.open_pairing(pair_info(None, 1)).await.unwrap();
        pair_event(&mut ea, is_code).await;
        pair_event(&mut eb, is_code).await;
    }

    #[tokio::test]
    async fn a_cancelled_attempt_dials_the_seen_window_again() {
        let (b, mut eb) = pairing("dev-b", pair_info(None, 0)).await;
        let (a, mut ea) = idle_pairing("dev-a").await;
        advertise(&a, "a-window", vec![sighting("b-window", local(&b))]);
        a.open_pairing(pair_info(None, 1)).await.unwrap();
        pair_event(&mut ea, is_code).await;
        pair_event(&mut eb, is_code).await;
        b.cancel_pairing();
        let cancelled = ended(PairRefusal::Cancelled);
        assert_eq!(pair_event(&mut ea, any_pair).await, cancelled);
        assert_eq!(pair_event(&mut eb, any_pair).await, cancelled);
        pair_event(&mut ea, is_code).await;
        pair_event(&mut eb, is_code).await;
    }

    #[tokio::test]
    async fn closing_the_window_cancels_the_session_quietly() {
        let (a, mut ea) = pairing("dev-a", pair_info(None, 0)).await;
        let (b, mut eb) = pairing("dev-b", pair_info(None, 0)).await;
        codes(&b, &mut eb, &a, &mut ea).await;
        a.close_pairing();
        assert!(!a.shared.pairing_open());
        assert_eq!(
            pair_event(&mut eb, any_pair).await,
            ended(PairRefusal::Cancelled)
        );
        until("handshakes settle", || idle(&a)).await;
        tokio::time::sleep(LINGER).await;
        assert!(no_pair_events(&mut ea));
    }

    #[tokio::test]
    async fn window_closes_by_itself() {
        let (a, mut ea) = idle_pairing("dev-a").await;
        let short = Duration::from_millis(200);
        a.shared.open_window(pair_info(None, 0), short).unwrap();
        assert!(a.shared.pairing_open());
        assert_eq!(
            pair_event(&mut ea, any_pair).await,
            closed(PairRefusal::TimedOut)
        );
        assert!(!a.shared.pairing_open());
    }

    #[test]
    fn rate_limiter_allows_five_per_ten_seconds() {
        let mut limiter = RateLimiter::new(RATE_MAX, RATE_WINDOW);
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

    #[tokio::test]
    async fn mapped_ipv4_peer_is_listed_canonically() {
        let (b, mut eb) = spawn("dev-b", 1).await;
        let (_session, _fd) = raw_peer(&b, "dev-a").await;
        next_event(&mut eb, listed("dev-a")).await;
        let peer = b
            .peers()
            .into_iter()
            .find(|p| p.device_id == "dev-a")
            .unwrap();
        assert_eq!(peer.address, "127.0.0.1");
        assert_eq!(peer.route, Route::Lan);
    }

    #[tokio::test]
    async fn ipv6_peers_connect_over_loopback() {
        if std::net::TcpListener::bind("[::1]:0").is_err() {
            return;
        }
        let (a, mut ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        b.connect(
            SocketAddr::new(Ipv6Addr::LOCALHOST.into(), a.port()),
            Source::Mdns,
        )
        .await;
        next_event(&mut ea, listed("dev-b")).await;
        next_event(&mut eb, listed("dev-a")).await;
    }

    #[tokio::test]
    async fn bind_falls_back_to_ipv4_without_ipv6() {
        let listener = bind_with(|_| Err(std::io::Error::from_raw_os_error(97)))
            .await
            .unwrap();
        assert!(listener.local_addr().unwrap().is_ipv4());
        let (a, mut ea) = spawn_on("dev-a", 1, listener).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        b.connect(local(&a), Source::Mdns).await;
        next_event(&mut ea, listed("dev-b")).await;
        next_event(&mut eb, listed("dev-a")).await;
    }

    #[test]
    fn ipv6_rate_limit_is_per_64() {
        let mut limiter = RateLimiter::new(RATE_MAX, RATE_WINDOW);
        let t0 = Instant::now();
        let key = |s: &str| rate_key(s.parse().unwrap());
        for i in 1..=5 {
            assert!(limiter.allow(key(&format!("2001:db8:1:2::{i}")), t0), "{i}");
        }
        assert!(!limiter.allow(key("2001:db8:1:2::ffff"), t0));
        assert!(limiter.allow(key("2001:db8:1:3::1"), t0));
        assert_eq!(
            rate_key("10.0.0.2".parse().unwrap()),
            "10.0.0.2".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn global_ipv6_inbound_is_dropped() {
        let allowed = |s: &str| inbound_allowed(s.parse().unwrap());
        assert!(!allowed("2001:db8::1"));
        for ok in ["fd7a:115c:a1e0::1", "fe80::1", "::1", "8.8.8.8"] {
            assert!(allowed(ok), "{ok}");
        }
    }

    #[test]
    fn each_manager_kind_runs_only_its_own_paths() {
        use PinPolicy::{Refuse, Repin};
        let caps = |t: Trust| {
            let k = t.kind();
            let dials = (k.polls_tailnet(), k.dials(), k.learns());
            (k.listens(), dials, k.serves_files(), k.pairs(), k.policy())
        };
        let account = (true, (true, true, true), true, true, Repin);
        assert_eq!(caps(on_account(1)), account);
        assert_eq!(caps(moved_to_account(1, 9)), account);
        let group = (true, (true, true, false), false, true, Refuse);
        assert_eq!(caps(Trust::grouped(&[1], &[])), group);
        let pairing = (true, (false, false, false), false, true, Repin);
        assert_eq!(caps(unpaired()), pairing);
        let farewell = (false, (false, true, false), false, false, Refuse);
        assert_eq!(caps(left_group(9)), farewell);
        let inert = (false, (false, false, false), false, false, Refuse);
        assert_eq!(caps(Trust::grouped(&[], &["dev-a"])), inert);
    }

    #[tokio::test]
    async fn only_an_account_manager_learns_addresses() {
        let (_socket, addr) = reserved();
        for (trust, learns) in [
            (on_account(1), true),
            (moved_to_account(1, 9), true),
            (Trust::grouped(&[1], &[]), false),
            (unpaired(), false),
        ] {
            let (m, _em) = spawn_as(test_identity("dev-a"), PeerStore::memory(), trust).await;
            m.learn("dev-b", &[addr]);
            assert_eq!(dialable(&m).is_empty(), !learns, "{learns}");
        }
        let (l, _el) = left_device().await;
        l.learn("dev-b", &[addr]);
        assert!(dialable(&l).is_empty());
    }

    #[tokio::test]
    async fn a_pairing_only_manager_runs_no_retry_sweep() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (l, _el) = left_device().await;
        until("sweeps subscribed", || {
            a.shared.retry.receiver_count() == 1 && l.shared.retry.receiver_count() == 1
        })
        .await;
        let (p, _ep) = idle_pairing("dev-p").await;
        tokio::time::sleep(RETRY_FIRST).await;
        assert_eq!(p.shared.retry.receiver_count(), 0);
    }

    #[tokio::test]
    async fn group_scope_refuses_a_changed_key_on_every_dial_path() {
        let b = test_identity("dev-b");
        for source in [Source::Mdns, Source::Remembered, Source::Tailscale] {
            let group = Trust::grouped(&[1], &["dev-b"]);
            let (a, mut ea) = spawn_as(test_identity("dev-a"), pinned(&b, false), group).await;
            let (rekeyed, _er) = spawn_as(
                impostor_of("dev-b"),
                PeerStore::memory(),
                Trust::grouped(&[1], &[]),
            )
            .await;
            let dialed = a.connect(local(&rekeyed), source).await;
            assert_eq!(dialed, DialOutcome::Rejected, "{source:?}");
            let refused = vec![("dev-b".to_string(), Rejection::KeyChanged)];
            assert_eq!(rejections(&mut ea), refused, "{source:?}");
            assert_eq!(a.record("dev-b").unwrap().device_key, b.key.public);
            assert!(a.peers().is_empty());
        }
    }

    #[tokio::test]
    async fn a_moved_devices_file_dial_never_says_farewell() {
        let group = Trust::grouped(&[9], &["dev-l"]);
        let (m, mut em) = spawn_as(test_identity("dev-m"), PeerStore::memory(), group).await;
        let mut store = PeerStore::memory();
        store.seed("dev-m", &[], now_secs());
        let (l, mut el) = spawn_as(test_identity("dev-l"), store, moved_to_account(1, 9)).await;
        l.spend_budget();
        tag(&l, local(&m), "dev-m");
        assert!(open(&l, "dev-m").await.is_err());
        until("handshakes settle", || idle(&l) && idle(&m)).await;
        let on_l: Vec<_> = std::iter::from_fn(|| el.try_recv().ok()).collect();
        let on_m: Vec<_> = std::iter::from_fn(|| em.try_recv().ok()).collect();
        assert!(!on_l.iter().any(farewell_sent("dev-m")), "{on_l:?}");
        let moved = presence_is("dev-l", PresenceState::Moved);
        assert!(!on_m.iter().any(moved), "{on_m:?}");
    }

    #[tokio::test]
    async fn a_farewell_only_manager_never_opens_pairing() {
        let (l, _el) = left_device().await;
        assert!(l.open_pairing(pair_info(None, 0)).await.is_err());
        assert!(!l.shared.pairing_open());
    }

    #[tokio::test]
    async fn a_pair_attempt_over_ipv6_is_accepted() {
        if std::net::TcpListener::bind("[::1]:0").is_err() {
            return;
        }
        let (a, mut ea) = pairing("dev-a", pair_info(None, 0)).await;
        let (b, mut eb) = pairing("dev-b", pair_info(None, 0)).await;
        b.connect_pair(SocketAddr::new(Ipv6Addr::LOCALHOST.into(), a.port()));
        pair_event(&mut ea, is_code).await;
        pair_event(&mut eb, is_code).await;
    }
}
