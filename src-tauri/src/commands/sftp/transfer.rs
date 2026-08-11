use super::{
    backend_transfer_command, get_session, open_remote_read, open_remote_write, pump_chunks,
    remote_size,
};
use crate::sftp::SftpManager;
use russh_sftp::client::SftpSession;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

// ── Single file transfer ──────────────────────────────────────────────────────

backend_transfer_command!(sftp_upload, upload_file, local_path, remote_path);

pub(crate) async fn sftp_upload_inner(
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

    let mut remote_file = open_remote_write(&session, remote_path).await?;

    let mut transferred = 0u64;
    pump_chunks(
        app,
        &mut local_file,
        &mut remote_file,
        transfer_id,
        token,
        &mut transferred,
        total,
    )
    .await?;
    remote_file
        .shutdown()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;
    Ok(())
}

backend_transfer_command!(sftp_download, download_file, remote_path, local_path);

pub(crate) async fn sftp_download_inner(
    app: &AppHandle,
    session: Arc<Mutex<SftpSession>>,
    remote_path: &str,
    local_path: &str,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let (total, mut remote_file) = open_remote_read(&session, remote_path).await?;

    if let Some(parent) = Path::new(local_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Cannot create local dir: {e}"))?;
    }
    let mut local_file = tokio::fs::File::create(local_path)
        .await
        .map_err(|e| format!("Cannot create local file: {e}"))?;

    let mut transferred = 0u64;
    pump_chunks(
        app,
        &mut remote_file,
        &mut local_file,
        transfer_id,
        token,
        &mut transferred,
        total,
    )
    .await?;
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
    let total = {
        let sftp = src_session.lock().await;
        remote_size(&sftp, src_path).await
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
    let (_, mut src_file) = open_remote_read(&src_session, src_path).await?;
    let mut dst_file = open_remote_write(&dst_session, dst_path).await?;

    pump_chunks(
        app,
        &mut src_file,
        &mut dst_file,
        transfer_id,
        token,
        transferred,
        total,
    )
    .await?;
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
