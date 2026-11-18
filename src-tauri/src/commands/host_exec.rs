use crate::ssh::exec::{drain_pipes, open_exec, Pipe};
use crate::ssh::session::SessionManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;

// sshd's MaxSessions (default 10) is shared with the terminal, SFTP, metrics and processes.
const PER_SESSION: usize = 4;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_MAX_BYTES: usize = 1024 * 1024;
const MAX_BYTES_CEILING: usize = 64 * 1024 * 1024;
// A host that flushes per line would otherwise cost one webview event per line.
const BATCH_WINDOW: Duration = Duration::from_millis(30);
const BATCH_BYTES: usize = 256 * 1024;
const EARLY_CANCEL_TTL: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct HostExecs {
    running: Mutex<HashMap<String, CancellationToken>>,
    early_cancels: Mutex<HashMap<String, Instant>>,
    slots: Mutex<HashMap<String, Arc<Semaphore>>>,
}

impl HostExecs {
    fn register(&self, id: &str) -> Result<Registration<'_>, String> {
        let mut running = self.running.lock().unwrap();
        if running.contains_key(id) {
            return Err(format!("exec id \"{id}\" is already running"));
        }
        let token = CancellationToken::new();
        if self.early_cancels.lock().unwrap().remove(id).is_some() {
            token.cancel();
        }
        running.insert(id.to_string(), token.clone());
        Ok(Registration {
            execs: self,
            id: id.to_string(),
            token,
        })
    }

    fn slot(&self, session_id: &str) -> Arc<Semaphore> {
        self.slots
            .lock()
            .unwrap()
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(PER_SESSION)))
            .clone()
    }

    /// A cancel that beats its exec's registration is remembered for a minute.
    fn cancel(&self, id: &str) {
        if let Some(token) = self.running.lock().unwrap().get(id) {
            return token.cancel();
        }
        let mut early = self.early_cancels.lock().unwrap();
        early.retain(|_, at| at.elapsed() < EARLY_CANCEL_TTL);
        early.insert(id.to_string(), Instant::now());
    }
}

struct Registration<'a> {
    execs: &'a HostExecs,
    id: String,
    token: CancellationToken,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.execs.running.lock().unwrap().remove(&self.id);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostExecRequest {
    exec_id: String,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    command: String,
    stdin: Option<String>,
    timeout_ms: Option<u64>,
    max_bytes: Option<usize>,
    #[serde(default)]
    stream: bool,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostExecResult {
    stdout: String,
    stderr: String,
    code: Option<i32>,
    timed_out: bool,
    truncated: bool,
    cancelled: bool,
}

#[derive(Serialize, Clone)]
struct Chunk<'a> {
    stream: Pipe,
    data: &'a str,
}

pub fn exec_event(exec_id: &str) -> String {
    format!("host-exec:{exec_id}")
}

enum Sink {
    Collect { out: [Vec<u8>; 2], cap: usize },
    Emit(mpsc::UnboundedSender<(Pipe, Vec<u8>)>),
}

type Lines = mpsc::UnboundedReceiver<(Pipe, Vec<u8>)>;

/// Hands `emit` everything that arrives within a short window as one chunk per pipe.
async fn forward(mut rx: Lines, mut emit: impl FnMut(Pipe, &[u8])) {
    while let Some((pipe, data)) = rx.recv().await {
        let mut batch: [Vec<u8>; 2] = Default::default();
        batch[pipe as usize] = data;
        let deadline = tokio::time::Instant::now() + BATCH_WINDOW;
        while batch[0].len() + batch[1].len() < BATCH_BYTES {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some((pipe, data))) => batch[pipe as usize].extend_from_slice(&data),
                _ => break,
            }
        }
        for pipe in [Pipe::Stdout, Pipe::Stderr] {
            if !batch[pipe as usize].is_empty() {
                emit(pipe, &batch[pipe as usize]);
            }
        }
    }
}

/// Where a running command's output goes: collected up to a cap, or forwarded in whole lines.
struct Output {
    sink: Sink,
    pending: [Vec<u8>; 2],
    truncated: bool,
    stop: CancellationToken,
}

