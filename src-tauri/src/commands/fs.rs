use crate::commands::sftp::{sort_listing, RemoteFile, TransferProgress};
use crate::commands::wsl;
use crate::error::AppError;
use crate::sftp::attrs::{
    apply_with, owners_with, parse_modes, split_mode, AttrChange, OwnerInfo, MODES_SCRIPT,
};
use crate::sftp::SftpManager;
use crate::ssh::exec::Captured;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
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

#[tauri::command]
pub fn fs_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Cannot determine home directory".into())
}

/// `"C:"` is drive-relative on Windows (the process CWD on that drive), so a
/// bare drive spec must become `"C:\"` before it is read as a directory.
fn drive_root(path: &str) -> Option<String> {
    let b = path.as_bytes();
    (b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':').then(|| format!("{path}\\"))
}

fn normalize_browse_path(path: &str) -> String {
    if cfg!(windows) {
        if let Some(root) = drive_root(path) {
            return root;
        }
    }
    path.to_string()
}

#[cfg(unix)]
fn raw_mode(meta: &std::fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    Some(meta.mode())
}

#[cfg(not(unix))]
fn raw_mode(_meta: &std::fs::Metadata) -> Option<u32> {
    None
}

fn set_raw_mode(f: &mut RemoteFile, raw: u32) {
    let (bits, link) = split_mode(raw);
    f.permissions = Some(bits);
    f.is_symlink = link;
}

fn read_local_dir(path: &str) -> Result<Vec<RemoteFile>, String> {
    let entries = std::fs::read_dir(path).map_err(|e| format!("Cannot read directory: {e}"))?;
    Ok(entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let meta = e.metadata().ok();
            let mut f = RemoteFile {
                name: e.file_name().to_string_lossy().into_owned(),
                path: e.path().to_string_lossy().into_owned(),
                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                is_symlink: false,
                modified: meta
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs()),
                permissions: None,
            };
            if let Some(raw) = meta.as_ref().and_then(raw_mode) {
                set_raw_mode(&mut f, raw);
            }
            f
        })
        .collect())
}

#[tauri::command]
pub async fn fs_list_dir(path: String) -> Result<Vec<RemoteFile>, String> {
    let path = normalize_browse_path(&path);
    // The bare WSL server root can't be read_dir'd; list distros as folders instead.
    if let Some(prefix) = wsl::root_prefix(&path) {
        return Ok(wsl::list_distros()
            .into_iter()
            .map(|distro| RemoteFile {
                path: format!("{prefix}\\{distro}"),
                name: distro,
                size: 0,
                is_dir: true,
                is_symlink: false,
                modified: None,
                permissions: None,
            })
            .collect());
    }

    let wsl_dir = wsl::distro_path(&path);
    let mut files = tokio::task::spawn_blocking(move || read_local_dir(&path))
        .await
        .map_err(|e| e.to_string())??;
    // Windows sees no POSIX mode on WSL files; the distro's own `stat` does.
    if let Some((distro, dir)) = wsl_dir {
        if let Ok(out) = run_sh(Some(&distro), MODES_SCRIPT, vec![dir]).await {
            let modes = parse_modes(&out.stdout_text());
            for f in &mut files {
                if let Some(&raw) = modes.get(&f.name) {
                    set_raw_mode(f, raw);
                }
            }
        }
    }
    sort_listing(&mut files);
    Ok(files)
}

fn sh_command(distro: Option<&str>) -> Result<tokio::process::Command, String> {
    match distro {
        #[cfg(target_os = "windows")]
        Some(d) => Ok(wsl::exec_command(d, "sh")),
        #[cfg(unix)]
        None => Ok(tokio::process::Command::new("sh")),
        _ => Err("This machine has no POSIX shell".into()),
    }
}

/// `script` with `args` as `$1…`, run by the shell of `distro` (None: this machine).
// The script goes in on stdin: wsl.exe re-quotes its command line, but not stdin.
async fn run_sh(distro: Option<&str>, script: &str, args: Vec<String>) -> Result<Captured, String> {
    use tokio::io::AsyncWriteExt;
    let mut child = sh_command(distro)?
        .args(["-s", "--"])
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Cannot start sh: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(script.as_bytes())
            .await
            .map_err(|e| format!("Cannot start sh: {e}"))?;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("sh failed: {e}"))?;
    Ok(Captured {
        stdout: out.stdout,
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        code: out.status.code(),
    })
}

