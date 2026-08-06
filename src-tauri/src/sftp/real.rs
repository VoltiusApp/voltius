//! `RealSftp`: a `FileBackend` backed by a real SFTP session over SSH.
//! Simple filesystem ops are implemented here; streaming transfers delegate to
//! the shared `*_inner` helpers in `crate::commands::sftp`.

use crate::commands::sftp::dir::{sftp_download_dir_inner, sftp_upload_dir_inner};
use crate::commands::sftp::transfer::{sftp_download_inner, sftp_upload_inner};
use crate::commands::sftp::RemoteFile;
use crate::sftp::backend::{FileBackend, RemoteRead, RemoteWrite};
use async_trait::async_trait;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct RealSftp {
    session: Arc<Mutex<SftpSession>>,
}

impl RealSftp {
    pub fn new(session: Arc<Mutex<SftpSession>>) -> Self {
        Self { session }
    }
}

#[async_trait]
impl FileBackend for RealSftp {
    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, String> {
        let sftp = self.session.lock().await;
        let entries = sftp
            .read_dir(path)
            .await
            .map_err(|e| format!("read_dir failed: {e}"))?;
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
        let sftp = self.session.lock().await;
        match sftp.metadata(path).await {
            Ok(meta) => Ok(Some(meta.is_dir())),
            Err(_) => Ok(None),
        }
    }

    async fn canonicalize(&self, path: &str) -> Result<String, String> {
        let sftp = self.session.lock().await;
        sftp.canonicalize(path)
            .await
            .map_err(|e| format!("canonicalize failed: {e}"))
    }

    async fn mkdir(&self, path: &str) -> Result<(), String> {
        let sftp = self.session.lock().await;
        sftp.create_dir(path)
            .await
            .map_err(|e| format!("mkdir failed: {e}"))
    }

    async fn touch(&self, path: &str) -> Result<(), String> {
        let sftp = self.session.lock().await;
        let flags = OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
        sftp.open_with_flags(path, flags)
            .await
            .map(|_| ())
            .map_err(|e| format!("touch failed: {e}"))
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let sftp = self.session.lock().await;
        sftp.rename(from, to)
            .await
            .map_err(|e| format!("rename failed: {e}"))
    }

    async fn delete(&self, path: &str) -> Result<(), String> {
        remove_recursive(Arc::clone(&self.session), path.to_string()).await
    }

    async fn file_size(&self, path: &str) -> u64 {
        let sftp = self.session.lock().await;
        sftp.metadata(path)
            .await
            .ok()
            .and_then(|m| m.size)
            .unwrap_or(0)
    }

    async fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let sftp = self.session.lock().await;
        let mut file = sftp
            .open(path)
            .await
            .map_err(|e| format!("open failed: {e}"))?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        Ok(buf)
    }

    async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let sftp = self.session.lock().await;
        let mut file = sftp
            .open_with_flags(
                path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| format!("open for write failed: {e}"))?;
        file.write_all(content.as_bytes())
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        file.flush()
            .await
            .map_err(|e| format!("flush failed: {e}"))?;
        Ok(())
    }

    // The file handle outlives the session guard: russh-sftp hands back an
    // owned handle multiplexed over the SSH channel, so nothing here holds the
    // session locked for the length of a transfer.
    async fn open_read(&self, path: &str) -> Result<Box<dyn RemoteRead>, String> {
        let sftp = self.session.lock().await;
        let file = sftp
            .open(path)
            .await
            .map_err(|e| format!("Cannot open source {path}: {e}"))?;
        Ok(Box::new(SftpStream { file }))
    }

    async fn open_write(&self, path: &str) -> Result<Box<dyn RemoteWrite>, String> {
        let sftp = self.session.lock().await;
        let file = sftp
            .open_with_flags(
                path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| format!("Cannot create destination {path}: {e}"))?;
        Ok(Box::new(SftpStream { file }))
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

    /// Per-item fallback. Real SFTP always takes the tar fast path (it exposes
    /// `as_sftp_session`), so this is only a safety net.
    async fn upload_batch(
        &self,
        app: &AppHandle,
        local_paths: &[String],
        remote_dir: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let base = remote_dir.trim_end_matches('/');
        let _ = self.mkdir(base).await;
        for p in local_paths {
            if token.is_cancelled() {
                return Err("Transfer cancelled".into());
            }
            let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let remote = format!("{base}/{name}");
            if Path::new(p).is_dir() {
                self.upload_dir(app, p, &remote, transfer_id, token).await?;
            } else {
                self.upload_file(app, p, &remote, transfer_id, token)
                    .await?;
            }
        }
        Ok(())
    }

    async fn download_batch(
        &self,
        app: &AppHandle,
        remote_paths: &[String],
        local_dir: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        for p in remote_paths {
            if token.is_cancelled() {
                return Err("Transfer cancelled".into());
            }
            let name = p.trim_end_matches('/').rsplit('/').next().unwrap_or(p);
            let local = Path::new(local_dir).join(name);
            let local_str = local.to_string_lossy();
            let is_dir = self.stat(p).await?.unwrap_or(false);
            if is_dir {
                self.download_dir(app, p, &local_str, transfer_id, token)
                    .await?;
            } else {
                self.download_file(app, p, &local_str, transfer_id, token)
                    .await?;
            }
        }
        Ok(())
    }

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

/// One open SFTP file handle, used for both directions.
///
/// `finish` shuts the handle down rather than letting `Drop` do it: russh-sftp
/// closes fire-and-forget on drop and leaks the client-side open-handle
/// counter, which a long-running session eventually notices.
struct SftpStream {
    file: russh_sftp::client::fs::File,
}

#[async_trait]
impl RemoteRead for SftpStream {
    async fn read_chunk(&mut self, buf: &mut [u8]) -> Result<usize, String> {
        self.file.read(buf).await.map_err(|e| format!("Read error: {e}"))
    }
    async fn finish(mut self: Box<Self>) -> Result<(), String> {
        self.file.shutdown().await.map_err(|e| format!("Close error: {e}"))
    }
}

#[async_trait]
impl RemoteWrite for SftpStream {
    async fn write_chunk(&mut self, buf: &[u8]) -> Result<(), String> {
        self.file.write_all(buf).await.map_err(|e| format!("Write error: {e}"))
    }
    async fn finish(mut self: Box<Self>) -> Result<(), String> {
        self.file.flush().await.map_err(|e| format!("Flush error: {e}"))?;
        self.file.shutdown().await.map_err(|e| format!("Close error: {e}"))
    }
    async fn abort(mut self: Box<Self>) {
        let _ = self.file.shutdown().await;
    }
}
