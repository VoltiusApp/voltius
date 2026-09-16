mod os;

use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// One interface change fires several notifications (v4, v6, duplicate-check done).
const SETTLE: Duration = Duration::from_millis(300);

/// Emit `network-changed` once the OS has assigned a new routable address.
pub fn start(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<()>();
    if let Err(e) = os::watch_address_added(tx) {
        log::info!("network change watcher unavailable: {e}");
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("network-watch-emit".into())
        .spawn(move || {
            while rx.recv().is_ok() {
                while rx.recv_timeout(SETTLE).is_ok() {}
                let _ = app.emit("network-changed", ());
            }
        });
    if let Err(e) = spawned {
        log::warn!("network change emitter failed to start: {e}");
    }
}
