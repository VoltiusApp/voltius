//! `RealSftp`: a `FileBackend` backed by a real SFTP session over SSH.
//! Simple filesystem ops are implemented here; streaming transfers delegate to
//! the shared `*_inner` helpers in `crate::commands::sftp`.

use crate::commands::sftp::dir::{sftp_download_dir_inner, sftp_upload_dir_inner};
use crate::commands::sftp::transfer::{sftp_download_inner, sftp_upload_inner};
use crate::commands::sftp::RemoteFile;
use crate::sftp::backend::FileBackend;
use crate::ssh::client::SshClient;
use crate::ssh::live_cells::read_cell;
use crate::ssh::session::SessionHandle;
use async_trait::async_trait;
use russh::client::Handle;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// How this backend's SFTP channel was obtained, so it can be obtained again
/// after the underlying SSH link is replaced.
#[derive(Clone)]
pub enum SftpOpener {
    /// `request_subsystem("sftp")` on a fresh channel.
    Subsystem,
    /// `exec` of a command that speaks the SFTP protocol on stdio
    /// (e.g. `docker exec -i <id> sftp-server`).
    Exec(String),
}

/// Run an SFTP call, re-opening the channel once and retrying if the cached
/// session turns out to be dead. The re-opened session replaces the shared one
/// in place, so streaming transfers holding the same `Arc` heal too.
///
/// A macro rather than a function taking a closure: the call borrows both the
/// session guard and the operation's arguments, which no single closure
/// signature can express without forcing the arguments to `'static`.
macro_rules! retry_sftp {
    ($self:expr, $what:expr, |$sftp:ident| $call:expr) => {{
        let this = $self;
        let mut guard = this.session.lock().await;
        let first = {
            let $sftp = &*guard;
            $call.await
        };
        match first {
            Ok(v) => Ok(v),
            Err(e) if !is_transport_dead(&e) => Err(format!("{} failed: {e}", $what)),
            Err(_) => {
                let handle = read_cell(&this.handle);
                match open_sftp(&handle, &this.opener).await {
                    Err(e) => Err(e),
                    Ok(fresh) => {
                        *guard = fresh;
                        let $sftp = &*guard;
                        $call.await.map_err(|e| format!("{} failed: {e}", $what))
                    }
                }
            }
        }
    }};
}

/// True when the error means the transport under the SFTP session is gone, as
/// opposed to the server refusing a specific operation. Sleep/hibernate leaves
/// the session's writer closed ("session closed") or its requests unanswered
/// (`Timeout`); either way the fix is a new channel, not a different path.
fn is_transport_dead(e: &SftpError) -> bool {
    match e {
        SftpError::Status(_) | SftpError::Limited(_) => false,
        SftpError::IO(_) | SftpError::Timeout | SftpError::UnexpectedPacket => true,
        SftpError::UnexpectedBehavior(msg) => {
            msg.contains("session closed")
                || msg.contains("SendError")
                || msg.contains("RecvError")
                || msg.contains("EOF")
        }
    }
}

/// Open a fresh SFTP session on `handle` the same way the original was opened.
pub async fn open_sftp(
    handle: &Handle<SshClient>,
    opener: &SftpOpener,
) -> Result<SftpSession, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel error: {e}"))?;
    match opener {
        SftpOpener::Subsystem => channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("SFTP subsystem error: {e}"))?,
        SftpOpener::Exec(cmd) => channel
            .exec(true, cmd.as_str())
            .await
            .map_err(|e| format!("Exec error: {e}"))?,
    }
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("SFTP session error: {e}"))
}

#[derive(Clone)]
pub struct RealSftp {
    session: Arc<Mutex<SftpSession>>,
    /// Live SSH handle — follows the owning terminal session across reconnects.
    handle: SessionHandle,
    opener: SftpOpener,
}

impl RealSftp {
    /// Open an SFTP channel on `handle` and wrap it as a backend that knows how
    /// to open the same kind of channel again after a reconnect.
    pub async fn open(handle: SessionHandle, opener: SftpOpener) -> Result<Self, String> {
        let current = read_cell(&handle);
        let session = open_sftp(&current, &opener).await?;
        Ok(Self {
            session: Arc::new(Mutex::new(session)),
            handle,
            opener,
        })
    }
}

#[async_trait]
impl FileBackend for RealSftp {
    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, String> {
        let entries = retry_sftp!(self, "read_dir", |s| s.read_dir(path))?;
        let base = path.trim_end_matches('/');
        let mut files: Vec<RemoteFile> = entries
            .map(|e| {
                let meta = e.metadata();
                let name = e.file_name();
                let entry_path = format!("{}/{}", base, name);
                RemoteFile {
                    path: entry_path,
                    name,
                    size: meta.size.unwrap_or(0),
                    is_dir: meta.is_dir(),
                    is_symlink: meta.is_symlink(),
                    modified: meta.mtime.map(|t| t as u64),
                    permissions: meta.permissions,
                }
            })
            .collect();
        files.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(files)
    }

