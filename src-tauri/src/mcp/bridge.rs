use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::{oneshot, Mutex};

#[derive(Debug)]
pub enum BridgeError {
    Timeout,
    Invalidated(String),
    NoWebview,
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BridgeError::Timeout => write!(f, "the app did not answer in time"),
            BridgeError::Invalidated(r) => write!(f, "request cancelled: {r}"),
            BridgeError::NoWebview => write!(f, "the app window is not available"),
        }
    }
}

/// Request/response over the Rust→webview boundary. Generalizes the host-key
/// conflict pattern in `ssh/client.rs`, which is the same oneshot-in-a-map
/// shape but has no invalidation: a reload strands its senders and the
/// awaiting task hangs forever.
///
/// Senders and receivers are held in separate maps so `register` (reserve the
/// slot) can be split from `wait` (park on it) — the caller must be able to
/// emit the event only after the slot exists, or a fast webview could reply
/// before there is anything to reply to.
#[derive(Clone)]
pub struct Bridge {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, BridgeError>>>>>,
    slots: Arc<Mutex<HashMap<String, oneshot::Receiver<Result<Value, BridgeError>>>>>,
}

impl Bridge {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            slots: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register(&self) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);
        self.slots.lock().await.insert(id.clone(), rx);
        id
    }

    pub async fn pending_count(&self) -> usize {
        self.pending.lock().await.len()
    }

    pub async fn reply(&self, id: &str, result: Value) {
        if let Some(tx) = self.pending.lock().await.remove(id) {
            let _ = tx.send(Ok(result));
        }
    }

    /// Fail every in-flight request. Called on webview reload/destroy: the
    /// listener that would have answered is gone, so waiting is pointless.
    pub async fn invalidate_all(&self, reason: &str) {
        let drained: Vec<_> = self.pending.lock().await.drain().collect();
        for (_id, tx) in drained {
            let _ = tx.send(Err(BridgeError::Invalidated(reason.to_string())));
        }
    }

    pub async fn request(
        &self,
        app: &tauri::AppHandle,
        payload: Value,
        timeout: Duration,
    ) -> Result<Value, BridgeError> {
        let id = self.register().await;
        app.emit("mcp-bridge-request", serde_json::json!({ "id": id, "payload": payload }))
            .map_err(|_| BridgeError::NoWebview)?;
        self.wait(&id, timeout).await
    }

    pub async fn wait(&self, id: &str, timeout: Duration) -> Result<Value, BridgeError> {
        let rx = match self.slots.lock().await.remove(id) {
            Some(rx) => rx,
            None => return Err(BridgeError::Timeout),
        };
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            // Sender dropped without sending — treat as invalidated, not a hang.
            Ok(Err(_)) => Err(BridgeError::Invalidated("dropped".into())),
            Err(_) => {
                self.pending.lock().await.remove(id);
                Err(BridgeError::Timeout)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn reply_resolves_the_matching_request() {
        let bridge = Bridge::new();
        let id = bridge.register().await;
        let waiter = {
            let b = bridge.clone();
            let id = id.clone();
            tokio::spawn(async move { b.wait(&id, Duration::from_secs(5)).await })
        };
        // Give the waiter a tick to park on the receiver.
        tokio::task::yield_now().await;
        bridge.reply(&id, serde_json::json!({"ok": true})).await;
        let got = waiter.await.unwrap().unwrap();
        assert_eq!(got, serde_json::json!({"ok": true}));
    }

    #[tokio::test]
    async fn invalidate_all_errors_in_flight_requests_instead_of_hanging() {
        let bridge = Bridge::new();
        let id = bridge.register().await;
        let waiter = {
            let b = bridge.clone();
            let id = id.clone();
            tokio::spawn(async move { b.wait(&id, Duration::from_secs(30)).await })
        };
        tokio::task::yield_now().await;
        bridge.invalidate_all("webview reloaded").await;
        // The point of the whole task: this returns promptly, it does not hang
        // out the 30s timeout.
        match waiter.await.unwrap() {
            Err(BridgeError::Invalidated(reason)) => assert_eq!(reason, "webview reloaded"),
            other => panic!("expected Invalidated, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_request_that_is_never_answered_times_out() {
        let bridge = Bridge::new();
        let id = bridge.register().await;
        let got = bridge.wait(&id, Duration::from_millis(50)).await;
        assert!(matches!(got, Err(BridgeError::Timeout)));
    }

    #[tokio::test]
    async fn a_reply_for_an_unknown_id_is_ignored_rather_than_panicking() {
        let bridge = Bridge::new();
        bridge.reply("no-such-id", serde_json::json!({})).await;
    }

    #[tokio::test]
    async fn a_timed_out_request_leaves_no_entry_behind() {
        let bridge = Bridge::new();
        let id = bridge.register().await;
        let _ = bridge.wait(&id, Duration::from_millis(50)).await;
        assert_eq!(bridge.pending_count().await, 0);
    }
}
