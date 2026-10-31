use super::raw_body;
use crate::device_files::link::DeviceLinks;
#[cfg(desktop)]
use crate::device_files::{for_account, service::FileService, stop_where, Slot};
use crate::lan_sync::addrs;
use crate::lan_sync::handshake::valid_device_id;
use crate::lan_sync::identity::{
    derive_auth_key, load_or_create_device_key, DeviceKey, LocalIdentity,
};
use crate::lan_sync::lock;
use crate::lan_sync::manager::{
    self, Farewell, LanStatus, Manager, ManagerEvent, Member, PeerInfo, Trust,
};
use crate::lan_sync::pairing::PairEvent;
use crate::lan_sync::peers::{encode_hex32, now_secs, parse_hex32, write_snapshot, PeerStore};
use crate::lan_sync::protocol::{GroupGrant, PairInfo, PresenceState};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, OnceCell};
use zeroize::Zeroizing;

const EVENTS: usize = 64;
const PEERS: &str = "lan-sync://peers";
const BLOB_READY: &str = "lan-sync://blob-ready";
const STATUS: &str = "lan-sync://status";
const REJECTED: &str = "lan-sync://rejected";
const PAIR: &str = "lan-sync://pair";
const PRESENCE: &str = "lan-sync://presence";
const FAREWELL_SENT: &str = "lan-sync://farewell-sent";

pub const OWN_ADDRS_FILE: &str = "lan_sync_addresses.json";

pub type Emit = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

#[derive(Default)]
struct Relay {
    epoch: u64,
    paused: bool,
    status: LanStatus,
    pairing_only: bool,
}

#[derive(Default)]
pub struct LanSyncState {
    manager: Arc<tokio::sync::Mutex<Option<Manager>>>,
    scope: Arc<Mutex<Option<String>>>,
    device_key: OnceCell<DeviceKey>,
    relay: Arc<Mutex<Relay>>,
    #[cfg(desktop)]
    pub(crate) files: crate::device_files::DeviceFilesState,
}

#[cfg(desktop)]
async fn offer_to(manager: &Manager, svc: Option<Arc<FileService>>) {
    let svc = svc.filter(|_| manager.serves_files());
    let files = svc.as_ref().is_some_and(|s| s.offers());
    manager.set_file_service(svc.map(|s| s as Arc<dyn manager::InboundFiles>));
    let caps = crate::lan_sync::protocol::Caps { files };
    manager.set_caps(caps).await;
}

impl LanSyncState {
    fn relay(&self) -> MutexGuard<'_, Relay> {
        lock(&self.relay)
    }

    fn announce(&self, emit: &Emit, status: LanStatus) {
        publish(&self.relay, None, emit, &ManagerEvent::Status(status));
    }

    #[cfg(desktop)]
    pub(crate) async fn offer_files(&self, slot: &Slot) {
        if let Some(manager) = self.manager.lock().await.as_ref() {
            let scope = lock(&self.scope).clone();
            let svc = scope.and_then(|s| for_account(slot, &s).cloned());
            offer_to(manager, svc).await;
        }
    }

    #[cfg(desktop)]
    async fn forget_files(&self, scope: &str, key: &str, dir: &Path, emit: &Emit) {
        let slot = self.files.service.lock().await;
        let forgotten = crate::commands::device_files::forget_device(&slot, dir, scope, key, emit);
        if let Err(e) = forgotten {
            log::warn!("device-files: revoking a forgotten device failed: {e}");
        }
    }

    async fn device_key(&self) -> Result<DeviceKey, String> {
        let key = self
            .device_key
            .get_or_try_init(|| async { load_or_create_device_key() })
            .await?;
        Ok(DeviceKey::from_private(key.private))
    }
}

fn status(s: LanStatus) -> (&'static str, Value) {
    (STATUS, json!(s))
}

fn payloads(event: &ManagerEvent, paused: bool) -> Vec<(&'static str, Value)> {
    match event {
        ManagerEvent::Peers(peers) => vec![(PEERS, json!(peers))],
        ManagerEvent::BlobReady { device_id } => {
            vec![(BLOB_READY, json!({ "deviceId": device_id }))]
        }
        ManagerEvent::Status(LanStatus::Running | LanStatus::Blocked) if paused => {
            vec![status(LanStatus::Paused)]
        }
        ManagerEvent::Status(LanStatus::Stopped) => {
            vec![(PEERS, json!([])), status(LanStatus::Stopped)]
        }
        ManagerEvent::Status(s) => vec![status(*s)],
        ManagerEvent::Rejected { device_id, reason } => {
            vec![(REJECTED, json!({ "deviceId": device_id, "reason": reason }))]
        }
        ManagerEvent::OwnAddrs(_) => vec![],
        ManagerEvent::Presence { device_id, state } => {
            vec![(PRESENCE, json!({ "deviceId": device_id, "state": state }))]
        }
        ManagerEvent::FarewellSent { device_id } => {
            vec![(FAREWELL_SENT, json!({ "deviceId": device_id }))]
        }
        ManagerEvent::Pair(event) => vec![(PAIR, json!(event))],
    }
}

fn write_own_addrs(dir: &Path, device_id: &str, addrs: &[SocketAddr]) -> std::io::Result<()> {
    let addrs: Vec<String> = addrs.iter().map(SocketAddr::to_string).collect();
    let body = json!({ "v": 1, "deviceId": device_id, "addrs": addrs });
    let path = dir.join(OWN_ADDRS_FILE);
    crate::storage::secrets::write_atomic(&path, body.to_string().as_bytes())
        .map_err(|e| std::io::Error::other(e.to_string()))
}

