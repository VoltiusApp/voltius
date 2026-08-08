use crate::mcp::McpState;
use std::sync::Arc;
use std::time::Duration;

/// The process token's user SID in string form (`S-1-5-21-…`), for the pipe's DACL.
#[cfg(windows)]
fn current_user_sid() -> std::io::Result<String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token: HANDLE = ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(std::io::Error::last_os_error());
        }
        // Two calls, deliberately: the first learns the size. A single call
        // with a guessed size returns ERROR_INSUFFICIENT_BUFFER and no SID.
        let mut len = 0u32;
        GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut len);
        let mut buf = vec![0u8; len as usize];
        let ok = GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), len, &mut len) != 0;
        let err = std::io::Error::last_os_error();
        CloseHandle(token);
        if !ok {
            return Err(err);
        }

        let user: *const TOKEN_USER = buf.as_ptr().cast();
        let mut raw: *mut u16 = ptr::null_mut();
        if ConvertSidToStringSidW((*user).User.Sid, &mut raw) == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let mut n = 0usize;
        while *raw.add(n) != 0 {
            n += 1;
        }
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(raw, n));
        LocalFree(raw.cast());
        Ok(sid)
    }
}

/// One pipe server instance. `first` sets FILE_FLAG_FIRST_PIPE_INSTANCE, which
/// makes a squatted pipe name fail loudly here instead of silently handing the
/// name to another process. It must be set on the first instance only —
/// later instances of the same name fail if it is set.
#[cfg(windows)]
fn create_instance(
    addr: &std::ffi::OsStr,
    first: bool,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use tokio::net::windows::named_pipe::ServerOptions;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

    // The SID comes from our own process token, never from user input:
    // `owner_only_sddl` interpolates it without escaping.
    let sddl = super::shared::owner_only_sddl(&current_user_sid()?);
    let wide: Vec<u16> = std::ffi::OsStr::new(&sddl)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut psd: PSECURITY_DESCRIPTOR = ptr::null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide.as_ptr(),
            SDDL_REVISION_1,
            &mut psd,
            ptr::null_mut(),
        ) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        let mut sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: psd,
            bInheritHandle: 0,
        };
        let res = ServerOptions::new()
            .first_pipe_instance(first)
            .create_with_security_attributes_raw(addr, (&mut sa) as *mut _ as *mut std::ffi::c_void);
        // Freed on both paths: the descriptor is copied into the pipe's kernel
        // object by create, so holding it past this point leaks.
        LocalFree(psd.cast());
        res
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

#[cfg(windows)]
pub async fn serve(app: tauri::AppHandle, state: Arc<McpState>) -> std::io::Result<()> {
    let addr = super::socket_path().into_os_string();
    let mut shutdown = state.shutdown_tx.subscribe();
    let mut server = create_first_instance(&addr).await?;

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
        tauri::async_runtime::spawn(super::shared::handle_connection_stream(
            connected,
            app_state,
            conn_shutdown,
        ));
    }
}
