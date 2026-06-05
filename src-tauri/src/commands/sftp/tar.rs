use super::{
    get_backend, get_session, shell_quote, temp_archive_name, transfer::sftp_download_inner,
    transfer::sftp_rr_file_inner, transfer::sftp_upload_inner,
};
use crate::sftp::{SftpBackend, SftpManager};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};

// Windows tar can't recreate POSIX symlinks: dereference them when extracting locally.
#[cfg(windows)]
const WIN_DEREF: &str = "-h --ignore-failed-read ";
#[cfg(not(windows))]
const WIN_DEREF: &str = "";

// ── Compress / Extract ────────────────────────────────────────────────────────

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
            "tar -czf {arch} {deref}-C {parent} {items} 2>&1; echo __TF_EXIT__:$?",
            arch = shell_quote(&tmp_remote),
            deref = WIN_DEREF,
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
            "tar -czf {arch} {deref}-C {parent} {base} 2>&1; echo __TF_EXIT__:$?",
            arch = shell_quote(&tmp_remote),
            deref = WIN_DEREF,
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
