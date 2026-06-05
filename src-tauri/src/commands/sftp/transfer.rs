use super::{get_backend, get_session, TransferProgress, CHUNK_SIZE};
use crate::sftp::{SftpBackend, SftpManager};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

// ── Single file transfer ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let token = sftp_state.register_transfer(&transfer_id).await;
    let result = match get_backend(&sftp_state, &sftp_id).await {
        Ok(SftpBackend::Docker(d)) => {
            d.upload_file(&app, &local_path, &remote_path, &transfer_id, &token)
                .await
        }
        Ok(SftpBackend::Real(session)) => {
            sftp_upload_inner(
                &app,
                session,
                &local_path,
                &remote_path,
                &transfer_id,
                &token,
            )
            .await
        }
        Err(e) => Err(e),
    };
    sftp_state.finish_transfer(&transfer_id).await;
    result
}

pub(super) async fn sftp_upload_inner(
    app: &AppHandle,
    session: Arc<Mutex<SftpSession>>,
    local_path: &str,
    remote_path: &str,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let mut local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("Cannot open local file: {e}"))?;
    let total = local_file.metadata().await.map(|m| m.len()).unwrap_or(0);

    let mut remote_file = {
        let sftp = session.lock().await;
        sftp.open_with_flags(
            remote_path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| format!("Cannot create remote file: {e}"))?
    };

    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred = 0u64;
    loop {
        if token.is_cancelled() {
            return Err("Transfer cancelled".into());
        }
        let n = local_file
            .read(&mut buf)
            .await
            .map_err(|e| format!("Read error: {e}"))?;
        if n == 0 {
            break;
        }
        remote_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        transferred += n as u64;
        let _ = app.emit(
            &format!("sftp-progress-{}", transfer_id),
            TransferProgress { transferred, total },
        );
    }
    remote_file
        .shutdown()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let token = sftp_state.register_transfer(&transfer_id).await;
    let result = match get_backend(&sftp_state, &sftp_id).await {
        Ok(SftpBackend::Docker(d)) => {
            d.download_file(&app, &remote_path, &local_path, &transfer_id, &token)
                .await
        }
        Ok(SftpBackend::Real(session)) => {
            sftp_download_inner(
                &app,
                session,
                &remote_path,
                &local_path,
                &transfer_id,
                &token,
            )
            .await
        }
        Err(e) => Err(e),
    };
    sftp_state.finish_transfer(&transfer_id).await;
    result
}

pub(super) async fn sftp_download_inner(
    app: &AppHandle,
    session: Arc<Mutex<SftpSession>>,
    remote_path: &str,
    local_path: &str,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let (total, mut remote_file) = {
        let sftp = session.lock().await;
        let meta = sftp.metadata(remote_path).await.ok();
        let total = meta.and_then(|m| m.size).unwrap_or(0);
        let file = sftp
            .open(remote_path)
            .await
            .map_err(|e| format!("Cannot open remote file: {e}"))?;
        (total, file)
    };

    if let Some(parent) = Path::new(local_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Cannot create local dir: {e}"))?;
    }
    let mut local_file = tokio::fs::File::create(local_path)
        .await
        .map_err(|e| format!("Cannot create local file: {e}"))?;

    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred = 0u64;
    loop {
        if token.is_cancelled() {
            return Err("Transfer cancelled".into());
        }
        let n = remote_file
            .read(&mut buf)
            .await
            .map_err(|e| format!("Read error: {e}"))?;
        if n == 0 {
            break;
        }
        local_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        transferred += n as u64;
        let _ = app.emit(
            &format!("sftp-progress-{}", transfer_id),
            TransferProgress { transferred, total },
        );
    }
    // Properly close the remote read handle; `Drop` alone leaks the client-side
    // open-handle counter in russh-sftp (fire-and-forget close).
    remote_file
        .shutdown()
        .await
        .map_err(|e| format!("Close error: {e}"))?;
    Ok(())
}

// ── Remote → Remote transfer ──────────────────────────────────────────────────

/// Transfer a single file between two remote SFTP sessions (streaming, never buffers whole file).
#[tauri::command]
pub async fn sftp_transfer(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    src_sftp_id: String,
    src_path: String,
    dst_sftp_id: String,
    dst_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let src_session = get_session(&sftp_state, &src_sftp_id).await?;
    let dst_session = get_session(&sftp_state, &dst_sftp_id).await?;
    let token = sftp_state.register_transfer(&transfer_id).await;

    let result = sftp_rr_file_inner(
        &app,
        src_session,
        &src_path,
        dst_session,
        &dst_path,
        &transfer_id,
        &token,
    )
    .await;
    sftp_state.finish_transfer(&transfer_id).await;
    result
}

/// Stream one file from src SFTP to dst SFTP.  Returns error on failure or cancellation.
pub(super) async fn sftp_rr_file_inner(
    app: &AppHandle,
    src_session: Arc<Mutex<SftpSession>>,
    src_path: &str,
    dst_session: Arc<Mutex<SftpSession>>,
    dst_path: &str,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let mut transferred = 0u64;
    let (total, _) = {
        let sftp = src_session.lock().await;
        let size = sftp
            .metadata(src_path)
            .await
            .ok()
            .and_then(|m| m.size)
            .unwrap_or(0);
        (size, ())
    };
    sftp_rr_file_inner_accum(
        app,
        src_session,
        src_path,
        dst_session,
        dst_path,
        transfer_id,
        token,
        &mut transferred,
        total,
    )
    .await
}

/// Inner streaming helper that accumulates `transferred` into a caller-owned counter.
pub(super) async fn sftp_rr_file_inner_accum(
    app: &AppHandle,
    src_session: Arc<Mutex<SftpSession>>,
    src_path: &str,
    dst_session: Arc<Mutex<SftpSession>>,
    dst_path: &str,
    transfer_id: &str,
    token: &CancellationToken,
    transferred: &mut u64,
    total: u64,
) -> Result<(), String> {
    let mut src_file = {
        let sftp = src_session.lock().await;
        sftp.open(src_path)
            .await
            .map_err(|e| format!("Cannot open source {src_path}: {e}"))?
    };
    let mut dst_file = {
        let sftp = dst_session.lock().await;
        sftp.open_with_flags(
            dst_path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| format!("Cannot create destination {dst_path}: {e}"))?
    };

    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        if token.is_cancelled() {
            return Err("Transfer cancelled".into());
        }
        let n = src_file
            .read(&mut buf)
            .await
            .map_err(|e| format!("Read error: {e}"))?;
        if n == 0 {
            break;
        }
        dst_file
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
    dst_file
        .shutdown()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;
    // Close the source read handle too; otherwise russh-sftp's client-side
    // handle counter leaks on the source session across many files.
    src_file
        .shutdown()
        .await
        .map_err(|e| format!("Close error: {e}"))?;
    Ok(())
}
