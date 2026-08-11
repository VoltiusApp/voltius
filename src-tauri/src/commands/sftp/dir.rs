use super::{
    backend_transfer_command, get_session, open_remote_read, open_remote_write, pump_chunks,
    sftp_rr_file_inner_accum,
};
use crate::sftp::SftpManager;
use russh_sftp::client::SftpSession;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// `(absolute_path, relative_path, size_bytes)` for a remote file.
type RemoteEntry = (String, String, u64);

/// Boxed, `Send` future with a borrowed lifetime. Needed by the recursive
/// directory-walk helpers below — recursion through `async fn` requires boxing.
type DirWalkFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

// ── Directory transfer ────────────────────────────────────────────────────────

backend_transfer_command!(sftp_upload_dir, upload_dir, local_path, remote_path);

/// Recursively upload a local directory over a real SFTP session.
pub(crate) async fn sftp_upload_dir_inner(
    app: &AppHandle,
    session: Arc<Mutex<SftpSession>>,
    local_path: &str,
    remote_path: &str,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let local_base = PathBuf::from(local_path);

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
        let _ = sftp.create_dir(remote_path).await; // ignore if exists
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

        let mut remote_file = open_remote_write(&session, &remote_file_path).await?;

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
    }
    Ok(())
}

backend_transfer_command!(sftp_download_dir, download_dir, remote_path, local_path);

/// Recursively download a remote directory over a real SFTP session.
pub(crate) async fn sftp_download_dir_inner(
    app: &AppHandle,
    session: Arc<Mutex<SftpSession>>,
    remote_path: &str,
    local_path: &str,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    // Collect remote files recursively
    let remote_entries: Vec<(String, String, u64)> = {
        let sftp = session.lock().await;
        collect_remote_entries(&sftp, remote_path, remote_path).await?
    };

    let total: u64 = remote_entries.iter().map(|(_, _, size)| size).sum();
    let local_base = PathBuf::from(local_path);

    let mut transferred = 0u64;
    for (remote_abs, rel, _) in &remote_entries {
        let local_abs = local_base.join(rel);
        if let Some(parent) = local_abs.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Cannot create directory: {e}"))?;
        }

        let (_, mut remote_file) = open_remote_read(&session, remote_abs).await?;

        let mut local_file = tokio::fs::File::create(&local_abs)
            .await
            .map_err(|e| format!("Cannot create local file: {e}"))?;

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
        // Properly close the remote handle. `File`'s `Drop` uses a fire-and-forget
        // close that never decrements russh-sftp's client-side open-handle counter,
        // so dropping thousands of files (e.g. node_modules) hits "handle limit reached".
        remote_file
            .shutdown()
            .await
            .map_err(|e| format!("Close error: {e}"))?;
    }
    Ok(())
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
) -> DirWalkFuture<'a, Vec<RemoteEntry>> {
    Box::pin(async move {
        let (_, files) = collect_remote_structure(sftp, base, current).await?;
        Ok(files)
    })
}

/// Walk a remote tree, returning its relative directory paths (for pre-creating
/// dirs) and every file as `(absolute, relative, size)`.
fn collect_remote_structure<'a>(
    sftp: &'a SftpSession,
    base: &'a str,
    current: &'a str,
) -> DirWalkFuture<'a, (Vec<String>, Vec<RemoteEntry>)> {
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
