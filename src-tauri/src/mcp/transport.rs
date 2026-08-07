use crate::mcp::{protocol, McpState};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

const CALL_TIMEOUT: Duration = Duration::from_secs(120);

#[cfg(unix)]
pub fn socket_path() -> PathBuf {
    crate::storage::config::config_dir().join("mcp.sock")
}

#[cfg(windows)]
pub fn socket_path() -> PathBuf {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "voltius".to_string());
    PathBuf::from(format!(r"\\.\pipe\voltius-mcp-{user}"))
}

/// `ctx: None` handles only the methods that need no app state, which is what
/// keeps the protocol path unit-testable without a running webview.
type Ctx<'a> = Option<(&'a tauri::AppHandle, &'a Arc<McpState>)>;

pub async fn dispatch_line(ctx: Ctx<'_>, line: &str) -> Option<Value> {
    let req = match protocol::parse_request(line) {
        Ok(r) => r,
        Err(resp) => return Some(resp),
    };
    // A notification has no id and, per JSON-RPC, gets no response at all.
    let id = req.id.clone()?;

    match req.method.as_str() {
        "initialize" => Some(protocol::success(Some(id), protocol::initialize_result())),
        "tools/list" | "tools/call" => {
            let Some((app, state)) = ctx else {
                return Some(protocol::error(Some(id), -32603, "app unavailable"));
            };
            let payload = if req.method == "tools/list" {
                json!({ "op": "tools/list" })
            } else {
                json!({
                    "op": "tools/call",
                    "name": req.params.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                    "args": req.params.get("arguments").cloned().unwrap_or_else(|| json!({})),
                })
            };
            match state.bridge.request(app, payload, CALL_TIMEOUT).await {
                Ok(v) => Some(protocol::success(Some(id), to_mcp_result(&req.method, v))),
                Err(e) => Some(protocol::error(Some(id), -32603, &e.to_string())),
            }
        }
        _ => Some(protocol::error(Some(id), -32601, "method not found")),
    }
}

/// `tools/call` results are MCP content blocks; `tools/list` passes through.
fn to_mcp_result(method: &str, v: Value) -> Value {
    if method == "tools/list" {
        return v;
    }
    let is_err = v.get("ok").and_then(|o| o.as_bool()) == Some(false);
    let body = if is_err {
        v.get("error").cloned().unwrap_or(json!("error"))
    } else {
        v.get("result").cloned().unwrap_or(Value::Null)
    };
    let text = match &body {
        Value::String(s) => s.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    };
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_err })
}

#[cfg(unix)]
pub async fn serve(app: tauri::AppHandle, state: Arc<McpState>) -> std::io::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;

    let path = socket_path();
    // A stale socket from a crashed run would make bind fail with EADDRINUSE.
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;
    {
        use std::os::unix::fs::PermissionsExt;
        // Owner-only: anything laxer would let any local user drive the user's
        // SSH hosts, which is the reason this is a socket and not a TCP port.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }

    loop {
        let (stream, _) = listener.accept().await?;
        let app = app.clone();
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            let (r, mut w) = tokio::io::split(stream);
            let mut lines = BufReader::new(r).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() { continue; }
                if let Some(resp) = dispatch_line(Some((&app, &state)), &line).await {
                    let mut out = serde_json::to_vec(&resp).unwrap_or_default();
                    out.push(b'\n');
                    if w.write_all(&out).await.is_err() { break; }
                }
            }
        });
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_socket_lives_under_the_app_config_dir() {
        let p = socket_path();
        assert!(p.starts_with(crate::storage::config::config_dir()));
        assert!(p.to_string_lossy().contains("mcp"));
    }

    #[tokio::test]
    async fn dispatch_answers_initialize_without_touching_the_webview() {
        let out = dispatch_line(None, r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#).await;
        let v = out.unwrap();
        assert_eq!(v["result"]["serverInfo"]["name"], serde_json::json!("voltius"));
    }

    #[tokio::test]
    async fn a_notification_produces_no_response_line() {
        let out = dispatch_line(None, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).await;
        assert!(out.is_none(), "notifications must not get a reply");
    }

    #[tokio::test]
    async fn an_unknown_method_is_method_not_found() {
        let out = dispatch_line(None, r#"{"jsonrpc":"2.0","id":9,"method":"resources/list"}"#).await;
        assert_eq!(out.unwrap()["error"]["code"], serde_json::json!(-32601));
    }

    #[tokio::test]
    async fn a_malformed_line_still_produces_a_well_formed_error() {
        let out = dispatch_line(None, "garbage").await;
        assert_eq!(out.unwrap()["error"]["code"], serde_json::json!(-32700));
    }

    #[tokio::test]
    async fn tools_call_without_app_context_is_an_internal_error_not_a_panic() {
        let out = dispatch_line(None, r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"x"}}"#).await;
        assert_eq!(out.unwrap()["error"]["code"], serde_json::json!(-32603));
    }
}
