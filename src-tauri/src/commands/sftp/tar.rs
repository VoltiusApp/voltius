use super::{
    get_backend, get_session, local_tar,
    remote_shell::RemoteShell,
    rr_dir_per_file, run_backend_transfer,
    stream::{self, Job, LocalSide, RemoteEnd},
    transfer::sftp_rr_file_inner,
    with_transfer, TarHost,
};
use crate::sftp::backend::{skip_unsafe_name, TransferEvents};
use crate::sftp::{FileBackend, SftpManager};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

// ── Shared shell fragments ────────────────────────────────────────────────────

/// Split a remote (always `/`-separated) path into parent and basename, ignoring a
/// trailing `/`. A path with no separator has parent `.`; an item at the root has parent `/`.
fn remote_split(path: &str) -> (&str, &str) {
    let path = match path.trim_end_matches('/') {
        "" => path,
        trimmed => trimmed,
    };
    match path.rfind('/') {
        Some(0) => ("/", &path[1..]),
        Some(i) => (&path[..i], &path[i + 1..]),
        None => (".", path),
    }
}

/// Basenames of `paths` that are safe to create here; the rest are reported as skipped.
fn local_safe_items(app: &impl TransferEvents, transfer_id: &str, paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter_map(|p| {
            let (_, name) = remote_split(p);
            (!skip_unsafe_name(app, transfer_id, p, name, true)).then(|| name.to_string())
        })
        .collect()
}

/// The same split for a local path, where the separator is the platform's.
/// A path with no file name archives as an empty item, exactly as before.
fn local_split(path: &str) -> (String, String) {
    let of = |p: Option<&std::ffi::OsStr>, fallback: &str| {
        p.and_then(|s| s.to_str()).unwrap_or(fallback).to_string()
    };
    let path = Path::new(path);
    (
        of(path.parent().map(|p| p.as_os_str()), "."),
        of(path.file_name(), ""),
    )
}

/// Basenames and common parent of remote `paths`; all share the first path's parent.
fn remote_items(paths: &[String]) -> (String, Vec<String>) {
    let (parent, _) = remote_split(&paths[0]);
    let items = paths
        .iter()
        .map(|p| remote_split(p).1.to_string())
        .collect();
    (parent.to_string(), items)
}

async fn shell_of(manager: &SftpManager, sftp_id: &str) -> RemoteShell {
    let backend = get_backend(manager, sftp_id).await.ok();
    match backend.as_ref().and_then(|b| b.tar_probe()) {
        Some(probe) => probe.shell().await.unwrap_or(RemoteShell::Posix),
        None => RemoteShell::Posix,
    }
}

// ── Compress / Extract ────────────────────────────────────────────────────────

/// Compress a remote file or directory into a .tar.gz archive via SSH exec.
#[tauri::command]
pub async fn sftp_compress(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    source_path: String,
    archive_path: String,
) -> Result<(), String> {
    let (parent, basename) = remote_split(&source_path);
    let shell = shell_of(&sftp_state, &sftp_id).await;
    let cmd = shell.compress(&archive_path, parent, &[basename.to_string()])?;
    sftp_state.exec_command(&sftp_id, &cmd, None).await
}

/// Extract a remote .tar.gz archive into a destination directory via SSH exec.
#[tauri::command]
pub async fn sftp_extract(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    archive_path: String,
    dest_dir: String,
) -> Result<(), String> {
    let shell = shell_of(&sftp_state, &sftp_id).await;
    let cmd = shell.extract(&archive_path, &dest_dir);
    sftp_state.exec_command(&sftp_id, &cmd, None).await
}

// ── Tar-based directory transfer ──────────────────────────────────────────────

/// True if the session can run commands on its host, as compress and extract do.
#[tauri::command]
pub async fn sftp_can_exec(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
) -> Result<bool, String> {
    Ok(sftp_state.can_exec(&sftp_id).await)
}

