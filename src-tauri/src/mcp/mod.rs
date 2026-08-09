pub mod bridge;
pub mod protocol;
pub mod shim;
pub mod transport;

use std::sync::atomic::AtomicBool;
use tokio::sync::{broadcast, watch};

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
    /// Fires when the tool list changes, so every live connection can send
    /// `notifications/tools/list_changed`. A broadcast, not a watch: each
    /// connection must observe every change, and there is no meaningful
    /// "current value" to hold. Unlike `shutdown_tx` it needs no receiver kept
    /// alive — `send` on a zero-receiver broadcast returns `Err`, not a no-op.
    pub tools_changed_tx: broadcast::Sender<()>,
}

impl Default for McpState {
    fn default() -> Self {
        Self::new()
    }
}

impl McpState {
    pub fn new() -> Self {
        let (shutdown_tx, _shutdown_rx) = watch::channel(false);
        let (tools_changed_tx, _) = broadcast::channel(16);
        Self {
            bridge: Bridge::new(),
            enabled: AtomicBool::new(false),
            shutdown_tx,
            _shutdown_rx,
            tools_changed_tx,
        }
    }
}
