use crate::error::AppError;
use crate::sftp::{FileBackend, SftpManager};
use resume::endpoint::Endpoint;
use russh_sftp::client::fs::File;
use serde::Serialize;
use std::future::Future;
use std::ops::{Deref, DerefMut};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio_util::sync::CancellationToken;

pub mod dir;
pub mod editor;
pub(crate) mod local_tar;
mod ops;
mod remote_shell;
pub(crate) mod resume;
mod stream;
mod tar;
mod tar_failure;
mod tar_host;
pub mod transfer;

pub use dir::*;
pub use ops::*;
pub use tar::*;
pub use tar_host::{TarHost, TarProbe};
pub use transfer::*;

pub(crate) const CHUNK_SIZE: usize = 256 * 1024; // 256 KB

#[derive(Serialize, Clone)]
pub struct RemoteFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
}

pub(crate) fn sort_listing(files: &mut [RemoteFile]) {
    files.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

#[derive(Serialize, Clone)]
pub struct TransferProgress {
    pub transferred: u64,
    pub total: u64,
}

pub(super) async fn get_endpoint(
    manager: &SftpManager,
    sftp_id: &str,
) -> Result<Arc<dyn Endpoint>, String> {
    Ok(get_backend(manager, sftp_id).await?.endpoint())
}

pub(super) async fn get_backend(
    manager: &SftpManager,
    sftp_id: &str,
) -> Result<Arc<dyn FileBackend>, String> {
    manager
        .backend(sftp_id)
        .await
        .ok_or_else(|| format!("SFTP session '{}' not found", sftp_id))
}

pub(super) use crate::ssh::exec::shell_quote;

/// Register the transfer, run it, and always deregister it.
pub(super) async fn with_transfer<F, Fut>(
    manager: &SftpManager,
    transfer_id: &str,
    run: F,
) -> Result<(), AppError>
where
    F: FnOnce(CancellationToken) -> Fut,
    Fut: Future<Output = Result<(), AppError>>,
{
    let token = manager.register_transfer(transfer_id).await;
    let result = run(token).await;
    manager.finish_transfer(transfer_id).await;
    result
}

/// `with_transfer` for the shape every single-backend transfer command has.
pub(super) async fn run_backend_transfer<F, Fut>(
    manager: &SftpManager,
    sftp_id: &str,
    transfer_id: &str,
    run: F,
) -> Result<(), AppError>
where
    F: FnOnce(Arc<dyn FileBackend>, CancellationToken) -> Fut,
    Fut: Future<Output = Result<(), AppError>>,
{
    with_transfer(manager, transfer_id, |token| async move {
        run(get_backend(manager, sftp_id).await?, token).await
    })
    .await
}

/// The four single-object transfer commands differ only in which `FileBackend`
/// method they call and which way round their two path arguments read.
///
/// `rustfmt::skip` because rustfmt is not idempotent on this body: it re-indents
/// the `run_backend_transfer` call one level further on every run, so a
/// `cargo fmt --check` would drift after each `cargo fmt`.
#[rustfmt::skip]
macro_rules! backend_transfer_command {
    ($name:ident, $method:ident, $from:ident, $to:ident) => {
        #[tauri::command]
        pub async fn $name(
            app: AppHandle,
            sftp_state: tauri::State<'_, SftpManager>,
            sftp_id: String,
            $from: String,
            $to: String,
            transfer_id: String,
        ) -> Result<(), $crate::error::AppError> {
            let tid = transfer_id.clone();
            $crate::commands::sftp::run_backend_transfer(
                &sftp_state,
                &sftp_id,
                &transfer_id,
                |backend, token| async move {
                    backend.$method(&app, &$from, &$to, &tid, &token).await
                },
            )
            .await
        }
    };
}

pub(super) use backend_transfer_command;

/// An open remote file that is always closed with `shutdown()`.
///
/// russh-sftp's `File` drop sends a close without waiting for the reply, so the
/// session's open-handle count is never decremented; against a server that
/// advertises `limits@openssh.com` (OpenSSH 9.x), every open then fails with
/// "handle limit reached" once enough files have been dropped. `close` shuts the
/// file down and reports why it couldn't (a write's errors only surface there);
/// a file dropped unclosed — an early return, a cancelled transfer — is shut
/// down in the background instead.
pub(crate) struct SftpFile {
    file: Option<File>,
    /// Prefix of `close`'s error: "Flush error" for a write, "Close error" for a read.
    close_error: &'static str,
}

impl SftpFile {
    pub(crate) fn new(file: File, close_error: &'static str) -> Self {
        Self {
            file: Some(file),
            close_error,
        }
    }

    pub(crate) async fn close(mut self) -> Result<(), String> {
        let closed = self.shutdown().await;
        if closed.is_ok() {
            // Shut down: nothing left for `Drop` to do.
            self.file = None;
        }
        closed.map_err(|e| format!("{}: {e}", self.close_error))
    }
}

impl Deref for SftpFile {
    type Target = File;
    fn deref(&self) -> &File {
        self.file.as_ref().expect("SftpFile used after close")
    }
}

impl DerefMut for SftpFile {
    fn deref_mut(&mut self) -> &mut File {
        self.file.as_mut().expect("SftpFile used after close")
    }
}

impl AsyncRead for SftpFile {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut **self.get_mut()).poll_read(cx, buf)
    }
}

