pub mod backend;
pub mod docker_fs;
pub mod real;

pub use backend::FileBackend;

use crate::commands::sftp::RemoteShell;
use crate::known_hosts::KnownHostsStore;
use crate::proxy::ProxySpec;
use crate::ssh::client::{
    authenticate_handle, client_config, connect_first_hop_retrying, hop_detail, JumpHostConnect,
    SshClient,
};
use crate::ssh::live_cells::{own_cell, read_cell};
use crate::ssh::session::SessionHandle;
use docker_fs::DockerFs;
use real::{RealSftp, SftpOpener};
use russh::client::{Handle, Msg};
use russh::Channel;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::sync::{Mutex, OnceCell};
use tokio::time::Duration;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SftpStep {
    TcpConnected,
    Handshake,
    Authenticating,
    SftpSubsystem,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpStepEvent {
    pub step: SftpStep,
    pub detail: String,
}

fn emit_step(app: &AppHandle, connect_id: &str, step: SftpStep, detail: impl Into<String>) {
    let _ = app.emit(
        &format!("sftp-step-{}", connect_id),
        SftpStepEvent {
            step,
            detail: detail.into(),
        },
    );
}

struct SftpEntry {
    backend: Arc<dyn FileBackend>,
    /// Live SSH handle for the session's host. Present for SSH-based transports
    /// (real SFTP, docker exec); None for transports that don't ride SSH.
    /// Used by `exec_command` and the keepalive monitor. It is a cell, not a
    /// snapshot, so an SFTP session riding a terminal follows that terminal
    /// across a reconnect instead of staying pinned to the dead handle.
    handle: Option<SessionHandle>,
    cancel: CancellationToken,
    _jump_handles: Vec<Arc<Handle<SshClient>>>,
    tar_shell: Arc<OnceCell<Option<RemoteShell>>>,
}

pub struct SftpManager {
    sessions: Arc<Mutex<HashMap<String, SftpEntry>>>,
    /// Active transfer cancellation tokens, keyed by transfer_id
    transfers: Arc<Mutex<HashMap<String, CancellationToken>>>,
    /// Per-(sftp_id, path) write serialization locks.
    write_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            transfers: Arc::new(Mutex::new(HashMap::new())),
            write_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a backend under a fresh id and return that id.
    async fn register(
        &self,
        backend: Arc<dyn FileBackend>,
        handle: Option<SessionHandle>,
        cancel: CancellationToken,
        jump_handles: Vec<Arc<Handle<SshClient>>>,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            id.clone(),
            SftpEntry {
                backend,
                handle,
                cancel,
                _jump_handles: jump_handles,
                tar_shell: Arc::default(),
            },
        );
        id
    }

    /// Register a real SFTP backend riding `handle`, opened via `opener`.
    async fn register_real(
        &self,
        handle: SessionHandle,
        opener: SftpOpener,
    ) -> Result<String, String> {
        let backend = RealSftp::open(Arc::clone(&handle), opener).await?;
        Ok(self
            .register(
                Arc::new(backend),
                Some(handle),
                CancellationToken::new(),
                vec![],
            )
            .await)
    }

    /// Open SFTP by exec-ing an sftp-server command on the remote host (e.g. `docker exec -i <id> sftp-server`).
    pub async fn open_exec(&self, handle: SessionHandle, cmd: &str) -> Result<String, String> {
        self.register_real(handle, SftpOpener::Exec(cmd.to_string()))
            .await
    }

    pub async fn open(&self, handle: SessionHandle) -> Result<String, String> {
        self.register_real(handle, SftpOpener::Subsystem).await
    }

    /// Register a `docker exec`-based filesystem backend for a container that has
    /// no sftp-server binary. `handle` is the host SSH connection.
    pub async fn open_docker(
        &self,
        handle: SessionHandle,
        container_id: String,
    ) -> Result<String, String> {
        let fs = DockerFs::new(Arc::clone(&handle), container_id);
        Ok(self
            .register(Arc::new(fs), Some(handle), CancellationToken::new(), vec![])
            .await)
    }

    /// Open a standalone FTP / explicit-FTPS connection. No SSH handle, so
    /// exec/tar fast paths are unavailable (transfers fall back to per-file).
    pub async fn connect_ftp(
        &self,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        secure: bool,
    ) -> Result<String, String> {
        let backend = crate::ftp::connect(host, port, username, password, secure).await?;
        Ok(self
            .register(Arc::new(backend), None, CancellationToken::new(), vec![])
            .await)
    }

    pub async fn connect(
        &self,
        app: &AppHandle,
        connect_id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        passphrase: Option<&str>,
        jump_hosts: Vec<JumpHostConnect>,
        known_hosts: Arc<KnownHostsStore>,
        keepalive_interval_secs: u64,
        keepalive_max: usize,
        legacy_algorithms: bool,
        proxy: Option<ProxySpec>,
    ) -> Result<String, String> {
        let config = Arc::new(client_config(
            keepalive_interval_secs,
            keepalive_max,
            legacy_algorithms,
        ));

        let mut jump_handles: Vec<Arc<Handle<SshClient>>> = Vec::new();

        let mut final_handle: Handle<SshClient> = if jump_hosts.is_empty() {
            let (h, via, ()) = connect_first_hop_retrying(
                &config,
                proxy.as_ref(),
                host,
                port,
                1,
                || {
                    let (c, reason) =
                        SshClient::new(host.to_string(), port, Arc::clone(&known_hosts));
                    (c, reason, ())
                },
                |e| format!("SSH connection failed: {e}"),
            )
            .await?;
            emit_step(
                app,
                connect_id,
                SftpStep::TcpConnected,
                hop_detail(host, port, "", via.as_deref()),
            );
            h
        } else {
            let first = &jump_hosts[0];
            let (mut current_handle, via, ()) = connect_first_hop_retrying(
                &config,
                proxy.as_ref(),
                &first.host,
                first.port,
                1,
                || {
                    let (c, reason) =
                        SshClient::new(first.host.clone(), first.port, Arc::clone(&known_hosts));
                    (c, reason, ())
                },
                |e| format!("Jump host {} connection failed: {}", first.host, e),
            )
            .await?;
            emit_step(
                app,
                connect_id,
                SftpStep::TcpConnected,
                hop_detail(&first.host, first.port, " (jump 1)", via.as_deref()),
            );
            authenticate_handle(
                &mut current_handle,
                &first.username,
                first.password.as_deref(),
                first.private_key.as_deref(),
                first.passphrase.as_deref(),
            )
            .await
            .map_err(|e| format!("Jump host {} auth failed: {}", first.host, e))?;

            for (i, jump) in jump_hosts[1..].iter().enumerate() {
                let channel = current_handle
                    .channel_open_direct_tcpip(&jump.host, jump.port as u32, "127.0.0.1", 0)
                    .await
                    .map_err(|e| format!("Failed to open tunnel to {}: {}", jump.host, e))?;
                let (next_client, _) =
                    SshClient::new(jump.host.clone(), jump.port, Arc::clone(&known_hosts));
                let mut next_handle = russh::client::connect_stream(
                    Arc::clone(&config),
                    channel.into_stream(),
                    next_client,
                )
                .await
                .map_err(|e| format!("Jump host {} SSH handshake failed: {}", jump.host, e))?;
                authenticate_handle(
                    &mut next_handle,
                    &jump.username,
                    jump.password.as_deref(),
                    jump.private_key.as_deref(),
                    jump.passphrase.as_deref(),
                )
                .await
                .map_err(|e| format!("Jump host {} auth failed: {}", jump.host, e))?;
                let prev = std::mem::replace(&mut current_handle, next_handle);
                jump_handles.push(Arc::new(prev));
                emit_step(
                    app,
                    connect_id,
                    SftpStep::TcpConnected,
                    format!("{}:{} (jump {})", jump.host, jump.port, i + 2),
                );
            }

            let channel = current_handle
                .channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0)
                .await
                .map_err(|e| format!("Failed to open tunnel to final host {}: {}", host, e))?;
            let (final_client, _) =
                SshClient::new(host.to_string(), port, Arc::clone(&known_hosts));
            let h = russh::client::connect_stream(
                Arc::clone(&config),
                channel.into_stream(),
                final_client,
            )
            .await
            .map_err(|e| format!("Final host {} SSH handshake failed: {}", host, e))?;
            jump_handles.push(Arc::new(current_handle));
            emit_step(
                app,
                connect_id,
                SftpStep::TcpConnected,
                format!("{}:{}", host, port),
            );
            h
        };

        emit_step(
            app,
            connect_id,
            SftpStep::Handshake,
            "Negotiating algorithms",
        );
        emit_step(
            app,
            connect_id,
            SftpStep::Authenticating,
            format!("{}@{}", username, host),
        );
        authenticate_handle(
            &mut final_handle,
            username,
            password,
            private_key,
            passphrase,
        )
        .await?;

        emit_step(
            app,
            connect_id,
            SftpStep::SftpSubsystem,
            "Requesting SFTP subsystem",
        );
        // This connection owns its handle outright — nothing else swaps it, but
        // it still travels as a cell so every backend takes the same type.
        let handle = own_cell(Arc::new(final_handle));
        let backend = RealSftp::open(Arc::clone(&handle), SftpOpener::Subsystem).await?;
        let cancel = CancellationToken::new();
        let id = self
            .register(
                Arc::new(backend),
                Some(Arc::clone(&handle)),
                cancel.clone(),
                jump_handles,
            )
            .await;

        // Monitor for connection loss by probing a lightweight channel, paced to
        // the keepalive preset: probe every `interval`, declare the link dead only
        // after `max` consecutive failures (≈ interval × max detection, matching the
        // terminal preset semantics). Disabled when keepalive is "off".
        if keepalive_interval_secs > 0 && keepalive_max > 0 {
            let monitor_handle = Arc::clone(&handle);
            let monitor_app = app.clone();
            let monitor_id = id.clone();
            let probe_every = Duration::from_secs(keepalive_interval_secs);
            let probe_timeout = Duration::from_secs(keepalive_interval_secs.max(2));
            tokio::spawn(async move {
                let mut failures = 0usize;
                loop {
                    tokio::select! {
                        _ = cancel.cancelled() => break,
                        _ = tokio::time::sleep(probe_every) => {}
                    }
                    let current = read_cell(&monitor_handle);
                    let result =
                        tokio::time::timeout(probe_timeout, current.channel_open_session()).await;
                    match result {
                        Ok(Ok(ch)) => {
                            let _ = ch.close().await;
                            failures = 0;
                        }
                        _ => {
                            failures += 1;
                            if failures >= keepalive_max {
                                let _ =
                                    monitor_app.emit(&format!("sftp-closed-{}", monitor_id), ());
                                break;
                            }
                        }
                    }
                }
            });
        }

        Ok(id)
    }

    /// Fetch the file backend for an id.
    pub async fn backend(&self, id: &str) -> Option<Arc<dyn FileBackend>> {
        self.sessions
            .lock()
            .await
            .get(id)
            .map(|e| Arc::clone(&e.backend))
    }

    /// Per-session cache of the remote shell tar commands are written for.
    pub(crate) async fn tar_shell_cell(
        &self,
        id: &str,
    ) -> Option<Arc<OnceCell<Option<RemoteShell>>>> {
        self.sessions
            .lock()
            .await
            .get(id)
            .map(|e| Arc::clone(&e.tar_shell))
    }

    pub async fn close(&self, id: &str) {
        let entry = self.sessions.lock().await.remove(id);
        if let Some(e) = entry {
            e.cancel.cancel();
            if let Some(s) = e.backend.as_sftp_session() {
                let _ = s.lock().await.close().await;
            }
        }
    }

    /// Register a transfer and return its cancellation token.
    pub async fn register_transfer(&self, transfer_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.transfers
            .lock()
            .await
            .insert(transfer_id.to_string(), token.clone());
        token
    }

    /// Cancel a transfer by ID. No-op if not found.
    pub async fn cancel_transfer(&self, transfer_id: &str) {
        if let Some(token) = self.transfers.lock().await.remove(transfer_id) {
            token.cancel();
        }
    }

    /// Remove a completed/failed transfer token.
    pub async fn finish_transfer(&self, transfer_id: &str) {
        self.transfers.lock().await.remove(transfer_id);
    }

    /// Return a shared mutex keyed by (sftp_id, path); created on first use.
    pub async fn path_lock(&self, sftp_id: &str, path: &str) -> Arc<Mutex<()>> {
        let key = format!("{sftp_id}\u{0}{path}");
        let mut map = self.write_locks.lock().await;
        map.entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Run a shell command on the remote host associated with an SFTP session
    /// and wait for it to exit, however long that takes: a tar of a large tree
    /// runs for minutes. `cancel` (the transfer's token) or closing the session
    /// stops the wait early, as an error.
    /// The command must report its exit code through the `__TF_EXIT__` marker
    /// (see `RemoteShell::status`); output without it is an error.
    /// `after_cancel` runs once a cancelled command has actually exited.
    pub async fn exec_command(
        &self,
        sftp_id: &str,
        cmd: &str,
        cancel: Option<&CancellationToken>,
        after_cancel: Option<String>,
    ) -> Result<(), String> {
        let stop = async {
            match cancel {
                Some(token) => token.cancelled().await,
                None => std::future::pending().await,
            }
            "Transfer cancelled".to_string()
        };
        exit_status(&self.exec_until(sftp_id, cmd, stop, after_cancel).await?)
    }

    /// True only if `cmd` ran and reported exit 0 through its `__TF_EXIT__` marker.
    pub async fn exec_probe(&self, sftp_id: &str, cmd: &str) -> bool {
        match self.exec_output(sftp_id, cmd).await {
            Ok(text) => exit_status(&text).is_ok(),
            Err(_) => false,
        }
    }

    /// Output of a quick probe command, or an error if it hasn't finished in
    /// `PROBE_TIMEOUT`.
    pub(crate) async fn exec_output(&self, sftp_id: &str, cmd: &str) -> Result<String, String> {
        let stop = async {
            tokio::time::sleep(PROBE_TIMEOUT).await;
            format!(
                "Remote command timed out after {}s",
                PROBE_TIMEOUT.as_secs()
            )
        };
        self.exec_until(sftp_id, cmd, stop, None).await
    }

    async fn exec_until(
        &self,
        sftp_id: &str,
        cmd: &str,
        stop: impl Future<Output = String>,
        after_stop: Option<String>,
    ) -> Result<String, String> {
        let (handle, session_cancel) = {
            let sessions = self.sessions.lock().await;
            let entry = sessions
                .get(sftp_id)
                .ok_or_else(|| format!("SFTP session '{}' not found", sftp_id))?;
            let handle = entry.handle.clone().ok_or_else(|| {
                "Remote command execution not supported for this connection".to_string()
            })?;
            (handle, entry.cancel.clone())
        };
        run_until(read_cell(&handle), cmd, stop, session_cancel, after_stop).await
    }
}