impl Output {
    fn collect(cap: usize, stop: CancellationToken) -> Self {
        Self::new(
            Sink::Collect {
                out: Default::default(),
                cap,
            },
            stop,
        )
    }

    fn emit(stop: CancellationToken) -> (Self, Lines) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Self::new(Sink::Emit(tx), stop), rx)
    }

    fn new(sink: Sink, stop: CancellationToken) -> Self {
        Self {
            sink,
            pending: Default::default(),
            truncated: false,
            stop,
        }
    }

    fn push(&mut self, pipe: Pipe, data: &[u8]) {
        let i = pipe as usize;
        match &mut self.sink {
            Sink::Collect { out, cap } => {
                let room = cap.saturating_sub(out[i].len());
                out[i].extend_from_slice(&data[..data.len().min(room)]);
                if data.len() > room {
                    self.truncated = true;
                    self.stop.cancel();
                }
            }
            // A newline never sits inside a UTF-8 sequence, so whole lines always decode cleanly.
            Sink::Emit(tx) => {
                let pending = &mut self.pending[i];
                pending.extend_from_slice(data);
                if let Some(end) = pending.iter().rposition(|&b| b == b'\n') {
                    let _ = tx.send((pipe, pending.drain(..=end).collect()));
                }
            }
        }
    }

    fn finish(mut self) -> (String, String, bool) {
        let text = |b: &[u8]| String::from_utf8_lossy(b).into_owned();
        match &mut self.sink {
            Sink::Collect { out, .. } => (text(&out[0]), text(&out[1]), self.truncated),
            Sink::Emit(tx) => {
                for pipe in [Pipe::Stdout, Pipe::Stderr] {
                    let rest = std::mem::take(&mut self.pending[pipe as usize]);
                    if !rest.is_empty() {
                        let _ = tx.send((pipe, rest));
                    }
                }
                (String::new(), String::new(), false)
            }
        }
    }
}

#[tauri::command]
pub async fn host_exec(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    execs: State<'_, HostExecs>,
    request: HostExecRequest,
) -> Result<HostExecResult, String> {
    let registration = execs.register(&request.exec_id)?;
    let token = registration.token.clone();
    let slot = execs.slot(&request.session_id);
    let _permit = tokio::select! {
        p = slot.acquire_owned() => p.map_err(|e| e.to_string())?,
        _ = token.cancelled() => return Ok(HostExecResult { cancelled: true, ..Default::default() }),
    };

    let target = if request.is_remote {
        let machine = sessions.get_machine(&request.session_id).await?;
        Target::Remote(machine.handle.clone(), machine.wrap(&request.command))
    } else {
        Target::Local(request.local_shell.clone(), request.command.clone())
    };

    let limit = match (request.timeout_ms, request.stream) {
        (Some(0), _) | (None, true) => None,
        (Some(ms), _) => Some(Duration::from_millis(ms)),
        (None, false) => Some(DEFAULT_TIMEOUT),
    };
    if !request.stream {
        let cap = request
            .max_bytes
            .unwrap_or(DEFAULT_MAX_BYTES)
            .min(MAX_BYTES_CEILING);
        let output = Output::collect(cap, token.clone());
        return run(target, request.stdin.as_deref(), output, token, limit).await;
    }
    let (output, lines) = Output::emit(token.clone());
    let event = exec_event(&request.exec_id);
    let forwarder = tokio::spawn(forward(lines, move |pipe, data| {
        let data = String::from_utf8_lossy(data);
        let _ = app.emit(
            &event,
            Chunk {
                stream: pipe,
                data: &data,
            },
        );
    }));
    let result = run(target, request.stdin.as_deref(), output, token, limit).await;
    // Every line must reach the webview before the caller's `done` settles.
    let _ = forwarder.await;
    result
}

#[tauri::command]
pub fn host_exec_cancel(execs: State<'_, HostExecs>, exec_id: String) {
    execs.cancel(&exec_id);
}

