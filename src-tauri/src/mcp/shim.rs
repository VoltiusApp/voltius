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

/// `voltius mcp` on Windows. Same two-thread relay as the unix shim, but a
/// duplex named pipe cannot half-close, so stdin EOF starts a quiet-period
/// drain instead: keep printing until the pipe has been idle for
/// DRAIN_QUIET_PERIOD, then exit.
#[cfg(windows)]
pub fn run_shim() -> std::io::Result<()> {
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::fs::OpenOptionsExt;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION;

    // Mandated by the design. Long enough to drain a burst of quick replies;
    // not long enough to wait out a slow tool call (SSH/SFTP routinely exceed
    // it) — a reply that arrives after the drain closes is lost.
    const DRAIN_QUIET_PERIOD: Duration = Duration::from_secs(2);

    // The pipe name is predictable and the named-pipe namespace is global, so
    // the server end may not be ours. SECURITY_IDENTIFICATION caps what it can
    // do with `ImpersonateNamedPipeClient` to identification level — it can ask
    // who we are, it cannot act as us. Without any QoS flag `CreateFileW`
    // defaults to impersonation level. std ORs SECURITY_SQOS_PRESENT in itself.
    //
    // Deferred: verifying the server end runs as this same user (e.g.
    // `GetNamedPipeServerProcessId` on the opened handle). Until then a
    // squatter still receives the request stream; this only protects our token.
    let pipe = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .security_qos_flags(SECURITY_IDENTIFICATION)
        .open(super::transport::socket_path())
        .map_err(|e| {
            eprintln!("voltius: the app is not running, or its MCP server is off ({e})");
            e
        })?;
    let mut to_app = pipe.try_clone()?;
    let from_app = pipe;

    let start = Instant::now();
    let last_activity = Arc::new(AtomicU64::new(0));
    let activity_writer = last_activity.clone();

    // Mirrors the unix arm's `draining` flag: distinguishes "the app closed
    // the pipe because we're past the drain and about to exit anyway" (flag
    // set, nothing to do) from "the app went away on its own while stdin was
    // still open" (flag unset, the main thread is stuck in a blocking stdin
    // read that nothing else can interrupt, so force the process to exit
    // instead of hanging forever as an orphaned child of the MCP client).
    let draining = Arc::new(AtomicBool::new(false));
    let draining_reader = draining.clone();

    std::thread::spawn(move || {
        let mut reader = BufReader::new(from_app);
        let mut buf = String::new();
        let stdout = std::io::stdout();
        while reader.read_line(&mut buf).unwrap_or(0) > 0 {
            // Recorded before the write so the quiet-period check below can
            // never see stale activity while a write is still in flight.
            activity_writer.store(start.elapsed().as_millis() as u64, Ordering::SeqCst);
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
        last_activity.store(start.elapsed().as_millis() as u64, Ordering::SeqCst);
    }

    // stdin is closed: no more requests. Wait until the pipe has been quiet
    // for DRAIN_QUIET_PERIOD, then exit. The reader thread is detached, not
    // joined: it blocks on a pipe that never reaches EOF while the app holds
    // its end, so joining it would hang forever.
    draining.store(true, Ordering::SeqCst);
    loop {
        let idle = start
            .elapsed()
            .saturating_sub(Duration::from_millis(last_activity.load(Ordering::SeqCst)));
        if idle >= DRAIN_QUIET_PERIOD {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
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
