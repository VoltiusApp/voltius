use crate::known_hosts::KnownHostsStore;
use crate::sftp::{SftpBackend, SftpManager};
use crate::ssh::client::JumpHostConnect;
use crate::ssh::session::SessionManager;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const CHUNK_SIZE: usize = 256 * 1024; // 256 KB

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

fn get_session<'a>(
    manager: &'a SftpManager,
    sftp_id: &'a str,
) -> impl std::future::Future<Output = Result<Arc<Mutex<SftpSession>>, String>> + 'a {
    async move {
        manager
            .get(sftp_id)
            .await
            .ok_or_else(|| format!("SFTP session '{}' not found", sftp_id))
    }
}

async fn get_backend(manager: &SftpManager, sftp_id: &str) -> Result<SftpBackend, String> {
    manager
        .backend(sftp_id)
        .await
        .ok_or_else(|| format!("SFTP session '{}' not found", sftp_id))
}

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

async fn sftp_upload_inner(
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

async fn sftp_download_inner(
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
    Ok(())
}

// ── Directory transfer ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_upload_dir(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let token = sftp_state.register_transfer(&transfer_id).await;
    let session = match get_backend(&sftp_state, &sftp_id).await {
        Ok(SftpBackend::Docker(d)) => {
            let r = d
                .upload_dir(&app, &local_path, &remote_path, &transfer_id, &token)
                .await;
            sftp_state.finish_transfer(&transfer_id).await;
            return r;
        }
        Ok(SftpBackend::Real(s)) => s,
        Err(e) => {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err(e);
        }
    };
    let local_base = PathBuf::from(&local_path);

    // Collect all files and their sizes
    let (dirs, files) = collect_local_entries(&local_base)?;

    // Calculate total size
    let total: u64 = files
        .iter()
        .map(|rel| {
            local_base
                .join(rel)
                .metadata()
                .map(|m| m.len())
                .unwrap_or(0)
        })
        .sum();

    // Create remote directory structure
    {
        let sftp = session.lock().await;
        let _ = sftp.create_dir(&remote_path).await; // ignore if exists
        for dir_rel in &dirs {
            let remote_dir = format!(
                "{}/{}",
                remote_path.trim_end_matches('/'),
                dir_rel.to_string_lossy().replace('\\', "/")
            );
            let _ = sftp.create_dir(&remote_dir).await;
        }
    }

    // Upload files
    let mut transferred = 0u64;
    for file_rel in &files {
        if token.is_cancelled() {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err("Transfer cancelled".into());
        }
        let local_abs = local_base.join(file_rel);
        let remote_file_path = format!(
            "{}/{}",
            remote_path.trim_end_matches('/'),
            file_rel.to_string_lossy().replace('\\', "/")
        );

        let mut local_file = tokio::fs::File::open(&local_abs)
            .await
            .map_err(|e| format!("Cannot open {}: {e}", local_abs.display()))?;

        let mut remote_file = {
            let sftp = session.lock().await;
            sftp.open_with_flags(
                &remote_file_path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| format!("Cannot create remote file {remote_file_path}: {e}"))?
        };

        let mut buf = vec![0u8; CHUNK_SIZE];
        loop {
            if token.is_cancelled() {
                sftp_state.finish_transfer(&transfer_id).await;
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
    }
    sftp_state.finish_transfer(&transfer_id).await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_download_dir(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let token = sftp_state.register_transfer(&transfer_id).await;
    let session = match get_backend(&sftp_state, &sftp_id).await {
        Ok(SftpBackend::Docker(d)) => {
            let r = d
                .download_dir(&app, &remote_path, &local_path, &transfer_id, &token)
                .await;
            sftp_state.finish_transfer(&transfer_id).await;
            return r;
        }
        Ok(SftpBackend::Real(s)) => s,
        Err(e) => {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err(e);
        }
    };

    // Collect remote files recursively
    let remote_entries: Vec<(String, String, u64)> = {
        let sftp = session.lock().await;
        collect_remote_entries(&sftp, &remote_path, &remote_path).await?
    };

    let total: u64 = remote_entries.iter().map(|(_, _, size)| size).sum();
    let local_base = PathBuf::from(&local_path);

    let mut transferred = 0u64;
    for (remote_abs, rel, _) in &remote_entries {
        let local_abs = local_base.join(rel);
        if let Some(parent) = local_abs.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Cannot create directory: {e}"))?;
        }

        let (_, mut remote_file) = {
            let sftp = session.lock().await;
            let meta = sftp.metadata(remote_abs).await.ok();
            let size = meta.and_then(|m| m.size).unwrap_or(0);
            let file = sftp
                .open(remote_abs)
                .await
                .map_err(|e| format!("Cannot open remote file {remote_abs}: {e}"))?;
            (size, file)
        };

        let mut local_file = tokio::fs::File::create(&local_abs)
            .await
            .map_err(|e| format!("Cannot create local file: {e}"))?;

        let mut buf = vec![0u8; CHUNK_SIZE];
        loop {
            if token.is_cancelled() {
                sftp_state.finish_transfer(&transfer_id).await;
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
    }
    sftp_state.finish_transfer(&transfer_id).await;
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn collect_local_entries(base: &Path) -> Result<(Vec<PathBuf>, Vec<PathBuf>), String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    collect_local_recursive(base, base, &mut dirs, &mut files)?;
    Ok((dirs, files))
}

fn collect_local_recursive(
    base: &Path,
    current: &Path,
    dirs: &mut Vec<PathBuf>,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(current)
        .map_err(|e| format!("Cannot read dir {}: {e}", current.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let rel = path
            .strip_prefix(base)
            .map_err(|e| e.to_string())?
            .to_path_buf();
        if path.is_dir() {
            dirs.push(rel);
            collect_local_recursive(base, &path, dirs, files)?;
        } else {
            files.push(rel);
        }
    }
    Ok(())
}

fn collect_remote_entries<'a>(
    sftp: &'a SftpSession,
    base: &'a str,
    current: &'a str,
) -> Pin<
    Box<dyn std::future::Future<Output = Result<Vec<(String, String, u64)>, String>> + Send + 'a>,
> {
    Box::pin(async move {
        let mut result = Vec::new();
        let entries = sftp
            .read_dir(current)
            .await
            .map_err(|e| format!("read_dir failed for {current}: {e}"))?;
        let cur = current.trim_end_matches('/');
        for entry in entries {
            let meta = entry.metadata();
            let name = entry.file_name();
            let abs = format!("{}/{}", cur, name);
            let rel = abs
                .strip_prefix(base)
                .unwrap_or(&abs)
                .trim_start_matches('/')
                .to_string();
            // Skip symlinks to avoid infinite loops
            if meta.is_symlink() {
                continue;
            }
            if meta.is_dir() {
                let mut children = collect_remote_entries(sftp, base, &abs).await?;
                result.append(&mut children);
            } else {
                result.push((abs, rel, meta.size.unwrap_or(0)));
            }
        }
        Ok(result)
    })
}

/// Like `collect_remote_entries` but also returns relative directory paths (for pre-creating dirs).
fn collect_remote_structure<'a>(
    sftp: &'a SftpSession,
    base: &'a str,
    current: &'a str,
) -> Pin<
    Box<
        dyn std::future::Future<Output = Result<(Vec<String>, Vec<(String, String, u64)>), String>>
            + Send
            + 'a,
    >,
> {
    Box::pin(async move {
        let mut dirs: Vec<String> = Vec::new();
        let mut files: Vec<(String, String, u64)> = Vec::new();
        let entries = sftp
            .read_dir(current)
            .await
            .map_err(|e| format!("read_dir failed for {current}: {e}"))?;
        let cur = current.trim_end_matches('/');
        for entry in entries {
            let meta = entry.metadata();
            let name = entry.file_name();
            let abs = format!("{}/{}", cur, name);
            let rel = abs
                .strip_prefix(base)
                .unwrap_or(&abs)
                .trim_start_matches('/')
                .to_string();
            if meta.is_symlink() {
                continue;
            }
            if meta.is_dir() {
                dirs.push(rel);
                let (mut child_dirs, mut child_files) =
                    collect_remote_structure(sftp, base, &abs).await?;
                dirs.append(&mut child_dirs);
                files.append(&mut child_files);
            } else {
                files.push((abs, rel, meta.size.unwrap_or(0)));
            }
        }
        Ok((dirs, files))
    })
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

/// Transfer a directory recursively between two remote SFTP sessions.
#[tauri::command]
pub async fn sftp_transfer_dir(
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

    // Collect structure from source (dirs + files with sizes)
    let (dirs, files): (Vec<String>, Vec<(String, String, u64)>) = {
        let sftp = src_session.lock().await;
        collect_remote_structure(&sftp, &src_path, &src_path).await?
    };

    let total: u64 = files.iter().map(|(_, _, size)| size).sum();

    // Pre-create destination directory structure
    {
        let sftp = dst_session.lock().await;
        let _ = sftp.create_dir(&dst_path).await; // ignore if already exists
        for dir_rel in &dirs {
            let dst_dir = format!("{}/{}", dst_path.trim_end_matches('/'), dir_rel);
            let _ = sftp.create_dir(&dst_dir).await;
        }
    }

    // Stream files one by one
    let mut transferred = 0u64;
    for (src_abs, rel, _) in &files {
        if token.is_cancelled() {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err("Transfer cancelled".into());
        }
        let dst_abs = format!("{}/{}", dst_path.trim_end_matches('/'), rel);
        let file_total = total; // keep cumulative total for progress bar
        let result = sftp_rr_file_inner_accum(
            &app,
            Arc::clone(&src_session),
            src_abs,
            Arc::clone(&dst_session),
            &dst_abs,
            &transfer_id,
            &token,
            &mut transferred,
            file_total,
        )
        .await;
        if let Err(e) = result {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err(e);
        }
    }
    sftp_state.finish_transfer(&transfer_id).await;
    Ok(())
}

/// Stream one file from src SFTP to dst SFTP.  Returns error on failure or cancellation.
async fn sftp_rr_file_inner(
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
async fn sftp_rr_file_inner_accum(
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
    Ok(())
}

// ── Compress / Extract ────────────────────────────────────────────────────────

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Compress a remote file or directory into a .tar.gz archive via SSH exec.
#[tauri::command]
pub async fn sftp_compress(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    source_path: String,
    archive_path: String,
) -> Result<(), String> {
    // tar -czf archive -C parent basename  (avoids leading path components)
    let parent = source_path
        .rfind('/')
        .map(|i| &source_path[..i])
        .unwrap_or(".");
    let basename = source_path
        .rfind('/')
        .map(|i| &source_path[i + 1..])
        .unwrap_or(&source_path);
    let cmd = format!(
        "tar -czf {} -C {} {} 2>&1; echo __TF_EXIT__:$?",
        shell_quote(&archive_path),
        shell_quote(parent),
        shell_quote(basename),
    );
    sftp_state.exec_command(&sftp_id, &cmd).await
}

/// Extract a remote .tar.gz archive into a destination directory via SSH exec.
#[tauri::command]
pub async fn sftp_extract(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    archive_path: String,
    dest_dir: String,
) -> Result<(), String> {
    let cmd = format!(
        "mkdir -p {} && tar -xzf {} -C {} 2>&1; echo __TF_EXIT__:$?",
        shell_quote(&dest_dir),
        shell_quote(&archive_path),
        shell_quote(&dest_dir),
    );
    sftp_state.exec_command(&sftp_id, &cmd).await
}

// ── Tar-based directory transfer ──────────────────────────────────────────────

fn temp_archive_name(transfer_id: &str) -> String {
    format!("tf_{}.tar.gz", transfer_id)
}

/// Upload multiple local files/directories as a single tar.gz batch.
#[tauri::command]
pub async fn sftp_upload_batch_tar(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    local_paths: Vec<String>,
    remote_dir: String,
    transfer_id: String,
) -> Result<(), String> {
    if local_paths.is_empty() {
        return Ok(());
    }
    let token = sftp_state.register_transfer(&transfer_id).await;
    let session = match get_backend(&sftp_state, &sftp_id).await {
        Ok(SftpBackend::Docker(d)) => {
            let r = d
                .upload_batch(&app, &local_paths, &remote_dir, &transfer_id, &token)
                .await;
            sftp_state.finish_transfer(&transfer_id).await;
            return r;
        }
        Ok(SftpBackend::Real(s)) => s,
        Err(e) => {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err(e);
        }
    };

    let result = async {
        let archive_name = temp_archive_name(&transfer_id);
        let tmp_local = std::env::temp_dir().join(&archive_name);
        let tmp_remote = format!("/tmp/{}", archive_name);

        // All paths share the same parent (same source directory in the UI)
        let parent = Path::new(&local_paths[0]).parent().and_then(|p| p.to_str()).unwrap_or(".");

        // 1. Archive all items locally
        let mut cmd = tokio::process::Command::new("tar");
        cmd.args(["-czf", tmp_local.to_str().unwrap_or(""), "-C", parent]);
        for p in &local_paths {
            if let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) {
                cmd.arg(name);
            }
        }
        crate::commands::win_proc::prevent_visible_child_window(&mut cmd);
        let tar_out = cmd.output().await.map_err(|e| format!("tar not found: {e}"))?;
        if !tar_out.status.success() {
            return Err(String::from_utf8_lossy(&tar_out.stderr).trim().to_string());
        }

        if token.is_cancelled() {
            let _ = tokio::fs::remove_file(&tmp_local).await;
            return Err("Transfer cancelled".into());
        }

        // 2. Upload archive
        let upload_result = sftp_upload_inner(
            &app, Arc::clone(&session),
            tmp_local.to_str().unwrap_or(""), &tmp_remote,
            &transfer_id, &token,
        ).await;
        let _ = tokio::fs::remove_file(&tmp_local).await;
        upload_result?;

        // 3. Extract on remote (no --strip-components: items land directly in remote_dir)
        let cmd = format!(
            "mkdir -p {dir} && tar -xzf {arch} -C {dir} 2>&1; RC=$?; rm -f {arch}; echo __TF_EXIT__:$RC",
            dir  = shell_quote(&remote_dir),
            arch = shell_quote(&tmp_remote),
        );
        sftp_state.exec_command(&sftp_id, &cmd).await
    }.await;

    sftp_state.finish_transfer(&transfer_id).await;
    result
}

/// Download multiple remote files/directories as a single tar.gz batch.
#[tauri::command]
pub async fn sftp_download_batch_tar(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    remote_paths: Vec<String>,
    local_dir: String,
    transfer_id: String,
) -> Result<(), String> {
    if remote_paths.is_empty() {
        return Ok(());
    }
    let token = sftp_state.register_transfer(&transfer_id).await;
    let session = match get_backend(&sftp_state, &sftp_id).await {
        Ok(SftpBackend::Docker(d)) => {
            let r = d
                .download_batch(&app, &remote_paths, &local_dir, &transfer_id, &token)
                .await;
            sftp_state.finish_transfer(&transfer_id).await;
            return r;
        }
        Ok(SftpBackend::Real(s)) => s,
        Err(e) => {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err(e);
        }
    };

    let result = async {
        let archive_name = temp_archive_name(&transfer_id);
        let tmp_local = std::env::temp_dir().join(&archive_name);
        let tmp_remote = format!("/tmp/{}", archive_name);

        let remote_parent = remote_paths[0]
            .rfind('/')
            .map(|i| &remote_paths[0][..i])
            .unwrap_or(".");
        let basenames: Vec<String> = remote_paths
            .iter()
            .filter_map(|p| p.rfind('/').map(|i| p[i + 1..].to_string()))
            .collect();

        // 1. Archive all items on remote
        let items_quoted: Vec<String> = basenames.iter().map(|b| shell_quote(b)).collect();
        let cmd = format!(
            "tar -czf {arch} -C {parent} {items} 2>&1; echo __TF_EXIT__:$?",
            arch = shell_quote(&tmp_remote),
            parent = shell_quote(remote_parent),
            items = items_quoted.join(" "),
        );
        sftp_state.exec_command(&sftp_id, &cmd).await?;

        if token.is_cancelled() {
            let _ = sftp_state
                .exec_command(&sftp_id, &format!("rm -f {}", shell_quote(&tmp_remote)))
                .await;
            return Err("Transfer cancelled".into());
        }

        // 2. Download archive
        let download_result = sftp_download_inner(
            &app,
            Arc::clone(&session),
            &tmp_remote,
            tmp_local.to_str().unwrap_or(""),
            &transfer_id,
            &token,
        )
        .await;
        let _ = sftp_state
            .exec_command(&sftp_id, &format!("rm -f {}", shell_quote(&tmp_remote)))
            .await;
        download_result?;

        // 3. Extract locally
        tokio::fs::create_dir_all(&local_dir)
            .await
            .map_err(|e| format!("Cannot create local dir: {e}"))?;
        let mut extract_cmd = tokio::process::Command::new("tar");
        extract_cmd.args(["-xzf", tmp_local.to_str().unwrap_or(""), "-C", &local_dir]);
        crate::commands::win_proc::prevent_visible_child_window(&mut extract_cmd);
        let extract_out = extract_cmd
            .output()
            .await
            .map_err(|e| format!("tar not found: {e}"))?;
        let _ = tokio::fs::remove_file(&tmp_local).await;
        if !extract_out.status.success() {
            return Err(String::from_utf8_lossy(&extract_out.stderr)
                .trim()
                .to_string());
        }

        Ok(())
    }
    .await;

    sftp_state.finish_transfer(&transfer_id).await;
    result
}

/// Transfer multiple files/directories between two remote hosts as a single tar.gz batch.
#[tauri::command]
pub async fn sftp_transfer_batch_tar(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    src_sftp_id: String,
    src_paths: Vec<String>,
    dst_sftp_id: String,
    dst_dir: String,
    transfer_id: String,
) -> Result<(), String> {
    if src_paths.is_empty() {
        return Ok(());
    }
    let src_session = get_session(&sftp_state, &src_sftp_id).await?;
    let dst_session = get_session(&sftp_state, &dst_sftp_id).await?;
    let token = sftp_state.register_transfer(&transfer_id).await;

    let result = async {
        let archive_name = temp_archive_name(&transfer_id);
        let tmp_src = format!("/tmp/{}", archive_name);
        let tmp_dst = format!("/tmp/{}", archive_name);

        let src_parent = src_paths[0].rfind('/').map(|i| &src_paths[0][..i]).unwrap_or(".");
        let basenames: Vec<String> = src_paths.iter()
            .filter_map(|p| p.rfind('/').map(|i| p[i + 1..].to_string()))
            .collect();

        // 1. Archive on source
        let items_quoted: Vec<String> = basenames.iter().map(|b| shell_quote(b)).collect();
        let cmd = format!(
            "tar -czf {arch} -C {parent} {items} 2>&1; echo __TF_EXIT__:$?",
            arch   = shell_quote(&tmp_src),
            parent = shell_quote(src_parent),
            items  = items_quoted.join(" "),
        );
        sftp_state.exec_command(&src_sftp_id, &cmd).await?;

        if token.is_cancelled() {
            let _ = sftp_state.exec_command(&src_sftp_id, &format!("rm -f {}", shell_quote(&tmp_src))).await;
            return Err("Transfer cancelled".into());
        }

        // 2. Stream archive between hosts
        let transfer_result = sftp_rr_file_inner(
            &app,
            Arc::clone(&src_session), &tmp_src,
            Arc::clone(&dst_session), &tmp_dst,
            &transfer_id, &token,
        ).await;
        let _ = sftp_state.exec_command(&src_sftp_id, &format!("rm -f {}", shell_quote(&tmp_src))).await;
        transfer_result?;

        // 3. Extract on destination and clean up
        let cmd = format!(
            "mkdir -p {dir} && tar -xzf {arch} -C {dir} 2>&1; RC=$?; rm -f {arch}; echo __TF_EXIT__:$RC",
            dir  = shell_quote(&dst_dir),
            arch = shell_quote(&tmp_dst),
        );
        sftp_state.exec_command(&dst_sftp_id, &cmd).await
    }.await;

    sftp_state.finish_transfer(&transfer_id).await;
    result
}

/// Upload a local directory as a single tar.gz: archive locally → upload → extract on remote.
#[tauri::command]
pub async fn sftp_upload_dir_tar(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let token = sftp_state.register_transfer(&transfer_id).await;
    let session = match get_backend(&sftp_state, &sftp_id).await {
        Ok(SftpBackend::Docker(d)) => {
            let r = d
                .upload_dir(&app, &local_path, &remote_path, &transfer_id, &token)
                .await;
            sftp_state.finish_transfer(&transfer_id).await;
            return r;
        }
        Ok(SftpBackend::Real(s)) => s,
        Err(e) => {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err(e);
        }
    };

    let result = async {
        let archive_name = temp_archive_name(&transfer_id);
        let tmp_local = std::env::temp_dir().join(&archive_name);
        let tmp_remote = format!("/tmp/{}", archive_name);

        // 1. Archive locally
        let parent = Path::new(&local_path).parent().and_then(|p| p.to_str()).unwrap_or(".");
        let basename = Path::new(&local_path).file_name().and_then(|n| n.to_str()).unwrap_or("");
        let mut tar_cmd = tokio::process::Command::new("tar");
        tar_cmd.args(["-czf", tmp_local.to_str().unwrap_or(""), "-C", parent, basename]);
        crate::commands::win_proc::prevent_visible_child_window(&mut tar_cmd);
        let tar_out = tar_cmd
            .output()
            .await
            .map_err(|e| format!("tar not found: {e}"))?;
        if !tar_out.status.success() {
            return Err(String::from_utf8_lossy(&tar_out.stderr).trim().to_string());
        }

        if token.is_cancelled() {
            let _ = tokio::fs::remove_file(&tmp_local).await;
            return Err("Transfer cancelled".into());
        }

        // 2. Upload archive
        let upload_result = sftp_upload_inner(
            &app, Arc::clone(&session),
            tmp_local.to_str().unwrap_or(""), &tmp_remote,
            &transfer_id, &token,
        ).await;
        let _ = tokio::fs::remove_file(&tmp_local).await;
        upload_result?;

        // 3. Extract on remote and clean up remote temp
        let cmd = format!(
            "mkdir -p {dest} && tar -xzf {arch} --strip-components=1 -C {dest} 2>&1; RC=$?; rm -f {arch}; echo __TF_EXIT__:$RC",
            dest = shell_quote(&remote_path),
            arch = shell_quote(&tmp_remote),
        );
        sftp_state.exec_command(&sftp_id, &cmd).await
    }.await;

    sftp_state.finish_transfer(&transfer_id).await;
    result
}

/// Download a remote directory as a single tar.gz: archive on remote → download → extract locally.
#[tauri::command]
pub async fn sftp_download_dir_tar(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let token = sftp_state.register_transfer(&transfer_id).await;
    let session = match get_backend(&sftp_state, &sftp_id).await {
        Ok(SftpBackend::Docker(d)) => {
            let r = d
                .download_dir(&app, &remote_path, &local_path, &transfer_id, &token)
                .await;
            sftp_state.finish_transfer(&transfer_id).await;
            return r;
        }
        Ok(SftpBackend::Real(s)) => s,
        Err(e) => {
            sftp_state.finish_transfer(&transfer_id).await;
            return Err(e);
        }
    };

    let result = async {
        let archive_name = temp_archive_name(&transfer_id);
        let tmp_local = std::env::temp_dir().join(&archive_name);
        let tmp_remote = format!("/tmp/{}", archive_name);

        // 1. Archive on remote
        let remote_parent = remote_path
            .rfind('/')
            .map(|i| &remote_path[..i])
            .unwrap_or(".");
        let remote_basename = remote_path
            .rfind('/')
            .map(|i| &remote_path[i + 1..])
            .unwrap_or(&remote_path);
        let cmd = format!(
            "tar -czf {arch} -C {parent} {base} 2>&1; echo __TF_EXIT__:$?",
            arch = shell_quote(&tmp_remote),
            parent = shell_quote(remote_parent),
            base = shell_quote(remote_basename),
        );
        sftp_state.exec_command(&sftp_id, &cmd).await?;

        if token.is_cancelled() {
            let _ = sftp_state
                .exec_command(&sftp_id, &format!("rm -f {}", shell_quote(&tmp_remote)))
                .await;
            return Err("Transfer cancelled".into());
        }

        // 2. Download archive
        let download_result = sftp_download_inner(
            &app,
            Arc::clone(&session),
            &tmp_remote,
            tmp_local.to_str().unwrap_or(""),
            &transfer_id,
            &token,
        )
        .await;
        // Clean up remote temp regardless of download result
        let _ = sftp_state
            .exec_command(&sftp_id, &format!("rm -f {}", shell_quote(&tmp_remote)))
            .await;
        download_result?;

        // 3. Extract locally
        tokio::fs::create_dir_all(&local_path)
            .await
            .map_err(|e| format!("Cannot create local dir: {e}"))?;
        let mut extract_cmd = tokio::process::Command::new("tar");
        extract_cmd.args([
            "-xzf",
            tmp_local.to_str().unwrap_or(""),
            "--strip-components=1",
            "-C",
            &local_path,
        ]);
        crate::commands::win_proc::prevent_visible_child_window(&mut extract_cmd);
        let extract_out = extract_cmd
            .output()
            .await
            .map_err(|e| format!("tar not found: {e}"))?;
        let _ = tokio::fs::remove_file(&tmp_local).await;
        if !extract_out.status.success() {
            return Err(String::from_utf8_lossy(&extract_out.stderr)
                .trim()
                .to_string());
        }

        Ok(())
    }
    .await;

    sftp_state.finish_transfer(&transfer_id).await;
    result
}

/// Transfer a directory between two remote hosts as a single tar.gz:
/// archive on source → transfer → extract on destination.
#[tauri::command]
pub async fn sftp_transfer_dir_tar(
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

    let result = async {
        let archive_name = temp_archive_name(&transfer_id);
        let tmp_src = format!("/tmp/{}", archive_name);
        let tmp_dst = format!("/tmp/{}", archive_name);

        // 1. Archive on source
        let src_parent = src_path.rfind('/').map(|i| &src_path[..i]).unwrap_or(".");
        let src_basename = src_path.rfind('/').map(|i| &src_path[i + 1..]).unwrap_or(&src_path);
        let cmd = format!(
            "tar -czf {arch} -C {parent} {base} 2>&1; echo __TF_EXIT__:$?",
            arch = shell_quote(&tmp_src),
            parent = shell_quote(src_parent),
            base = shell_quote(src_basename),
        );
        sftp_state.exec_command(&src_sftp_id, &cmd).await?;

        if token.is_cancelled() {
            let _ = sftp_state.exec_command(&src_sftp_id, &format!("rm -f {}", shell_quote(&tmp_src))).await;
            return Err("Transfer cancelled".into());
        }

        // 2. Transfer the archive between hosts
        let transfer_result = sftp_rr_file_inner(
            &app,
            Arc::clone(&src_session), &tmp_src,
            Arc::clone(&dst_session), &tmp_dst,
            &transfer_id, &token,
        ).await;
        // Clean up source temp regardless
        let _ = sftp_state.exec_command(&src_sftp_id, &format!("rm -f {}", shell_quote(&tmp_src))).await;
        transfer_result?;

        // 3. Extract on destination and clean up
        let cmd = format!(
            "mkdir -p {dest} && tar -xzf {arch} --strip-components=1 -C {dest} 2>&1; RC=$?; rm -f {arch}; echo __TF_EXIT__:$RC",
            dest = shell_quote(&dst_path),
            arch = shell_quote(&tmp_dst),
        );
        sftp_state.exec_command(&dst_sftp_id, &cmd).await
    }.await;

    sftp_state.finish_transfer(&transfer_id).await;
    result
}