/// Run `cmd` and collect its stdout until the channel reaches EOF, or fail
/// with `stop`'s message if it resolves first. Partial output is never
/// returned: the caller would read a command that is still running as done.
/// A stopped command keeps running remotely, so `after_stop` waits for its exit.
async fn run_until<H: russh::client::Handler + 'static>(
    handle: Arc<Handle<H>>,
    cmd: &str,
    stop: impl Future<Output = String>,
    session_cancel: CancellationToken,
    after_stop: Option<String>,
) -> Result<String, String> {
    let mut channel = open_exec(&handle, cmd).await?;
    let mut output = Vec::new();
    let mut stopped = false;
    let ended = {
        let mut reader = channel.make_reader();
        tokio::select! {
            read = reader.read_to_end(&mut output) => {
                read.map(drop).map_err(|e| format!("Remote command failed: {e}"))
            }
            why = stop => {
                stopped = true;
                Err(why)
            }
            _ = session_cancel.cancelled() => Err("SFTP session closed".to_string()),
        }
    };
    match after_stop {
        Some(cleanup) if stopped => {
            tokio::spawn(run_after_exit(handle, channel, session_cancel, cleanup));
        }
        // A plain `Channel` doesn't close itself on drop the way a stream does.
        _ => {
            let _ = channel.close().await;
        }
    }
    ended.map(|()| String::from_utf8_lossy(&output).into_owned())
}

