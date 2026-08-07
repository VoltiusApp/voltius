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

#[tauri::command]
pub async fn mcp_set_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<McpState>>,
    enabled: bool,
) -> Result<String, String> {
    let state = state.inner().clone();
    if !enabled {
        state.enabled.store(false, Ordering::SeqCst);
        let _ = std::fs::remove_file(transport::socket_path());
        return Ok(String::new());
    }
    // Already serving: report the path rather than binding twice.
    if state.enabled.swap(true, Ordering::SeqCst) {
        return Ok(transport::socket_path().to_string_lossy().into_owned());
    }
    let path = transport::socket_path().to_string_lossy().into_owned();
    let st = state.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = transport::serve(app, st.clone()).await {
            log::error!("[mcp] listener stopped: {e}");
            st.enabled.store(false, Ordering::SeqCst);
        }
    });
    Ok(path)
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
