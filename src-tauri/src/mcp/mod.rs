pub mod bridge;
pub mod protocol;

use std::sync::atomic::AtomicBool;

pub use bridge::{Bridge, BridgeError};

pub struct McpState {
    pub bridge: Bridge,
    /// Off by default: no socket exists until the user turns the server on.
    pub enabled: AtomicBool,
}

impl McpState {
    pub fn new() -> Self {
        Self { bridge: Bridge::new(), enabled: AtomicBool::new(false) }
    }
}