async fn run_after_exit<H: russh::client::Handler + 'static>(
    handle: Arc<Handle<H>>,
    mut channel: Channel<Msg>,
    session_cancel: CancellationToken,
    cleanup: String,
) {
    let exited = drain(&mut channel, &session_cancel).await;
    let _ = channel.close().await;
    if !exited {
        return;
    }
    if let Ok(mut cleanup) = open_exec(&handle, &cleanup).await {
        drain(&mut cleanup, &session_cancel).await;
        let _ = cleanup.close().await;
    }
}

async fn open_exec<H: russh::client::Handler>(
    handle: &Handle<H>,
    cmd: &str,
) -> Result<Channel<Msg>, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel error: {e}"))?;
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Exec error: {e}"))?;
    Ok(channel)
}

/// Discard `channel`'s output until it ends; false if the session closed first.
async fn drain(channel: &mut Channel<Msg>, session_cancel: &CancellationToken) -> bool {
    let (mut reader, mut sink) = (channel.make_reader(), tokio::io::sink());
    tokio::select! {
        _ = tokio::io::copy(&mut reader, &mut sink) => true,
        _ = session_cancel.cancelled() => false,
    }
}

/// How long a probe (`command -v tar`, `echo %TEMP%`) may take before the host
/// is treated as unable to run it.
const PROBE_TIMEOUT: Duration = Duration::from_secs(120);