/// True if the remote host has a tar that streams binary-clean over an exec channel.
#[tauri::command]
pub async fn sftp_tar_available(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
) -> Result<bool, String> {
    let backend = get_backend(&sftp_state, &sftp_id).await?;
    Ok(host_of(&backend).await.is_some())
}

async fn host_of(backend: &Arc<dyn FileBackend>) -> Option<TarHost> {
    match backend.tar_probe() {
        Some(probe) => probe.host().await,
        None => None,
    }
}

#[allow(clippy::too_many_arguments)]
async fn upload_via(
    app: &AppHandle,
    host: &TarHost,
    parent: String,
    names: Vec<String>,
    dest: &str,
    strip: bool,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let job = Job::new(app, transfer_id, token);
    let deref = host.shell.is_windows();
    let (walk_parent, walk_names, progress) =
        (PathBuf::from(&parent), names.clone(), job.progress.clone());
    tokio::task::spawn_blocking(move || {
        progress.set_total(local_tar::walk_size(&walk_parent, &walk_names, deref))
    });
    let ssh = host.ssh();
    let to = RemoteEnd {
        handle: &ssh,
        cmd: host.wrap(&host.shell.extract_from_stdin(dest, strip)),
        dir: dest,
    };
    stream::upload(
        to,
        LocalSide {
            parent: parent.into(),
            names,
            deref,
        },
        &job,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn download_via(
    app: &AppHandle,
    host: &TarHost,
    parent: &str,
    items: &[String],
    local_dir: &str,
    strip: bool,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let job = Job::new(app, transfer_id, token);
    let _sizing = host.spawn_size(parent, items, job.progress.clone());
    let ssh = host.ssh();
    let cmd = host.wrap(&host.shell.create_to_stdout(parent, items, cfg!(windows))?);
    stream::download(
        RemoteEnd {
            handle: &ssh,
            cmd,
            dir: parent,
        },
        local_dir.into(),
        strip,
        &job,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn relay_via(
    app: &AppHandle,
    src: &TarHost,
    parent: &str,
    items: &[String],
    dst: &TarHost,
    dest: &str,
    strip: bool,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let job = Job::new(app, transfer_id, token);
    let _sizing = src.spawn_size(parent, items, job.progress.clone());
    let (src_ssh, dst_ssh) = (src.ssh(), dst.ssh());
    let src_cmd = src.wrap(
        &src.shell
            .create_to_stdout(parent, items, dst.shell.is_windows())?,
    );
    let dst_cmd = dst.wrap(&dst.shell.extract_from_stdin(dest, strip));
    stream::relay(
        RemoteEnd {
            handle: &src_ssh,
            cmd: src_cmd,
            dir: parent,
        },
        RemoteEnd {
            handle: &dst_ssh,
            cmd: dst_cmd,
            dir: dest,
        },
        &job,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn relay_or_per_file(
    app: &AppHandle,
    manager: &SftpManager,
    src_id: &str,
    paths: &[String],
    dst_id: &str,
    dest: &str,
    whole_dir: bool,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let (src, dst) = (
        get_backend(manager, src_id).await?,
        get_backend(manager, dst_id).await?,
    );
    let (parent, items) = remote_items(paths);
    if let (Some(s), Some(d)) = tokio::join!(host_of(&src), host_of(&dst)) {
        return relay_via(
            app,
            &s,
            &parent,
            &items,
            &d,
            dest,
            whole_dir,
            transfer_id,
            token,
        )
        .await;
    }
    let (src_session, dst_session) = (
        get_session(manager, src_id).await?,
        get_session(manager, dst_id).await?,
    );
    let base = dest.trim_end_matches('/');
    for (path, name) in paths.iter().zip(&items) {
        let to = if whole_dir {
            base.to_string()
        } else {
            format!("{base}/{name}")
        };
        let (s, d) = (Arc::clone(&src_session), Arc::clone(&dst_session));
        if src.stat(path).await?.unwrap_or(false) {
            rr_dir_per_file(app, s, path, d, &to, transfer_id, token).await?;
        } else {
            sftp_rr_file_inner(app, s, path, d, &to, transfer_id, token).await?;
        }
    }
    Ok(())
}

/// Run `stream` when the backend's host can stream tar, else `fallback` on the backend itself.
async fn stream_or<S, SF, B, BF>(
    manager: &SftpManager,
    sftp_id: &str,
    transfer_id: &str,
    stream: S,
    fallback: B,
) -> Result<(), String>
where
    S: FnOnce(TarHost, CancellationToken) -> SF,
    SF: Future<Output = Result<(), String>>,
    B: FnOnce(Arc<dyn FileBackend>, CancellationToken) -> BF,
    BF: Future<Output = Result<(), String>>,
{
    run_backend_transfer(manager, sftp_id, transfer_id, |backend, token| async move {
        match host_of(&backend).await {
            Some(host) => stream(host, token).await,
            None => fallback(backend, token).await,
        }
    })
    .await
}

/// Upload multiple local files/directories as a single tar stream.
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
    let (app, tid, paths, dir) = (&app, &transfer_id, &local_paths, &remote_dir);
    stream_or(
        &sftp_state,
        &sftp_id,
        &transfer_id,
        |host, token| async move {
            let (parent, _) = local_split(&paths[0]);
            let names = paths
                .iter()
                .filter_map(|p| Path::new(p).file_name()?.to_str().map(str::to_string))
                .collect();
            upload_via(app, &host, parent, names, dir, false, tid, &token).await
        },
        |backend, token| async move { backend.upload_batch(app, paths, dir, tid, &token).await },
    )
    .await
}

/// Download multiple remote files/directories as a single tar stream.
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
    let (app, tid, paths, dir) = (&app, &transfer_id, &remote_paths, &local_dir);
    stream_or(
        &sftp_state,
        &sftp_id,
        &transfer_id,
        |host, token| async move {
            let items = local_safe_items(app, tid, paths);
            if items.is_empty() {
                return Ok(());
            }
            let (parent, _) = remote_split(&paths[0]);
            download_via(app, &host, parent, &items, dir, false, tid, &token).await
        },
        |backend, token| async move { backend.download_batch(app, paths, dir, tid, &token).await },
    )
    .await
}

/// Transfer multiple files/directories between two remote hosts as a single tar stream.
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
    let manager: &SftpManager = &sftp_state;
    with_transfer(manager, &transfer_id.clone(), |token| async move {
        relay_or_per_file(
            &app,
            manager,
            &src_sftp_id,
            &src_paths,
            &dst_sftp_id,
            &dst_dir,
            false,
            &transfer_id,
            &token,
        )
        .await
    })
    .await
}

/// Upload a local directory as a single tar stream.
#[tauri::command]
pub async fn sftp_upload_dir_tar(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let (app, tid, local, remote) = (&app, &transfer_id, &local_path, &remote_path);
    stream_or(
        &sftp_state,
        &sftp_id,
        &transfer_id,
        |host, token| async move {
            let (parent, base) = local_split(local);
            upload_via(app, &host, parent, vec![base], remote, true, tid, &token).await
        },
        |backend, token| async move { backend.upload_dir(app, local, remote, tid, &token).await },
    )
    .await
}

/// Download a remote directory as a single tar stream.
#[tauri::command]
pub async fn sftp_download_dir_tar(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let (app, tid, remote, local) = (&app, &transfer_id, &remote_path, &local_path);
    stream_or(
        &sftp_state,
        &sftp_id,
        &transfer_id,
        |host, token| async move {
            let (parent, base) = remote_split(remote);
            let items = [base.to_string()];
            download_via(app, &host, parent, &items, local, true, tid, &token).await
        },
        |backend, token| async move { backend.download_dir(app, remote, local, tid, &token).await },
    )
    .await
}

/// Transfer a directory between two remote hosts as a single tar stream.
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
    let manager: &SftpManager = &sftp_state;
    with_transfer(manager, &transfer_id.clone(), |token| async move {
        relay_or_per_file(
            &app,
            manager,
            &src_sftp_id,
            &[src_path],
            &dst_sftp_id,
            &dst_path,
            true,
            &transfer_id,
            &token,
        )
        .await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_items_are_basenames_of_one_parent() {
        let (parent, items) = remote_items(&["/srv/a".into(), "/srv/b c".into()]);
        assert_eq!(parent, "/srv");
        assert_eq!(items, ["a", "b c"]);
    }

    #[test]
    fn root_level_items_archive_from_the_root() {
        let (parent, items) = remote_items(&["/app".into(), "/etc/".into()]);
        assert_eq!(
            (parent.as_str(), items),
            ("/", vec!["app".into(), "etc".into()])
        );
        let cmd = RemoteShell::Posix
            .create_to_stdout(&parent, &["app".into()], false)
            .unwrap();
        assert!(cmd.contains("-C '/' -- 'app'"), "{cmd}");
    }

    #[test]
    fn remote_split_separates_parent_from_basename() {
        assert_eq!(remote_split("/srv/data/logs"), ("/srv/data", "logs"));
        assert_eq!(remote_split("logs"), (".", "logs"));
        assert_eq!(remote_split("/logs"), ("/", "logs"));
        assert_eq!(remote_split("/app"), ("/", "app"));
        assert_eq!(remote_split("/srv/data/"), ("/srv", "data"));
    }

    #[test]
    fn local_safe_items_skips_names_that_would_leave_the_folder() {
        use crate::sftp::backend::test_tree::Recorder;
        let rec = Recorder::default();
        let paths: Vec<String> = ["/srv/ok.txt", "/srv/..", "/srv/10:30.log", "/srv/a\\b"]
            .map(String::from)
            .to_vec();
        let items = local_safe_items(&rec, "t1", &paths);
        let mut kept = vec!["ok.txt"];
        let mut skipped = vec!["/srv/.."];
        if cfg!(windows) {
            skipped.extend(["/srv/10:30.log", "/srv/a\\b"]);
        } else {
            kept.extend(["10:30.log", "a\\b"]);
        }
        assert_eq!(items, kept);
        assert_eq!(rec.skipped("t1"), skipped);
    }

    #[test]
    fn local_split_keeps_the_empty_parent_a_bare_file_name_has() {
        assert_eq!(
            local_split("/srv/data/logs"),
            ("/srv/data".to_string(), "logs".to_string())
        );
        assert_eq!(local_split("logs"), (String::new(), "logs".to_string()));
    }

    #[cfg(windows)]
    #[test]
    fn real_cmd_exe_keeps_percent_names_literal() {
        use super::super::remote_shell::WinShell;
        use std::os::windows::process::CommandExt;
        let run = |line: String| {
            let out = std::process::Command::new("cmd")
                .args(["/d", "/c"])
                .raw_arg(&line)
                .output()
                .unwrap();
            let out = String::from_utf8_lossy(&out.stdout).into_owned();
            assert!(out.contains("__TF_EXIT__:0"), "{line}\n{out}");
        };
        let sftp = |p: &Path| format!("/{}", p.to_str().unwrap().replace('\\', "/"));
        let (shell, root) = (
            RemoteShell::Windows {
                shell: WinShell::Cmd,
            },
            tempfile::tempdir().unwrap(),
        );
        let src = root.path().join("%USERNAME% 50% off");
        let dst = root.path().join("%OS%");
        let archive = root.path().join("%TEMP%.tar.gz");
        std::fs::create_dir(&src).unwrap();
        std::fs::write(src.join("%PATH%"), b"v").unwrap();

        let items = ["%PATH%".to_string()];
        run(shell
            .compress(&sftp(&archive), &sftp(&src), &items)
            .unwrap());
        run(shell.extract(&sftp(&archive), &sftp(&dst)));
        assert_eq!(std::fs::read(dst.join("%PATH%")).unwrap(), b"v");
    }
}
