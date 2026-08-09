/// `voltius mcp`: a byte relay between this process's stdio and the running
/// app's socket. Deliberately dumb — it parses nothing, so the protocol lives
/// in exactly one place.
#[cfg(unix)]
pub fn run_shim() -> std::io::Result<()> {
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixStream;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let sock = UnixStream::connect(super::transport::socket_path()).map_err(|e| {
        eprintln!("voltius: the app is not running, or its MCP server is off ({e})");
        e
    })?;
    let mut to_app = sock.try_clone()?;
    let from_app = sock;

    // Set right before we half-close our write side below, so the reader
    // thread can tell "the app finished answering everything and closed
    // cleanly" (this flag is set, just join) apart from "the app went away
    // on its own — disabled, crashed — while stdin was still open" (flag
    // unset, the main thread is stuck in a blocking stdin read that nothing
    // else can interrupt, so force the process to exit instead of hanging).
    let draining = Arc::new(AtomicBool::new(false));
    let draining_reader = draining.clone();

    // App → stdout on its own thread; stdin → app on this one.
    let reader_thread = std::thread::spawn(move || {
        let mut reader = BufReader::new(from_app);
        let mut buf = String::new();
        let stdout = std::io::stdout();
        while reader.read_line(&mut buf).unwrap_or(0) > 0 {
            let mut lock = stdout.lock();
            let _ = lock.write_all(buf.as_bytes());
            let _ = lock.flush();
            buf.clear();
        }
        if !draining_reader.load(Ordering::SeqCst) {
            std::process::exit(0);
        }
    });

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line?;
        to_app.write_all(line.as_bytes())?;
        to_app.write_all(b"\n")?;
        to_app.flush()?;
    }
    // stdin is closed: no more requests will be sent. Half-close our write
    // side so the app sees EOF once it has answered everything already
    // written — its per-connection loop is sequential, so this cannot cut
    // off a response that was already queued. Then wait for the reader
    // thread so every already-in-flight response gets printed before this
    // process exits, instead of racing it on stdin closing early.
    draining.store(true, Ordering::SeqCst);
    let _ = to_app.shutdown(std::net::Shutdown::Write);
    let _ = reader_thread.join();
    Ok(())
}

