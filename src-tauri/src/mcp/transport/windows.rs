use crate::mcp::McpState;
use std::sync::Arc;
use std::time::Duration;

/// One pipe server instance. `first` sets FILE_FLAG_FIRST_PIPE_INSTANCE, which
/// makes a squatted pipe name fail loudly here instead of silently handing the
/// name to another process. It must be set on the first instance only —
/// later instances of the same name fail if it is set.
#[cfg(windows)]
fn create_instance(
    addr: &std::ffi::OsStr,
    first: bool,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use tokio::net::windows::named_pipe::ServerOptions;

    // The SID comes from our own process token, never from user input:
    // `owner_only_sddl` interpolates it without escaping.
    let sddl = super::shared::owner_only_sddl(&crate::win_security::current_user_sid()?);
    let sd = crate::win_security::SecurityDescriptor::from_sddl(&sddl)?;
    let mut sa = sd.attributes();
    unsafe {
        ServerOptions::new()
            .first_pipe_instance(first)
            .create_with_security_attributes_raw(addr, (&mut sa) as *mut _ as *mut std::ffi::c_void)
    }
}

/// FILE_FLAG_FIRST_PIPE_INSTANCE fails while *any* instance of the name still
/// exists, so a disable/enable cycle can lose the race against connection tasks
/// that have not yet dropped their handles. Retry briefly rather than weaken the
/// flag: a genuine squatter still makes this fail, just half a second later.
#[cfg(windows)]
async fn create_first_instance(
    addr: &std::ffi::OsStr,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    let mut last = match create_instance(addr, true) {
        Ok(s) => return Ok(s),
        Err(e) => e,
    };
    for _ in 0..5 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        match create_instance(addr, true) {
            Ok(s) => return Ok(s),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// A failed `serve` only flips `enabled`; it does not signal shutdown. Every
/// handler task already spawned would keep full `tools/call` access to the
/// user's hosts while the toggle reads off, so an error return has to disarm
/// them here — `commands/mcp.rs` does not.
///
/// `ready` reports whether the first pipe instance came up, so the caller can
/// fail the enable instead of leaving the toggle on with no pipe. It fires
/// once; every later failure is reported by the returned error.
#[cfg(windows)]
pub async fn serve(
    app: tauri::AppHandle,
    state: Arc<McpState>,
    ready: tokio::sync::oneshot::Sender<Result<(), String>>,
) -> std::io::Result<()> {
    let res = run_pipe_server(app, &state, ready).await;
    if res.is_err() {
        state.shutdown_tx.send_replace(false);
    }
    res
}

#[cfg(windows)]
async fn run_pipe_server(
    app: tauri::AppHandle,
    state: &Arc<McpState>,
    ready: tokio::sync::oneshot::Sender<Result<(), String>>,
) -> std::io::Result<()> {
    let addr = super::socket_path().into_os_string();
    let mut shutdown = state.shutdown_tx.subscribe();
    let mut server = match create_first_instance(&addr).await {
        Ok(s) => {
            let _ = ready.send(Ok(()));
            s
        }
        Err(e) => {
            let _ = ready.send(Err(e.to_string()));
            return Err(e);
        }
    };

    loop {
        // The connect future borrows `server`, so it must be fully out of scope
        // before the instance below is swapped out.
        let accepted = tokio::select! {
            biased;
            changed = shutdown.changed() => {
                if changed.is_err() || !*shutdown.borrow() { return Ok(()); }
                continue;
            }
            res = server.connect() => res,
        };
        if let Err(e) = accepted {
            // Nothing supervises `serve()`, so bailing on a transient accept
            // failure would permanently disable MCP for this app run.
            eprintln!("voltius mcp: pipe connect error, retrying: {e}");
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        }
        // Next instance BEFORE spawning the handler: the connect above consumed
        // this one, and until the next exists the pipe name does not, so a
        // client landing in that window gets ERROR_FILE_NOT_FOUND. Failing to
        // create it is fatal — continuing would leave no pipe at all.
        let next = create_instance(&addr, false).inspect_err(|e| {
            eprintln!("voltius mcp: cannot create next pipe instance: {e}");
        })?;
        let connected = std::mem::replace(&mut server, next);

        // Re-check rather than trust the branch was chosen for the "still
        // running" reason: connect() can win the select race against a
        // shutdown that landed in the same instant.
        if !*shutdown.borrow() {
            return Ok(());
        }
        let app_state = Some((app.clone(), state.clone()));
        let conn_shutdown = state.shutdown_tx.subscribe();
        let changed = state.tools_changed_tx.subscribe();
        let client_id = uuid::Uuid::new_v4().to_string();
        tauri::async_runtime::spawn(super::shared::handle_connection_stream(
            connected,
            app_state,
            conn_shutdown,
            changed,
            client_id,
        ));
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use crate::policy::acl::sddl;
    use crate::win_security::{current_user_sid, sddl_of};
    use std::collections::BTreeSet;
    use std::ffi::OsString;
    use std::os::windows::io::AsRawHandle;
    use tokio::net::windows::named_pipe::ClientOptions;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Security::Authorization::SE_KERNEL_OBJECT;

    fn unique_addr() -> OsString {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!(r"\\.\pipe\voltius-mcp-test-{}-{nanos}", std::process::id()).into()
    }

    #[tokio::test]
    async fn pipe_grants_only_system_and_the_current_user() {
        let server = create_first_instance(&unique_addr()).await.unwrap();
        let text = sddl_of(server.as_raw_handle() as HANDLE, SE_KERNEL_OBJECT).unwrap();
        let alias = |sid: String| if sid == "S-1-5-18" { "SY".into() } else { sid };
        let sids: BTreeSet<String> = sddl::aces(&text)
            .into_iter()
            .map(|a| alias(a.sid))
            .collect();
        let want: BTreeSet<String> = ["SY".to_string(), alias(current_user_sid().unwrap())].into();
        assert_eq!(sids, want, "{text}");
    }

    #[tokio::test]
    async fn a_client_connects_to_the_first_instance() {
        let addr = unique_addr();
        let server = create_first_instance(&addr).await.unwrap();
        let accept = tokio::spawn(async move { server.connect().await });
        ClientOptions::new().open(&addr).unwrap();
        tokio::time::timeout(Duration::from_secs(5), accept)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn a_second_first_instance_is_refused() {
        let addr = unique_addr();
        let _server = create_first_instance(&addr).await.unwrap();
        assert!(create_instance(&addr, true).is_err());
    }
}
