use super::shared::handle_connection_stream;
use super::socket_path;
use crate::mcp::McpState;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;

/// Owner-only, unreachable-parent-first: `bind` on some platforms creates the
/// socket with `0o777 & ~umask` before we can chmod it, and `config_dir()`
/// itself is world-traversable. Putting the socket in its own `0o700`
/// directory closes that window regardless of the transient socket mode or
/// the caller's umask.
#[cfg(unix)]
fn prepare_socket_dir(dir: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(unix)]
fn bind_socket(path: &std::path::Path) -> std::io::Result<tokio::net::UnixListener> {
    use std::os::unix::fs::PermissionsExt;
    // A stale socket from a crashed run would make bind fail with EADDRINUSE.
    let _ = std::fs::remove_file(path);
    let listener = tokio::net::UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Accepts connections until `shutdown` drops to `false`, then returns —
/// dropping `listener` and closing its fd. `on_accept` decides how to run
/// each connection (production spawns it; tests can just record it), which
/// keeps this loop testable without a `tauri::AppHandle`.
#[cfg(unix)]
async fn run_accept_loop(
    listener: tokio::net::UnixListener,
    mut shutdown: watch::Receiver<bool>,
    mut on_accept: impl FnMut(tokio::net::UnixStream, watch::Receiver<bool>),
) {
    loop {
        tokio::select! {
            biased;
            changed = shutdown.changed() => {
                if changed.is_err() || !*shutdown.borrow() { return; }
            }
            accept = listener.accept() => {
                match accept {
                    Ok((stream, _)) => {
                        // Re-check rather than trust the branch was chosen for
                        // the "still running" reason: accept() can win the
                        // select race against a shutdown that landed in the
                        // same instant.
                        if *shutdown.borrow() {
                            on_accept(stream, shutdown.clone());
                        }
                    }
                    Err(e) => {
                        // This process also holds SSH/SFTP sockets and PTYs, so
                        // fd-exhaustion errors (EMFILE/ENFILE) here are plausible and
                        // transient; nothing supervises `serve()`, so bailing would
                        // permanently disable MCP over a passing blip.
                        eprintln!("voltius mcp: accept error, retrying: {e}");
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }
            }
        }
    }
}

/// `ready` reports whether the socket came up, so the caller can fail the
/// enable instead of leaving the toggle on with nothing bound. It fires once,
/// before the accept loop starts; everything after it is reported by the
/// returned error.
#[cfg(unix)]
pub async fn serve(
    app: tauri::AppHandle,
    state: Arc<McpState>,
    ready: tokio::sync::oneshot::Sender<Result<(), String>>,
) -> std::io::Result<()> {
    let path = socket_path();
    let listener = match prepare_socket_dir(path.parent().expect("socket path has a parent"))
        .and_then(|()| bind_socket(&path))
    {
        Ok(l) => {
            let _ = ready.send(Ok(()));
            l
        }
        Err(e) => {
            let _ = ready.send(Err(e.to_string()));
            return Err(e);
        }
    };
    let shutdown = state.shutdown_tx.subscribe();

    run_accept_loop(listener, shutdown, move |stream, conn_shutdown| {
        let app_state = Some((app.clone(), state.clone()));
        let changed = state.tools_changed_tx.subscribe();
        let client_id = uuid::Uuid::new_v4().to_string();
        tauri::async_runtime::spawn(handle_connection_stream(
            stream,
            app_state,
            conn_shutdown,
            changed,
            client_id,
        ));
    })
    .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[cfg(unix)]
    #[test]
    fn prepare_socket_dir_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("voltius-mcp-test-dir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        prepare_socket_dir(&dir).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn bind_socket_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir =
            std::env::temp_dir().join(format!("voltius-mcp-test-sock-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test.sock");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let _listener = rt.block_on(async { bind_socket(&path) }).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    fn temp_sock_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "voltius-mcp-test-{tag}-{}.sock",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn run_accept_loop_returns_promptly_once_shutdown_flips_to_false() {
        let path = temp_sock_path("accept-cancel");
        let listener = bind_socket(&path).unwrap();
        let (tx, rx) = watch::channel(true);
        let task = tokio::spawn(run_accept_loop(listener, rx, |_stream, _rx| {}));

        tx.send(false).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(2), task).await;
        assert!(
            result.is_ok(),
            "run_accept_loop hung instead of returning on cancellation"
        );

        let _ = std::fs::remove_file(&path);
    }

    /// Reuses a single, long-lived `McpState`-backed sender across both
    /// cycles — exactly the shape `mcp_set_enabled` re-arms on every
    /// enable/disable, and exactly the shape that stayed permanently stuck
    /// at `false` when `McpState::new()` dropped its only receiver (a fresh
    /// `watch::channel` per cycle, as this test used to build, would never
    /// have caught that).
    #[cfg(unix)]
    #[tokio::test]
    async fn an_off_on_off_on_cycle_leaves_no_listener_bound_afterward() {
        let path = temp_sock_path("cycle");
        let state = McpState::new();
        for _ in 0..2 {
            state.shutdown_tx.send_replace(true);
            let listener = bind_socket(&path).unwrap();
            let rx = state.shutdown_tx.subscribe();
            let task = tokio::spawn(run_accept_loop(listener, rx, |_stream, _rx| {}));

            state.shutdown_tx.send_replace(false);
            tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .unwrap()
                .unwrap();

            // The listener was dropped when run_accept_loop returned, so the
            // stale socket file (still on disk) now refuses connections —
            // proof the fd, not just the atomic flag, was released.
            assert!(std::os::unix::net::UnixStream::connect(&path).is_err());
        }
        let _ = std::fs::remove_file(&path);
    }

    /// End-to-end over a real Unix socket, driven exactly the way
    /// `mcp_set_enabled` drives production: bind through `bind_socket`,
    /// arm `McpState`'s own channel with `send_replace`, accept through
    /// `run_accept_loop`. This is the check that would have caught the
    /// regression where enable never actually armed the signal — a real
    /// client connects and gets a real reply, then loses the connection
    /// the instant disable fires, mid-call.
    #[cfg(unix)]
    #[tokio::test]
    async fn end_to_end_a_real_client_talks_to_the_server_then_loses_it_on_disable() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let path = temp_sock_path("e2e");
        let state = McpState::new();
        state.shutdown_tx.send_replace(true);

        let listener = bind_socket(&path).unwrap();
        let rx = state.shutdown_tx.subscribe();
        let accept_task = tokio::spawn(run_accept_loop(listener, rx, {
            let changed_tx = state.tools_changed_tx.clone();
            move |stream, conn_shutdown| {
                tokio::spawn(handle_connection_stream(
                    stream,
                    None,
                    conn_shutdown,
                    changed_tx.subscribe(),
                    "c1".to_string(),
                ));
            }
        }));

        let mut client = tokio::net::UnixStream::connect(&path).await.unwrap();
        client
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n")
            .await
            .unwrap();
        let mut buf = [0u8; 512];
        let n = client.read(&mut buf).await.unwrap();
        assert!(n > 0, "a real client got no reply from a real socket");
        let resp: Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(resp["result"]["serverInfo"]["name"], json!("voltius"));

        state.shutdown_tx.send_replace(false);
        tokio::time::timeout(Duration::from_secs(2), accept_task)
            .await
            .unwrap()
            .unwrap();

        // The connection this client already held is now dead, not just new ones.
        let mut buf2 = [0u8; 16];
        let read_after_disable =
            tokio::time::timeout(Duration::from_secs(2), client.read(&mut buf2)).await;
        match read_after_disable {
            Ok(Ok(0)) => {}  // clean EOF: server closed the connection
            Ok(Err(_)) => {} // reset: also an acceptable "connection is gone"
            other => panic!("client's pre-disable connection is still open: {other:?}"),
        }

        let _ = std::fs::remove_file(&path);
    }
}