enum Target<H: russh::client::Handler> {
    Remote(Arc<russh::client::Handle<H>>, String),
    Local(Option<String>, String),
}

async fn run<H: russh::client::Handler>(
    target: Target<H>,
    stdin: Option<&str>,
    mut output: Output,
    token: CancellationToken,
    limit: Option<Duration>,
) -> Result<HostExecResult, String> {
    let timed_out = Arc::new(AtomicBool::new(false));
    let timer = limit.map(|limit| {
        let (token, timed_out) = (token.clone(), timed_out.clone());
        tokio::spawn(async move {
            tokio::time::sleep(limit).await;
            timed_out.store(true, Ordering::SeqCst);
            token.cancel();
        })
    });
    // Boxed: Tauri builds a command's future on the main thread, whose stack is 1 MiB on Windows.
    let ran = match target {
        Target::Remote(handle, wrapped) => {
            Box::pin(run_remote(&handle, &wrapped, stdin, &mut output, &token)).await
        }
        Target::Local(shell, command) => {
            Box::pin(run_local(
                shell.as_deref(),
                &command,
                stdin,
                &mut output,
                &token,
            ))
            .await
        }
    };
    if let Some(timer) = timer {
        timer.abort();
    }
    let (stdout, stderr, truncated) = output.finish();
    let (code, stopped) = match ran {
        Ok(code) => (code, false),
        Err(_) if token.is_cancelled() => (None, true),
        Err(e) => return Err(e),
    };
    let timed_out = stopped && timed_out.load(Ordering::SeqCst);
    Ok(HostExecResult {
        stdout,
        stderr,
        code,
        timed_out,
        truncated,
        cancelled: stopped && !timed_out && !truncated,
    })
}

async fn run_remote<H: russh::client::Handler>(
    handle: &russh::client::Handle<H>,
    command: &str,
    stdin: Option<&str>,
    output: &mut Output,
    token: &CancellationToken,
) -> Result<Option<i32>, String> {
    let mut channel = open_exec(handle, command).await?;
    if let Some(input) = stdin {
        channel
            .data(input.as_bytes())
            .await
            .map_err(|e| format!("Write error: {e}"))?;
    }
    let _ = channel.eof().await;
    let drained = drain_pipes(
        &mut channel,
        &mut tokio::io::sink(),
        &mut |pipe, data| output.push(pipe, data),
        Some(token),
    )
    .await;
    if drained.is_err() {
        let _ = channel.signal(russh::Sig::TERM).await;
    }
    let _ = channel.close().await;
    drained
}

async fn run_local(
    shell: Option<&str>,
    command: &str,
    stdin: Option<&str>,
    output: &mut Output,
    token: &CancellationToken,
) -> Result<Option<i32>, String> {
    let mut cmd = local_command(shell, command);
    cmd.stdin(if stdin.is_some() {
        std::process::Stdio::piped()
    } else {
        std::process::Stdio::null()
    })
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .kill_on_drop(true);
    crate::commands::win_proc::prevent_visible_child_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start command: {e}"))?;
    if let (Some(mut pipe), Some(input)) = (child.stdin.take(), stdin) {
        let input = input.to_owned();
        tokio::spawn(async move {
            let _ = pipe.write_all(input.as_bytes()).await;
        });
    }
    let mut readers: [Reader; 2] = [
        child.stdout.take().map(|r| Box::new(r) as _),
        child.stderr.take().map(|r| Box::new(r) as _),
    ];
    let finished = async {
        let mut bufs = [[0u8; 16384]; 2];
        while readers.iter().any(Option::is_some) {
            let [out, err] = &mut readers;
            let [out_buf, err_buf] = &mut bufs;
            let (pipe, read) = tokio::select! {
                r = read_open(out, out_buf) => (Pipe::Stdout, r),
                r = read_open(err, err_buf) => (Pipe::Stderr, r),
            };
            match read {
                Ok(n) if n > 0 => output.push(pipe, &bufs[pipe as usize][..n]),
                _ => readers[pipe as usize] = None,
            }
        }
        child.wait().await.map_err(|e| e.to_string())
    };
    // Returning drops the child, and kill_on_drop stops it.
    tokio::select! {
        status = finished => Ok(status?.code()),
        _ = token.cancelled() => Err(crate::sftp::TRANSFER_CANCELLED.into()),
    }
}

