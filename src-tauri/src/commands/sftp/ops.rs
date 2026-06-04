use super::{get_backend, RemoteFile};
use crate::known_hosts::KnownHostsStore;
use crate::sftp::{SftpBackend, SftpManager};
use crate::ssh::client::JumpHostConnect;
use crate::ssh::session::SessionManager;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

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
        )
        .await
}

#[tauri::command]
pub async fn sftp_open(
    ssh_state: State<'_, SessionManager>,
    sftp_state: State<'_, SftpManager>,
    session_id: String,
) -> Result<String, String> {
    let handle = ssh_state.get_handle(&session_id).await?;
    sftp_state.open(handle).await
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
    let session = match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => return d.stat(&path).await,
        SftpBackend::Real(s) => s,
    };
    let sftp = session.lock().await;
    match sftp.metadata(&path).await {
        Ok(meta) => Ok(Some(meta.is_dir())),
        Err(_) => Ok(None),
    }
}

// ── File browser ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_list_dir(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<Vec<RemoteFile>, String> {
    let session = match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => return d.list_dir(&path).await,
        SftpBackend::Real(s) => s,
    };
    let sftp = session.lock().await;
    let entries = sftp
        .read_dir(&path)
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

#[tauri::command]
pub async fn sftp_canonicalize(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<String, String> {
    let session = match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => return d.canonicalize(&path).await,
        SftpBackend::Real(s) => s,
    };
    let sftp = session.lock().await;
    sftp.canonicalize(&path)
        .await
        .map_err(|e| format!("canonicalize failed: {e}"))
}

#[tauri::command]
pub async fn sftp_mkdir(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let session = match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => return d.mkdir(&path).await,
        SftpBackend::Real(s) => s,
    };
    let sftp = session.lock().await;
    sftp.create_dir(&path)
        .await
        .map_err(|e| format!("mkdir failed: {e}"))
}

#[tauri::command]
pub async fn sftp_touch(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let session = match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => return d.touch(&path).await,
        SftpBackend::Real(s) => s,
    };
    let sftp = session.lock().await;
    // Open with create + write flags to create an empty file if it doesn't exist
    let flags = OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
    sftp.open_with_flags(&path, flags)
        .await
        .map(|_| ())
        .map_err(|e| format!("touch failed: {e}"))
}

#[tauri::command]
pub async fn sftp_rename(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let session = match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => return d.rename(&from, &to).await,
        SftpBackend::Real(s) => s,
    };
    let sftp = session.lock().await;
    sftp.rename(&from, &to)
        .await
        .map_err(|e| format!("rename failed: {e}"))
}

#[tauri::command]
pub async fn sftp_delete(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let session = match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => return d.delete(&path).await,
        SftpBackend::Real(s) => s,
    };
    sftp_remove_recursive(session, path).await
}

fn sftp_remove_recursive(
    session: Arc<Mutex<SftpSession>>,
    path: String,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> {
    Box::pin(async move {
        let is_dir = {
            let sftp = session.lock().await;
            // Use symlink_metadata so symlinks to directories are deleted as files.
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
                sftp_remove_recursive(Arc::clone(&session), child).await?;
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
