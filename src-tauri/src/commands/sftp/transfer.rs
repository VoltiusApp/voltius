use super::resume::copy_one;
use super::{backend_transfer_command, get_sftp_fs, with_transfer};
use crate::error::AppError;
use crate::sftp::SftpManager;
use tauri::{AppHandle, State};

// ── Single file transfer ──────────────────────────────────────────────────────

backend_transfer_command!(sftp_upload, upload_file, local_path, remote_path);

backend_transfer_command!(sftp_download, download_file, remote_path, local_path);

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
) -> Result<(), AppError> {
    let src = get_sftp_fs(&sftp_state, &src_sftp_id).await?;
    let dst = get_sftp_fs(&sftp_state, &dst_sftp_id).await?;
    with_transfer(&sftp_state, &transfer_id.clone(), |token| async move {
        copy_one(&app, &src, &src_path, &dst, &dst_path, &transfer_id, &token).await
    })
    .await
}
