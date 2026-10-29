use crate::lan_sync::identity::{
    derive_auth_key, load_or_create_device_key, DeviceKey, LocalIdentity,
};
use crate::lan_sync::manager::{self, LanStatus, Manager, ManagerEvent, PeerInfo};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, OnceCell};
use zeroize::Zeroizing;

const EVENTS: usize = 64;
const PEERS: &str = "lan-sync://peers";
const BLOB_READY: &str = "lan-sync://blob-ready";
const STATUS: &str = "lan-sync://status";

pub type Emit = Arc<dyn Fn(&'static str, Value) + Send + Sync>;

#[derive(Default)]
struct Relay {
    epoch: u64,
    paused: bool,
}

#[derive(Default)]
pub struct LanSyncState {
    manager: tokio::sync::Mutex<Option<Manager>>,
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

fn lock(relay: &Mutex<Relay>) -> MutexGuard<'_, Relay> {
    relay.lock().unwrap_or_else(|e| e.into_inner())
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
        ManagerEvent::Status(LanStatus::Running) if paused => vec![status(LanStatus::Paused)],
        ManagerEvent::Status(LanStatus::Stopped) => {
            vec![(PEERS, json!([])), status(LanStatus::Stopped)]
        }
        ManagerEvent::Status(s) => vec![status(*s)],
    }
}

// `from` is the forwarder's epoch; a stale forwarder stays silent once a restart bumped it.
fn publish(relay: &Mutex<Relay>, from: Option<u64>, emit: &Emit, event: &ManagerEvent) {
    let relay = lock(relay);
    if from.is_some_and(|epoch| epoch != relay.epoch) {
        return;
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
    emit: Emit,
) -> Result<(), String> {
    let auth_keys = Zeroizing::new(auth_keys);
    let derived = Zeroizing::new(auth_keys.iter().map(|k| derive_auth_key(k)).collect());
    let mut running = state.manager.lock().await;
    let (epoch, paused) = {
        let mut relay = state.relay();
        relay.epoch += 1;
        (relay.epoch, relay.paused)
    };
    *running = None;
    let (tx, rx) = mpsc::channel(EVENTS);
    let manager = match manager::start(me, derived, !cfg!(test), tx).await {
        Ok(manager) => manager,
        Err(e) => {
            state.announce(&emit, LanStatus::Stopped);
            return Err(e);
        }
    };
    manager.set_paused(paused);
    tokio::spawn(forward(rx, state.relay.clone(), epoch, emit));
    *running = Some(manager);
    Ok(())
}

pub async fn stop_inner(state: &LanSyncState) {
    let mut running = state.manager.lock().await;
    if let Some(manager) = running.take() {
        manager.stop().await;
    }
}

pub async fn set_paused_inner(state: &LanSyncState, paused: bool, emit: &Emit) {
    let running = state.manager.lock().await;
    state.relay().paused = paused;
    if let Some(manager) = running.as_ref() {
        manager.set_paused(paused);
        state.announce(
            emit,
            if paused {
                LanStatus::Paused
            } else {
                LanStatus::Running
            },
        );
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
    };
    #[cfg(target_os = "android")]
    if let Err(e) = crate::lan_sync::android::acquire_multicast_lock() {
        log::warn!("lan-sync: {e}");
    }
    start_inner(&state, me, auth_keys, emit).await
}

#[tauri::command]
pub async fn lan_sync_stop(state: State<'_, LanSyncState>) -> Result<(), String> {
    stop_inner(&state).await;
    #[cfg(target_os = "android")]
    crate::lan_sync::android::release_multicast_lock();
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_broadcast(
    state: State<'_, LanSyncState>,
    blob: Vec<u8>,
) -> Result<(), String> {
    broadcast_inner(&state, blob).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_sync_take_blob(
    state: State<'_, LanSyncState>,
    device_id: String,
) -> Result<Option<Vec<u8>>, String> {
    Ok(take_blob_inner(&state, &device_id).await)
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

    async fn until(seen: &Seen, wanted: (&'static str, Value)) {
        let poll = async {
            while !seen.lock().unwrap().contains(&wanted) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        if tokio::time::timeout(Duration::from_secs(10), poll)
            .await
            .is_err()
        {
            panic!("never saw {wanted:?}; saw {:?}", seen.lock().unwrap());
        }
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
        for account in [1u8, 2] {
            start_inner(
                &state,
                test_identity("dev-me"),
                vec![vec![account; 32]],
                emit.clone(),
            )
            .await
            .unwrap();
        }
        assert!(peers_inner(&state).await.is_empty());
        assert!(dial_as(&state, "dev-old", 1).await.is_err());

        dial_as(&state, "dev-b", 2).await.unwrap();
        until(&seen, (BLOB_READY, json!({ "deviceId": "dev-b" }))).await;
        assert_eq!(take_blob_inner(&state, "dev-b").await, Some(vec![2]));
        assert_eq!(peers_inner(&state).await[0].device_id, "dev-b");
        let listed = seen
            .lock()
            .unwrap()
            .iter()
            .any(|(name, payload)| *name == PEERS && payload[0]["deviceId"] == "dev-b");
        assert!(listed, "{:?}", seen.lock().unwrap());

        set_paused_inner(&state, true, &emit).await;
        until(&seen, status(LanStatus::Paused)).await;
        stop_inner(&state).await;
        until(&seen, status(LanStatus::Stopped)).await;
        assert!(peers_inner(&state).await.is_empty());
        let seen = seen.lock().unwrap();
        assert_eq!(
            seen[seen.len() - 2..],
            [(PEERS, json!([])), status(LanStatus::Stopped)]
        );
    }

    #[tokio::test]
    async fn stale_forwarder_is_silent_after_a_restart() {
        let state = LanSyncState::default();
        let (emit, seen) = recorder();
        start_inner(
            &state,
            test_identity("dev-me"),
            vec![vec![1; 32]],
            emit.clone(),
        )
        .await
        .unwrap();
        let stale = state.relay().epoch;
        start_inner(
            &state,
            test_identity("dev-me"),
            vec![vec![1; 32]],
            emit.clone(),
        )
        .await
        .unwrap();
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

    #[test]
    fn paused_relay_reports_running_as_paused() {
        let running = ManagerEvent::Status(LanStatus::Running);
        assert_eq!(payloads(&running, true), vec![status(LanStatus::Paused)]);
        assert_eq!(payloads(&running, false), vec![(STATUS, json!("running"))]);
    }
}
