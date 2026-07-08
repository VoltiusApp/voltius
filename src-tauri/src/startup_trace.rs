//! DIAGNOSTIC: a flushed, force-quit-surviving startup milestone trace.
//!
//! The reported startup freeze leaves the normal log empty (the app is killed
//! mid-hang before anything flushes). This writes each milestone to a plain file
//! in the OS temp dir — a known-fast path, deliberately NOT the app config dir,
//! which is itself a suspect for the hang — flushing after every line. Whatever
//! the last line on disk is names exactly where startup got stuck.
//!
//! File: `%TEMP%\voltius-startup-trace.log` (Windows) / `$TMPDIR/...` elsewhere.

use std::io::Write;

pub fn trace_path() -> std::path::PathBuf {
    std::env::temp_dir().join("voltius-startup-trace.log")
}

/// Read the whole trace file (for bundling into the bug report).
pub fn read_all() -> std::io::Result<Vec<u8>> {
    std::fs::read(trace_path())
}

/// Append one flushed milestone line.
pub fn trace(msg: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(trace_path())
    {
        let _ = writeln!(
            f,
            "[{}] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            msg
        );
        let _ = f.flush();
    }
}

/// Time a startup step: writes `<name> START` before and `<name> END <ms>ms`
/// after. If the step hangs, only the START line reaches disk — naming the
/// culprit even when the app is force-quit mid-hang.
pub fn step<T>(name: &str, f: impl FnOnce() -> T) -> T {
    trace(&format!("{name} START"));
    let t0 = std::time::Instant::now();
    let r = f();
    trace(&format!("{name} END {}ms", t0.elapsed().as_millis()));
    r
}