/// `voltius mcp` on Windows. Same relay as the unix shim, but a duplex named
/// pipe cannot half-close, so stdin EOF starts a quiet-period drain instead:
/// keep printing until the pipe has been idle for DRAIN_QUIET_PERIOD, then
/// exit.
///
/// The pipe is driven by tokio, not `std::fs`. `OpenOptions` yields a
/// *synchronous* file object, and Windows serializes I/O on one of those even
/// across duplicated handles: a blocking `ReadFile` waiting for the app's
/// reply holds the lock, and every request `WriteFile` queues behind it
/// forever. `ClientOptions` opens with FILE_FLAG_OVERLAPPED, so the two halves
/// really are independent.
#[cfg(windows)]
pub fn run_shim() -> std::io::Result<()> {
    use std::io::{BufRead, Write};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    use tokio::net::windows::named_pipe::ClientOptions;
    use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;
    use windows_sys::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION;

    // Mandated by the design. Long enough to drain a burst of quick replies;
    // not long enough to wait out a slow tool call (SSH/SFTP routinely exceed
    // it) — a reply that arrives after the drain closes is lost.
    const DRAIN_QUIET_PERIOD: Duration = Duration::from_secs(2);

    // This process relays bytes and nothing else, so one thread is plenty.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    rt.block_on(async move {
        // The pipe name is predictable and the named-pipe namespace is global,
        // so the server end may not be ours. SECURITY_IDENTIFICATION caps what
        // it can do with `ImpersonateNamedPipeClient` to identification level —
        // it can ask who we are, it cannot act as us. (It is also tokio's
        // default; set explicitly so a future edit cannot drop it silently.)
        //
        // Deferred: verifying the server end runs as this same user (e.g.
        // `GetNamedPipeServerProcessId` on the opened handle). Until then a
        // squatter still receives the request stream; this only protects our
        // token.
        let path = super::transport::socket_path();
        let mut busy_waits = 0;
        let pipe = loop {
            match ClientOptions::new()
                .security_qos_flags(SECURITY_IDENTIFICATION)
                .open(&path)
            {
                Ok(pipe) => break pipe,
                // The server creates its next instance before handing the
                // connected one to a handler, but a client can still land in
                // that window. Bounded so a permanently busy pipe still fails.
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) && busy_waits < 20 => {
                    busy_waits += 1;
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(e) => {
                    eprintln!("voltius: the app is not running, or its MCP server is off ({e})");
                    return Err(e);
                }
            }
        };
        let (from_app, mut to_app) = tokio::io::split(pipe);

        let start = Instant::now();
        let last_activity = Arc::new(AtomicU64::new(0));
        let activity_writer = last_activity.clone();

        // stdin and stdout stay on dedicated blocking threads: a stdout write
        // to a client that has stopped reading would otherwise park the whole
        // runtime, stalling pipe I/O — the same coupling this rewrite removes.
        let (stdin_tx, mut stdin_rx) = tokio::sync::mpsc::unbounded_channel();
        std::thread::spawn(move || {
            let stdin = std::io::stdin();
            for line in stdin.lock().lines() {
                if stdin_tx.send(line).is_err() {
                    break;
                }
            }
        });

        let (stdout_tx, stdout_rx) = std::sync::mpsc::channel::<String>();
        let stdout_thread = std::thread::spawn(move || {
            let stdout = std::io::stdout();
            for line in stdout_rx {
                // Recorded before the write so the quiet-period check below can
                // never see stale activity while a write is still in flight and
                // tear the process down mid-line.
                activity_writer.store(start.elapsed().as_millis() as u64, Ordering::SeqCst);
                let mut lock = stdout.lock();
                let _ = lock.write_all(line.as_bytes());
                let _ = lock.flush();
            }
        });

        // Mirrors the unix arm's `draining` flag: distinguishes "the app closed
        // the pipe because we're past the drain and about to exit anyway" (flag
        // set, nothing to do) from "the app went away on its own while stdin was
        // still open" (flag unset, nothing will ever end the stdin read, so
        // force the process to exit instead of hanging forever as an orphaned
        // child of the MCP client).
        let draining = Arc::new(AtomicBool::new(false));
        let draining_reader = draining.clone();

        tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(from_app);
            let mut buf = String::new();
            while matches!(reader.read_line(&mut buf).await, Ok(n) if n > 0) {
                if stdout_tx.send(std::mem::take(&mut buf)).is_err() {
                    break;
                }
            }
            // Hand the queue over before deciding to exit, or a reply the app
            // managed to send just before dying dies with it.
            drop(stdout_tx);
            let _ = stdout_thread.join();
            if !draining_reader.load(Ordering::SeqCst) {
                std::process::exit(0);
            }
        });

        while let Some(line) = stdin_rx.recv().await {
            let line = line?;
            to_app.write_all(line.as_bytes()).await?;
            to_app.write_all(b"\n").await?;
            to_app.flush().await?;
            last_activity.store(start.elapsed().as_millis() as u64, Ordering::SeqCst);
        }

        // stdin is closed: no more requests. Wait until the pipe has been quiet
        // for DRAIN_QUIET_PERIOD, then exit. The reader task is not awaited: it
        // blocks on a pipe that never reaches EOF while the app holds its end,
        // so awaiting it would hang forever.
        draining.store(true, Ordering::SeqCst);
        loop {
            // saturating: `impl Sub for Duration` panics on underflow in
            // release too, and the two clocks are read at different instants.
            let idle = start
                .elapsed()
                .saturating_sub(Duration::from_millis(last_activity.load(Ordering::SeqCst)));
            if idle >= DRAIN_QUIET_PERIOD {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
}

// The shim's end-to-end regression test spawns the compiled binary, so it lives
// in `src-tauri/tests/mcp_shim.rs` — see the comment there.
