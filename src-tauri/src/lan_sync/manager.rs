use super::discovery::{self, Discovery, DiscoveryError};
use super::handshake::{handshake, SessionReader, SessionWriter};
use super::identity::LocalIdentity;
use super::protocol::{Frame, Hello};
use super::route::{classify, Route};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Notify, OwnedSemaphorePermit, Semaphore};
use tokio::task::{AbortHandle, JoinHandle};
use tokio::time::timeout;

pub const PREFERRED_PORT: u16 = 47391;
const MAX_HANDSHAKES: usize = 16;
const RATE_MAX: usize = 5;
const RATE_WINDOW: Duration = Duration::from_secs(10);
const DIAL_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);
const OUTBOX: usize = 8;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub route: Route,
    pub address: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LanStatus {
    Running,
    Paused,
    Blocked,
    Stopped,
}

#[derive(Clone, Debug)]
pub enum ManagerEvent {
    Peers(Vec<PeerInfo>),
    BlobReady { device_id: String },
    Status(LanStatus),
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

async fn secure(
    stream: TcpStream,
    addr: SocketAddr,
    initiator: bool,
    shared: &Shared,
) -> Option<Link> {
    match handshake(stream, initiator, &shared.me, &shared.auth_keys).await {
        Ok((session, hello)) => {
            let session_id = session.handshake_hash().to_vec();
            let (reader, writer) = session.split();
            Some(Link {
                hello,
                addr,
                initiator,
                session_id,
                reader,
                writer,
            })
        }
        Err(e) => {
            log::debug!("lan-sync: handshake with {addr} failed: {e}");
            None
        }
    }
}

async fn establish(
    shared: Arc<Shared>,
    stream: TcpStream,
    addr: SocketAddr,
    initiator: bool,
    _permit: OwnedSemaphorePermit,
) {
    if let Some(link) = secure(stream, addr, initiator, &shared).await {
        shared.adopt(link);
    }
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
        let Ok(permit) = shared.handshakes.clone().try_acquire_owned() else {
            continue;
        };
        tokio::spawn(establish(shared.clone(), stream, addr, false, permit));
    }
}