/// Read the `__TF_EXIT__` marker a finished command printed. Its absence means
/// the command never got that far — the connection dropped, or the host's shell
/// didn't understand it — so it is a failure, never a silent success.
fn exit_status(text: &str) -> Result<(), String> {
    for line in text.lines().rev() {
        if let Some(code_str) = line.strip_prefix("__TF_EXIT__:") {
            let code: i32 = code_str.trim().parse().unwrap_or(1);
            if code != 0 {
                let msg = text
                    .lines()
                    .filter(|l| !l.starts_with("__TF_EXIT__:"))
                    .collect::<Vec<_>>()
                    .join("\n");
                return Err(msg.trim().to_string());
            }
            return Ok(());
        }
    }

    match text.trim() {
        "" => Err("Remote command ended without reporting its exit status".into()),
        out => Err(out.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{exit_status, run_until, SftpManager};
    use crate::port_forward::test_ssh::{serve_one, TestClient};
    use russh::server::{Auth, ChannelOpenHandle, Msg as ServerMsg, Session};
    use russh::{Channel, ChannelId};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    /// Answers every exec with an exit marker; `slow` only once `release` fires.
    struct ExecServer {
        ran: Arc<std::sync::Mutex<Vec<String>>>,
        release: Arc<Notify>,
    }

    impl russh::server::Handler for ExecServer {
        type Error = russh::Error;

        async fn auth_none(&mut self, _user: &str) -> Result<Auth, Self::Error> {
            Ok(Auth::Accept)
        }

        async fn channel_open_session(
            &mut self,
            _channel: Channel<ServerMsg>,
            reply: ChannelOpenHandle,
            _session: &mut Session,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }

        async fn exec_request(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut Session,
        ) -> Result<(), Self::Error> {
            let cmd = String::from_utf8_lossy(data).into_owned();
            let (ran, release, handle) = (self.ran.clone(), self.release.clone(), session.handle());
            session.channel_success(channel)?;
            tokio::spawn(async move {
                if cmd == "slow" {
                    release.notified().await;
                }
                ran.lock().unwrap().push(cmd);
                let _ = handle.data(channel, &b"__TF_EXIT__:0\n"[..]).await;
                let _ = handle.eof(channel).await;
                let _ = handle.close(channel).await;
            });
            Ok(())
        }
    }

    async fn exec_server() -> (
        Arc<russh::client::Handle<TestClient>>,
        Arc<std::sync::Mutex<Vec<String>>>,
        Arc<Notify>,
    ) {
        let ran = Arc::new(std::sync::Mutex::new(Vec::new()));
        let release = Arc::new(Notify::new());
        let server = ExecServer {
            ran: ran.clone(),
            release: release.clone(),
        };
        let port = serve_one(Default::default(), server).await;
        let mut handle =
            russh::client::connect(Default::default(), ("127.0.0.1", port), TestClient)
                .await
                .unwrap();
        assert!(handle.authenticate_none("test").await.unwrap().success());
        (Arc::new(handle), ran, release)
    }

    async fn wait_for(ran: &std::sync::Mutex<Vec<String>>, want: &[&str]) {
        for _ in 0..200 {
            if ran.lock().unwrap().as_slice() == want {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("ran {:?}, wanted {want:?}", ran.lock().unwrap());
    }

    #[tokio::test]
    async fn a_finished_command_returns_its_output() {
        let (handle, ran, _) = exec_server().await;
        let never = std::future::pending::<String>();
        let out = run_until(handle, "fast", never, CancellationToken::new(), None).await;
        assert_eq!(out, Ok("__TF_EXIT__:0\n".to_string()));
        assert_eq!(*ran.lock().unwrap(), ["fast"]);
    }

    #[tokio::test]
    async fn cleanup_after_a_stop_waits_for_the_command_to_exit() {
        let (handle, ran, release) = exec_server().await;
        let stop = std::future::ready("stopped".to_string());
        let out = run_until(
            handle,
            "slow",
            stop,
            CancellationToken::new(),
            Some("rm".into()),
        )
        .await;
        assert_eq!(out, Err("stopped".to_string()));

        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(ran.lock().unwrap().is_empty(), "cleanup raced the command");
        release.notify_one();
        wait_for(&ran, &["slow", "rm"]).await;
    }

    #[tokio::test]
    async fn no_cleanup_once_the_session_is_closed() {
        let (handle, ran, release) = exec_server().await;
        let session = CancellationToken::new();
        let stop = std::future::ready("stopped".to_string());
        let out = run_until(handle, "slow", stop, session.clone(), Some("rm".into())).await;
        assert!(out.is_err());

        session.cancel();
        release.notify_one();
        wait_for(&ran, &["slow"]).await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(*ran.lock().unwrap(), ["slow"]);
    }

    #[test]
    fn exit_status_reads_the_marker() {
        assert_eq!(exit_status("__TF_EXIT__:0\n"), Ok(()));
        assert_eq!(
            exit_status("tar: boom\n__TF_EXIT__:2\n"),
            Err("tar: boom".into())
        );
    }

    #[test]
    fn a_missing_marker_is_a_failure() {
        let cmd_exe = "The system cannot find the path specified.\r\n";
        assert_eq!(
            exit_status(cmd_exe),
            Err("The system cannot find the path specified.".into())
        );
        assert!(exit_status("").is_err());
        // A tar cut off mid-run: some output, no marker.
        assert!(exit_status("tar: file changed as we read it\n").is_err());
    }

    #[tokio::test]
    async fn path_lock_same_path_is_shared() {
        let mgr = SftpManager::new();
        let a = mgr.path_lock("s1", "/etc/hosts").await;
        let b = mgr.path_lock("s1", "/etc/hosts").await;
        assert!(Arc::ptr_eq(&a, &b));
    }

    #[tokio::test]
    async fn path_lock_different_path_is_distinct() {
        let mgr = SftpManager::new();
        let a = mgr.path_lock("s1", "/a").await;
        let b = mgr.path_lock("s1", "/b").await;
        assert!(!Arc::ptr_eq(&a, &b));
    }
}
