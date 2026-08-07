pub mod bridge;
pub mod protocol;
pub mod shim;
pub mod transport;

use std::sync::atomic::AtomicBool;
use tokio::sync::watch;

pub use bridge::{Bridge, BridgeError};

pub struct McpState {
    pub bridge: Bridge,
    /// Off by default: no socket exists until the user turns the server on.
    pub enabled: AtomicBool,
    /// `true` while the listener (and every connection it spawned) should keep
    /// running. A watch channel, not a `Notify`, so a receiver created *after*
    /// the flip to `false` still observes it immediately instead of only
    /// future changes — closing the race where a connection is accepted in
    /// the same instant the toggle is switched off.
    pub shutdown_tx: watch::Sender<bool>,
    /// Kept alive so `receiver_count()` never hits 0: `watch::Sender::send`
    /// writes nothing and returns `Err` once every receiver has been
    /// dropped, which would silently strand the value at its initial
    /// `false` forever. Never read directly — subscribe via `shutdown_tx`.
    _shutdown_rx: watch::Receiver<bool>,
}

impl McpState {
    pub fn new() -> Self {
        let (shutdown_tx, _shutdown_rx) = watch::channel(false);
        Self {
            bridge: Bridge::new(),
            enabled: AtomicBool::new(false),
            shutdown_tx,
            _shutdown_rx,
        }
    }
}
