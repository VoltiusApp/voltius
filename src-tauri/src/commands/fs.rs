use crate::commands::sftp::TransferProgress;
use crate::sftp::SftpManager;
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

const COPY_CHUNK_SIZE: usize = 256 * 1024;

fn resolve_home_path(path: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let resolved = if let Some(rel) = path.strip_prefix("~/") {
        home.join(rel)
    } else if std::path::Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        home.join(path)
    };
    // Security: keep within home dir.
    // On Windows, canonicalize() returns UNC paths (\\?\C:\...) while home_dir()
    // returns a plain path (C:\...), so we must canonicalize both before comparing.
    let canonical = resolved
        .canonicalize()
        .map_err(|e| format!("Path error: {e}"))?;
    let home_canonical = home.canonicalize().unwrap_or(home);
    if !canonical.starts_with(&home_canonical) {
        return Err("Path must be within the home directory".into());
    }
    Ok(canonical)
}

#[derive(Serialize)]
pub struct LocalFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified: Option<u64>,
}

#[tauri::command]
pub fn fs_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Cannot determine home directory".into())
}

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<LocalFile>, String> {
    // The bare WSL server root can't be read_dir'd; list distros as folders instead.
    if let Some(prefix) = crate::commands::wsl::root_prefix(&path) {
        return Ok(crate::commands::wsl::list_distros()
            .into_iter()
            .map(|distro| LocalFile {
                path: format!("{prefix}\\{distro}"),
                name: distro,
                size: 0,
                is_dir: true,
                modified: None,
            })
            .collect());
    }

    let p = PathBuf::from(&path);
    let entries = std::fs::read_dir(&p).map_err(|e| format!("Cannot read directory: {e}"))?;
    let mut files: Vec<LocalFile> = entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let meta = e.metadata().ok();
            let name = e.file_name().to_string_lossy().into_owned();
            let entry_path = e.path().to_string_lossy().into_owned();
            LocalFile {
                name,
                path: entry_path,
                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                modified: meta
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs()),
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
pub fn fs_read_text_home(path: String) -> Result<String, String> {
    let p = resolve_home_path(&path)?;
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_text_home(path: String, content: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let resolved = if let Some(rel) = path.strip_prefix("~/") {
        home.join(rel)
    } else {
        home.join(&path)
    };
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Security check after ensuring parent exists.
    // Canonicalize both sides to handle Windows UNC paths (\\?\C:\...).
    let canonical_dir = resolved
        .parent()
        .ok_or("Cannot determine parent directory")?
        .canonicalize()
        .map_err(|e| format!("Path error: {e}"))?;
    let home_canonical = home.canonicalize().unwrap_or(home);
    if !canonical_dir.starts_with(&home_canonical) {
        return Err("Path must be within the home directory".into());
    }
    std::fs::write(resolved, content).map_err(|e| e.to_string())
}

/// Returns Some(is_dir) if path exists, None if it doesn't.
#[tauri::command]
pub fn fs_stat(path: String) -> Result<Option<bool>, String> {
    let p = std::path::Path::new(&path);
    match p.metadata() {
        Ok(meta) => Ok(Some(meta.is_dir())),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn fs_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_touch(path: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// Must mirror `copy_recursive`'s traversal so the total matches bytes transferred.
fn copy_total_bytes(src: &Path) -> std::io::Result<u64> {
    let meta = src.symlink_metadata()?;
    if meta.is_dir() {
        let mut total = 0u64;
        for entry in std::fs::read_dir(src)? {
            total += copy_total_bytes(&entry?.path())?;
        }
        Ok(total)
    } else {
        Ok(std::fs::metadata(src).map(|m| m.len()).unwrap_or(0))
    }
}

/// Recursively copy a file or directory on the local filesystem.
#[tauri::command]
pub async fn fs_copy(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    from: String,
    to: String,
    transfer_id: String,
) -> Result<(), String> {
    let token = sftp_state.register_transfer(&transfer_id).await;
    let event = format!("sftp-progress-{}", transfer_id);
    let result = tokio::task::spawn_blocking(move || {
        let src = Path::new(&from);
        let dst = Path::new(&to);
        let total = copy_total_bytes(src).unwrap_or(0);
        let mut transferred = 0u64;
        let emit = |transferred: u64| {
            let _ = app.emit(&event, TransferProgress { transferred, total });
        };
        emit(0);

        fn copy_recursive(
            src: &Path,
            dst: &Path,
            total: u64,
            transferred: &mut u64,
            token: &CancellationToken,
            emit: &dyn Fn(u64),
        ) -> std::io::Result<()> {
            if token.is_cancelled() {
                return Err(std::io::Error::other("Transfer cancelled"));
            }
            let meta = src.symlink_metadata()?;
            if meta.is_dir() {
                std::fs::create_dir_all(dst)?;
                for entry in std::fs::read_dir(src)? {
                    let entry = entry?;
                    copy_recursive(
                        &entry.path(),
                        &dst.join(entry.file_name()),
                        total,
                        transferred,
                        token,
                        emit,
                    )?;
                }
            } else {
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let mut reader = std::fs::File::open(src)?;
                let mut writer = std::fs::File::create(dst)?;
                let mut buf = vec![0u8; COPY_CHUNK_SIZE];
                loop {
                    if token.is_cancelled() {
                        return Err(std::io::Error::other("Transfer cancelled"));
                    }
                    let n = reader.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    writer.write_all(&buf[..n])?;
                    *transferred += n as u64;
                    emit(*transferred);
                }
            }
            Ok(())
        }

        copy_recursive(src, dst, total, &mut transferred, &token, &emit).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    sftp_state.finish_transfer(&transfer_id).await;
    result
}

/// Compress a local file or directory into a .tar.gz archive.
#[tauri::command]
pub async fn fs_compress(source_path: String, archive_path: String) -> Result<(), String> {
    let parent = std::path::Path::new(&source_path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string());
    let basename = std::path::Path::new(&source_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut cmd = tokio::process::Command::new("tar");
    cmd.args(["-czf", &archive_path, "-C", &parent, &basename]);
    crate::commands::win_proc::prevent_visible_child_window(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("tar not found: {e}"))?;
    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr);
        return Err(msg.trim().to_string());
    }
    Ok(())
}

/// Extract a local .tar.gz archive into a destination directory.
#[tauri::command]
pub async fn fs_extract(archive_path: String, dest_dir: String) -> Result<(), String> {
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| format!("Cannot create dest dir: {e}"))?;
    let mut cmd = tokio::process::Command::new("tar");
    cmd.args(["-xzf", &archive_path, "-C", &dest_dir]);
    crate::commands::win_proc::prevent_visible_child_window(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("tar not found: {e}"))?;
    if !output.status.success() {
        let msg = String::from_utf8_lossy(&output.stderr);
        return Err(msg.trim().to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn fs_exists_home(path: String) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let resolved = if let Some(rel) = path.strip_prefix("~/") {
        home.join(rel)
    } else if std::path::Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        home.join(&path)
    };
    Ok(resolved.exists())
}