impl AsyncWrite for SftpFile {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut **self.get_mut()).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut **self.get_mut()).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut **self.get_mut()).poll_shutdown(cx)
    }
}

impl Drop for SftpFile {
    fn drop(&mut self) {
        let Some(mut file) = self.file.take() else {
            return;
        };
        // Outside a runtime there is nothing to await on: `File`'s own drop is the fallback.
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            // Bounded: on a dead link the pending write acks never resolve.
            rt.spawn(async move {
                let _ = tokio::time::timeout(Duration::from_secs(30), file.shutdown()).await;
            });
        }
    }
}

/// Copy `reader` into `writer` in `CHUNK_SIZE` chunks, calling `on_chunk` after
/// each and honouring cancellation. Neither side is shut down.
pub(crate) async fn pump<R, W>(
    reader: &mut R,
    writer: &mut W,
    token: &CancellationToken,
    mut on_chunk: impl FnMut(usize),
) -> Result<(), AppError>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = tokio::select! {
            biased;
            _ = token.cancelled() => return Err("Transfer cancelled".into()),
            r = reader.read(&mut buf) => r.map_err(|e| AppError::caused("Read error", &e))?,
        };
        if n == 0 {
            return Ok(());
        }
        tokio::select! {
            biased;
            _ = token.cancelled() => return Err("Transfer cancelled".into()),
            r = writer.write_all(&buf[..n]) => r.map_err(|e| AppError::caused("Write error", &e))?,
        }
        on_chunk(n);
    }
}

#[cfg(test)]
mod listing_tests {
    use super::{sort_listing, RemoteFile};

    fn entry(name: &str, is_dir: bool) -> RemoteFile {
        RemoteFile {
            name: name.into(),
            path: format!("/{name}"),
            size: 0,
            is_dir,
            is_symlink: false,
            modified: None,
            permissions: None,
        }
    }

    #[test]
    fn folders_first_then_names_ignoring_case() {
        let mut files = vec![
            entry("b.txt", false),
            entry("Zed", true),
            entry("A.txt", false),
            entry("alpha", true),
        ];
        sort_listing(&mut files);
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["alpha", "Zed", "A.txt", "b.txt"]);
    }
}

#[cfg(test)]
mod transfer_error_tests {
    use super::with_transfer;
    use crate::error::{AppError, ErrorCode};
    use crate::sftp::SftpManager;

    #[tokio::test]
    async fn a_coded_transfer_error_keeps_its_code() {
        let manager = SftpManager::new();
        let err = with_transfer(&manager, "t", |_| async {
            Err::<(), _>(AppError::coded(ErrorCode::TransferVerifyFailed, "x"))
        })
        .await
        .unwrap_err();
        assert_eq!(err.code(), Some(ErrorCode::TransferVerifyFailed));
    }
}
