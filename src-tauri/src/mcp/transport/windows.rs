use crate::mcp::McpState;
use std::sync::Arc;

/// Windows named-pipe support is deferred to a later plan; this keeps the
/// Windows build compiling with a clear, honest error instead of a guessed
/// `named_pipe` builder API.
#[cfg(windows)]
pub async fn serve(_app: tauri::AppHandle, _state: Arc<McpState>) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "MCP server is not yet supported on Windows",
    ))
}