type Reader = Option<Box<dyn AsyncRead + Unpin + Send>>;

async fn read_open(reader: &mut Reader, buf: &mut [u8]) -> std::io::Result<usize> {
    match reader {
        Some(r) => r.read(buf).await,
        None => std::future::pending().await,
    }
}

#[cfg(unix)]
fn local_command(_shell: Option<&str>, command: &str) -> tokio::process::Command {
    #[cfg(target_os = "linux")]
    if crate::local::flatpak::spawns_on_host() {
        let mut cmd = tokio::process::Command::new("flatpak-spawn");
        // --watch-bus: killing the spawner must also stop the command on the host.
        cmd.args(["--host", "--watch-bus", "sh", "-c", command]);
        return cmd;
    }
    let mut cmd = tokio::process::Command::new("sh");
    cmd.args(["-c", command]);
    cmd
}

#[cfg(windows)]
fn local_command(shell: Option<&str>, command: &str) -> tokio::process::Command {
    let program = shell.unwrap_or("cmd.exe");
    let name = program
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(program)
        .to_ascii_lowercase();
    let mut cmd = tokio::process::Command::new(program);
    match name.trim_end_matches(".exe") {
        "wsl" => cmd.args(["-e", "sh", "-c", command]),
        "powershell" | "pwsh" => cmd.args(["-NoProfile", "-NonInteractive", "-Command", command]),
        "cmd" => cmd
            .args(["/D", "/S", "/C"])
            .raw_arg(format!("\"{command}\"")),
        _ => cmd.args(["-c", command]),
    };
    cmd
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::port_forward::test_ssh::TestClient;
    use crate::ssh::test_proc_server::{proc_server, ProcOptions};

    fn local(command: &str) -> Target<TestClient> {
        Target::Local(None, command.into())
    }

    async fn exec(
        target: Target<TestClient>,
        cap: usize,
        limit: Option<Duration>,
    ) -> HostExecResult {
        let token = CancellationToken::new();
        let output = Output::collect(cap, token.clone());
        run(target, None, output, token, limit).await.unwrap()
    }

    // Tauri builds a command's future on the main thread, whose stack is 1 MiB on Windows.
    #[tokio::test]
    async fn an_exec_future_is_small_enough_to_build_on_the_main_thread() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let token = CancellationToken::new();
        let output = || Output::collect(1, token.clone());
        let remote = run(
            Target::Remote(handle, "true".into()),
            None,
            output(),
            token.clone(),
            None,
        );
        let local = run(local("true"), None, output(), token.clone(), None);
        let sizes = (size_of_val(&remote), size_of_val(&local));
        assert!(
            sizes.0 < 4096 && sizes.1 < 4096,
            "run futures take {sizes:?} bytes"
        );
    }

    #[tokio::test]
    async fn local_exec_reports_stdout_stderr_and_status() {
        let r = exec(local("echo out; echo err >&2; exit 3"), 1024, None).await;
        assert_eq!(r.stdout, "out\n");
        assert_eq!(r.stderr, "err\n");
        assert_eq!(r.code, Some(3));
        assert!(!r.timed_out && !r.truncated && !r.cancelled);
    }

    #[tokio::test]
    async fn output_past_the_cap_stops_the_command_and_says_so() {
        let r = exec(local("yes"), 100, None).await;
        assert_eq!(r.stdout.len(), 100);
        assert!(r.truncated && !r.cancelled);
        assert_eq!(r.code, None);
    }

    #[tokio::test]
    async fn a_command_past_its_limit_is_stopped_as_timed_out() {
        let r = exec(
            local("echo early; sleep 30"),
            1024,
            Some(Duration::from_millis(300)),
        )
        .await;
        assert_eq!(r.stdout, "early\n");
        assert!(r.timed_out && !r.cancelled);
    }

    #[tokio::test]
    async fn stdin_reaches_the_command() {
        let token = CancellationToken::new();
        let output = Output::collect(1024, token.clone());
        let r = run(local("tr a-z A-Z"), Some("hi"), output, token, None)
            .await
            .unwrap();
        assert_eq!(r.stdout, "HI");
    }

    fn drain(mut rx: Lines) -> Vec<(Pipe, String)> {
        let mut seen = Vec::new();
        while let Ok((pipe, data)) = rx.try_recv() {
            seen.push((pipe, String::from_utf8_lossy(&data).into_owned()));
        }
        seen
    }

    #[test]
    fn emitted_output_is_whole_lines_until_the_end() {
        let (mut out, rx) = Output::emit(CancellationToken::new());
        out.push(Pipe::Stdout, b"a\nb");
        out.push(Pipe::Stdout, "\u{e9}\nc".as_bytes());
        out.push(Pipe::Stderr, b"x");
        out.finish();
        assert_eq!(
            drain(rx),
            vec![
                (Pipe::Stdout, "a\n".to_string()),
                (Pipe::Stdout, "b\u{e9}\n".to_string()),
                (Pipe::Stdout, "c".to_string()),
                (Pipe::Stderr, "x".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn lines_arriving_together_reach_the_webview_as_one_chunk_per_pipe() {
        let (tx, rx) = mpsc::unbounded_channel();
        for i in 0..500 {
            tx.send((Pipe::Stdout, format!("{i}\n").into_bytes()))
                .unwrap();
        }
        tx.send((Pipe::Stderr, b"e\n".to_vec())).unwrap();
        drop(tx);
        let mut emitted = Vec::new();
        forward(rx, |pipe, data| emitted.push((pipe, data.len()))).await;
        let total: usize = (0..500).map(|i: usize| i.to_string().len() + 1).sum();
        assert_eq!(emitted, vec![(Pipe::Stdout, total), (Pipe::Stderr, 2)]);
    }

    #[tokio::test]
    async fn remote_exec_runs_over_ssh_with_status_and_stderr() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let cmd = "echo out; echo err >&2; exit 2".to_string();
        let r = exec(Target::Remote(handle, cmd), 1024, None).await;
        assert_eq!(
            (r.stdout.as_str(), r.stderr.as_str(), r.code),
            ("out\n", "err\n", Some(2))
        );
    }

    #[tokio::test]
    async fn remote_exec_past_its_limit_is_stopped() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let r = exec(
            Target::Remote(handle, "sleep 30".into()),
            1024,
            Some(Duration::from_millis(300)),
        )
        .await;
        assert!(r.timed_out);
    }

    #[test]
    fn a_running_id_cannot_be_reused_and_is_freed_when_done() {
        let execs = HostExecs::default();
        let first = execs.register("a").unwrap();
        assert!(execs.register("a").is_err());
        drop(first);
        assert!(!execs.register("a").unwrap().token.is_cancelled());
    }

    #[test]
    fn a_cancel_that_beats_its_exec_still_cancels_it() {
        let execs = HostExecs::default();
        execs.cancel("a");
        let late = execs.register("a").unwrap();
        assert!(late.token.is_cancelled());
        drop(late);
        assert!(execs.running.lock().unwrap().is_empty());
        assert!(execs.early_cancels.lock().unwrap().is_empty());
    }

    #[test]
    fn a_cancel_for_a_finished_exec_does_not_outlive_its_ttl() {
        let execs = HostExecs::default();
        execs.cancel("gone");
        let stale = Instant::now() - EARLY_CANCEL_TTL - Duration::from_secs(1);
        execs
            .early_cancels
            .lock()
            .unwrap()
            .insert("gone".into(), stale);
        execs.cancel("other");
        assert_eq!(execs.early_cancels.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_command_that_ends_on_its_own_is_never_reported_stopped() {
        let r = exec(local("exit 0"), 1024, Some(Duration::from_secs(30))).await;
        assert_eq!(r.code, Some(0));
        assert!(!r.timed_out && !r.cancelled && !r.truncated);
    }
}
