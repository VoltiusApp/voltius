use crate::mcp::{protocol, McpState};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, watch};

pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(120);
pub(crate) const MAX_LINE_BYTES: usize = 1024 * 1024;
/// Display-only, and chosen by the client, so it is length-capped before it
/// ever reaches the UI.
const MAX_CLIENT_NAME: usize = 40;

#[cfg(unix)]
fn mcp_dir() -> PathBuf {
    crate::storage::config::config_dir().join("mcp")
}

#[cfg(unix)]
pub fn socket_path() -> PathBuf {
    mcp_dir().join("mcp.sock")
}

#[cfg(windows)]
pub fn socket_path() -> PathBuf {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "voltius".to_string());
    PathBuf::from(format!(r"\\.\pipe\voltius-mcp-{user}"))
}

/// `ctx: None` handles only the methods that need no app state, which is what
/// keeps the protocol path unit-testable without a running webview.
type Ctx<'a> = Option<(&'a tauri::AppHandle, &'a Arc<McpState>)>;

pub async fn dispatch_line(
    ctx: Ctx<'_>,
    client_id: &str,
    client_name: &mut Option<String>,
    line: &str,
) -> Option<Value> {
    let req = match protocol::parse_request(line) {
        Ok(r) => r,
        Err(resp) => return Some(resp),
    };
    // A notification has no id and, per JSON-RPC, gets no response at all.
    let id = req.id.clone()?;

    match req.method.as_str() {
        "initialize" => {
            if let Some(n) = req
                .params
                .get("clientInfo")
                .and_then(|c| c.get("name"))
                .and_then(|n| n.as_str())
                .filter(|n| !n.trim().is_empty())
            {
                *client_name = Some(n.chars().take(MAX_CLIENT_NAME).collect());
            }
            Some(protocol::success(Some(id), protocol::initialize_result()))
        }
        "tools/list" | "tools/call" => {
            let Some((app, state)) = ctx else {
                return Some(protocol::error(Some(id), -32603, "app unavailable"));
            };
            let name = client_name.clone().unwrap_or_default();
            let payload = if req.method == "tools/list" {
                json!({ "op": "tools/list", "clientId": client_id, "clientName": name })
            } else {
                json!({
                    "op": "tools/call",
                    "clientId": client_id,
                    "clientName": name,
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

/// Reads one line, capped at `max` bytes, so a client that never sends `\n`
/// can't grow this process's memory without bound. On overflow, drains the
/// rest of the oversized line so the connection can recover on the next read.
///
/// `buf` is the caller's, not a local, so cancelling this future mid-line — the
/// connection loop drops it whenever another `select!` arm wins — keeps the
/// bytes already read instead of truncating the client's request.
pub(crate) async fn read_line_capped<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<Option<String>> {
    use tokio::io::AsyncReadExt;
    let mut byte = [0u8; 1];
    loop {
        if reader.read(&mut byte).await? == 0 {
            return Ok(if buf.is_empty() {
                None
            } else {
                Some(String::from_utf8_lossy(&std::mem::take(buf)).into_owned())
            });
        }
        if byte[0] == b'\n' {
            return Ok(Some(
                String::from_utf8_lossy(&std::mem::take(buf)).into_owned(),
            ));
        }
        if buf.len() >= max {
            buf.clear();
            while reader.read(&mut byte).await? != 0 && byte[0] != b'\n' {}
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "line too long",
            ));
        }
        buf.push(byte[0]);
    }
}

/// Reads lines and dispatches them until the stream closes, a line is
/// malformed, or `shutdown` drops to `false` — the same signal `run_accept_loop`
/// watches. Every await point in the loop (the line read, the dispatch —
/// which can run up to `CALL_TIMEOUT` — the response write, and the
/// `tools/list_changed` notification write) races against
/// `shutdown.changed()`, so a call already in flight when the server is
/// turned off has its response discarded rather than delivered up to
/// `CALL_TIMEOUT` later to a client the toggle says is off.
///
/// Generic over the stream and given an owned `app_state` (not borrowed) so
/// it can be spawned as a `'static` task; `app_state: None` exercises the
/// same cancellation logic in tests without a `tauri::AppHandle`.
pub(crate) async fn handle_connection_stream<S>(
    stream: S,
    app_state: Option<(tauri::AppHandle, Arc<McpState>)>,
    mut shutdown: watch::Receiver<bool>,
    mut tools_changed: broadcast::Receiver<()>,
    client_id: String,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::{AsyncWriteExt, BufReader};

    if !*shutdown.borrow() {
        return;
    }
    let (r, mut w) = tokio::io::split(stream);
    let mut reader = BufReader::new(r);
    // `recv()` on a closed broadcast is instantly ready every time, so the arm
    // has to be disabled rather than `continue`d past, or the loop busy-waits.
    let mut changed_open = true;
    let mut pending = Vec::new();
    let mut client_name: Option<String> = None;
    loop {
        let line = tokio::select! {
            biased;
            changed = shutdown.changed() => {
                if changed.is_err() || !*shutdown.borrow() { break; }
                continue;
            }
            changed = tools_changed.recv(), if changed_open => {
                // Lagged means changes were missed; the client still needs to
                // re-list, so one notification covers the gap.
                if matches!(changed, Err(broadcast::error::RecvError::Closed)) {
                    changed_open = false;
                    continue;
                }
                let mut out = serde_json::to_vec(&protocol::tools_changed_notification())
                    .unwrap_or_default();
                out.push(b'\n');
                // Raced against shutdown like every other write: a client that
                // stopped reading would otherwise park this task on a full
                // buffer forever, unreachable by the toggle.
                tokio::select! {
                    biased;
                    changed = shutdown.changed() => {
                        if changed.is_err() || !*shutdown.borrow() { break; }
                        continue;
                    }
                    res = w.write_all(&out) => { if res.is_err() { break; } }
                }
                continue;
            }
            res = read_line_capped(&mut reader, &mut pending, MAX_LINE_BYTES) => res,
        };
        let resp = match line {
            Ok(None) => break,
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                let ctx = app_state.as_ref().map(|(a, s)| (a, s));
                tokio::select! {
                    biased;
                    changed = shutdown.changed() => {
                        if changed.is_err() || !*shutdown.borrow() { break; }
                        continue;
                    }
                    resp = dispatch_line(ctx, &client_id, &mut client_name, &line) => resp,
                }
            }
            Err(_) => Some(protocol::error(None, -32600, "line too long")),
        };
        if let Some(resp) = resp {
            let mut out = serde_json::to_vec(&resp).unwrap_or_default();
            out.push(b'\n');
            tokio::select! {
                biased;
                changed = shutdown.changed() => {
                    if changed.is_err() || !*shutdown.borrow() { break; }
                    continue;
                }
                res = w.write_all(&out) => { if res.is_err() { break; } }
            }
        }
    }

    // Fire and forget: the reply is meaningless and awaiting it would hold the
    // connection task open for up to CALL_TIMEOUT after the client is already
    // gone. Sessions this client opened stay open as real tabs; they simply
    // stop being MCP-closable, exactly like sessions the user opened.
    if let Some((app, state)) = app_state {
        let payload = json!({ "op": "client_closed", "clientId": client_id });
        tauri::async_runtime::spawn(async move {
            let _ = state.bridge.request(&app, payload, CALL_TIMEOUT).await;
        });
    }
}

/// A protected DACL granting generic-all to LocalSystem and one user SID, and
/// nothing to anyone else. `P` blocks inherited ACEs from widening it.
/// Only called from the Windows pipe listener; `cfg(test)` keeps it compiled
/// (and thus lint-checked) on non-Windows so the tests below still run.
#[cfg(any(windows, test))]
pub(crate) fn owner_only_sddl(user_sid: &str) -> String {
    format!("D:P(A;;GA;;;SY)(A;;GA;;;{user_sid})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn the_socket_lives_under_the_app_config_dir() {
        let p = socket_path();
        assert!(p.starts_with(crate::storage::config::config_dir()));
        assert!(p.to_string_lossy().contains("mcp"));
    }

    #[cfg(windows)]
    #[test]
    fn the_pipe_lives_in_the_named_pipe_namespace() {
        let p = socket_path();
        assert!(p.to_string_lossy().starts_with(r"\\.\pipe\"));
        assert!(p.to_string_lossy().contains("mcp"));
    }

    #[tokio::test]
    async fn initialize_records_the_client_name_for_later_payloads() {
        let mut name = None;
        dispatch_line(
            None,
            "test",
            &mut name,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"Claude Code"}}}"#,
        )
        .await;
        assert_eq!(name.as_deref(), Some("Claude Code"));
    }

    #[tokio::test]
    async fn a_client_name_is_capped_and_a_missing_one_stays_none() {
        let mut long = None;
        dispatch_line(
            None,
            "test",
            &mut long,
            &format!(
                r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"clientInfo":{{"name":"{}"}}}}}}"#,
                "x".repeat(200)
            ),
        )
        .await;
        assert_eq!(long.as_deref().map(str::len), Some(40));

        let mut absent = None;
        dispatch_line(
            None,
            "test",
            &mut absent,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
        )
        .await;
        assert!(absent.is_none());
    }

    #[tokio::test]
    async fn dispatch_answers_initialize_without_touching_the_webview() {
        let out = dispatch_line(
            None,
            "test",
            &mut None,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
        )
        .await;
        let v = out.unwrap();
        assert_eq!(
            v["result"]["serverInfo"]["name"],
            serde_json::json!("voltius")
        );
    }

    #[tokio::test]
    async fn a_notification_produces_no_response_line() {
        let out = dispatch_line(
            None,
            "test",
            &mut None,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        )
        .await;
        assert!(out.is_none(), "notifications must not get a reply");
    }

    #[tokio::test]
    async fn an_unknown_method_is_method_not_found() {
        let out = dispatch_line(
            None,
            "test",
            &mut None,
            r#"{"jsonrpc":"2.0","id":9,"method":"resources/list"}"#,
        )
        .await;
        assert_eq!(out.unwrap()["error"]["code"], serde_json::json!(-32601));
    }

    #[tokio::test]
    async fn a_malformed_line_still_produces_a_well_formed_error() {
        let out = dispatch_line(None, "test", &mut None, "garbage").await;
        assert_eq!(out.unwrap()["error"]["code"], serde_json::json!(-32700));
    }

    #[tokio::test]
    async fn tools_call_without_app_context_is_an_internal_error_not_a_panic() {
        let out = dispatch_line(
            None,
            "test",
            &mut None,
            r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"x"}}"#,
        )
        .await;
        assert_eq!(out.unwrap()["error"]["code"], serde_json::json!(-32603));
    }

    #[test]
    fn to_mcp_result_passes_tools_list_through_unchanged() {
        let v = json!({ "tools": [{ "name": "x" }] });
        assert_eq!(to_mcp_result("tools/list", v.clone()), v);
    }

    #[test]
    fn to_mcp_result_wraps_a_successful_string_result_as_text() {
        let v = json!({ "ok": true, "result": "hello" });
        let out = to_mcp_result("tools/call", v);
        assert_eq!(out["content"][0]["text"], json!("hello"));
        assert_eq!(out["isError"], json!(false));
    }

    #[test]
    fn to_mcp_result_serializes_a_non_string_result_as_json_text() {
        let v = json!({ "ok": true, "result": { "a": 1 } });
        let out = to_mcp_result("tools/call", v);
        assert_eq!(out["content"][0]["text"], json!(r#"{"a":1}"#));
        assert_eq!(out["isError"], json!(false));
    }

    #[test]
    fn to_mcp_result_marks_a_failed_call_as_an_error_with_the_error_body() {
        let v = json!({ "ok": false, "error": "boom" });
        let out = to_mcp_result("tools/call", v);
        assert_eq!(out["isError"], json!(true));
        assert_eq!(out["content"][0]["text"], json!("boom"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_line_capped_reads_a_normal_line() {
        let mut cursor = std::io::Cursor::new(b"hello\n".to_vec());
        let line = read_line_capped(&mut cursor, &mut Vec::new(), 1024)
            .await
            .unwrap();
        assert_eq!(line, Some("hello".to_string()));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_line_capped_rejects_a_line_over_the_limit() {
        let mut data = vec![b'a'; 20];
        data.push(b'\n');
        let mut cursor = std::io::Cursor::new(data);
        let err = read_line_capped(&mut cursor, &mut Vec::new(), 10)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }

    /// The connection loop drops this future whenever another `select!` arm
    /// wins, so a half-read line has to survive in the caller's buffer.
    #[cfg(unix)]
    #[tokio::test]
    async fn read_line_capped_resumes_a_line_it_was_cancelled_midway_through() {
        use tokio::io::AsyncWriteExt;

        let (mut server, mut client) = tokio::io::duplex(64);
        let mut buf = Vec::new();
        client.write_all(b"hel").await.unwrap();
        assert!(
            tokio::time::timeout(
                Duration::from_millis(50),
                read_line_capped(&mut server, &mut buf, 1024)
            )
            .await
            .is_err(),
            "no newline yet, so the read must still be pending when cancelled"
        );

        client.write_all(b"lo\n").await.unwrap();
        assert_eq!(
            read_line_capped(&mut server, &mut buf, 1024).await.unwrap(),
            Some("hello".to_string())
        );
    }

    /// Reuses a single, long-lived `McpState`-backed sender across both
    /// cycles — exactly the shape `mcp_set_enabled` re-arms on every
    /// enable/disable, and exactly the shape that stayed permanently stuck
    /// at `false` when `McpState::new()` dropped its only receiver (a fresh
    /// `watch::channel` per cycle, as this test used to build, would never
    /// have caught that).
    #[tokio::test]
    async fn mcp_state_new_keeps_its_shutdown_channel_live_before_anyone_subscribes() {
        let state = McpState::new();

        // Mirrors mcp_set_enabled's real order: the flip happens first,
        // `serve()`'s subscribe() happens only after the task is spawned.
        state
            .shutdown_tx
            .send(true)
            .expect("send must not no-op: McpState must hold a live receiver");

        let rx = state.shutdown_tx.subscribe();
        assert!(
            *rx.borrow(),
            "a receiver created after the flip must see it, not the stale default"
        );

        state
            .shutdown_tx
            .send(false)
            .expect("send must not no-op on disable either");
        assert!(
            !*state.shutdown_tx.subscribe().borrow(),
            "disable must reach a receiver subscribed afterward"
        );
    }

    /// `handle_connection_stream` needs no `tauri::AppHandle` at all — it's
    /// exercised with `app_state: None`, the same path the existing
    /// no-context `dispatch_line` tests use, over an in-memory duplex pair
    /// instead of a real Unix socket.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_connected_clients_task_ends_when_shutdown_flips_to_false() {
        let (server_side, client_side) = tokio::io::duplex(1024);
        let (tx, rx) = watch::channel(true);
        let (_changed_tx, changed_rx) = broadcast::channel(8);
        let task = tokio::spawn(handle_connection_stream(
            server_side,
            None,
            rx,
            changed_rx,
            "c1".to_string(),
        ));

        // Let the task actually reach its blocking read — proving cancellation
        // works mid-`select!`, not only the up-front guard before any I/O.
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }

        tx.send(false).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(2), task).await;
        assert!(
            result.is_ok(),
            "connection task kept running after shutdown"
        );

        drop(client_side);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn handle_connection_stream_answers_one_request_before_shutdown() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (server_side, mut client_side) = tokio::io::duplex(4096);
        let (_tx, rx) = watch::channel(true);
        let (_changed_tx, changed_rx) = broadcast::channel(8);
        let task = tokio::spawn(handle_connection_stream(
            server_side,
            None,
            rx,
            changed_rx,
            "c1".to_string(),
        ));

        client_side
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n")
            .await
            .unwrap();
        let mut buf = [0u8; 512];
        let n = client_side.read(&mut buf).await.unwrap();
        let resp: Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(resp["result"]["serverInfo"]["name"], json!("voltius"));

        drop(client_side);
        let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_tools_changed_broadcast_reaches_a_connected_client() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (server_side, mut client_side) = tokio::io::duplex(4096);
        let (_tx, rx) = watch::channel(true);
        let (changed_tx, changed_rx) = broadcast::channel(8);
        let task = tokio::spawn(handle_connection_stream(
            server_side,
            None,
            rx,
            changed_rx,
            "c1".to_string(),
        ));

        // Answer one request first, so the connection is demonstrably parked on its
        // read when the broadcast lands rather than racing the task's startup.
        client_side
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n")
            .await
            .unwrap();
        let mut buf = [0u8; 512];
        let n = client_side.read(&mut buf).await.unwrap();
        assert!(String::from_utf8_lossy(&buf[..n]).contains("serverInfo"));

        changed_tx.send(()).unwrap();
        let n = client_side.read(&mut buf).await.unwrap();
        let resp: Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(resp["method"], json!("notifications/tools/list_changed"));
        assert!(resp.get("id").is_none(), "a notification carries no id");

        drop(client_side);
        let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
    }

    /// A dropped sender must not turn the notification arm into a busy-wait:
    /// `recv()` on a closed broadcast returns `Err(Closed)` immediately, forever.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_closed_broadcast_leaves_the_connection_serving_requests() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (server_side, mut client_side) = tokio::io::duplex(4096);
        let (_tx, rx) = watch::channel(true);
        let (changed_tx, changed_rx) = broadcast::channel(8);
        let task = tokio::spawn(handle_connection_stream(
            server_side,
            None,
            rx,
            changed_rx,
            "c1".to_string(),
        ));
        drop(changed_tx);

        client_side
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n")
            .await
            .unwrap();
        let mut buf = [0u8; 512];
        let n = tokio::time::timeout(Duration::from_secs(2), client_side.read(&mut buf))
            .await
            .expect("connection spun on a closed broadcast instead of reading")
            .unwrap();
        let resp: Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(resp["result"]["serverInfo"]["name"], json!("voltius"));

        drop(client_side);
        let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
    }

    #[test]
    fn initialize_advertises_a_live_tool_list() {
        assert_eq!(
            protocol::initialize_result()["capabilities"]["tools"]["listChanged"],
            json!(true)
        );
    }

    #[test]
    fn owner_only_sddl_grants_the_user_and_system_only() {
        let s = owner_only_sddl("S-1-5-21-1-2-3-1001");
        assert_eq!(s, "D:P(A;;GA;;;SY)(A;;GA;;;S-1-5-21-1-2-3-1001)");
    }

    #[test]
    fn owner_only_sddl_is_protected_so_no_inherited_ace_can_widen_it() {
        assert!(owner_only_sddl("S-1-5-21-1-2-3-1001").starts_with("D:P"));
    }

    #[test]
    fn owner_only_sddl_grants_no_access_to_world_or_everyone() {
        let s = owner_only_sddl("S-1-5-21-1-2-3-1001");
        for sid in ["WD", "AU", "BU", "AN"] {
            assert!(
                !s.contains(&format!(";{sid})")),
                "SDDL must not grant {sid}: {s}"
            );
        }
    }
}