/// The WSL distro all `paths` live in (None: this machine) and each path as its shell sees it.
fn shell_paths(paths: &[String]) -> Result<(Option<String>, Vec<String>), String> {
    let mut distro = None;
    let mut out = Vec::with_capacity(paths.len());
    for (i, p) in paths.iter().enumerate() {
        let (d, path) = match wsl::distro_path(p) {
            Some((d, path)) => (Some(d), path),
            None => (None, p.clone()),
        };
        if i > 0 && d != distro {
            return Err("The selection spans more than one system".into());
        }
        distro = d;
        out.push(path);
    }
    Ok((distro, out))
}

/// Owner and group of each path, or None when this machine has no POSIX shell to ask.
#[tauri::command]
pub async fn fs_owners(paths: Vec<String>) -> Option<Vec<OwnerInfo>> {
    let (distro, paths) = shell_paths(&paths).ok()?;
    owners_with(paths, |script, args| {
        run_sh(distro.as_deref(), script, args)
    })
    .await
}

#[tauri::command]
pub async fn fs_set_attrs(mut change: AttrChange) -> Result<(), AppError> {
    if change.paths.is_empty() {
        return Ok(());
    }
    let (distro, paths) = shell_paths(&change.paths)?;
    change.paths = paths;
    apply_with(&change, |script, args| {
        run_sh(distro.as_deref(), script, args)
    })
    .await
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

/// True if a `tar` binary is on PATH locally (the host that runs the archiving
/// half of tar-accelerated transfers).
#[tauri::command]
pub async fn fs_tar_available() -> bool {
    let mut cmd = tokio::process::Command::new("tar");
    cmd.arg("--version");
    crate::commands::win_proc::prevent_visible_child_window(&mut cmd);
    cmd.output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Links to directories could loop back into the tree, and dangling ones have nothing to read.
/// Windows needs a privilege to create links, so there a link to a file is copied as its file.
fn is_copied_as_link(src: &Path, meta: &std::fs::Metadata) -> bool {
    meta.is_symlink() && !(cfg!(windows) && std::fs::metadata(src).is_ok_and(|m| m.is_file()))
}

fn copy_link(src: &Path, dst: &Path) -> std::io::Result<()> {
    let target = std::fs::read_link(src)?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, dst)
    }
    #[cfg(windows)]
    {
        const ERROR_PRIVILEGE_NOT_HELD: i32 = 1314;
        let made = if std::fs::metadata(src).is_ok_and(|m| m.is_dir()) {
            std::os::windows::fs::symlink_dir(target, dst)
        } else {
            std::os::windows::fs::symlink_file(target, dst)
        };
        made.map_err(|e| match e.raw_os_error() {
            Some(ERROR_PRIVILEGE_NOT_HELD) => std::io::Error::other(format!(
                "Cannot copy the link {}: Windows only lets administrators or Developer Mode create links",
                src.display()
            )),
            _ => e,
        })
    }
}

fn remove_link(path: &Path) -> std::io::Result<()> {
    if !path.symlink_metadata().is_ok_and(|m| m.is_symlink()) {
        return Ok(());
    }
    std::fs::remove_file(path).or_else(|_| std::fs::remove_dir(path))
}

/// `path` with its parent resolved but its last component kept as written, so
/// a link there isn't followed. Parents that don't exist yet stay as written.
fn resolve_parent(path: &Path) -> PathBuf {
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => resolve_existing(parent).join(name),
        _ => path.canonicalize().unwrap_or_else(|_| path.to_path_buf()),
    }
}

fn resolve_existing(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| resolve_parent(path))
}

/// A selected link to a file is copied as that file, as `cp` does; any other item as is.
fn copy_source(selected: &Path) -> PathBuf {
    let is_file_link = selected.symlink_metadata().is_ok_and(|m| m.is_symlink())
        && std::fs::metadata(selected).is_ok_and(|m| m.is_file());
    if is_file_link {
        selected
            .canonicalize()
            .unwrap_or_else(|_| selected.to_path_buf())
    } else {
        selected.to_path_buf()
    }
}

// Must mirror `copy_recursive`'s traversal so the total matches bytes transferred.
fn copy_total_bytes(src: &Path) -> std::io::Result<u64> {
    let meta = src.symlink_metadata()?;
    if is_copied_as_link(src, &meta) {
        Ok(0)
    } else if meta.is_dir() {
        let mut total = 0u64;
        for entry in std::fs::read_dir(src)? {
            total += copy_total_bytes(&entry?.path())?;
        }
        Ok(total)
    } else {
        Ok(std::fs::metadata(src).map(|m| m.len()).unwrap_or(0))
    }
}

