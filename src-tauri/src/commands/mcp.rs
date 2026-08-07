use crate::mcp::McpState;
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
