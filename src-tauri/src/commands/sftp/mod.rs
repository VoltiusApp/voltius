use crate::sftp::{FileBackend, SftpManager};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use std::future::Future;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub mod dir;
pub mod editor;
mod ops;
mod tar;
pub mod transfer;

pub use dir::*;
pub use ops::*;
pub use tar::*;
pub use transfer::*;

pub(super) const CHUNK_SIZE: usize = 256 * 1024; // 256 KB

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

#[derive(Serialize, Clone)]
pub struct TransferProgress {
    pub transferred: u64,
    pub total: u64,
}

pub(super) async fn get_session<'a>(
    manager: &'a SftpManager,
    sftp_id: &'a str,
) -> Result<Arc<Mutex<SftpSession>>, String> {
    manager
        .backend(sftp_id)
        .await
        .and_then(|b| b.as_sftp_session())
        .ok_or_else(|| format!("SFTP session '{}' not found", sftp_id))
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

pub(super) fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

pub(super) fn temp_archive_name(transfer_id: &str) -> String {
    format!("tf_{}.tar.gz", transfer_id)
}

/// Register the transfer, hand the resolved backend to `run`, and always
/// deregister it — the shape every single-object transfer command has.
pub(super) async fn run_backend_transfer<F, Fut>(
    manager: &SftpManager,
    sftp_id: &str,
    transfer_id: &str,
    run: F,
) -> Result<(), String>
where
    F: FnOnce(Arc<dyn FileBackend>, CancellationToken) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let token = manager.register_transfer(transfer_id).await;
    let result = match get_backend(manager, sftp_id).await {
        Ok(backend) => run(backend, token).await,
        Err(e) => Err(e),
    };
    manager.finish_transfer(transfer_id).await;
    result
}

/// The four single-object transfer commands differ only in which `FileBackend`
/// method they call and which way round their two path arguments read.
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
        ) -> Result<(), String> {
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

/// Open a remote file for writing (create + truncate), holding the session lock
/// for the open alone.
pub(super) async fn open_remote_write(
    session: &Mutex<SftpSession>,
    path: &str,
) -> Result<russh_sftp::client::fs::File, String> {
    let sftp = session.lock().await;
    sftp.open_with_flags(
        path,
        OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
    )
    .await
    .map_err(|e| format!("Cannot create remote file {path}: {e}"))
}

/// Open a remote file for reading, returning its size alongside the handle.
/// A missing or unreadable size is reported as 0 — progress only needs a bound.
pub(super) async fn open_remote_read(
    session: &Mutex<SftpSession>,
    path: &str,
) -> Result<(u64, russh_sftp::client::fs::File), String> {
    let sftp = session.lock().await;
    let total = remote_size(&sftp, path).await;
    let file = sftp
        .open(path)
        .await
        .map_err(|e| format!("Cannot open remote file {path}: {e}"))?;
    Ok((total, file))
}

pub(super) async fn remote_size(sftp: &SftpSession, path: &str) -> u64 {
    sftp.metadata(path)
        .await
        .ok()
        .and_then(|m| m.size)
        .unwrap_or(0)
}

/// What a tar-based command found behind an sftp id: a real SFTP session it can
/// drive itself, or a backend that has to run its own implementation.
pub(super) enum TarBackend {
    Session(Arc<Mutex<SftpSession>>),
    Other(Arc<dyn FileBackend>),
}

pub(super) async fn tar_backend(
    manager: &SftpManager,
    sftp_id: &str,
) -> Result<TarBackend, String> {
    let backend = get_backend(manager, sftp_id).await?;
    Ok(match backend.as_sftp_session() {
        Some(session) => TarBackend::Session(session),
        None => TarBackend::Other(backend),
    })
}

/// Copy `reader` into `writer` in `CHUNK_SIZE` chunks, emitting transfer
/// progress after every chunk and honouring cancellation between them.
/// Neither side is shut down — the caller owns the close, and its wording.
pub(crate) async fn pump_chunks<R, W>(
    app: &AppHandle,
    reader: &mut R,
    writer: &mut W,
    transfer_id: &str,
    token: &CancellationToken,
    transferred: &mut u64,
    total: u64,
) -> Result<(), String>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        if token.is_cancelled() {
            return Err("Transfer cancelled".into());
        }
        let n = reader
            .read(&mut buf)
            .await
            .map_err(|e| format!("Read error: {e}"))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        *transferred += n as u64;
        let _ = app.emit(
            &format!("sftp-progress-{}", transfer_id),
            TransferProgress {
                transferred: *transferred,
                total,
            },
        );
    }
    Ok(())
}