/// `emit` gets (bytes copied, total bytes).
fn copy_tree(
    selected: &Path,
    dst: &Path,
    token: &CancellationToken,
    emit: &dyn Fn(u64, u64),
) -> std::io::Result<()> {
    let src = copy_source(selected);
    let total = copy_total_bytes(&src).unwrap_or(0);
    emit(0, total);
    let root = if src.symlink_metadata()?.is_symlink() {
        resolve_parent(&src)
    } else {
        src.canonicalize()?
    };
    // `dst` is created before `src` is listed, so a copy into itself would recurse forever.
    if resolve_existing(dst).starts_with(&root) || resolve_parent(dst).starts_with(&root) {
        return Err(std::io::Error::other("Cannot copy an item into itself"));
    }
    copy_recursive(&src, dst, &mut 0, token, &|n| emit(n, total))
}

fn copy_recursive(
    src: &Path,
    dst: &Path,
    transferred: &mut u64,
    token: &CancellationToken,
    emit: &dyn Fn(u64),
) -> std::io::Result<()> {
    if token.is_cancelled() {
        return Err(std::io::Error::other("Transfer cancelled"));
    }
    let meta = src.symlink_metadata()?;
    // An existing link at `dst` is replaced, never written through.
    remove_link(dst)?;
    if meta.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(
                &entry.path(),
                &dst.join(entry.file_name()),
                transferred,
                token,
                emit,
            )?;
        }
        return Ok(());
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if is_copied_as_link(src, &meta) {
        if dst.symlink_metadata().is_ok_and(|m| m.is_file()) {
            std::fs::remove_file(dst)?;
        }
        return copy_link(src, dst);
    }
    let mut reader = std::fs::File::open(src)?;
    let mut writer = std::fs::File::create(dst)?;
    // Deliberately not `commands::sftp::pump_chunks`: this runs
    // blocking std::io inside spawn_blocking, not AsyncRead/Write.
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
    Ok(())
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
        let emit = |transferred: u64, total: u64| {
            let _ = app.emit(&event, TransferProgress { transferred, total });
        };
        copy_tree(Path::new(&from), Path::new(&to), &token, &emit).map_err(|e| e.to_string())
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
    cmd.args(["-czf", &archive_path, "-C", &parent, "--", &basename]);
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

// ── Editor (local) ─────────────────────────────────────────────────────────────
use crate::commands::sftp::editor::{is_binary, EditorFile, ReadError, SNIFF_BYTES};

#[tauri::command]
pub async fn fs_read_file(path: String, max_bytes: u64) -> Result<EditorFile, ReadError> {
    let bytes = tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.len() > max_bytes {
            return Err(ReadError::TooLarge {
                size: meta.len(),
                limit: max_bytes,
            });
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > max_bytes {
            return Err(ReadError::TooLarge {
                size: bytes.len() as u64,
                limit: max_bytes,
            });
        }
        let sample = &bytes[..bytes.len().min(SNIFF_BYTES)];
        if is_binary(sample) {
            return Err(ReadError::Binary);
        }
        Ok(bytes)
    })
    .await
    .map_err(|e| ReadError::Io {
        message: e.to_string(),
    })??;
    let size = bytes.len() as u64;
    Ok(EditorFile {
        content: String::from_utf8_lossy(&bytes).into_owned(),
        size,
    })
}