async fn dial(shared: Arc<Shared>, addr: SocketAddr) {
    let Ok(permit) = shared.handshakes.clone().try_acquire_owned() else {
        return;
    };
    match timeout(DIAL_TIMEOUT, TcpStream::connect(addr)).await {
        Ok(Ok(stream)) => establish(shared, stream, addr, true, permit).await,
        Ok(Err(e)) => log::debug!("lan-sync: dial {addr} failed: {e}"),
        Err(_) => log::debug!("lan-sync: dial {addr} timed out"),
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

async fn send(writer: &mut SessionWriter, frame: &Frame) -> bool {
    matches!(timeout(WRITE_TIMEOUT, writer.send(frame)).await, Ok(Ok(())))
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Rank {
    higher_initiated: bool,
    session_id: Vec<u8>,
}

struct Peer {
    info: PeerInfo,
    rank: Rank,
    conn: u64,
    outbox: mpsc::Sender<Frame>,
    reader: AbortHandle,
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

#[derive(Default)]
struct State {
    peers: HashMap<String, Peer>,
    blobs: HashMap<String, Vec<u8>>,
    next_conn: u64,
    closed: bool,
}

struct Shared {
    me: LocalIdentity,
    auth_keys: Vec<[u8; 32]>,
    events: mpsc::Sender<ManagerEvent>,
    state: Mutex<State>,
    paused: AtomicBool,
    handshakes: Arc<Semaphore>,
    peers_changed: Notify,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn peers(&self) -> Vec<PeerInfo> {
        let mut peers: Vec<PeerInfo> = self.lock().peers.values().map(|p| p.info.clone()).collect();
        peers.sort_by(|a, b| a.device_id.cmp(&b.device_id));
        peers
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

    fn adopt(self: &Arc<Self>, link: Link) {
        if link.hello.device_id == self.me.device_id {
            return;
        }
        let rank = self.rank(&link);
        let mut state = self.lock();
        let id = link.hello.device_id.clone();
        if state.closed || state.peers.get(&id).is_some_and(|p| p.rank <= rank) {
            return;
        }
        state.next_conn += 1;
        let conn = state.next_conn;
        let (outbox, queued) = mpsc::channel(OUTBOX);
        let _ = outbox.try_send(Frame::Nudge);
        let info = PeerInfo {
            device_id: id.clone(),
            device_name: link.hello.device_name,
            platform: link.hello.platform,
            route: classify(link.addr.ip()),
            address: link.addr.ip().to_string(),
        };
        let reader = self.spawn_peer(id.clone(), conn, link.reader, link.writer, queued);
        state.peers.insert(
            id,
            Peer {
                info,
                rank,
                conn,
                outbox,
                reader,
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
        mut writer: SessionWriter,
        mut queued: mpsc::Receiver<Frame>,
    ) -> AbortHandle {
        let shared = self.clone();
        let from = id.clone();
        tokio::spawn(async move {
            while let Some(frame) = queued.recv().await {
                if !send(&mut writer, &frame).await {
                    break;
                }
            }
            shared.release(&from, conn);
        });
        let shared = self.clone();
        tokio::spawn(async move {
            while let Some(frame) = recv(&mut reader).await {
                shared.on_frame(&id, frame).await;
            }
            shared.release(&id, conn);
        })
        .abort_handle()
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

    fn release(&self, id: &str, conn: u64) {
        let mut state = self.lock();
        if state.peers.get(id).is_some_and(|p| p.conn == conn) {
            state.peers.remove(id);
            drop(state);
            self.peers_changed.notify_one();
        }
    }

    async fn status(&self, status: LanStatus) {
        let _ = self.events.send(ManagerEvent::Status(status)).await;
    }

    async fn discovery_failed(&self, e: DiscoveryError) {
        log::warn!("lan-sync: discovery: {e}");
        if e == DiscoveryError::Blocked {
            self.status(LanStatus::Blocked).await;
        }
    }
}

async fn emit_peers(shared: Arc<Shared>) {
    loop {
        shared.peers_changed.notified().await;
        let peers = shared.peers();
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
    discovery: Option<Discovery>,
}

pub async fn start(
    me: LocalIdentity,
    auth_keys: Vec<[u8; 32]>,
    discovery: bool,
    events: mpsc::Sender<ManagerEvent>,
) -> Result<Manager, String> {
    let listener = bind().await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let shared = Arc::new(Shared {
        me,
        auth_keys,
        events,
        state: Mutex::default(),
        paused: AtomicBool::new(false),
        handshakes: Arc::new(Semaphore::new(MAX_HANDSHAKES)),
        peers_changed: Notify::new(),
    });
    let mut manager = Manager {
        port,
        tasks: vec![
            tokio::spawn(accept_loop(listener, shared.clone())),
            tokio::spawn(emit_peers(shared.clone())),
        ],
        discovery: None,
        shared,
    };
    manager.shared.status(LanStatus::Running).await;
    if discovery {
        manager.start_discovery().await;
    }
    Ok(manager)
}

impl Manager {
    async fn start_discovery(&mut self) {
        let (found, mut found_rx) = mpsc::channel(32);
        let (errors, mut errors_rx) = mpsc::channel(8);
        let shared = self.shared.clone();
        self.tasks.push(tokio::spawn(async move {
            while let Some(addr) = found_rx.recv().await {
                tokio::spawn(dial(shared.clone(), addr));
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

    pub fn port(&self) -> u16 {
        self.port
    }

    pub async fn connect(&self, addr: SocketAddr) {
        dial(self.shared.clone(), addr).await;
    }

    pub async fn broadcast(&self, blob: Vec<u8>) {
        if self.shared.paused.load(Ordering::Relaxed) {
            return;
        }
        let outboxes: Vec<_> = self
            .shared
            .lock()
            .peers
            .values()
            .map(|p| p.outbox.clone())
            .collect();
        for outbox in outboxes {
            let _ = outbox.send(Frame::Blob(blob.clone())).await;
        }
    }

    pub fn take_blob(&self, device_id: &str) -> Option<Vec<u8>> {
        self.shared.lock().blobs.remove(device_id)
    }

    pub fn peers(&self) -> Vec<PeerInfo> {
        self.shared.peers()
    }

    pub fn set_paused(&self, paused: bool) {
        self.shared.paused.store(paused, Ordering::Relaxed);
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
        self.shared.status(LanStatus::Stopped).await;
    }
}

impl Drop for Manager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan_sync::identity::{derive_auth_key, test_identity};
    use std::io::Write;

    async fn spawn(id: &str, account: u8) -> (Manager, mpsc::Receiver<ManagerEvent>) {
        let (tx, rx) = mpsc::channel(64);
        let keys = vec![derive_auth_key(&[account; 32])];
        let manager = start(test_identity(id), keys, false, tx).await.unwrap();
        (manager, rx)
    }

    fn local(m: &Manager) -> SocketAddr {
        (Ipv4Addr::LOCALHOST, m.port()).into()
    }

    fn idle(m: &Manager) -> bool {
        m.shared.handshakes.available_permits() == MAX_HANDSHAKES
    }

    async fn until(what: &str, cond: impl Fn() -> bool) {
        let poll = async {
            while !cond() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        if timeout(Duration::from_secs(10), poll).await.is_err() {
            panic!("timed out waiting for {what}");
        }
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
        until("both peers", || {
            a.peers().len() == 1 && b.peers().len() == 1
        })
        .await;
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
        let kept = |m: &Manager, id: &str| m.shared.lock().peers.get(id).map(|p| p.rank.clone());
        let on_a = kept(&a, "dev-b").expect("a lost b");
        assert!(!on_a.higher_initiated);
        assert_eq!(Some(on_a), kept(&b, "dev-a"));

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
        let raw = std::net::TcpStream::connect(local(&a)).unwrap();
        let mut cut = raw.try_clone().unwrap();
        raw.set_nonblocking(true).unwrap();
        let stream = TcpStream::from_std(raw).unwrap();
        let me = test_identity("dev-b");
        let (session, _) = handshake(stream, true, &me, &[derive_auth_key(&[1; 32])])
            .await
            .unwrap();
        next_event(
            &mut ea,
            |e| matches!(e, ManagerEvent::Peers(p) if p.len() == 1),
        )
        .await;

        cut.write_all(&[0x40, 0x00, 1, 2, 3]).unwrap();
        drop(session);
        drop(cut);
        next_event(&mut ea, no_peers).await;
        assert!(a.peers().is_empty());
    }

    #[tokio::test]
    async fn paused_manager_ignores_blobs() {
        let (a, _ea) = spawn("dev-a", 1).await;
        let (b, mut eb) = spawn("dev-b", 1).await;
        b.set_paused(true);
        a.connect(local(&b)).await;
        until("both peers", || {
            a.peers().len() == 1 && b.peers().len() == 1
        })
        .await;
        next_event(
            &mut eb,
            |e| matches!(e, ManagerEvent::Peers(p) if p.len() == 1),
        )
        .await;

        a.broadcast(vec![5; 10]).await;
        a.stop().await;
        let seen = next_event(&mut eb, no_peers).await;
        assert!(!seen.iter().any(blob_from("dev-a")), "{seen:?}");
        assert_eq!(b.take_blob("dev-a"), None);
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