fn ends_pairing(event: &ManagerEvent) -> bool {
    matches!(
        event,
        ManagerEvent::Pair(PairEvent::Closed { .. } | PairEvent::Granted { .. } | PairEvent::Done)
    )
}

fn hex_key(text: &str) -> Result<[u8; 32], String> {
    parse_hex32(text).ok_or_else(|| "expected 64 lowercase hex characters".to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberArg {
    device_id: String,
    device_key: String,
}

fn members_from(list: &[MemberArg]) -> Result<Vec<Member>, String> {
    list.iter()
        .map(|m| {
            Ok(Member {
                device_id: m.device_id.clone(),
                key: hex_key(&m.device_key)?,
            })
        })
        .collect()
}

pub fn trust_from(
    auth_keys: Vec<Vec<u8>>,
    members: Option<Vec<MemberArg>>,
    farewell: Option<String>,
    left: bool,
) -> Result<Trust, String> {
    let auth_keys = Zeroizing::new(auth_keys);
    let state = if left {
        PresenceState::Left
    } else {
        PresenceState::Moved
    };
    Ok(Trust {
        keys: Zeroizing::new(auth_keys.iter().map(|k| derive_auth_key(k)).collect()),
        members: members.as_deref().map(members_from).transpose()?,
        farewell: farewell
            .as_deref()
            .map(hex_key)
            .transpose()?
            .map(|k| Farewell {
                key: derive_auth_key(&k),
                state,
            }),
    })
}

// `from` is the forwarder's epoch; a stale forwarder stays silent once a restart bumped it.
fn publish(relay: &Mutex<Relay>, from: Option<u64>, emit: &Emit, event: &ManagerEvent) {
    let mut relay = lock(relay);
    if from.is_some_and(|epoch| epoch != relay.epoch) {
        return;
    }
    if let (Some(_), ManagerEvent::Status(s)) = (from, event) {
        relay.status = *s;
    }
    for (name, payload) in payloads(event, relay.paused) {
        emit(name, payload);
    }
}

async fn forward(
    mut events: mpsc::Receiver<ManagerEvent>,
    relay: Arc<Mutex<Relay>>,
    parts: Parts,
    epoch: u64,
    emit: Emit,
    own: Option<(PathBuf, String)>,
) {
    while let Some(event) = events.recv().await {
        if let (ManagerEvent::OwnAddrs(addrs), Some((dir, id))) = (&event, &own) {
            if lock(&relay).epoch == epoch {
                let (dir, id, addrs) = (dir.clone(), id.clone(), addrs.clone());
                let written =
                    tokio::task::spawn_blocking(move || write_own_addrs(&dir, &id, &addrs));
                match written.await {
                    Ok(Err(e)) => log::warn!("lan-sync: saving own addresses failed: {e}"),
                    Err(e) => log::warn!("lan-sync: saving own addresses panicked: {e}"),
                    Ok(Ok(())) => {}
                }
            }
        }
        publish(&relay, Some(epoch), &emit, &event);
        if ends_pairing(&event) {
            tokio::spawn(stop_pairing_only(parts.clone(), relay.clone(), epoch));
        }
    }
}

#[derive(Clone, Default)]
struct Parts {
    manager: Arc<tokio::sync::Mutex<Option<Manager>>>,
    scope: Arc<Mutex<Option<String>>>,
}

impl Parts {
    fn of(state: &LanSyncState) -> Self {
        Self {
            manager: state.manager.clone(),
            scope: state.scope.clone(),
        }
    }
}

async fn stop_pairing_only(parts: Parts, relay: Arc<Mutex<Relay>>, epoch: u64) {
    let mut running = parts.manager.lock().await;
    let current = {
        let relay = lock(&relay);
        relay.epoch == epoch && relay.pairing_only
    };
    if current {
        stop_parts(&parts.scope, &mut running).await;
    }
}

pub async fn start_inner(
    state: &LanSyncState,
    me: LocalIdentity,
    trust: Trust,
    scope: &str,
    store_dir: Option<&Path>,
    emit: Emit,
) -> Result<(), String> {
    #[cfg(desktop)]
    let mut files = state.files.service.lock().await;
    let mut running = state.manager.lock().await;
    launch(state, &mut running, me, trust, store_dir, Some(scope), emit).await?;
    #[cfg(desktop)]
    if let Some(manager) = running.as_ref() {
        stop_where(&mut files, |s| s.account() != scope);
        offer_to(manager, files.clone()).await;
    }
    Ok(())
}

async fn launch(
    state: &LanSyncState,
    running: &mut Option<Manager>,
    me: LocalIdentity,
    trust: Trust,
    store_dir: Option<&Path>,
    scope: Option<&str>,
    emit: Emit,
) -> Result<(), String> {
    let (epoch, paused) = {
        let mut relay = state.relay();
        relay.epoch += 1;
        relay.status = LanStatus::Running;
        relay.pairing_only = scope.is_none();
        (relay.epoch, relay.paused)
    };
    stop_running(state, running).await;
    // Opened only once the old manager has flushed, so a Forget it just took is on disk.
    let store = match (store_dir, scope) {
        (Some(dir), Some(scope)) => PeerStore::open(dir, scope),
        _ => PeerStore::memory(),
    };
    publish(&state.relay, None, &emit, &ManagerEvent::Peers(vec![]));
    #[cfg(target_os = "android")]
    if let Err(e) = crate::lan_sync::android::acquire_multicast_lock() {
        log::warn!("lan-sync: {e}");
    }
    let device_id = me.device_id.clone();
    let (tx, rx) = mpsc::channel(EVENTS);
    let discovery = !cfg!(test);
    let manager = match manager::start(me, trust, paused, discovery, store, tx).await {
        Ok(manager) => manager,
        Err(e) => {
            #[cfg(target_os = "android")]
            crate::lan_sync::android::release_multicast_lock();
            state.announce(&emit, LanStatus::Stopped);
            return Err(e);
        }
    };
    let own = store_dir.map(|dir| (dir.to_path_buf(), device_id));
    let parts = Parts::of(state);
    tokio::spawn(forward(rx, state.relay.clone(), parts, epoch, emit, own));
    *running = Some(manager);
    *lock(&state.scope) = scope.map(str::to_string);
    Ok(())
}

pub async fn pair_open_inner(
    state: &LanSyncState,
    me: LocalIdentity,
    info: PairInfo,
    emit: Emit,
) -> Result<(), String> {
    let mut running = state.manager.lock().await;
    if running.is_none() {
        let trust = Trust {
            keys: Zeroizing::new(vec![]),
            members: None,
            farewell: None,
        };
        launch(state, &mut running, me, trust, None, None, emit).await?;
    }
    match running.as_ref() {
        Some(manager) => manager.open_pairing(info).await,
        None => Ok(()),
    }
}

pub async fn pair_close_inner(state: &LanSyncState) {
    let mut running = state.manager.lock().await;
    if state.relay().pairing_only {
        stop_running(state, &mut running).await;
    } else if let Some(manager) = running.as_ref() {
        manager.close_pairing();
    }
}

pub async fn pair_confirm_inner(
    state: &LanSyncState,
    grant: Option<GroupGrant>,
) -> Result<(), String> {
    match state.manager.lock().await.as_ref() {
        Some(manager) => manager.confirm_pairing(grant).await,
        None => Err("pairing ended".into()),
    }
}

pub async fn pair_cancel_inner(state: &LanSyncState) {
    with_manager(state, Manager::cancel_pairing).await;
}

pub async fn set_members_inner(state: &LanSyncState, members: Vec<Member>) {
    with_manager(state, |m| m.set_members(members)).await;
}

pub async fn stop_inner(state: &LanSyncState) {
    #[cfg(desktop)]
    crate::device_files::stop_running(&mut *state.files.service.lock().await);
    let mut running = state.manager.lock().await;
    stop_running(state, &mut running).await;
}

async fn stop_running(state: &LanSyncState, running: &mut Option<Manager>) {
    stop_parts(&state.scope, running).await;
}

async fn stop_parts(scope: &Mutex<Option<String>>, running: &mut Option<Manager>) {
    *lock(scope) = None;
    if let Some(manager) = running.take() {
        manager.stop().await;
    }
    #[cfg(target_os = "android")]
    crate::lan_sync::android::release_multicast_lock();
}

#[cfg_attr(not(desktop), allow(unused_variables))]
pub async fn forget_inner(
    state: &LanSyncState,
    device_id: &str,
    scope: &str,
    group: bool,
    dir: &Path,
    emit: &Emit,
) -> Result<bool, String> {
    let forgotten = forget_peer(state, device_id, scope, dir).await?;
    #[cfg(desktop)]
    if let Some(key) = forgotten.filter(|_| !group) {
        state
            .forget_files(scope, &crate::crypto::hex(&key), dir, emit)
            .await;
    }
    Ok(forgotten.is_some())
}

async fn forget_peer(
    state: &LanSyncState,
    device_id: &str,
    scope: &str,
    dir: &Path,
) -> Result<Option<[u8; 32]>, String> {
    let running = state.manager.lock().await;
    if let Some(manager) = running
        .as_ref()
        .filter(|_| lock(&state.scope).as_deref() == Some(scope))
    {
        return Ok(manager.forget(device_id));
    }
    let mut store = PeerStore::open(dir, scope);
    let forgotten = store.forget(device_id, now_secs());
    if let Some((path, bytes)) = store.snapshot().filter(|_| forgotten.is_some()) {
        write_snapshot(&path, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(forgotten)
}

pub async fn clear_scope_inner(
    state: &LanSyncState,
    scope: &str,
    dir: &Path,
) -> Result<(), String> {
    #[cfg(desktop)]
    stop_where(&mut *state.files.service.lock().await, |s| {
        s.account() == scope
    });
    let mut running = state.manager.lock().await;
    if lock(&state.scope).as_deref() == Some(scope) {
        stop_running(state, &mut running).await;
    }
    match std::fs::remove_file(PeerStore::path_for(dir, scope)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

pub async fn set_paused_inner(state: &LanSyncState, paused: bool, emit: &Emit) {
    let running = state.manager.lock().await;
    state.relay().paused = paused;
    if let Some(manager) = running.as_ref() {
        manager.set_paused(paused);
        let last = state.relay().status;
        state.announce(emit, last);
    }
}

pub async fn broadcast_inner(state: &LanSyncState, blob: Vec<u8>) {
    if let Some(manager) = state.manager.lock().await.as_ref() {
        manager.broadcast(blob).await;
    }
}

pub async fn learn_inner(state: &LanSyncState, device_id: &str, addrs: &[String]) {
    let addrs = addrs::sanitize(addrs);
    if !addrs.is_empty() && valid_device_id(device_id) {
        with_manager(state, |m| m.learn(device_id, &addrs)).await;
    }
}

pub(crate) async fn with_manager<T: Default>(
    state: &LanSyncState,
    f: impl FnOnce(&Manager) -> T,
) -> T {
    state
        .manager
        .lock()
        .await
        .as_ref()
        .map(f)
        .unwrap_or_default()
}

pub async fn take_blob_inner(state: &LanSyncState, device_id: &str) -> Option<Vec<u8>> {
    with_manager(state, |m| m.take_blob(device_id)).await
}

pub async fn peers_inner(state: &LanSyncState) -> Vec<PeerInfo> {
    with_manager(state, Manager::peers).await
}

async fn device_key_inner(state: &LanSyncState) -> Result<String, String> {
    Ok(encode_hex32(&state.device_key().await?.public))
}

pub(crate) fn emitter(app: AppHandle) -> Emit {
    Arc::new(move |name, payload| {
        if let Err(e) = app.emit(name, payload) {
            log::warn!("lan-sync: emit {name} failed: {e}");
        }
    })
}

async fn local_identity(
    state: &LanSyncState,
    device_id: String,
    device_name: String,
) -> Result<LocalIdentity, String> {
    Ok(LocalIdentity {
        device_id,
        device_name,
        platform: std::env::consts::OS.into(),
        key: state.device_key().await?,
        addrs: addrs::none(),
    })
}

const UNSUPPORTED: bool = cfg!(target_os = "ios");

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lan_sync_start(
    app: AppHandle,
    state: State<'_, LanSyncState>,
    device_id: String,
    device_name: String,
    auth_keys: Vec<Vec<u8>>,
    scope: String,
    members: Option<Vec<MemberArg>>,
    farewell: Option<String>,
    farewell_left: Option<bool>,
) -> Result<(), String> {
    let emit = emitter(app);
    if UNSUPPORTED {
        state.announce(&emit, LanStatus::Stopped);
        return Ok(());
    }
    let trust = trust_from(auth_keys, members, farewell, farewell_left == Some(true))?;
    let me = local_identity(&state, device_id, device_name).await?;
    let dir = crate::storage::config::config_dir();
    start_inner(&state, me, trust, &scope, Some(&dir), emit).await
}

#[tauri::command]
pub async fn lan_sync_pair_open(
    app: AppHandle,
    state: State<'_, LanSyncState>,
    device_id: String,
    device_name: String,
    info: PairInfo,
) -> Result<(), String> {
    if UNSUPPORTED {
        return Err("local network sync is not available on this platform".into());
    }
    let me = local_identity(&state, device_id, device_name).await?;
    pair_open_inner(&state, me, info, emitter(app)).await
}

#[tauri::command]
pub async fn lan_sync_pair_close(state: State<'_, LanSyncState>) -> Result<(), String> {
    pair_close_inner(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_pair_confirm(
    state: State<'_, LanSyncState>,
    grant: Option<GroupGrant>,
) -> Result<(), String> {
    pair_confirm_inner(&state, grant).await
}

#[tauri::command]
pub async fn lan_sync_pair_cancel(state: State<'_, LanSyncState>) -> Result<(), String> {
    pair_cancel_inner(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_set_members(
    state: State<'_, LanSyncState>,
    members: Vec<MemberArg>,
) -> Result<(), String> {
    set_members_inner(&state, members_from(&members)?).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_stop(state: State<'_, LanSyncState>) -> Result<(), String> {
    stop_inner(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_forget(
    app: AppHandle,
    state: State<'_, LanSyncState>,
    links: State<'_, DeviceLinks>,
    device_id: String,
    scope: String,
    group: bool,
) -> Result<bool, String> {
    let dir = crate::storage::config::config_dir();
    let forgotten = forget_inner(&state, &device_id, &scope, group, &dir, &emitter(app)).await?;
    if forgotten && !group {
        links.forget(&device_id);
    }
    Ok(forgotten)
}

#[tauri::command]
pub async fn lan_sync_clear_scope(
    state: State<'_, LanSyncState>,
    scope: String,
) -> Result<(), String> {
    clear_scope_inner(&state, &scope, &crate::storage::config::config_dir()).await
}

#[tauri::command]
pub async fn lan_sync_broadcast(
    state: State<'_, LanSyncState>,
    request: Request<'_>,
) -> Result<(), String> {
    broadcast_inner(&state, raw_body(request.body(), "blob")?.to_vec()).await;
    Ok(())
}

// Empty when nothing is waiting: a sealed blob is never empty.
#[tauri::command]
pub async fn lan_sync_take_blob(
    state: State<'_, LanSyncState>,
    device_id: String,
) -> Result<Response, String> {
    let blob = take_blob_inner(&state, &device_id).await;
    Ok(Response::new(blob.unwrap_or_default()))
}

#[tauri::command]
pub async fn lan_sync_peers(state: State<'_, LanSyncState>) -> Result<Vec<PeerInfo>, String> {
    Ok(peers_inner(&state).await)
}

#[tauri::command]
pub async fn lan_sync_learn(
    state: State<'_, LanSyncState>,
    device_id: String,
    addrs: Vec<String>,
) -> Result<(), String> {
    learn_inner(&state, &device_id, &addrs).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_device_key(state: State<'_, LanSyncState>) -> Result<String, String> {
    device_key_inner(&state).await
}

#[tauri::command]
pub async fn lan_sync_set_paused(
    app: AppHandle,
    state: State<'_, LanSyncState>,
    paused: bool,
) -> Result<(), String> {
    set_paused_inner(&state, paused, &emitter(app)).await;
    Ok(())
}

#[cfg(test)]
impl LanSyncState {
    pub(crate) async fn meet(&self, other: &LanSyncState) {
        let port = with_manager(other, Manager::port).await;
        if let Some(manager) = self.manager.lock().await.as_ref() {
            let addr = std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, port));
            manager.connect(addr, manager::Source::Mdns).await;
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::lan_sync::handshake::handshake;
    use crate::lan_sync::identity::test_identity;
    use crate::lan_sync::protocol::Frame;
    use std::net::{Ipv4Addr, SocketAddr};
    use std::time::Duration;
    use tokio::net::TcpStream;

    pub(crate) type Seen = Arc<Mutex<Vec<(&'static str, Value)>>>;

    pub(crate) fn recorder() -> (Emit, Seen) {
        let seen = Seen::default();
        let sink = seen.clone();
        let emit: Emit = Arc::new(move |name, payload| sink.lock().unwrap().push((name, payload)));
        (emit, seen)
    }

    async fn until_after(
        seen: &Seen,
        from: usize,
        what: &str,
        wanted: impl Fn(&(&'static str, Value)) -> bool,
    ) {
        let poll = async {
            while !seen.lock().unwrap()[from..].iter().any(&wanted) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        if tokio::time::timeout(Duration::from_secs(10), poll)
            .await
            .is_err()
        {
            panic!("never saw {what}; saw {:?}", seen.lock().unwrap());
        }
    }

    async fn until_any(seen: &Seen, what: &str, wanted: impl Fn(&(&'static str, Value)) -> bool) {
        until_after(seen, 0, what, wanted).await;
    }

    async fn until(seen: &Seen, wanted: (&'static str, Value)) {
        until_any(seen, &format!("{wanted:?}"), |e| *e == wanted).await;
    }

    fn lists(id: &'static str) -> impl Fn(&(&'static str, Value)) -> bool {
        move |(name, payload)| {
            *name == PEERS
                && payload
                    .as_array()
                    .is_some_and(|p| p.iter().any(|p| p["deviceId"] == id))
        }
    }

    fn trust(account: u8) -> Trust {
        trust_from(vec![vec![account; 32]], None, None, false).unwrap()
    }

    async fn start_in(
        state: &LanSyncState,
        account: u8,
        scope: &str,
        dir: Option<&Path>,
        emit: &Emit,
    ) {
        start_inner(
            state,
            test_identity("dev-me"),
            trust(account),
            scope,
            dir,
            emit.clone(),
        )
        .await
        .unwrap();
    }

    async fn start(state: &LanSyncState, account: u8, emit: &Emit) {
        start_in(state, account, "acct", None, emit).await;
    }

    async fn dial_as(state: &LanSyncState, id: &str, account: u8) -> Result<(), String> {
        let port = with_manager(state, Manager::port).await;
        let stream = TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
            .await
            .unwrap();
        let keys = [derive_auth_key(&[account; 32])];
        let (mut session, _) = handshake(stream, true, &test_identity(id), &keys)
            .await
            .map_err(|e| e.to_string())?;
        session.send(&Frame::Blob(vec![account])).await.unwrap();
        tokio::spawn(async move { while session.recv().await.is_ok() {} });
        Ok(())
    }

    #[tokio::test]
    async fn device_key_is_the_public_key_in_hex() {
        let state = LanSyncState::default();
        assert!(state
            .device_key
            .set(DeviceKey::from_private([7; 32]))
            .is_ok());
        let hex = device_key_inner(&state).await.unwrap();
        assert_eq!(
            parse_hex32(&hex),
            Some(DeviceKey::from_private([7; 32]).public)
        );
    }

    #[tokio::test]
    async fn start_twice_restarts_with_new_keys() {
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start(&state, 1, &emit).await;
        dial_as(&state, "dev-a", 1).await.unwrap();
        until_any(&seen, "dev-a listed", lists("dev-a")).await;

        let restart = seen.lock().unwrap().len();
        start(&state, 2, &emit).await;
        let cleared = restart
            + seen.lock().unwrap()[restart..]
                .iter()
                .position(|e| *e == (PEERS, json!([])))
                .expect("restart cleared peers");
        assert!(peers_inner(&state).await.is_empty());
        assert!(dial_as(&state, "dev-old", 1).await.is_err());

        dial_as(&state, "dev-b", 2).await.unwrap();
        until(&seen, (BLOB_READY, json!({ "deviceId": "dev-b" }))).await;
        assert_eq!(take_blob_inner(&state, "dev-b").await, Some(vec![2]));
        assert_eq!(peers_inner(&state).await[0].device_id, "dev-b");
        until_any(&seen, "dev-b listed", lists("dev-b")).await;

        set_paused_inner(&state, true, &emit).await;
        until(&seen, status(LanStatus::Paused)).await;
        stop_inner(&state).await;
        until(&seen, status(LanStatus::Stopped)).await;
        assert!(peers_inner(&state).await.is_empty());
        let seen = seen.lock().unwrap();
        assert!(!seen[cleared..].iter().any(lists("dev-a")), "{seen:?}");
        assert_eq!(
            seen[seen.len() - 2..],
            [(PEERS, json!([])), status(LanStatus::Stopped)]
        );
    }

    #[tokio::test]
    async fn unpause_restores_blocked() {
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start(&state, 1, &emit).await;
        until(&seen, status(LanStatus::Running)).await;
        let epoch = state.relay().epoch;
        let blocked = ManagerEvent::Status(LanStatus::Blocked);
        publish(&state.relay, Some(epoch), &emit, &blocked);
        set_paused_inner(&state, true, &emit).await;
        set_paused_inner(&state, false, &emit).await;
        {
            let seen = seen.lock().unwrap();
            assert_eq!(
                seen[seen.len() - 3..],
                [
                    status(LanStatus::Blocked),
                    status(LanStatus::Paused),
                    status(LanStatus::Blocked)
                ]
            );
        }
        stop_inner(&state).await;
    }

    #[tokio::test]
    async fn stale_forwarder_is_silent_after_a_restart() {
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start(&state, 1, &emit).await;
        let stale = state.relay().epoch;
        start(&state, 1, &emit).await;
        let before = seen.lock().unwrap().len();
        publish(
            &state.relay,
            Some(stale),
            &emit,
            &ManagerEvent::Peers(vec![]),
        );
        assert_eq!(seen.lock().unwrap().len(), before);
        stop_inner(&state).await;
    }

    #[tokio::test]
    async fn start_passes_scope_and_forget_drops_peer() {
        let dir = tempfile::tempdir().unwrap();
        let file = PeerStore::path_for(dir.path(), "acct-1");
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start_in(&state, 1, "acct-1", Some(dir.path()), &emit).await;
        dial_as(&state, "dev-a", 1).await.unwrap();
        until_any(&seen, "dev-a listed", lists("dev-a")).await;
        let before = seen.lock().unwrap().len();

        let forget =
            |id: &'static str| forget_inner(&state, id, "acct-1", false, dir.path(), &emit);
        assert!(forget("dev-a").await.unwrap());
        until_after(&seen, before, "peers cleared", |e| *e == (PEERS, json!([]))).await;
        assert!(!forget("dev-a").await.unwrap());
        stop_inner(&state).await;
        assert!(file.exists());
    }

    #[tokio::test]
    async fn restart_flushes_the_old_peer_store() {
        let dir = tempfile::tempdir().unwrap();
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start_in(&state, 1, "acct-1", Some(dir.path()), &emit).await;
        dial_as(&state, "dev-a", 1).await.unwrap();
        until_any(&seen, "dev-a listed", lists("dev-a")).await;
        let restart = start_in(&state, 1, "acct-2", Some(dir.path()), &emit);
        tokio::time::timeout(Duration::from_secs(10), restart)
            .await
            .expect("restart hung");
        let saved = std::fs::read_to_string(PeerStore::path_for(dir.path(), "acct-1")).unwrap();
        assert!(saved.contains("dev-a"), "{saved}");
        stop_inner(&state).await;
    }

    #[tokio::test]
    async fn forget_then_restart_keeps_the_block() {
        let dir = tempfile::tempdir().unwrap();
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start_in(&state, 1, "acct-1", Some(dir.path()), &emit).await;
        dial_as(&state, "dev-a", 1).await.unwrap();
        until_any(&seen, "dev-a listed", lists("dev-a")).await;
        let file = PeerStore::path_for(dir.path(), "acct-1");
        let on_disk = || std::fs::read_to_string(&file).unwrap_or_default();
        tokio::time::timeout(Duration::from_secs(10), async {
            while !on_disk().contains("dev-a") {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("dev-a pin never saved");

        assert!(
            forget_inner(&state, "dev-a", "acct-1", false, dir.path(), &emit)
                .await
                .unwrap()
        );
        start_in(&state, 1, "acct-1", Some(dir.path()), &emit).await;

        assert!(with_manager(&state, |m| m.record("dev-a").is_none()).await);
        stop_inner(&state).await;
        let saved = on_disk();
        assert!(
            saved.contains("blocked") && saved.contains("dev-a"),
            "{saved}"
        );
    }

    #[tokio::test]
    async fn clear_scope_removes_file_and_stops_matching_manager() {
        let dir = tempfile::tempdir().unwrap();
        let file = PeerStore::path_for(dir.path(), "acct-1");
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start_in(&state, 1, "acct-1", Some(dir.path()), &emit).await;
        dial_as(&state, "dev-a", 1).await.unwrap();
        until_any(&seen, "dev-a listed", lists("dev-a")).await;

        clear_scope_inner(&state, "other", dir.path())
            .await
            .unwrap();
        assert!(with_manager(&state, |_| true).await);
        stop_inner(&state).await;
        assert!(file.exists());

        start_in(&state, 1, "acct-1", Some(dir.path()), &emit).await;
        clear_scope_inner(&state, "acct-1", dir.path())
            .await
            .unwrap();
        until(&seen, status(LanStatus::Stopped)).await;
        assert!(!with_manager(&state, |_| true).await);
        assert!(!file.exists());
        clear_scope_inner(&state, "acct-1", dir.path())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn learn_without_manager_is_a_noop() {
        let state = LanSyncState::default();
        learn_inner(&state, "dev-b", &["10.9.9.9:47391".to_string()]).await;
        assert!(!with_manager(&state, |_| true).await);
    }

    #[tokio::test]
    async fn learn_sanitises_before_dialing() {
        let state = LanSyncState::default();
        let (emit, _seen) = recorder();
        start(&state, 1, &emit).await;
        let candidates = || with_manager(&state, Manager::candidates);
        let junk = [
            "nope",
            "0.0.0.0:47391",
            "[2001:db8::1]:47391",
            "127.0.0.1:47391",
            "[::1]:47391",
        ]
        .map(String::from);
        with_manager(&state, Manager::spend_budget).await;
        learn_inner(&state, "dev-b", &junk).await;
        assert!(candidates().await.is_empty());
        let good = ["nope".into(), "10.9.9.9:47391".into()];
        learn_inner(&state, "", &good).await;
        learn_inner(&state, &"x".repeat(129), &good).await;
        assert!(candidates().await.is_empty());
        learn_inner(&state, &"x".repeat(128), &good).await;
        assert_eq!(candidates().await, vec!["10.9.9.9:47391".parse().unwrap()]);
        let many: Vec<String> = (1..=40).map(|i| format!("10.8.0.{i}:47391")).collect();
        learn_inner(&state, "dev-b", &many).await;
        assert!(candidates().await.len() <= 1 + crate::lan_sync::protocol::MAX_HELLO_ADDRS);
        stop_inner(&state).await;
    }

    #[tokio::test]
    async fn stale_forwarder_does_not_write_own_addrs() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel(8);
        let (emit, _seen) = recorder();
        let relay = Arc::new(Mutex::new(Relay {
            epoch: 2,
            ..Relay::default()
        }));
        let own = Some((dir.path().to_path_buf(), "dev-me".to_string()));
        let task = tokio::spawn(forward(rx, relay, Parts::default(), 1, emit, own));
        let addr: SocketAddr = "10.7.7.7:47391".parse().unwrap();
        tx.send(ManagerEvent::OwnAddrs(vec![addr])).await.unwrap();
        drop(tx);
        task.await.unwrap();
        assert!(!dir.path().join(OWN_ADDRS_FILE).exists());
    }

    fn hex(byte: u8) -> String {
        format!("{byte:02x}").repeat(32)
    }

    async fn pair_open(state: &LanSyncState, emit: &Emit) {
        let info = PairInfo {
            mode: "local".into(),
            group: None,
            entities: 0,
            members: 0,
            reverify: false,
        };
        pair_open_inner(state, test_identity("dev-me"), info, emit.clone())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn pair_open_without_manager_starts_pairing_only_and_close_stops_it() {
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        pair_open(&state, &emit).await;
        assert!(with_manager(&state, |_| true).await);
        assert!(state.relay().pairing_only);
        assert_eq!(*lock(&state.scope), None);

        pair_close_inner(&state).await;
        assert!(!with_manager(&state, |_| true).await);
        until(&seen, status(LanStatus::Stopped)).await;
    }

    #[tokio::test]
    async fn pair_close_keeps_a_real_manager_running() {
        let state = LanSyncState::default();
        let (emit, _seen) = recorder();
        start(&state, 1, &emit).await;
        pair_open(&state, &emit).await;
        assert!(!state.relay().pairing_only);
        pair_close_inner(&state).await;
        assert!(with_manager(&state, |_| true).await);
        stop_inner(&state).await;
    }

    #[tokio::test]
    async fn start_replaces_a_pairing_only_manager() {
        let state = LanSyncState::default();
        let (emit, _seen) = recorder();
        pair_open(&state, &emit).await;
        start(&state, 1, &emit).await;
        assert!(!state.relay().pairing_only);
        assert_eq!(lock(&state.scope).as_deref(), Some("acct"));
        pair_close_inner(&state).await;
        assert!(with_manager(&state, |_| true).await);
        stop_inner(&state).await;
    }

    #[tokio::test]
    async fn a_terminal_pair_event_stops_a_pairing_only_manager() {
        let state = LanSyncState::default();
        let (emit, _seen) = recorder();
        pair_open(&state, &emit).await;
        let epoch = state.relay().epoch;
        let parts = Parts::of(&state);
        stop_pairing_only(parts.clone(), state.relay.clone(), epoch + 1).await;
        assert!(with_manager(&state, |_| true).await);
        stop_pairing_only(parts, state.relay.clone(), epoch).await;
        assert!(!with_manager(&state, |_| true).await);
    }

    #[test]
    fn only_closed_granted_and_done_end_pairing() {
        use crate::lan_sync::pairing::PairRefusal;
        let pair = ManagerEvent::Pair;
        let closed = pair(PairEvent::Closed {
            reason: PairRefusal::TimedOut,
        });
        let ended = pair(PairEvent::Ended {
            reason: PairRefusal::Cancelled,
        });
        assert!(ends_pairing(&closed));
        assert!(ends_pairing(&pair(PairEvent::Done)));
        assert!(!ends_pairing(&ended));
        assert!(!ends_pairing(&pair(PairEvent::PeerConfirmed)));
        assert!(!ends_pairing(&ManagerEvent::Status(LanStatus::Stopped)));
    }

    #[tokio::test]
    async fn forget_without_a_manager_persists_to_the_scope_file() {
        let dir = tempfile::tempdir().unwrap();
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start_in(&state, 1, "acct-1", Some(dir.path()), &emit).await;
        dial_as(&state, "dev-a", 1).await.unwrap();
        until_any(&seen, "dev-a listed", lists("dev-a")).await;
        stop_inner(&state).await;

        assert!(
            forget_inner(&state, "dev-a", "acct-1", false, dir.path(), &emit)
                .await
                .unwrap()
        );
        let saved = std::fs::read_to_string(PeerStore::path_for(dir.path(), "acct-1")).unwrap();
        assert!(
            saved.contains("blocked") && saved.contains("dev-a"),
            "{saved}"
        );
        assert!(PeerStore::open(dir.path(), "acct-1").get("dev-a").is_none());
        assert!(
            !forget_inner(&state, "dev-a", "acct-1", false, dir.path(), &emit)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn forget_with_another_scope_running_uses_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start_in(&state, 1, "acct-1", Some(dir.path()), &emit).await;
        dial_as(&state, "dev-a", 1).await.unwrap();
        until_any(&seen, "dev-a listed", lists("dev-a")).await;
        assert!(
            !forget_inner(&state, "dev-a", "acct-2", false, dir.path(), &emit)
                .await
                .unwrap()
        );
        assert!(!peers_inner(&state).await.is_empty());
        stop_inner(&state).await;
    }

    #[tokio::test]
    async fn a_left_device_says_farewell_at_a_remembered_address_then_its_scope_clears() {
        let dir = tempfile::tempdir().unwrap();
        let left = test_identity("dev-l");
        let listed = MemberArg {
            device_id: left.device_id.clone(),
            device_key: encode_hex32(&left.key.public),
        };
        let member = LanSyncState::default();
        let group = trust_from(vec![vec![4; 32]], Some(vec![listed]), None, false).unwrap();
        let quiet: Emit = Arc::new(|_, _| {});
        start_inner(&member, test_identity("dev-m"), group, "grp", None, quiet)
            .await
            .unwrap();
        let port = with_manager(&member, Manager::port).await;
        let at = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        PeerStore::seed_file(dir.path(), "grp", "dev-m", &[at]);

        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        let farewell = trust_from(vec![], Some(vec![]), Some(hex(4)), true).unwrap();
        start_inner(&state, left, farewell, "grp", Some(dir.path()), emit)
            .await
            .unwrap();
        until(&seen, (FAREWELL_SENT, json!({ "deviceId": "dev-m" }))).await;

        clear_scope_inner(&state, "grp", dir.path()).await.unwrap();
        assert!(!PeerStore::path_for(dir.path(), "grp").exists());
        assert!(!with_manager(&state, |_| true).await);
    }

    #[test]
    fn start_with_members_builds_group_trust() {
        let member = |id: &str, key: String| MemberArg {
            device_id: id.into(),
            device_key: key,
        };
        let listed = vec![member("a", hex(2)), member("b", hex(3))];
        let trust = trust_from(vec![vec![1; 32]], Some(listed), Some(hex(4)), false).unwrap();
        let expected = |id: &str, key| Member {
            device_id: id.into(),
            key,
        };
        assert_eq!(
            trust.members,
            Some(vec![expected("a", [2; 32]), expected("b", [3; 32])])
        );
        let farewell = trust.farewell.as_ref().map(|f| (f.key, f.state));
        assert_eq!(
            farewell,
            Some((derive_auth_key(&[4; 32]), PresenceState::Moved))
        );
        assert_eq!(trust.keys.len(), 1);
        let left = trust_from(vec![], Some(vec![]), Some(hex(4)), true).unwrap();
        assert_eq!(left.farewell.map(|f| f.state), Some(PresenceState::Left));
        assert!(left.keys.is_empty());
        assert!(trust_from(vec![], None, None, false)
            .unwrap()
            .members
            .is_none());
        for bad in [
            "zz".to_string(),
            hex(2)[2..].to_string(),
            hex(0xab).to_uppercase(),
        ] {
            assert!(trust_from(vec![], Some(vec![member("a", bad.clone())]), None, false).is_err());
            assert!(trust_from(vec![], None, Some(bad), false).is_err());
        }
    }

    #[test]
    fn pair_presence_and_farewell_events_are_relayed() {
        use crate::lan_sync::pairing::Role;
        let code = ManagerEvent::Pair(PairEvent::Code {
            sas: 123456,
            role: Role::Joiner,
            peer_id: "p".into(),
            peer_key: "ab".repeat(32),
            peer_name: "n".into(),
            peer_platform: "linux".into(),
            peer_entities: 3,
            reverify: false,
        });
        assert_eq!(
            payloads(&code, false),
            vec![(
                PAIR,
                json!({"state":"code","sas":123456,"role":"joiner","peerId":"p",
                    "peerKey":"ab".repeat(32),"peerName":"n",
                    "peerPlatform":"linux","peerEntities":3})
            )]
        );
        let presence = ManagerEvent::Presence {
            device_id: "x".into(),
            state: PresenceState::Moved,
        };
        assert_eq!(
            payloads(&presence, false),
            vec![(PRESENCE, json!({"deviceId":"x","state":"moved"}))]
        );
        let sent = ManagerEvent::FarewellSent {
            device_id: "x".into(),
        };
        assert_eq!(
            payloads(&sent, false),
            vec![(FAREWELL_SENT, json!({"deviceId":"x"}))]
        );
    }

    #[test]
    fn rejected_event_is_relayed() {
        use crate::lan_sync::peers::Rejection;
        let event = ManagerEvent::Rejected {
            device_id: "x".into(),
            reason: Rejection::KeyChanged,
        };
        assert_eq!(
            payloads(&event, false),
            vec![(
                "lan-sync://rejected",
                json!({ "deviceId": "x", "reason": "keyChanged" })
            )]
        );
    }

    #[tokio::test]
    async fn own_addrs_event_writes_the_blob_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(OWN_ADDRS_FILE);
        let (tx, rx) = mpsc::channel(8);
        let (emit, seen) = recorder();
        let own = Some((dir.path().to_path_buf(), "dev-me".to_string()));
        let task = tokio::spawn(forward(rx, Arc::default(), Parts::default(), 0, emit, own));
        tx.send(ManagerEvent::Peers(vec![])).await.unwrap();
        tx.send(ManagerEvent::Status(LanStatus::Running))
            .await
            .unwrap();
        tx.send(ManagerEvent::Peers(vec![])).await.unwrap();
        until_any(&seen, "peers", |(n, _)| *n == PEERS).await;
        assert!(!file.exists());
        let addr: SocketAddr = "10.7.7.7:47391".parse().unwrap();
        tx.send(ManagerEvent::OwnAddrs(vec![addr])).await.unwrap();
        drop(tx);
        task.await.unwrap();
        let written: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(
            written,
            json!({ "v": 1, "deviceId": "dev-me", "addrs": ["10.7.7.7:47391"] })
        );
        assert_eq!(payloads(&ManagerEvent::OwnAddrs(vec![addr]), false), vec![]);
    }

    #[test]
    fn paused_relay_reports_running_as_paused() {
        let running = ManagerEvent::Status(LanStatus::Running);
        assert_eq!(payloads(&running, true), vec![status(LanStatus::Paused)]);
        assert_eq!(payloads(&running, false), vec![(STATUS, json!("running"))]);
    }
}
