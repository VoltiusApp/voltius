// Regression test for a real bug `src/mcp/shim.rs`'s own integration testing
// caught: `run_shim` used to return as soon as stdin hit EOF, killing the whole
// process — including the still-running reader thread — and silently dropping
// every response that hadn't arrived yet. A batch of requests piped in over a
// closing stdin (exactly how a shell one-liner or a script driving this shim
// behaves) would only ever get the first reply. Exercised through the real
// compiled binary because the bug is in process-exit-vs-thread-join timing,
// which a same-process unit test of `run_shim`'s internals cannot observe.
//
// It lives in tests/ rather than beside the code because only an integration
// test gets `CARGO_BIN_EXE_voltius`, and only an integration test makes cargo
// build the binary it spawns. As a unit test inside the bin crate it passed
// solely when some earlier command had happened to build `voltius`, and failed
// with NotFound in CI, where nothing had.
#![cfg(unix)]

use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::process::{Command, Stdio};

#[test]
fn drains_every_response_even_when_stdin_closes_before_the_app_answers() {
    // socket_path() derives from dirs::config_dir(), which on Linux honours
    // XDG_CONFIG_HOME — point the *subprocess* at a scratch dir so this doesn't
    // touch (or race with) a real running instance.
    let xdg = tempfile::tempdir().unwrap();
    let mcp_dir = xdg.path().join("voltius").join("mcp");
    std::fs::create_dir_all(&mcp_dir).unwrap();
    let path = mcp_dir.join("mcp.sock");

    let listener = UnixListener::bind(&path).unwrap();

    let server = std::thread::spawn(move || {
        let (mut conn, _) = listener.accept().unwrap();
        let mut buf = [0u8; 4096];
        // Read all three lines the client will have written (and closed its
        // write side of) before answering any of them — mirrors the app's real
        // one-line-per-connection dispatch but batches the replies to make the
        // original race easy to hit.
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

    let mut child = Command::new(env!("CARGO_BIN_EXE_voltius"))
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
