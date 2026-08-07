/// `voltius mcp`: a byte relay between this process's stdio and the running
/// app's socket. Deliberately dumb — it parses nothing, so the protocol lives
/// in exactly one place.
#[cfg(unix)]
pub fn run_shim() -> std::io::Result<()> {
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixStream;

    let sock = UnixStream::connect(super::transport::socket_path()).map_err(|e| {
        eprintln!("voltius: the app is not running, or its MCP server is off ({e})");
        e
    })?;
    let mut to_app = sock.try_clone()?;
    let from_app = sock;

    // App → stdout on its own thread; stdin → app on this one.
    std::thread::spawn(move || {
        let mut reader = BufReader::new(from_app);
        let mut buf = String::new();
        let stdout = std::io::stdout();
        while reader.read_line(&mut buf).unwrap_or(0) > 0 {
            let mut lock = stdout.lock();
            let _ = lock.write_all(buf.as_bytes());
            let _ = lock.flush();
            buf.clear();
        }
        // The app went away: end the shim rather than sit on a dead socket.
        std::process::exit(0);
    });

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line?;
        to_app.write_all(line.as_bytes())?;
        to_app.write_all(b"\n")?;
        to_app.flush()?;
    }
    Ok(())
}

/// Windows named-pipe support is deferred; this keeps `voltius mcp` a coherent
/// (if unusable) command on Windows instead of a build break.
#[cfg(windows)]
pub fn run_shim() -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "MCP server is not yet supported on Windows",
    ))
}
