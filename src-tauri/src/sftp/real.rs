//! `RealSftp`: a `FileBackend` backed by a real SFTP session over SSH.
//! Simple filesystem ops are implemented here; transfers go through the
//! resumable copy engine over `SftpFs`.

use crate::commands::sftp::editor::read_capped;
use crate::commands::sftp::resume::endpoint::Endpoint;
use crate::commands::sftp::resume::sftp_fs::SftpFs;
use crate::commands::sftp::{sort_listing, RemoteFile, SftpFile, TarProbe};
use crate::error::AppError;
use crate::sftp::attrs::{apply_mode, apply_via_shell, AttrChange};
use crate::sftp::backend::FileBackend;
use crate::sftp::link::{is_transport_dead, SftpLink};
use crate::ssh::exec::{run_captured, sh_c, Captured};
use crate::ssh::live_cells::read_cell;
use crate::ssh::session::SessionHandle;
use async_trait::async_trait;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// How this backend's SFTP channel was obtained, so it can be obtained again
/// after the underlying SSH link is replaced.
#[derive(Clone)]
pub enum SftpOpener {
    /// `request_subsystem("sftp")` on a fresh channel.
    Subsystem,
    /// `exec` of `server`, a command that speaks the SFTP protocol on stdio, behind
    /// `inside`: the prefix (e.g. `docker exec -i <id>`) that runs any command where it runs.
    Exec { inside: String, server: String },
}

impl SftpOpener {
    /// Where shell commands must run to see the session's paths; None for the host itself.
    pub fn inside(&self) -> Option<String> {
        match self {
            Self::Subsystem => None,
            Self::Exec { inside, .. } => Some(inside.clone()),
        }
    }
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
            Err(e) if !is_transport_dead(&e) => {
                Err(AppError::caused(format_args!("{} failed", $what), &e))
            }
            Err(_) => match this.link.open().await {
                Err(e) => Err(e.into()),
                Ok(fresh) => {
                    *guard = fresh;
                    let $sftp = &*guard;
                    $call
                        .await
                        .map_err(|e| AppError::caused(format_args!("{} failed", $what), &e))
                }
            },
        }
    }};
}

#[derive(Clone)]
pub struct RealSftp {
    session: Arc<Mutex<SftpSession>>,
    link: Arc<SftpLink>,
    tar: Arc<TarProbe>,
}

impl RealSftp {
    /// Open an SFTP channel on `handle` and wrap it as a backend that knows how
    /// to open the same kind of channel again after a reconnect.
    pub async fn open(
        handle: SessionHandle,
        opener: SftpOpener,
        closed: CancellationToken,
    ) -> Result<Self, String> {
        let tar = Arc::new(TarProbe::new(Arc::clone(&handle), opener.inside()));
        let link = Arc::new(SftpLink {
            handle,
            opener,
            closed,
        });
        let session = link.open().await?;
        Ok(Self {
            session: Arc::new(Mutex::new(session)),
            tar,
            link,
        })
    }

    pub(crate) fn fs(&self) -> SftpFs {
        SftpFs::new(
            Arc::clone(&self.session),
            Arc::clone(&self.link),
            Arc::clone(&self.tar),
        )
    }
}

#[async_trait]
impl FileBackend for RealSftp {
    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, AppError> {
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
        sort_listing(&mut files);
        Ok(files)
    }

    async fn stat(&self, path: &str) -> Result<Option<bool>, String> {
        match retry_sftp!(self, "metadata", |s| s.metadata(path)) {
            Ok(meta) => Ok(Some(meta.is_dir())),
            Err(_) => Ok(None),
        }
    }

    async fn canonicalize(&self, path: &str) -> Result<String, AppError> {
        retry_sftp!(self, "canonicalize", |s| s.canonicalize(path))
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        retry_sftp!(self, "mkdir", |s| s.create_dir(path))
    }

    async fn touch(&self, path: &str) -> Result<(), AppError> {
        let flags = OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
        let file = retry_sftp!(self, "touch", |s| s.open_with_flags(path, flags))?;
        Ok(SftpFile::new(file, "touch failed").close().await?)
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        retry_sftp!(self, "rename", |s| s.rename(from, to))
    }

    async fn delete(&self, path: &str) -> Result<(), AppError> {
        remove_recursive(Arc::clone(&self.session), path.to_string()).await
    }

    async fn run_sh(&self, script: &str, args: &[&str]) -> Result<Captured, String> {
        let handle = read_cell(&self.link.handle);
        run_captured(&*handle, &self.tar.run_in(&sh_c(script, args))).await
    }

    async fn set_attrs(&self, change: &AttrChange) -> Result<(), AppError> {
        if change.needs_shell() {
            return apply_via_shell(self, change).await;
        }
        if !change.changes_mode() {
            return Ok(());
        }
        for path in &change.paths {
            let current = retry_sftp!(self, "stat", |s| s.metadata(path.as_str()))?;
            let mut attrs = FileAttributes::empty();
            attrs.permissions = Some(apply_mode(
                current.permissions.unwrap_or(0),
                change.set,
                change.clear,
            ));
            retry_sftp!(self, "chmod", |s| s
                .set_metadata(path.as_str(), attrs.clone()))?;
        }
        Ok(())
    }

    async fn file_size(&self, path: &str) -> u64 {
        retry_sftp!(self, "metadata", |s| s.metadata(path))
            .ok()
            .and_then(|m| m.size)
            .unwrap_or(0)
    }

    async fn read_file(&self, path: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
        let file = retry_sftp!(self, "open", |s| s.open(path))?;
        let mut file = SftpFile::new(file, "Close error");
        let buf = read_capped(&mut *file, max_bytes)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        file.close().await?;
        Ok(buf)
    }

    async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let flags = OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE;
        let file = retry_sftp!(self, "open for write", |s| s.open_with_flags(path, flags))?;
        let mut file = SftpFile::new(file, "close failed");
        file.write_all(content.as_bytes())
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        file.flush()
            .await
            .map_err(|e| format!("flush failed: {e}"))?;
        file.close().await
    }

    fn endpoint(&self) -> Arc<dyn Endpoint> {
        Arc::new(self.fs())
    }

    async fn close(&self) {
        self.fs().close_session().await;
    }

    fn tar_probe(&self) -> Option<&TarProbe> {
        Some(&self.tar)
    }
}

/// Recursively remove a file or directory tree over SFTP. `symlink_metadata`
/// ensures symlinks to directories are deleted as files (not followed).
fn remove_recursive(
    session: Arc<Mutex<SftpSession>>,
    path: String,
) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send>> {
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
                    .map_err(|e| AppError::caused("read_dir failed", &e))?
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
                .map_err(|e| AppError::caused("remove_dir failed", &e))?;
        } else {
            let sftp = session.lock().await;
            sftp.remove_file(&path)
                .await
                .map_err(|e| AppError::caused("remove_file failed", &e))?;
        }

        Ok(())
    })
}
