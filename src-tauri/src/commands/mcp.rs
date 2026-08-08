use crate::mcp::{transport, McpState};
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[tauri::command]
pub async fn mcp_bridge_reply(
    state: tauri::State<'_, Arc<McpState>>,
    id: String,
    result: serde_json::Value,
) -> Result<(), String> {
    state.bridge.reply(&id, result).await;
    Ok(())
}

/// Called once the webview's consumer has (re)attached its
/// `mcp-bridge-request` listener — on first boot and after every reload.
/// Reopens the gate `on_page_load`'s `Started` handler closed, so requests
/// that arrive between a reload starting and the new listener being ready
/// get rejected immediately instead of registering against nothing.
#[tauri::command]
pub async fn mcp_consumer_ready(state: tauri::State<'_, Arc<McpState>>) -> Result<(), String> {
    state.bridge.set_ready(true);
    Ok(())
}

#[tauri::command]
pub async fn mcp_set_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
    enabled: bool,
) -> Result<String, String> {
    let state = state.inner().clone();
    if !enabled {
        state.enabled.store(false, Ordering::SeqCst);
        // Wakes the accept loop and every live connection task, not just the
        // atomic flag — otherwise a client connected before this call keeps
        // full tool access until it disconnects on its own. `send_replace`,
        // not `send`, because `send` no-ops on a receiver count of 0 — a
        // trap this code fell into once already.
        state.shutdown_tx.send_replace(false);
        // Stale-socket cleanup, unix only: on Windows this path names a pipe,
        // and an unlink of it could open the pipe as a client instead.
        #[cfg(unix)]
        let _ = std::fs::remove_file(transport::socket_path());
        return Ok(String::new());
    }
    // Already serving: report the path rather than binding twice.
    if state.enabled.swap(true, Ordering::SeqCst) {
        return Ok(transport::socket_path().to_string_lossy().into_owned());
    }
    state.shutdown_tx.send_replace(true);
    let path = transport::socket_path().to_string_lossy().into_owned();
    let st = state.clone();
    // `serve` runs for as long as the server is on, so it cannot be awaited
    // here — but returning Ok before the listener exists would leave the
    // toggle reading on with nothing bound. This channel carries just the
    // bind/create result back, so a failure reaches the caller.
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = transport::serve(app, st.clone(), ready_tx).await {
            log::error!("[mcp] listener stopped: {e}");
            st.enabled.store(false, Ordering::SeqCst);
        }
    });
    match ready_rx.await {
        Ok(Ok(())) => Ok(path),
        // A dropped sender means `serve` ended without ever signalling; treat
        // it as a failure to start rather than silently reporting success.
        Ok(Err(e)) => Err(disarm(&state, e)),
        Err(_) => Err(disarm(&state, "the MCP listener did not start".into())),
    }
}

/// The listener never came up: put the state back where a fresh enable can
/// re-arm it, and stop any connection task that raced in behind it.
fn disarm(state: &Arc<McpState>, err: String) -> String {
    state.enabled.store(false, Ordering::SeqCst);
    state.shutdown_tx.send_replace(false);
    err
}

#[tauri::command]
pub async fn mcp_status(
    state: tauri::State<'_, Arc<McpState>>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "enabled": state.enabled.load(Ordering::SeqCst),
        "socketPath": transport::socket_path().to_string_lossy(),
    }))
}