#[tauri::command]
pub async fn fs_write_file(path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || std::fs::write(&path, content).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
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

#[cfg(test)]
mod tests {
    use super::{copy_tree, drive_root};
    use std::fs;
    use std::path::Path;
    use tokio_util::sync::CancellationToken;

    fn copy(src: &Path, dst: &Path) -> std::io::Result<()> {
        copy_tree(src, dst, &CancellationToken::new(), &|_, _| {})
    }

    #[test]
    fn a_folder_is_not_copied_into_itself() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("a");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("f"), "x").unwrap();

        assert!(copy(&src, &src.join("b")).is_err());
        assert!(!src.join("b").exists());
        assert!(copy(&src.join("f"), &src.join("f")).is_err());
        assert_eq!(fs::read_to_string(src.join("f")).unwrap(), "x");

        // A sibling that merely shares the name's prefix is not inside it.
        copy(&src, &tmp.path().join("ab")).unwrap();
        assert_eq!(fs::read_to_string(tmp.path().join("ab/f")).unwrap(), "x");
    }

    #[cfg(unix)]
    #[test]
    fn links_are_copied_as_links() {
        use std::os::unix::fs::symlink;
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("sub/f"), "12345").unwrap();
        symlink("sub", src.join("to_dir")).unwrap();
        symlink("sub/f", src.join("to_file")).unwrap();
        symlink("missing", src.join("dangling")).unwrap();
        // Following this one would recurse without end.
        symlink("..", src.join("sub/up")).unwrap();

        let dst = tmp.path().join("dst");
        copy(&src, &dst).unwrap();

        assert_eq!(fs::read_link(dst.join("to_dir")).unwrap(), Path::new("sub"));
        assert_eq!(
            fs::read_link(dst.join("to_file")).unwrap(),
            Path::new("sub/f")
        );
        assert_eq!(
            fs::read_link(dst.join("dangling")).unwrap(),
            Path::new("missing")
        );
        assert_eq!(fs::read_link(dst.join("sub/up")).unwrap(), Path::new(".."));
        assert_eq!(fs::read_to_string(dst.join("sub/f")).unwrap(), "12345");
        assert_eq!(super::copy_total_bytes(&src).unwrap(), 5);
    }

    #[cfg(unix)]
    #[test]
    fn overwriting_replaces_links_instead_of_writing_through_them() {
        use std::os::unix::fs::symlink;
        let tmp = tempfile::tempdir().unwrap();
        let (src, dst) = (tmp.path().join("src"), tmp.path().join("dst"));
        fs::create_dir(&src).unwrap();
        fs::write(src.join("conf"), "new").unwrap();
        symlink("conf", src.join("link")).unwrap();
        copy(&src, &dst).unwrap();

        let outside = tmp.path().join("outside");
        fs::write(&outside, "keep").unwrap();
        fs::remove_file(dst.join("conf")).unwrap();
        symlink(&outside, dst.join("conf")).unwrap();
        copy(&src, &dst).unwrap();

        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
        assert!(!dst.join("conf").is_symlink());
        assert_eq!(fs::read_to_string(dst.join("conf")).unwrap(), "new");
        assert_eq!(fs::read_link(dst.join("link")).unwrap(), Path::new("conf"));
    }

    #[cfg(unix)]
    #[test]
    fn a_selected_link_to_a_file_is_copied_as_the_file() {
        use std::os::unix::fs::symlink;
        let tmp = tempfile::tempdir().unwrap();
        let (dir, elsewhere) = (tmp.path().join("dir"), tmp.path().join("elsewhere"));
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(dir.join("f"), "abc").unwrap();
        symlink("f", dir.join("l")).unwrap();

        copy(&dir.join("l"), &elsewhere.join("l")).unwrap();
        assert!(!elsewhere.join("l").is_symlink());
        assert_eq!(fs::read_to_string(elsewhere.join("l")).unwrap(), "abc");

        assert!(copy(&dir.join("l"), &dir.join("f")).is_err());
        assert!(copy(&dir.join("l"), &dir.join("l")).is_err());
        assert_eq!(fs::read_to_string(dir.join("f")).unwrap(), "abc");
        assert_eq!(fs::read_link(dir.join("l")).unwrap(), Path::new("f"));
    }

    #[cfg(unix)]
    #[test]
    fn a_selected_link_to_a_folder_is_not_copied_onto_itself() {
        use std::os::unix::fs::symlink;
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir(tmp.path().join("d")).unwrap();
        symlink("d", tmp.path().join("l")).unwrap();

        assert!(copy(&tmp.path().join("l"), &tmp.path().join("l")).is_err());
        assert_eq!(fs::read_link(tmp.path().join("l")).unwrap(), Path::new("d"));
    }

    #[test]
    fn bare_drive_spec_becomes_drive_root() {
        assert_eq!(drive_root("C:").as_deref(), Some("C:\\"));
        assert_eq!(drive_root("d:").as_deref(), Some("d:\\"));
        assert_eq!(drive_root("C:\\"), None);
        assert_eq!(drive_root("C:\\Users"), None);
        assert_eq!(drive_root("/home"), None);
        assert_eq!(drive_root("::"), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn local_files_list_and_change_their_mode_and_owner() {
        use super::{fs_list_dir, fs_owners, fs_set_attrs, AttrChange};
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("a 'b");
        fs::write(&file, "").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        std::os::unix::fs::symlink(&file, tmp.path().join("link")).unwrap();
        let path = file.to_string_lossy().into_owned();
        let meta = fs::metadata(&file).unwrap();

        fs_set_attrs(AttrChange {
            paths: vec![path.clone()],
            set: 0o055,
            group: Some(meta.gid().to_string()),
            ..Default::default()
        })
        .await
        .unwrap();

        let listed = fs_list_dir(tmp.path().to_string_lossy().into_owned())
            .await
            .unwrap();
        let mode_of = |name: &str| {
            let f = listed.iter().find(|f| f.name == name).unwrap();
            (f.permissions, f.is_symlink)
        };
        assert_eq!(mode_of("a 'b"), (Some(0o655), false));
        assert!(mode_of("link").1);

        let owners = fs_owners(vec![path]).await.unwrap();
        assert_eq!((owners[0].uid, owners[0].gid), (meta.uid(), meta.gid()));
    }
}
