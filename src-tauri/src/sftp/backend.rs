//! The `FileBackend` trait: the filesystem operations every SFTP-id speaks,
//! regardless of transport (real SFTP over SSH, `docker exec` shim, …).
//!
//! The tar fast paths are inherently SFTP-only; they reach the raw session
//! through `as_sftp_session()` (None for non-SFTP backends, which fall back to
//! the per-item `*_batch` methods). Server-to-server transfer takes that fast
//! path when BOTH ends are real SFTP and otherwise pipes `open_read` into
//! `open_write`, which is what lets an FTP end pair with an SFTP one.

use crate::commands::sftp::RemoteFile;
use async_trait::async_trait;
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// A streaming read handle over one remote file.
///
/// `finish` is separate from `Drop` because FTP's data connection has to be
/// finalized on the control connection: dropping the stream alone leaves the
/// session mid-transfer and the NEXT command on it fails with an unrelated
/// error. Every implementor must be safe to drop without finishing, since a
/// cancelled transfer does exactly that.
#[async_trait]
pub trait RemoteRead: Send {
    /// Fills as much of `buf` as it can; `Ok(0)` means end of file.
    async fn read_chunk(&mut self, buf: &mut [u8]) -> Result<usize, String>;
    async fn finish(self: Box<Self>) -> Result<(), String>;
}

/// A streaming write handle over one remote file. See `RemoteRead` for why
/// `finish` is explicit — for a write it also decides whether the bytes are
/// committed at all, so a dropped writer must be assumed to have failed.
#[async_trait]
pub trait RemoteWrite: Send {
    async fn write_chunk(&mut self, buf: &[u8]) -> Result<(), String>;
    async fn finish(self: Box<Self>) -> Result<(), String>;
    /// Abandon the partial write. Best-effort: used on cancellation, where
    /// there is nothing useful to do with a further failure.
    async fn abort(self: Box<Self>);
}

#[async_trait]
pub trait FileBackend: Send + Sync {
    // ── Browse / metadata ──────────────────────────────────────────────────
    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, String>;
    /// Some(is_dir) if the path exists, None if it doesn't.
    async fn stat(&self, path: &str) -> Result<Option<bool>, String>;
    async fn canonicalize(&self, path: &str) -> Result<String, String>;
    async fn mkdir(&self, path: &str) -> Result<(), String>;
    async fn touch(&self, path: &str) -> Result<(), String>;
    async fn rename(&self, from: &str, to: &str) -> Result<(), String>;
    async fn delete(&self, path: &str) -> Result<(), String>;

    // ── Editor ─────────────────────────────────────────────────────────────
    async fn file_size(&self, path: &str) -> u64;
    async fn read_file(&self, path: &str) -> Result<Vec<u8>, String>;
    async fn write_file(&self, path: &str, content: &str) -> Result<(), String>;

    // ── Streaming (server-to-server across unlike transports) ──────────────
    async fn open_read(&self, path: &str) -> Result<Box<dyn RemoteRead>, String>;
    async fn open_write(&self, path: &str) -> Result<Box<dyn RemoteWrite>, String>;

    /// True when one open stream monopolises the whole connection, so a read
    /// and a write on the SAME backend cannot overlap. An FTP session is one
    /// control connection and cannot RETR and STOR at once; SFTP multiplexes
    /// file handles over an SSH channel and can.
    fn stream_is_exclusive(&self) -> bool {
        false
    }

    // ── Transfers ──────────────────────────────────────────────────────────
    async fn upload_file(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn download_file(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn upload_dir(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn download_dir(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn upload_batch(
        &self,
        app: &AppHandle,
        local_paths: &[String],
        remote_dir: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn download_batch(
        &self,
        app: &AppHandle,
        remote_paths: &[String],
        local_dir: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;

    /// Raw SFTP session, for server-to-server transfer and tar fast paths.
    /// None for transports that don't speak real SFTP.
    fn as_sftp_session(&self) -> Option<Arc<Mutex<SftpSession>>> {
        None
    }
}
