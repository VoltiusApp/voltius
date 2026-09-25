use super::{
    get_session,
    remote_shell::{remote_shell, RemoteShell},
    tar_backend, temp_archive_name,
    transfer::sftp_download_inner,
    transfer::sftp_rr_file_inner,
    transfer::sftp_upload_inner,
    TarBackend,
};
use crate::sftp::SftpManager;
use russh_sftp::client::SftpSession;
use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

// Windows tar can't recreate POSIX symlinks: dereference them when the extracting end is Windows.
const LOCAL_IS_WINDOWS: bool = cfg!(windows);

// ── Shared shell fragments ────────────────────────────────────────────────────

/// Split a remote (always `/`-separated) path into parent and basename. A path
/// with no separator has parent `.` and is its own basename.
fn remote_split(path: &str) -> (&str, &str) {
    match path.rfind('/') {
        Some(i) => (&path[..i], &path[i + 1..]),
        None => (".", path),
    }
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

/// `tar -czf <archive> -C <parent> -- <items…>`, reporting its exit code. `deref`
/// follows symlinks, for an archive a Windows tar will extract. The `--` keeps
/// an item named like `--checkpoint-action=exec=…` from being read as an option;
/// GNU tar, bsdtar (macOS, Windows) and busybox all accept it.
fn tar_create_cmd(
    shell: &RemoteShell,
    archive: &str,
    deref: bool,
    parent: &str,
    items: &[String],
) -> Result<String, String> {
    let quoted: Vec<String> = items.iter().map(|i| shell.quote(i)).collect();
    let tar = format!(
        "tar -czf {arch} {deref}-C {parent} -- {items}",
        arch = shell.quote_path(archive),
        deref = if deref { shell.deref_flags() } else { "" },
        parent = shell.quote_path(parent),
        items = quoted.join(" "),
    );
    shell.checked(shell.status(&tar, None))
}

/// Make `dest`, then `tar -xzf <archive> -C <dest>`. `strip` drops the archive's
/// single top-level directory (a whole-directory transfer); `remove_archive`
/// deletes the archive afterwards but still reports the *extraction's* exit code.
fn tar_extract_cmd(
    shell: &RemoteShell,
    dest: &str,
    archive: &str,
    strip: bool,
    remove_archive: bool,
) -> String {
    let tar = format!(
        "tar -xzf {arch} {strip}-C {dest}",
        arch = shell.quote_path(archive),
        strip = if strip { "--strip-components=1 " } else { "" },
        dest = shell.quote_path(dest),
    );
    let cleanup = remove_archive.then(|| shell.rm(archive));
    shell.status(&shell.in_dir(dest, &tar), cleanup.as_deref())
}

async fn shell_of(manager: &SftpManager, sftp_id: &str) -> RemoteShell {
    remote_shell(manager, sftp_id)
        .await
        .unwrap_or(RemoteShell::Posix)
}

/// Remote path of a transfer's temp archive. The destination end gets a name of
/// its own: when both ends are the *same* host, one shared name means the
/// source's clean-up `rm -f` — which runs before the destination extracts —
/// deletes the very archive the extraction is waiting for.
fn remote_archive(shell: &RemoteShell, transfer_id: &str, dst: bool) -> String {
    let name = if dst {
        temp_archive_name(&format!("{transfer_id}_dst"))
    } else {
        temp_archive_name(transfer_id)
    };
    shell.temp_path(&name)
}

/// Archive `names` (all relative to `parent`) into `archive` with the local tar;
/// `--` as in `tar_create_cmd`.
async fn local_tar_create(
    archive: &Path,
    deref: bool,
    parent: &str,
    names: &[String],
) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new("tar");
    cmd.args(["-czf", archive.to_str().unwrap_or("")]);
    if deref {
        cmd.arg("-h");
    }
    cmd.args(["-C", parent, "--"]).args(names);
    crate::commands::win_proc::prevent_visible_child_window(&mut cmd);
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("tar not found: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// Extract `archive` into `dest` with the local tar, then delete the archive.
async fn local_tar_extract(archive: &Path, dest: &str, strip: bool) -> Result<(), String> {
    tokio::fs::create_dir_all(dest)
        .await
        .map_err(|e| format!("Cannot create local dir: {e}"))?;
    let mut cmd = tokio::process::Command::new("tar");
    cmd.arg("-xzf").arg(archive);
    if strip {
        cmd.arg("--strip-components=1");
    }
    cmd.args(["-C", dest]);
    crate::commands::win_proc::prevent_visible_child_window(&mut cmd);
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("tar not found: {e}"))?;
    let _ = tokio::fs::remove_file(archive).await;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

/// What every tar command threads through its three steps. Bundling it keeps
/// the workers' argument lists from swamping the logic they carry.
struct TarJob<'a> {
    app: &'a AppHandle,
    manager: &'a SftpManager,
    sftp_id: &'a str,
    transfer_id: &'a str,
    token: &'a CancellationToken,
    shell: RemoteShell,
}

impl<'a> TarJob<'a> {
    async fn new(
        app: &'a AppHandle,
        manager: &'a SftpManager,
        sftp_id: &'a str,
        transfer_id: &'a str,
        token: &'a CancellationToken,
    ) -> Self {
        Self {
            app,
            manager,
            sftp_id,
            transfer_id,
            token,
            shell: shell_of(manager, sftp_id).await,
        }
    }

    /// This transfer's temp archive, under the app cache dir locally and the remote temp dir.
    /// Not `std::env::temp_dir()`: on Android that is `/data/local/tmp`, which an app uid
    /// cannot write.
    fn temp_paths(&self) -> Result<(std::path::PathBuf, String), String> {
        let name = temp_archive_name(self.transfer_id);
        let local = crate::scratch::app_scratch_dir(self.app)?.join(&name);
        Ok((local, remote_archive(&self.shell, self.transfer_id, false)))
    }

    async fn exec(&self, cmd: &str) -> Result<(), String> {
        self.manager.exec_command(self.sftp_id, cmd).await
    }

    /// Best-effort cleanup of a remote temp archive.
    async fn rm_remote(&self, path: &str) {
        let _ = self.exec(&self.shell.rm(path)).await;
    }
}

/// Run `body` and deregister the transfer whichever way it ends.
async fn finish_with<F>(job: &TarJob<'_>, body: F) -> Result<(), String>
where
    F: Future<Output = Result<(), String>>,
{
    let result = body.await;
    job.manager.finish_transfer(job.transfer_id).await;
    result
}

/// Resolve the sftp id to a real SFTP session, or hand the whole job to the
/// backend's own implementation and **return** from the calling command.
///
/// The method call is passed as a token tree rather than a closure because the
/// fallback has to `return` out of the command, which a closure cannot do.
macro_rules! tar_session {
    ($state:expr, $sftp_id:expr, $transfer_id:expr, $method:ident($($arg:expr),* $(,)?)) => {
        match tar_backend(&$state, &$sftp_id).await {
            Ok(TarBackend::Session(session)) => session,
            Ok(TarBackend::Other(backend)) => {
                let r = backend.$method($($arg),*).await;
                $state.finish_transfer(&$transfer_id).await;
                return r;
            }
            Err(e) => {
                $state.finish_transfer(&$transfer_id).await;
                return Err(e);
            }
        }
    };
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
    let cmd = tar_create_cmd(
        &shell,
        &archive_path,
        false,
        parent,
        &[basename.to_string()],
    )?;
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
    let shell = shell_of(&sftp_state, &sftp_id).await;
    let cmd = tar_extract_cmd(&shell, &dest_dir, &archive_path, false, false);
    sftp_state.exec_command(&sftp_id, &cmd).await
}

// ── Tar-based directory transfer ──────────────────────────────────────────────

/// True if the remote host has a tar and a temp dir the archive can be staged in.
#[tauri::command]
pub async fn sftp_tar_available(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
) -> Result<bool, String> {
    Ok(remote_shell(&sftp_state, &sftp_id).await.is_some())
}

/// Archive `names` (relative to `local_parent`) locally, upload the archive, and
/// extract it into `remote_dir`. Shared by the batch and whole-directory uploads,
/// which differ only in `strip`.
async fn upload_tar(
    job: &TarJob<'_>,
    session: Arc<Mutex<SftpSession>>,
    local_parent: &str,
    names: &[String],
    remote_dir: &str,
    strip: bool,
) -> Result<(), String> {
    let (tmp_local, tmp_remote) = job.temp_paths()?;

    // 1. Archive locally
    local_tar_create(&tmp_local, job.shell.is_windows(), local_parent, names).await?;

    if job.token.is_cancelled() {
        let _ = tokio::fs::remove_file(&tmp_local).await;
        return Err("Transfer cancelled".into());
    }

    // 2. Upload archive
    let local = tmp_local.to_str().unwrap_or("").to_string();
    let uploaded = sftp_upload_inner(
        job.app,
        session,
        &local,
        &tmp_remote,
        job.transfer_id,
        job.token,
    )
    .await;
    let _ = tokio::fs::remove_file(&tmp_local).await;
    uploaded?;

    // 3. Extract on remote and clean up remote temp
    job.exec(&tar_extract_cmd(
        &job.shell,
        remote_dir,
        &tmp_remote,
        strip,
        true,
    ))
    .await
}

/// Archive `items` (relative to `remote_parent`) on the remote host, download the
/// archive, and extract it into `local_dir`.
async fn download_tar(
    job: &TarJob<'_>,
    session: Arc<Mutex<SftpSession>>,
    remote_parent: &str,
    items: &[String],
    local_dir: &str,
    strip: bool,
) -> Result<(), String> {
    let (tmp_local, tmp_remote) = job.temp_paths()?;

    // 1. Archive on remote
    job.exec(&tar_create_cmd(
        &job.shell,
        &tmp_remote,
        LOCAL_IS_WINDOWS,
        remote_parent,
        items,
    )?)
    .await?;

    if job.token.is_cancelled() {
        job.rm_remote(&tmp_remote).await;
        return Err("Transfer cancelled".into());
    }

    // 2. Download archive
    let local = tmp_local.to_str().unwrap_or("").to_string();
    let downloaded = sftp_download_inner(
        job.app,
        session,
        &tmp_remote,
        &local,
        job.transfer_id,
        job.token,
    )
    .await;
    // Clean up remote temp regardless of download result
    job.rm_remote(&tmp_remote).await;
    downloaded?;

    // 3. Extract locally
    local_tar_extract(&tmp_local, local_dir, strip).await
}

/// Archive `items` on the source host, stream the archive to the destination
/// host, and extract it into `dst_dir`.
#[allow(clippy::too_many_arguments)]
async fn transfer_tar(
    job: &TarJob<'_>,
    src_session: Arc<Mutex<SftpSession>>,
    dst_sftp_id: &str,
    dst_session: Arc<Mutex<SftpSession>>,
    src_parent: &str,
    items: &[String],
    dst_dir: &str,
    strip: bool,
) -> Result<(), String> {
    // `job.sftp_id` is the source; the destination archive is named apart so a
    // same-host transfer survives the source clean-up below.
    let (_, src_tmp) = job.temp_paths()?;
    let dst_shell = shell_of(job.manager, dst_sftp_id).await;
    let dst_tmp = remote_archive(&dst_shell, job.transfer_id, true);

    // 1. Archive on source
    job.exec(&tar_create_cmd(
        &job.shell,
        &src_tmp,
        dst_shell.is_windows(),
        src_parent,
        items,
    )?)
    .await?;

    if job.token.is_cancelled() {
        job.rm_remote(&src_tmp).await;
        return Err("Transfer cancelled".into());
    }

    // 2. Stream the archive between hosts
    let streamed = sftp_rr_file_inner(
        job.app,
        src_session,
        &src_tmp,
        dst_session,
        &dst_tmp,
        job.transfer_id,
        job.token,
    )
    .await;
    // Clean up source temp regardless
    job.rm_remote(&src_tmp).await;
    streamed?;

    // 3. Extract on destination and clean up
    let cmd = tar_extract_cmd(&dst_shell, dst_dir, &dst_tmp, strip, true);
    job.manager.exec_command(dst_sftp_id, &cmd).await
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
    let session = tar_session!(
        sftp_state,
        sftp_id,
        transfer_id,
        upload_batch(&app, &local_paths, &remote_dir, &transfer_id, &token)
    );

    // All paths share the same parent (same source directory in the UI)
    let (parent, _) = local_split(&local_paths[0]);
    let names: Vec<String> = local_paths
        .iter()
        .filter_map(|p| Path::new(p).file_name()?.to_str().map(str::to_string))
        .collect();

    let job = TarJob::new(&app, &sftp_state, &sftp_id, &transfer_id, &token).await;
    finish_with(
        &job,
        upload_tar(&job, session, &parent, &names, &remote_dir, false),
    )
    .await
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
    let session = tar_session!(
        sftp_state,
        sftp_id,
        transfer_id,
        download_batch(&app, &remote_paths, &local_dir, &transfer_id, &token)
    );

    let (parent, _) = remote_split(&remote_paths[0]);
    let items: Vec<String> = remote_paths
        .iter()
        .filter_map(|p| p.rfind('/').map(|i| p[i + 1..].to_string()))
        .collect();

    let job = TarJob::new(&app, &sftp_state, &sftp_id, &transfer_id, &token).await;
    finish_with(
        &job,
        download_tar(&job, session, parent, &items, &local_dir, false),
    )
    .await
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

    let (parent, _) = remote_split(&src_paths[0]);
    let items: Vec<String> = src_paths
        .iter()
        .filter_map(|p| p.rfind('/').map(|i| p[i + 1..].to_string()))
        .collect();

    let job = TarJob::new(&app, &sftp_state, &src_sftp_id, &transfer_id, &token).await;
    finish_with(
        &job,
        transfer_tar(
            &job,
            src_session,
            &dst_sftp_id,
            dst_session,
            parent,
            &items,
            &dst_dir,
            false,
        ),
    )
    .await
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
    let session = tar_session!(
        sftp_state,
        sftp_id,
        transfer_id,
        upload_dir(&app, &local_path, &remote_path, &transfer_id, &token)
    );

    let (parent, basename) = local_split(&local_path);

    let job = TarJob::new(&app, &sftp_state, &sftp_id, &transfer_id, &token).await;
    finish_with(
        &job,
        upload_tar(&job, session, &parent, &[basename], &remote_path, true),
    )
    .await
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
    let session = tar_session!(
        sftp_state,
        sftp_id,
        transfer_id,
        download_dir(&app, &remote_path, &local_path, &transfer_id, &token)
    );

    let (parent, basename) = remote_split(&remote_path);
    let items = [basename.to_string()];

    let job = TarJob::new(&app, &sftp_state, &sftp_id, &transfer_id, &token).await;
    finish_with(
        &job,
        download_tar(&job, session, parent, &items, &local_path, true),
    )
    .await
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

    let (parent, basename) = remote_split(&src_path);
    let items = [basename.to_string()];

    let job = TarJob::new(&app, &sftp_state, &src_sftp_id, &transfer_id, &token).await;
    finish_with(
        &job,
        transfer_tar(
            &job,
            src_session,
            &dst_sftp_id,
            dst_session,
            parent,
            &items,
            &dst_path,
            true,
        ),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_split_separates_parent_from_basename() {
        assert_eq!(remote_split("/srv/data/logs"), ("/srv/data", "logs"));
        assert_eq!(remote_split("logs"), (".", "logs"));
        assert_eq!(remote_split("/logs"), ("", "logs"));
    }

    #[test]
    fn local_split_keeps_the_empty_parent_a_bare_file_name_has() {
        assert_eq!(
            local_split("/srv/data/logs"),
            ("/srv/data".to_string(), "logs".to_string())
        );
        assert_eq!(local_split("logs"), (String::new(), "logs".to_string()));
    }

    const SH: &RemoteShell = &RemoteShell::Posix;

    fn cmd_exe() -> RemoteShell {
        RemoteShell::Windows {
            shell: super::super::remote_shell::WinShell::Cmd,
            temp: r"C:\Temp".into(),
        }
    }

    #[test]
    fn create_quotes_every_item_and_reports_its_exit_code() {
        assert_eq!(
            tar_create_cmd(
                SH,
                "/tmp/a.tar.gz",
                false,
                "/srv",
                &["x".into(), "y z".into()]
            ),
            Ok("tar -czf '/tmp/a.tar.gz' -C '/srv' -- 'x' 'y z' 2>&1; echo __TF_EXIT__:$?".into())
        );
    }

    #[test]
    fn create_only_dereferences_when_asked() {
        let with = tar_create_cmd(SH, "/tmp/a", true, "/srv", &["x".into()]).unwrap();
        let without = tar_create_cmd(SH, "/tmp/a", false, "/srv", &["x".into()]).unwrap();
        assert!(!without.contains("-h "));
        assert_eq!(
            with,
            without.replacen("-C", "-h --ignore-failed-read -C", 1)
        );
    }

    #[test]
    fn extract_makes_the_destination_and_reports_its_exit_code() {
        assert_eq!(
            tar_extract_cmd(SH, "/dest", "/tmp/a.tar.gz", false, false),
            "mkdir -p '/dest' && tar -xzf '/tmp/a.tar.gz' -C '/dest' 2>&1; echo __TF_EXIT__:$?"
        );
    }

    #[test]
    fn extract_strips_the_top_level_dir_for_a_whole_directory_transfer() {
        let cmd = tar_extract_cmd(SH, "/dest", "/tmp/a", true, false);
        assert!(cmd.contains("--strip-components=1 -C '/dest'"));
    }

    #[test]
    fn extract_removing_the_archive_still_reports_the_extraction_exit_code() {
        assert_eq!(
            tar_extract_cmd(SH, "/dest", "/tmp/a", false, true),
            "mkdir -p '/dest' && tar -xzf '/tmp/a' -C '/dest' 2>&1; \
             RC=$?; rm -f '/tmp/a'; echo __TF_EXIT__:$RC"
        );
    }

    #[test]
    fn windows_extract_uses_native_paths_and_cleans_up_on_either_outcome() {
        assert_eq!(
            tar_extract_cmd(&cmd_exe(), "/C:/dest dir", "/C:/Temp/a.tar.gz", false, true),
            r#"(mkdir "C:\dest dir" 2>nul & tar -xzf "C:\Temp\a.tar.gz" -C "C:\dest dir") 2>&1 && (del /f /q "C:\Temp\a.tar.gz" 2>nul & echo __TF_EXIT__:0) || (del /f /q "C:\Temp\a.tar.gz" 2>nul & echo __TF_EXIT__:1)"#
        );
    }

    #[test]
    fn windows_create_at_a_drive_root_archives_from_the_root() {
        let cmd = tar_create_cmd(&cmd_exe(), "/C:/Temp/a", false, "/C:", &["x".into()]).unwrap();
        assert!(cmd.contains(r#"-C "C:\." -- "x""#));
    }

    #[test]
    fn create_never_reads_an_item_as_an_option() {
        let cmd = tar_create_cmd(SH, "/tmp/a", false, "/srv", &["--version".into()]).unwrap();
        assert!(cmd.contains("-C '/srv' -- '--version'"), "{cmd}");
    }

    #[tokio::test]
    async fn local_tar_archives_a_file_named_like_an_option() {
        let (src, dst) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(src.path().join("--version"), b"v").unwrap();
        let archive = src.path().join("a.tar.gz");
        let parent = src.path().to_str().unwrap();
        local_tar_create(&archive, false, parent, &["--version".into()])
            .await
            .unwrap();
        local_tar_extract(&archive, dst.path().to_str().unwrap(), false)
            .await
            .unwrap();
        assert_eq!(std::fs::read(dst.path().join("--version")).unwrap(), b"v");
    }

    #[test]
    fn the_two_ends_of_a_transfer_never_name_the_same_archive() {
        let src = remote_archive(SH, "t1", false);
        let dst = remote_archive(SH, "t1", true);
        assert_eq!(src, "/tmp/tf_t1.tar.gz");
        assert_eq!(dst, "/tmp/tf_t1_dst.tar.gz");
        assert_ne!(src, dst);
    }

    #[test]
    fn removing_the_source_archive_leaves_the_destination_one_alone() {
        let dst = remote_archive(SH, "t1", true);
        assert!(!SH.rm(&remote_archive(SH, "t1", false)).contains(&dst));
    }

    #[test]
    fn rm_remote_quotes_its_path() {
        assert_eq!(SH.rm("/tmp/a b"), "rm -f '/tmp/a b'");
    }
}
