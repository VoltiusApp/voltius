use super::{get_backend, RemoteFile};
use crate::known_hosts::KnownHostsStore;
use crate::sftp::SftpManager;
use crate::ssh::client::JumpHostConnect;
use crate::ssh::session::SessionManager;
use std::sync::Arc;
use tauri::{AppHandle, State};

// ── Session lifecycle ─────────────────────────────────────────────────────────

/// Cancel an in-progress transfer.
#[tauri::command]
pub async fn sftp_cancel_transfer(
    sftp_state: State<'_, SftpManager>,
    transfer_id: String,
) -> Result<(), String> {
    sftp_state.cancel_transfer(&transfer_id).await;
    Ok(())
}

/// Standalone SFTP connection — no terminal session needed.
#[tauri::command]
pub async fn sftp_connect(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    known_hosts: State<'_, Arc<KnownHostsStore>>,
    connect_id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
    jump_hosts: Option<Vec<JumpHostConnect>>,
    keepalive_interval_secs: u64,
    keepalive_max: usize,
) -> Result<String, String> {
    sftp_state
        .connect(
            &app,
            &connect_id,
            &host,
            port,
            &username,
            password.as_deref(),
            private_key.as_deref(),
            passphrase.as_deref(),
            jump_hosts.unwrap_or_default(),
            Arc::clone(&*known_hosts),
            keepalive_interval_secs,
            keepalive_max,
        )
        .await
}

#[tauri::command]
pub async fn sftp_open(
    ssh_state: State<'_, SessionManager>,
    sftp_state: State<'_, SftpManager>,
    session_id: String,
) -> Result<String, String> {
    let handle = ssh_state.get_session_handle(&session_id).await?;
    sftp_state.open(handle).await
}

/// Standalone FTP / explicit-FTPS connection. Returns an `sftpId` usable with
/// all the `sftp_*` browse/transfer commands.
#[tauri::command]
pub async fn ftp_connect(
    sftp_state: State<'_, SftpManager>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    secure: bool,
) -> Result<String, String> {
    sftp_state
        .connect_ftp(&host, port, &username, password.as_deref(), secure)
        .await
}

#[tauri::command]
pub async fn sftp_close(sftp_state: State<'_, SftpManager>, sftp_id: String) -> Result<(), String> {
    sftp_state.close(&sftp_id).await;
    Ok(())
}

// ── Stat ─────────────────────────────────────────────────────────────────────

/// Returns Some(is_dir) if path exists, None if it doesn't.
#[tauri::command]
pub async fn sftp_stat(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<Option<bool>, String> {
    get_backend(&sftp_state, &sftp_id).await?.stat(&path).await
}

// ── File browser ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_list_dir(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<Vec<RemoteFile>, String> {
    get_backend(&sftp_state, &sftp_id)
        .await?
        .list_dir(&path)
        .await
}

#[tauri::command]
pub async fn sftp_canonicalize(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<String, String> {
    get_backend(&sftp_state, &sftp_id)
        .await?
        .canonicalize(&path)
        .await
}

#[tauri::command]
pub async fn sftp_mkdir(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    get_backend(&sftp_state, &sftp_id).await?.mkdir(&path).await
}

#[tauri::command]
pub async fn sftp_touch(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    get_backend(&sftp_state, &sftp_id).await?.touch(&path).await
}

#[tauri::command]
pub async fn sftp_rename(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    get_backend(&sftp_state, &sftp_id)
        .await?
        .rename(&from, &to)
        .await
}

#[tauri::command]
pub async fn sftp_delete(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    get_backend(&sftp_state, &sftp_id)
        .await?
        .delete(&path)
        .await
}
