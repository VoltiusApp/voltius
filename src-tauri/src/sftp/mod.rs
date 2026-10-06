pub mod attrs;
pub mod backend;
pub mod docker_fs;
pub mod link;
pub mod real;

pub use backend::FileBackend;

use crate::error::AppError;
use crate::known_hosts::{ConflictPrompt, KnownHostsStore};
use crate::proxy::ProxySpec;
use crate::ssh::client::{
    authenticate_handle, chain_jumps, client_config, connect_first_hop_plain, hop_detail,
    tunnel_hop, JumpHostConnect, SshClient,
};
use crate::ssh::exec::open_exec;
use crate::ssh::live_cells::{own_cell, read_cell, Cell};
use crate::ssh::session::SessionHandle;
use docker_fs::DockerFs;
use real::{RealSftp, SftpOpener};
use russh::client::Handle;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;
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
    /// Whether `handle` is this entry's own connection (`connect`) rather than a
    /// terminal session's, which only the terminal may swap. Only owned handles relink.
    owns_handle: bool,
    cancel: CancellationToken,
    jump_handles: Vec<Arc<Handle<SshClient>>>,
}

pub struct SftpManager {
    sessions: Arc<Mutex<HashMap<String, SftpEntry>>>,
    /// Active transfer cancellation tokens, keyed by transfer_id
    transfers: Arc<Mutex<HashMap<String, CancellationToken>>>,
    /// Per-(sftp_id, path) write serialization locks.
    write_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

/// Swap `value` into the slot's cell, unless the slot borrows it (`owned` false):
/// a borrowed cell is a terminal session's live handle.
fn relink_cell<T>(slot: &mut Option<Cell<T>>, owned: bool, value: T) -> Option<Cell<T>> {
    let cell = slot.as_ref().filter(|_| owned)?;
    *cell.write().unwrap() = value;
    Some(Arc::clone(cell))
}

/// Probe a channel every `interval`; after `max` straight failures report the link closed,
/// matching the terminal keepalive presets. Off when keepalive is off.
fn spawn_keepalive(
    app: &AppHandle,
    id: &str,
    handle: SessionHandle,
    cancel: CancellationToken,
    interval_secs: u64,
    max: usize,
) {
    if interval_secs == 0 || max == 0 {
        return;
    }
    let (app, id) = (app.clone(), id.to_string());
    let probe_every = Duration::from_secs(interval_secs);
    let probe_timeout = Duration::from_secs(interval_secs.max(2));
    tokio::spawn(async move {
        let mut failures = 0usize;
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tokio::time::sleep(probe_every) => {}
            }
            let current = read_cell(&handle);
            let result = tokio::time::timeout(probe_timeout, current.channel_open_session()).await;
            match result {
                Ok(Ok(ch)) => {
                    let _ = ch.close().await;
                    failures = 0;
                }
                _ => {
                    failures += 1;
                    if failures >= max {
                        let _ = app.emit(&format!("sftp-closed-{id}"), ());
                        break;
                    }
                }
            }
        }
    });
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            transfers: Arc::new(Mutex::new(HashMap::new())),
            write_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// A backend with no SSH connection underneath.
    async fn register_standalone(&self, backend: Arc<dyn FileBackend>) -> String {
        self.register(backend, None, false, CancellationToken::new(), vec![])
            .await
    }

    /// A backend riding a terminal session's handle, which a relink must not swap.
    async fn register_riding(
        &self,
        backend: Arc<dyn FileBackend>,
        handle: SessionHandle,
        cancel: CancellationToken,
    ) -> String {
        self.register(backend, Some(handle), false, cancel, vec![])
            .await
    }

    /// Register a backend under a fresh id and return that id.
    async fn register(
        &self,
        backend: Arc<dyn FileBackend>,
        handle: Option<SessionHandle>,
        owns_handle: bool,
        cancel: CancellationToken,
        jump_handles: Vec<Arc<Handle<SshClient>>>,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            id.clone(),
            SftpEntry {
                backend,
                handle,
                owns_handle,
                cancel,
                jump_handles,
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
        let cancel = CancellationToken::new();
        let backend = RealSftp::open(Arc::clone(&handle), opener, cancel.clone()).await?;
        Ok(self
            .register_riding(Arc::new(backend), handle, cancel)
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
            .register_riding(Arc::new(fs), handle, CancellationToken::new())
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
        Ok(self.register_standalone(Arc::new(backend)).await)
    }

    pub async fn connect_webdav(
        &self,
        url: &str,
        username: &str,
        password: &str,
        proxy: Option<ProxySpec>,
        known_hosts: Arc<KnownHostsStore>,
        prompt: Option<ConflictPrompt>,
    ) -> Result<String, AppError> {
        let backend =
            crate::webdav::connect(url, username, password, proxy, known_hosts, prompt).await?;
        Ok(self.register_standalone(Arc::new(backend)).await)
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
        relink: Option<&str>,
    ) -> Result<String, String> {
        let config = Arc::new(client_config(
            keepalive_interval_secs,
            keepalive_max,
            legacy_algorithms,
        ));

        let mut jump_handles: Vec<Arc<Handle<SshClient>>> = Vec::new();

        let mut final_handle: Handle<SshClient> = if jump_hosts.is_empty() {
            let (h, via) =
                connect_first_hop_plain(&config, proxy.as_ref(), &known_hosts, host, port, 1)
                    .await
                    .map_err(|e| e.describe("SSH connection failed"))?;
            emit_step(
                app,
                connect_id,
                SftpStep::TcpConnected,
                hop_detail(host, port, "", via.as_deref()),
            );
            h
        } else {
            let first = &jump_hosts[0];
            let (mut current_handle, via) = first
                .connect_first(&config, proxy.as_ref(), &known_hosts, 1)
                .await?;
            emit_step(
                app,
                connect_id,
                SftpStep::TcpConnected,
                hop_detail(&first.host, first.port, " (jump 1)", via.as_deref()),
            );
            first.authenticate(&mut current_handle).await?;
            let (current_handle, passed) = chain_jumps(
                current_handle,
                &jump_hosts[1..],
                &config,
                &known_hosts,
                |detail| emit_step(app, connect_id, SftpStep::TcpConnected, detail),
            )
            .await?;
            jump_handles.extend(passed);

            let final_client = SshClient::new(host.to_string(), port, Arc::clone(&known_hosts));
            let h = tunnel_hop(&current_handle, &config, "final host", final_client).await?;
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
        let shared = Arc::new(final_handle);
        if let Some(old) = relink {
            if let Some((cell, cancel)) = self
                .relink(old, Arc::clone(&shared), jump_handles.clone())
                .await
            {
                spawn_keepalive(
                    app,
                    old,
                    cell,
                    cancel,
                    keepalive_interval_secs,
                    keepalive_max,
                );
                return Ok(old.to_string());
            }
        }
        // A cell, so a later reconnect can relink into this id.
        let handle = own_cell(shared);
        let cancel = CancellationToken::new();
        let backend =
            RealSftp::open(Arc::clone(&handle), SftpOpener::Subsystem, cancel.clone()).await?;
        let id = self
            .register(
                Arc::new(backend),
                Some(Arc::clone(&handle)),
                true,
                cancel.clone(),
                jump_handles,
            )
            .await;
        spawn_keepalive(
            app,
            &id,
            handle,
            cancel,
            keepalive_interval_secs,
            keepalive_max,
        );
        Ok(id)
    }

    /// Point an existing session at a fresh SSH handle, keeping its id and in-flight transfers.
    /// None when the id is unknown or rides a terminal's handle; the caller opens a fresh id.
    async fn relink(
        &self,
        id: &str,
        handle: Arc<Handle<SshClient>>,
        jump_handles: Vec<Arc<Handle<SshClient>>>,
    ) -> Option<(SessionHandle, CancellationToken)> {
        let mut sessions = self.sessions.lock().await;
        let entry = sessions.get_mut(id)?;
        let cell = relink_cell(&mut entry.handle, entry.owns_handle, handle)?;
        entry.jump_handles = jump_handles;
        Some((cell, entry.cancel.clone()))
    }

    async fn with_entry<T>(&self, id: &str, read: impl FnOnce(&SftpEntry) -> T) -> Option<T> {
        self.sessions.lock().await.get(id).map(read)
    }

    /// Fetch the file backend for an id.
    pub async fn backend(&self, id: &str) -> Option<Arc<dyn FileBackend>> {
        self.with_entry(id, |e| Arc::clone(&e.backend)).await
    }

    pub async fn can_exec(&self, id: &str) -> bool {
        self.with_entry(id, |e| e.handle.is_some())
            .await
            .unwrap_or(false)
    }

    pub async fn close(&self, id: &str) {
        let entry = self.sessions.lock().await.remove(id);
        if let Some(e) = entry {
            e.cancel.cancel();
            if let Some(fs) = e.backend.sftp_fs() {
                fs.close_session().await;
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
        crate::commands::sftp::resume::clear_resume(transfer_id);
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
    pub async fn exec_command(
        &self,
        sftp_id: &str,
        cmd: &str,
        cancel: Option<&CancellationToken>,
    ) -> Result<(), String> {
        let stop = async {
            match cancel {
                Some(token) => token.cancelled().await,
                None => std::future::pending().await,
            }
            "Transfer cancelled".to_string()
        };
        exit_status(&self.exec_until(sftp_id, cmd, stop).await?)
    }

    async fn exec_until(
        &self,
        sftp_id: &str,
        cmd: &str,
        stop: impl Future<Output = String>,
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
        run_until(read_cell(&handle), cmd, stop, session_cancel).await
    }
}

/// Run `cmd` and collect its stdout until the channel reaches EOF, or fail
/// with `stop`'s message if it resolves first. Partial output is never
/// returned: the caller would read a command that is still running as done.
async fn run_until<H: russh::client::Handler + 'static>(
    handle: Arc<Handle<H>>,
    cmd: &str,
    stop: impl Future<Output = String>,
    session_cancel: CancellationToken,
) -> Result<String, String> {
    let mut channel = open_exec(&handle, cmd).await?;
    let mut output = Vec::new();
    let ended = {
        let mut reader = channel.make_reader();
        tokio::select! {
            read = reader.read_to_end(&mut output) => {
                read.map(drop).map_err(|e| format!("Remote command failed: {e}"))
            }
            why = stop => Err(why),
            _ = session_cancel.cancelled() => Err("SFTP session closed".to_string()),
        }
    };
    // A plain `Channel` doesn't close itself on drop the way a stream does.
    let _ = channel.close().await;
    ended.map(|()| String::from_utf8_lossy(&output).into_owned())
}

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
    use super::{exit_status, read_cell, relink_cell, run_until, SftpManager};
    use crate::port_forward::test_ssh::{serve_one, TestClient};
    use russh::server::{Auth, ChannelOpenHandle, Msg as ServerMsg, Session};
    use russh::{Channel, ChannelId};
    use std::sync::Arc;
    use tokio_util::sync::CancellationToken;

    /// Answers every exec with an exit marker.
    struct ExecServer {
        ran: Arc<std::sync::Mutex<Vec<String>>>,
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
            let (ran, handle) = (self.ran.clone(), session.handle());
            session.channel_success(channel)?;
            tokio::spawn(async move {
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
    ) {
        let ran = Arc::new(std::sync::Mutex::new(Vec::new()));
        let server = ExecServer { ran: ran.clone() };
        let port = serve_one(Default::default(), server).await;
        let mut handle =
            russh::client::connect(Default::default(), ("127.0.0.1", port), TestClient)
                .await
                .unwrap();
        assert!(handle.authenticate_none("test").await.unwrap().success());
        (Arc::new(handle), ran)
    }

    #[tokio::test]
    async fn a_finished_command_returns_its_output() {
        let (handle, ran) = exec_server().await;
        let never = std::future::pending::<String>();
        let out = run_until(handle, "fast", never, CancellationToken::new()).await;
        assert_eq!(out, Ok("__TF_EXIT__:0\n".to_string()));
        assert_eq!(*ran.lock().unwrap(), ["fast"]);
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

    #[test]
    fn relinking_swaps_the_shared_cell_in_place() {
        use crate::ssh::live_cells::{own_cell, Cell};
        let held = own_cell(1u32);
        let mut slot = Some(Arc::clone(&held));
        let got = relink_cell(&mut slot, true, 2).expect("a cell to relink");
        assert_eq!(read_cell(&held), 2);
        assert!(Arc::ptr_eq(&got, &held));
        assert!(relink_cell(&mut None::<Cell<u32>>, true, 3).is_none());
    }

    #[test]
    fn a_borrowed_cell_is_never_relinked() {
        use crate::ssh::live_cells::own_cell;
        // A terminal session's cell: swapping it would move the terminal.
        let terminal = own_cell(1u32);
        let mut slot = Some(Arc::clone(&terminal));
        assert!(relink_cell(&mut slot, false, 2).is_none());
        assert_eq!(read_cell(&terminal), 1);
    }
}