    async fn stat(&self, path: &str) -> Result<Option<bool>, String> {
        match retry_sftp!(self, "metadata", |s| s.metadata(path)) {
            Ok(meta) => Ok(Some(meta.is_dir())),
            Err(_) => Ok(None),
        }
    }

    async fn canonicalize(&self, path: &str) -> Result<String, String> {
        retry_sftp!(self, "canonicalize", |s| s.canonicalize(path))
    }

    async fn mkdir(&self, path: &str) -> Result<(), String> {
        retry_sftp!(self, "mkdir", |s| s.create_dir(path))
    }

    async fn touch(&self, path: &str) -> Result<(), String> {
        let flags = OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
        retry_sftp!(self, "touch", |s| s.open_with_flags(path, flags)).map(|_| ())
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        retry_sftp!(self, "rename", |s| s.rename(from, to))
    }

    async fn delete(&self, path: &str) -> Result<(), String> {
        remove_recursive(Arc::clone(&self.session), path.to_string()).await
    }

    async fn file_size(&self, path: &str) -> u64 {
        retry_sftp!(self, "metadata", |s| s.metadata(path))
            .ok()
            .and_then(|m| m.size)
            .unwrap_or(0)
    }

    async fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let mut file = retry_sftp!(self, "open", |s| s.open(path))?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        Ok(buf)
    }

    async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let flags = OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE;
        let mut file = retry_sftp!(self, "open for write", |s| s.open_with_flags(path, flags))?;
        file.write_all(content.as_bytes())
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        file.flush()
            .await
            .map_err(|e| format!("flush failed: {e}"))?;
        Ok(())
    }

    async fn upload_file(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        sftp_upload_inner(
            app,
            Arc::clone(&self.session),
            local_path,
            remote_path,
            transfer_id,
            token,
        )
        .await
    }

    async fn download_file(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        sftp_download_inner(
            app,
            Arc::clone(&self.session),
            remote_path,
            local_path,
            transfer_id,
            token,
        )
        .await
    }

    async fn upload_dir(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        sftp_upload_dir_inner(
            app,
            Arc::clone(&self.session),
            local_path,
            remote_path,
            transfer_id,
            token,
        )
        .await
    }

    async fn download_dir(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        sftp_download_dir_inner(
            app,
            Arc::clone(&self.session),
            remote_path,
            local_path,
            transfer_id,
            token,
        )
        .await
    }

    // upload_batch / download_batch: the FileBackend per-item defaults, which
    // real SFTP only reaches if the tar fast path behind `as_sftp_session`
    // is unavailable.

    fn as_sftp_session(&self) -> Option<Arc<Mutex<SftpSession>>> {
        Some(Arc::clone(&self.session))
    }
}

/// Recursively remove a file or directory tree over SFTP. `symlink_metadata`
/// ensures symlinks to directories are deleted as files (not followed).
fn remove_recursive(
    session: Arc<Mutex<SftpSession>>,
    path: String,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> {
    Box::pin(async move {
        let is_dir = {
            let sftp = session.lock().await;
            match sftp.symlink_metadata(&path).await {
                Ok(meta) => meta.is_dir(),
                Err(_) => false,
            }
        };

        if is_dir {
            let entries: Vec<String> = {
                let sftp = session.lock().await;
                sftp.read_dir(&path)
                    .await
                    .map_err(|e| format!("read_dir failed: {e}"))?
                    .map(|e| e.file_name())
                    .collect()
            };
            for name in entries {
                let child = format!("{}/{}", path.trim_end_matches('/'), name);
                remove_recursive(Arc::clone(&session), child).await?;
            }
            let sftp = session.lock().await;
            sftp.remove_dir(&path)
                .await
                .map_err(|e| format!("remove_dir failed: {e}"))?;
        } else {
            let sftp = session.lock().await;
            sftp.remove_file(&path)
                .await
                .map_err(|e| format!("remove_file failed: {e}"))?;
        }

        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::{is_transport_dead, SftpError};
    use russh_sftp::protocol::{Status, StatusCode};

    fn status(code: StatusCode) -> SftpError {
        SftpError::Status(Status {
            id: 1,
            status_code: code,
            error_message: String::new(),
            language_tag: String::new(),
        })
    }

    #[test]
    fn a_refused_operation_is_not_a_dead_transport() {
        assert!(!is_transport_dead(&status(StatusCode::NoSuchFile)));
        assert!(!is_transport_dead(&status(StatusCode::PermissionDenied)));
        assert!(!is_transport_dead(&SftpError::Limited("too big".into())));
    }

    #[test]
    fn a_closed_or_unanswered_session_is_a_dead_transport() {
        assert!(is_transport_dead(&SftpError::UnexpectedBehavior(
            "session closed".into()
        )));
        assert!(is_transport_dead(&SftpError::Timeout));
        assert!(is_transport_dead(&SftpError::IO("broken pipe".into())));
        assert!(is_transport_dead(&SftpError::UnexpectedBehavior(
            "SendError: channel closed".into()
        )));
    }
}
