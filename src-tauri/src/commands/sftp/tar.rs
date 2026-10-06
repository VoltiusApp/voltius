use super::{
    get_backend, local_tar,
    remote_shell::{RemoteShell, Unreachable},
    resume::{
        copy_one, copy_tree, emit,
        endpoint::Endpoint,
        is_resume,
        large::{has_large_local, has_large_remote},
        mark_resume, revive, LARGE_FILE, LINK_WAIT,
    },
    run_backend_transfer,
    stream::{self, Job, LocalSide, RemoteEnd},
    with_transfer, TarHost,
};
use crate::error::AppError;
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
    let host = probed_host(&backend)
        .await
        .map_err(|_| "Couldn't ask the host whether it can stream tar".to_string())?;
    Ok(host.is_some())
}

async fn probed_host(backend: &Arc<dyn FileBackend>) -> Result<Option<TarHost>, Unreachable> {
    match backend.tar_probe() {
        Some(probe) => probe.host().await,
        None => Ok(None),
    }
}

async fn host_of(backend: &Arc<dyn FileBackend>) -> Option<TarHost> {
    probed_host(backend).await.ok().flatten()
}

#[allow(clippy::too_many_arguments)]
async fn upload_via(
    events: &impl TransferEvents,
    host: &TarHost,
    parent: String,
    names: Vec<String>,
    dest: &str,
    strip: bool,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let job = Job::new(events, transfer_id, token);
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
    events: &impl TransferEvents,
    host: &TarHost,
    parent: &str,
    items: &[String],
    local_dir: &str,
    strip: bool,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let job = Job::new(events, transfer_id, token);
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
    events: &impl TransferEvents,
    src: &TarHost,
    parent: &str,
    items: &[String],
    dst: &TarHost,
    dest: &str,
    strip: bool,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), String> {
    let job = Job::new(events, transfer_id, token);
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
) -> Result<(), AppError> {
    let (src, dst) = (
        get_backend(manager, src_id).await?,
        get_backend(manager, dst_id).await?,
    );
    let (src_fs, dst_fs) = (src.endpoint(), dst.endpoint());
    let (src_fs, dst_fs) = (&*src_fs, &*dst_fs);
    let (parent, items) = remote_items(paths);
    let per_file = || async {
        let base = dest.trim_end_matches('/');
        for (path, name) in paths.iter().zip(&items) {
            let to = if whole_dir {
                base.to_string()
            } else {
                format!("{base}/{name}")
            };
            if src.stat(path).await?.unwrap_or(false) {
                copy_tree(app, src_fs, path, dst_fs, &to, transfer_id, token).await?;
            } else {
                copy_one(app, src_fs, path, dst_fs, &to, transfer_id, token).await?;
            }
        }
        Ok(())
    };
    if let (Some(s), Some(d)) = tokio::join!(host_of(&src), host_of(&dst)) {
        let large = has_large_remote(&s, src_fs, &parent, &items, LARGE_FILE);
        if tar_fits(transfer_id, large).await {
            let relayed = relay_via(
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
            .await
            .map_err(Into::into);
            return after_tar(
                app,
                transfer_id,
                relayed,
                &[src_fs, dst_fs],
                token,
                per_file,
            )
            .await;
        }
        per_file_accel(app, transfer_id);
    }
    per_file().await
}

/// Tar only on a first run with no big file: a retry or a big file goes per file, resumable.
async fn tar_fits(transfer_id: &str, large: impl Future<Output = bool>) -> bool {
    !is_resume(transfer_id) && !large.await
}

fn per_file_accel(events: &impl TransferEvents, transfer_id: &str) {
    emit(
        events,
        "accel",
        transfer_id,
        serde_json::json!({ "accel": "perFile" }),
    );
}

/// A tar stream that died with its link resumes per file once the link is back.
async fn after_tar<E, B, BF>(
    events: &E,
    transfer_id: &str,
    streamed: Result<(), AppError>,
    ends: &[&dyn Endpoint],
    token: &CancellationToken,
    fallback: B,
) -> Result<(), AppError>
where
    E: TransferEvents,
    B: FnOnce() -> BF,
    BF: Future<Output = Result<(), AppError>>,
{
    let Err(e) = streamed else {
        return Ok(());
    };
    if token.is_cancelled() {
        return Err(e);
    }
    match revive(ends, events, transfer_id, token, LINK_WAIT).await {
        None => Err(e),
        Some(Err(waited)) => Err(waited),
        Some(Ok(())) => {
            mark_resume(transfer_id);
            per_file_accel(events, transfer_id);
            fallback().await
        }
    }
}

/// Run `stream` when the backend's host can stream tar and `large` finds no big file,
/// else `fallback` on the backend itself (per file, resumable).
#[allow(clippy::too_many_arguments)]
async fn stream_or<E, L, LF, S, SF, B, BF>(
    events: &E,
    manager: &SftpManager,
    sftp_id: &str,
    transfer_id: &str,
    large: L,
    stream: S,
    fallback: B,
) -> Result<(), AppError>
where
    E: TransferEvents,
    L: FnOnce(TarHost, Arc<dyn Endpoint>) -> LF,
    LF: Future<Output = bool>,
    S: FnOnce(TarHost, CancellationToken) -> SF,
    SF: Future<Output = Result<(), String>>,
    B: FnOnce(Arc<dyn FileBackend>, CancellationToken) -> BF,
    BF: Future<Output = Result<(), AppError>>,
{
    run_backend_transfer(manager, sftp_id, transfer_id, |backend, token| async move {
        let Some(host) = host_of(&backend).await else {
            return fallback(backend, token).await;
        };
        let fs = backend.endpoint();
        if !tar_fits(transfer_id, large(host.clone(), Arc::clone(&fs))).await {
            per_file_accel(events, transfer_id);
            return fallback(backend, token).await;
        }
        let streamed = stream(host, token.clone()).await.map_err(Into::into);
        let retry = || fallback(Arc::clone(&backend), token.clone());
        after_tar(events, transfer_id, streamed, &[&*fs], &token, retry).await
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
) -> Result<(), AppError> {
    if local_paths.is_empty() {
        return Ok(());
    }
    let (app, tid, paths, dir) = (&app, &transfer_id, &local_paths, &remote_dir);
    stream_or(
        app,
        &sftp_state,
        &sftp_id,
        &transfer_id,
        |_, _| has_large_local(paths, LARGE_FILE),
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
) -> Result<(), AppError> {
    if remote_paths.is_empty() {
        return Ok(());
    }
    let (app, tid, paths, dir) = (&app, &transfer_id, &remote_paths, &local_dir);
    stream_or(
        app,
        &sftp_state,
        &sftp_id,
        &transfer_id,
        |host, fs| async move {
            let (parent, items) = remote_items(paths);
            has_large_remote(&host, &*fs, &parent, &items, LARGE_FILE).await
        },
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
) -> Result<(), AppError> {
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
) -> Result<(), AppError> {
    let (app, tid, local, remote) = (&app, &transfer_id, &local_path, &remote_path);
    stream_or(
        app,
        &sftp_state,
        &sftp_id,
        &transfer_id,
        |_, _| has_large_local(std::slice::from_ref(local), LARGE_FILE),
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
) -> Result<(), AppError> {
    let (app, tid, remote, local) = (&app, &transfer_id, &remote_path, &local_path);
    stream_or(
        app,
        &sftp_state,
        &sftp_id,
        &transfer_id,
        |host, fs| async move {
            let (parent, items) = remote_items(std::slice::from_ref(remote));
            has_large_remote(&host, &*fs, &parent, &items, LARGE_FILE).await
        },
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
) -> Result<(), AppError> {
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

    #[tokio::test]
    async fn a_tar_stream_lost_with_its_link_falls_back_to_a_resumed_per_file_run() {
        use crate::commands::sftp::resume::endpoint::tests_support::TestFs;
        use crate::commands::sftp::resume::{clear_resume, is_resume};
        use crate::sftp::backend::test_tree::Recorder;
        use std::sync::atomic::{AtomicBool, Ordering};
        let rec = Recorder::default();
        let dead = TestFs {
            dead_until_waited: true,
            ..Default::default()
        };
        let ran = AtomicBool::new(false);
        let token = CancellationToken::new();
        let r = after_tar(
            &rec,
            "tt",
            Err("stream broke".into()),
            &[&dead],
            &token,
            || async {
                ran.store(is_resume("tt"), Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        clear_resume("tt");
        assert!(r.is_ok());
        assert!(ran.load(Ordering::SeqCst), "fallback ran as a resume");
        assert_eq!(rec.last("sftp-accel-tt").unwrap()["accel"], "perFile");
    }

    #[tokio::test]
    async fn a_retry_never_takes_the_tar_stream() {
        use crate::commands::sftp::resume::{clear_resume, mark_resume};
        mark_resume("tr");
        let retried = tar_fits("tr", async { panic!("no size probe on a retry") }).await;
        clear_resume("tr");
        assert!(!retried);
        assert!(tar_fits("tf", async { false }).await);
        assert!(!tar_fits("tl", async { true }).await);
    }

    #[tokio::test]
    async fn a_tar_error_on_a_live_link_is_reported_as_is() {
        use crate::commands::sftp::resume::endpoint::LocalFs;
        use crate::sftp::backend::test_tree::Recorder;
        let token = CancellationToken::new();
        let r = after_tar(
            &Recorder::default(),
            "tu",
            Err("disk full".into()),
            &[&LocalFs],
            &token,
            || async { panic!("no fallback") },
        )
        .await;
        assert_eq!(r.unwrap_err().to_string(), "disk full");
    }

    #[cfg(unix)]
    mod live {
        use super::*;
        use crate::known_hosts::KnownHostsStore;
        use crate::sftp::backend::test_tree::Recorder;
        use crate::sftp::real::{RealSftp, SftpOpener};
        use crate::ssh::client::connect_authenticated;
        use crate::ssh::live_cells::own_cell;
        use crate::ssh::test_docker::{docker, Container};
        use std::io::Read;
        use std::process::Command;
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        use std::time::{Duration, Instant};

        const IMAGE: &str = "lscr.io/linuxserver/openssh-server:latest";
        const TREE: &str = r#"cd "$1" && echo $(find . -type f | wc -l) $(find . -type f -exec cat {} + | wc -c) $(find . -type f -exec md5sum {} + | sort | md5sum | cut -c1-32)"#;
        const BLOB: u64 = 50_000_000;

        fn ssh_host(tag: &str, extra: &[&str]) -> Container {
            let mut args = vec![
                "-p",
                "127.0.0.1::2222",
                "-e",
                "USER_NAME=t",
                "-e",
                "USER_PASSWORD=t",
                "-e",
                "PASSWORD_ACCESS=true",
            ];
            args.extend_from_slice(extra);
            args.push(IMAGE);
            Container::run(format!("tar468-{}-{tag}", std::process::id()), &args)
        }

        fn stdout(cmd: &mut Command) -> String {
            let out = cmd.output().unwrap();
            assert!(
                out.status.success(),
                "{cmd:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }

        fn sh(container: &str, script: &str, args: &[&str]) -> String {
            stdout(
                Command::new("docker")
                    .args(["exec", container, "sh", "-c", script, "x"])
                    .args(args),
            )
        }

        fn remote_tree(container: &str, dir: &str) -> String {
            sh(container, TREE, &[dir])
        }

        fn local_tree(dir: &Path) -> String {
            stdout(Command::new("sh").args(["-c", TREE, "x"]).arg(dir))
        }

        fn tmp_used_kb(container: &str) -> u64 {
            sh(container, "df -k /tmp | awk 'NR==2{print $3}'", &[])
                .parse()
                .unwrap()
        }

        async fn peak_tmp_kb<T>(c: &Container, work: impl Future<Output = T>) -> (T, u64) {
            let (stop, peak) = (
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicU64::new(0)),
            );
            let name = c.0.clone();
            let sampler = {
                let (stop, peak) = (Arc::clone(&stop), Arc::clone(&peak));
                std::thread::spawn(move || {
                    while !stop.load(Ordering::Relaxed) {
                        peak.fetch_max(tmp_used_kb(&name), Ordering::Relaxed);
                    }
                })
            };
            let out = work.await;
            stop.store(true, Ordering::Relaxed);
            sampler.join().unwrap();
            (out, peak.load(Ordering::Relaxed))
        }

        async fn backend(c: &Container) -> Arc<dyn FileBackend> {
            let mapped = String::from_utf8(docker(&["port", &c.0, "2222"]).stdout).unwrap();
            let port: u16 = mapped.trim().rsplit(':').next().unwrap().parse().unwrap();
            let deadline = Instant::now() + Duration::from_secs(60);
            let handle = loop {
                let known_hosts = Arc::new(KnownHostsStore::new());
                let attempt = connect_authenticated(
                    known_hosts,
                    "127.0.0.1",
                    port,
                    "t",
                    Some("t"),
                    None,
                    None,
                    false,
                    None,
                );
                match attempt.await {
                    Ok(h) => break h,
                    Err(e) => assert!(Instant::now() < deadline, "{}: {e}", c.0),
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            };
            let sftp = RealSftp::open(
                own_cell(Arc::new(handle)),
                SftpOpener::Subsystem,
                CancellationToken::new(),
            );
            Arc::new(sftp.await.unwrap())
        }

        async fn streaming_host(backend: &Arc<dyn FileBackend>) -> TarHost {
            let probe = backend.tar_probe().expect("SSH backends probe tar");
            assert_eq!(probe.shell().await, Some(RemoteShell::Posix));
            host_of(backend).await.expect("stream probe passes")
        }

        fn progress_seen(rec: &Recorder, transfer_id: &str) -> serde_json::Value {
            let last = rec
                .last(&format!("sftp-progress-{transfer_id}"))
                .expect("progress reported");
            assert!(last["total"].as_u64().unwrap() > 0, "{transfer_id}: {last}");
            assert!(
                last["transferred"].as_u64().unwrap() > 0,
                "{transfer_id}: {last}"
            );
            last
        }

        #[tokio::test(flavor = "multi_thread")]
        #[ignore = "needs docker"]
        async fn a_tree_bigger_than_a_small_tmp_relays_downloads_and_uploads() {
            let a = ssh_host("a", &["--tmpfs", "/tmp:size=16m"]);
            let b = ssh_host("b", &[]);
            let (sa, sb) = tokio::join!(backend(&a), backend(&b));
            let (ha, hb) = (streaming_host(&sa).await, streaming_host(&sb).await);
            sh(
                &b.0,
                &format!(
                    "mkdir -p /config/big && head -c {BLOB} /dev/urandom > /config/big/blob && \
                     i=1; while [ $i -le 2000 ]; do echo $i > /config/big/f$i; i=$((i+1)); done"
                ),
                &[],
            );
            let source = remote_tree(&b.0, "/config/big");
            assert!(source.starts_with("2001 50008893 "), "{source}");
            let (rec, token) = (Recorder::default(), CancellationToken::new());
            let tmp_before = tmp_used_kb(&a.0);

            let (parent, items) = remote_items(&["/config/big".into()]);
            let relay = relay_via(
                &rec,
                &hb,
                &parent,
                &items,
                &ha,
                "/config/big",
                true,
                "relay",
                &token,
            );
            let (relayed, peak) = peak_tmp_kb(&a, relay).await;
            relayed.unwrap();
            assert_eq!(remote_tree(&a.0, "/config/big"), source);
            assert!(
                peak < tmp_before + 1024,
                "A's /tmp peaked at {peak} KB from {tmp_before} KB"
            );

            let local = tempfile::tempdir().unwrap();
            let down = local.path().join("big");
            let (parent, base) = remote_split("/config/big");
            let (down_str, items) = (down.to_str().unwrap(), [base.to_string()]);
            download_via(&rec, &ha, parent, &items, down_str, true, "down", &token)
                .await
                .unwrap();
            assert_eq!(local_tree(&down), source);

            let (parent, base) = local_split(down_str);
            upload_via(
                &rec,
                &ha,
                parent,
                vec![base],
                "/config/back",
                true,
                "up",
                &token,
            )
            .await
            .unwrap();
            assert_eq!(remote_tree(&a.0, "/config/back"), source);
            assert_eq!(tmp_used_kb(&a.0), tmp_before);

            for id in ["relay", "down", "up"] {
                eprintln!("{id}: {}", progress_seen(&rec, id));
            }
            eprintln!("tree {source}; A /tmp {tmp_before} KB before, peak {peak} KB during relay");
        }

        #[tokio::test(flavor = "multi_thread")]
        #[ignore = "needs docker"]
        async fn a_full_destination_is_named_in_the_error() {
            let a = ssh_host("full", &["--tmpfs", "/small:size=1m,mode=1777"]);
            let host = streaming_host(&backend(&a).await).await;
            let local = tempfile::tempdir().unwrap();
            let src = local.path().join("src");
            std::fs::create_dir(&src).unwrap();
            let mut random = std::fs::File::open("/dev/urandom").unwrap().take(BLOB);
            std::io::copy(
                &mut random,
                &mut std::fs::File::create(src.join("blob")).unwrap(),
            )
            .unwrap();
            let (rec, token) = (Recorder::default(), CancellationToken::new());

            let (parent, base) = local_split(src.to_str().unwrap());
            let upload = upload_via(
                &rec,
                &host,
                parent,
                vec![base],
                "/small/x",
                true,
                "full",
                &token,
            );
            let err = tokio::time::timeout(Duration::from_secs(120), upload)
                .await
                .expect("a full disk ends the upload")
                .unwrap_err();
            assert_eq!(err, "Not enough space in /small/x on the remote host");
        }
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
