use super::raw_body;
use crate::lan_sync::addrs;
use crate::lan_sync::identity::{
    derive_auth_key, load_or_create_device_key, DeviceKey, LocalIdentity,
};
use crate::lan_sync::manager::{self, LanStatus, Manager, ManagerEvent, PeerInfo};
use crate::lan_sync::peers::PeerStore;
use serde_json::{json, Value};
use std::path::Path;
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

pub type Emit = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

#[derive(Default)]
struct Relay {
    epoch: u64,
    paused: bool,
    status: LanStatus,
}

#[derive(Default)]
pub struct LanSyncState {
    manager: tokio::sync::Mutex<Option<Manager>>,
    scope: Mutex<Option<String>>,
    device_key: OnceCell<DeviceKey>,
    relay: Arc<Mutex<Relay>>,
}

impl LanSyncState {
    fn relay(&self) -> MutexGuard<'_, Relay> {
        lock(&self.relay)
    }

    fn announce(&self, emit: &Emit, status: LanStatus) {
        publish(&self.relay, None, emit, &ManagerEvent::Status(status));
    }

    async fn device_key(&self) -> Result<DeviceKey, String> {
        let key = self
            .device_key
            .get_or_try_init(|| async { load_or_create_device_key() })
            .await?;
        Ok(DeviceKey::from_private(key.private))
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
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
    }
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
    epoch: u64,
    emit: Emit,
) {
    while let Some(event) = events.recv().await {
        publish(&relay, Some(epoch), &emit, &event);
    }
}

pub async fn start_inner(
    state: &LanSyncState,
    me: LocalIdentity,
    auth_keys: Vec<Vec<u8>>,
    scope: &str,
    store_dir: Option<&Path>,
    emit: Emit,
) -> Result<(), String> {
    let auth_keys = Zeroizing::new(auth_keys);
    let derived = Zeroizing::new(auth_keys.iter().map(|k| derive_auth_key(k)).collect());
    let mut running = state.manager.lock().await;
    let (epoch, paused) = {
        let mut relay = state.relay();
        relay.epoch += 1;
        relay.status = LanStatus::Running;
        (relay.epoch, relay.paused)
    };
    stop_running(state, &mut running).await;
    publish(&state.relay, None, &emit, &ManagerEvent::Peers(vec![]));
    #[cfg(target_os = "android")]
    if let Err(e) = crate::lan_sync::android::acquire_multicast_lock() {
        log::warn!("lan-sync: {e}");
    }
    let (tx, rx) = mpsc::channel(EVENTS);
    let store = store_dir.map_or_else(PeerStore::memory, |dir| PeerStore::open(dir, scope));
    let manager = match manager::start(me, derived, paused, !cfg!(test), store, tx).await {
        Ok(manager) => manager,
        Err(e) => {
            #[cfg(target_os = "android")]
            crate::lan_sync::android::release_multicast_lock();
            state.announce(&emit, LanStatus::Stopped);
            return Err(e);
        }
    };
    tokio::spawn(forward(rx, state.relay.clone(), epoch, emit));
    *running = Some(manager);
    *lock(&state.scope) = Some(scope.to_string());
    Ok(())
}

pub async fn stop_inner(state: &LanSyncState) {
    let mut running = state.manager.lock().await;
    stop_running(state, &mut running).await;
    #[cfg(target_os = "android")]
    crate::lan_sync::android::release_multicast_lock();
}

async fn stop_running(state: &LanSyncState, running: &mut Option<Manager>) {
    *lock(&state.scope) = None;
    if let Some(manager) = running.take() {
        manager.stop().await;
    }
}

pub async fn forget_inner(state: &LanSyncState, device_id: &str) -> bool {
    with_manager(state, |m| m.forget(device_id)).await
}

pub async fn clear_scope_inner(
    state: &LanSyncState,
    scope: &str,
    dir: &Path,
) -> Result<(), String> {
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

async fn with_manager<T: Default>(state: &LanSyncState, f: impl FnOnce(&Manager) -> T) -> T {
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

fn emitter(app: AppHandle) -> Emit {
    Arc::new(move |name, payload| {
        if let Err(e) = app.emit(name, payload) {
            log::warn!("lan-sync: emit {name} failed: {e}");
        }
    })
}

#[tauri::command]
pub async fn lan_sync_start(
    app: AppHandle,
    state: State<'_, LanSyncState>,
    device_id: String,
    device_name: String,
    auth_keys: Vec<Vec<u8>>,
    scope: String,
) -> Result<(), String> {
    let emit = emitter(app);
    if cfg!(target_os = "ios") {
        state.announce(&emit, LanStatus::Stopped);
        return Ok(());
    }
    let me = LocalIdentity {
        device_id,
        device_name,
        platform: std::env::consts::OS.into(),
        key: state.device_key().await?,
        addrs: addrs::none(),
    };
    let dir = crate::storage::config::config_dir();
    start_inner(&state, me, auth_keys, &scope, Some(&dir), emit).await
}

#[tauri::command]
pub async fn lan_sync_stop(state: State<'_, LanSyncState>) -> Result<(), String> {
    stop_inner(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_forget(
    state: State<'_, LanSyncState>,
    device_id: String,
) -> Result<bool, String> {
    Ok(forget_inner(&state, &device_id).await)
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
pub async fn lan_sync_set_paused(
    app: AppHandle,
    state: State<'_, LanSyncState>,
    paused: bool,
) -> Result<(), String> {
    set_paused_inner(&state, paused, &emitter(app)).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan_sync::handshake::handshake;
    use crate::lan_sync::identity::test_identity;
    use crate::lan_sync::protocol::Frame;
    use std::net::{Ipv4Addr, SocketAddr};
    use std::time::Duration;
    use tokio::net::TcpStream;

    type Seen = Arc<Mutex<Vec<(&'static str, Value)>>>;

    fn recorder() -> (Emit, Seen) {
        let seen = Seen::default();
        let sink = seen.clone();
        let emit: Emit = Arc::new(move |name, payload| sink.lock().unwrap().push((name, payload)));
        (emit, seen)
    }

    async fn until_any(seen: &Seen, what: &str, wanted: impl Fn(&(&'static str, Value)) -> bool) {
        let poll = async {
            while !seen.lock().unwrap().iter().any(&wanted) {
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
            vec![vec![account; 32]],
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

        assert!(forget_inner(&state, "dev-a").await);
        let cleared = |seen: &Seen| seen.lock().unwrap()[before..].contains(&(PEERS, json!([])));
        while !cleared(&seen) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(!forget_inner(&state, "dev-a").await);
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
        start_in(&state, 1, "acct-2", Some(dir.path()), &emit).await;
        let saved = std::fs::read_to_string(PeerStore::path_for(dir.path(), "acct-1")).unwrap();
        assert!(saved.contains("dev-a"), "{saved}");
        stop_inner(&state).await;
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

    #[test]
    fn paused_relay_reports_running_as_paused() {
        let running = ManagerEvent::Status(LanStatus::Running);
        assert_eq!(payloads(&running, true), vec![status(LanStatus::Paused)]);
        assert_eq!(payloads(&running, false), vec![(STATUS, json!("running"))]);
    }
}
