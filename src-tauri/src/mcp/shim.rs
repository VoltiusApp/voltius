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

#[cfg(all(test, unix))]
mod tests {
    // Regression test for a real bug this file's own integration testing
    // caught: `run_shim` used to return as soon as stdin hit EOF, killing
    // the whole process — including the still-running reader thread — and
    // silently dropping every response that hadn't arrived yet. A batch of
    // requests piped in over a closing stdin (exactly how a shell one-liner
    // or a script driving this shim behaves) would only ever get the first
    // reply. Exercised through the real compiled binary because the bug is
    // in process-exit-vs-thread-join timing, which a same-process unit test
    // of `run_shim`'s internals cannot observe.
    use std::io::{Read, Write};
    use std::os::unix::net::UnixListener;
    use std::process::{Command, Stdio};

    #[test]
    fn drains_every_response_even_when_stdin_closes_before_the_app_answers() {
        // socket_path() derives from dirs::config_dir(), which on Linux
        // honours XDG_CONFIG_HOME — point the *subprocess* at a scratch dir
        // so this doesn't touch (or race with) a real running instance.
        let xdg = tempfile::tempdir().unwrap();
        let mcp_dir = xdg.path().join("voltius").join("mcp");
        std::fs::create_dir_all(&mcp_dir).unwrap();
        let path = mcp_dir.join("mcp.sock");

        let listener = UnixListener::bind(&path).unwrap();

        let server = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            // Read all three lines the client will have written (and closed
            // its write side of) before answering any of them — mirrors the
            // app's real one-line-per-connection dispatch but batches the
            // replies to make the original race easy to hit.
            let mut collected = Vec::new();
            loop {
                let n = conn.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                collected.extend_from_slice(&buf[..n]);
                if collected.iter().filter(|&&b| b == b'\n').count() >= 3 {
                    break;
                }
            }
            for i in 1..=3 {
                conn.write_all(format!("{{\"id\":{i},\"reply\":true}}\n").as_bytes())
                    .unwrap();
            }
        });

        // No CARGO_BIN_EXE_voltius here (that's only set for tests/ integration
        // binaries, not unit tests inside the lib/bin crate itself) — the test
        // harness sits at target/debug/deps/voltius-<hash>, one directory below
        // the real `voltius` binary this test needs to spawn.
        let test_exe = std::env::current_exe().unwrap();
        let voltius_bin = test_exe.parent().unwrap().parent().unwrap().join("voltius");

        let mut child = Command::new(&voltius_bin)
            .arg("mcp")
            .env("XDG_CONFIG_HOME", xdg.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();

        {
            let mut stdin = child.stdin.take().unwrap();
            for i in 1..=3 {
                writeln!(stdin, "{{\"id\":{i}}}").unwrap();
            }
            // Dropping `stdin` here closes it immediately — this is the
            // premature-EOF condition the bug needed.
        }

        let output = child.wait_with_output().unwrap();
        server.join().unwrap();

        let stdout = String::from_utf8(output.stdout).unwrap();
        let lines: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 3, "expected all 3 replies, got: {lines:?}");
    }
}
