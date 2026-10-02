//! A `docker exec`-based filesystem backend for containers that have no
//! `sftp-server` binary (the common case for slim images). Every operation runs
//! a short shell command inside the container over the host's SSH connection,
//! so it needs only docker-group access — no root, no nsenter, no binary in the
//! container.
//!
//! Dynamic paths are always passed as positional args to `sh -c '<script>' x <arg…>`
//! and host-shell-quoted exactly once, so the fixed script never has to escape
//! user data. Listing/parsing assumes filenames contain no tab or newline
//! characters (acceptable for a file manager).

use crate::commands::sftp::editor::read_limit;
use crate::commands::sftp::{pump_chunks, RemoteFile};
use crate::error::AppError;
use crate::sftp::backend::FileBackend;
use crate::ssh::client::SshClient;
use crate::ssh::exec::{
    drain_channel, exit_error, open_exec, run_captured, sh_c, shell_quote, Captured,
};
use crate::ssh::live_cells::read_cell;
use crate::ssh::session::SessionHandle;
use async_trait::async_trait;
use russh::client::Handle;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

/// How much of a failing local tar's stderr is kept for its error message.
const STDERR_TAIL: usize = 4096;

/// A local `tar` whose stderr is drained while it runs. Piped and left unread,
/// stderr fills its pipe (~64 KB of "file changed as we read it" and the like)
/// and tar blocks on its next warning, hanging the transfer for good.
struct LocalTar {
    child: tokio::process::Child,
    stderr: tokio::task::JoinHandle<Vec<u8>>,
}

impl LocalTar {
    /// Spawn `cmd` — tar with its args and data pipe already set — with stderr
    /// drained in the background.
    fn spawn(cmd: &mut tokio::process::Command) -> Result<Self, String> {
        cmd.stderr(Stdio::piped());
        crate::commands::win_proc::prevent_visible_child_window(cmd);
        let mut child = cmd.spawn().map_err(|e| format!("tar not found: {e}"))?;
        let stderr = child.stderr.take().ok_or("tar stderr unavailable")?;
        Ok(Self {
            child,
            stderr: tokio::spawn(read_tail(stderr, STDERR_TAIL)),
        })
    }

    /// Stop tar after the transfer failed on the other end.
    async fn kill(mut self) {
        let _ = self.child.kill().await;
    }

    /// Wait for tar to exit; a failure reads `failure: <stderr tail>`.
    async fn finish(mut self, failure: &str) -> Result<(), String> {
        let status = self
            .child
            .wait()
            .await
            .map_err(|e| format!("tar wait error: {e}"))?;
        if status.success() {
            return Ok(());
        }
        let stderr = self.stderr.await.unwrap_or_default();
        let detail = String::from_utf8_lossy(&stderr);
        Err(match detail.trim() {
            "" => failure.to_string(),
            detail => format!("{failure}: {detail}"),
        })
    }
}

/// Read `reader` to its end, keeping only its last `keep` bytes.
async fn read_tail<R: AsyncRead + Unpin>(mut reader: R, keep: usize) -> Vec<u8> {
    let mut tail = Vec::new();
    let mut buf = [0u8; 4096];
    while let Ok(n @ 1..) = reader.read(&mut buf).await {
        tail.extend_from_slice(&buf[..n]);
        let excess = tail.len().saturating_sub(keep);
        tail.drain(..excess);
    }
    tail
}

fn parent_of(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => "/",
        Some(i) => &trimmed[..i],
        None => ".",
    }
}

fn basename_of(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    trimmed
        .rfind('/')
        .map(|i| &trimmed[i + 1..])
        .unwrap_or(trimmed)
}

#[derive(Clone)]
pub struct DockerFs {
    /// Live handle of the host session, so exec channels are opened on whatever
    /// connection the terminal currently has rather than the one present when
    /// the panel was first opened.
    handle: SessionHandle,
    container_id: String,
}

impl DockerFs {
    pub fn new(handle: SessionHandle, container_id: String) -> Self {
        Self {
            handle,
            container_id,
        }
    }

    fn ssh(&self) -> Arc<Handle<SshClient>> {
        read_cell(&self.handle)
    }

    /// Build a `docker exec -i <cid> sh -c '<script>' x <arg…>` command string.
    fn dexec(&self, script: &str, args: &[&str]) -> String {
        format!(
            "docker exec -i {} {}",
            shell_quote(&self.container_id),
            sh_c(script, args)
        )
    }

    /// Open a channel on the live host session and start `cmd` on it.
    async fn exec_channel(&self, cmd: &str) -> Result<russh::Channel<russh::client::Msg>, String> {
        open_exec(&self.ssh(), cmd).await
    }

    /// Run a command on the host, capturing raw stdout, stderr, and exit status.
    async fn run_bytes(&self, cmd: &str) -> Result<(Vec<u8>, String, Option<i32>), String> {
        let c = run_captured(&self.ssh(), cmd).await?;
        Ok((c.stdout, c.stderr, c.code))
    }

    /// `run_bytes` with stdout as text.
    async fn run(&self, cmd: &str) -> Result<(String, String, Option<i32>), String> {
        let (out, err, code) = self.run_bytes(cmd).await?;
        Ok((String::from_utf8_lossy(&out).into_owned(), err, code))
    }

    async fn simple(&self, script: &str, args: &[&str], label: &str) -> Result<(), AppError> {
        let (_out, err, code) = self.run(&self.dexec(script, args)).await?;
        Ok(exit_error(label, code, &err)?)
    }

    /// Wait for a streaming-upload command to finish and report any error.
    /// The channel produces no stdout here, so it drains into a sink.
    async fn drain_exit(
        &self,
        channel: &mut russh::Channel<russh::client::Msg>,
        label: &str,
    ) -> Result<(), String> {
        let (code, err) = drain_channel(channel, &mut tokio::io::sink(), None, None).await?;
        exit_error(
            &format!("{label} failed"),
            code,
            &String::from_utf8_lossy(&err),
        )
    }

    /// Spawn a local `tar` producer and stream its stdout into a container command's stdin.
    async fn tar_into_container(
        &self,
        app: &AppHandle,
        tar_args: &[&str],
        remote_cmd: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let mut tar = LocalTar::spawn(
            tokio::process::Command::new("tar")
                .args(tar_args)
                .stdout(Stdio::piped()),
        )?;
        let mut tar_out = tar.child.stdout.take().ok_or("tar stdout unavailable")?;

        let mut channel = self.exec_channel(remote_cmd).await?;
        let mut writer = channel.make_writer();

        let mut transferred = 0u64;
        // Any failure, cancellation included, must reap the local tar first.
        if let Err(e) = pump_chunks(
            app,
            &mut tar_out,
            &mut writer,
            transfer_id,
            token,
            &mut transferred,
            0,
        )
        .await
        {
            tar.kill().await;
            return Err(e);
        }
        writer.flush().await.ok();
        drop(writer);
        channel.eof().await.ok();

        tar.finish("Local tar archiving failed").await?;
        self.drain_exit(&mut channel, "upload").await
    }

    /// Run a container `tar` producer and stream its stdout into a local `tar` extractor.
    async fn tar_from_container(
        &self,
        app: &AppHandle,
        remote_cmd: &str,
        local_dir: &str,
        tar_args: &[&str],
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        tokio::fs::create_dir_all(local_dir)
            .await
            .map_err(|e| format!("Cannot create local dir: {e}"))?;

        let mut tar = LocalTar::spawn(
            tokio::process::Command::new("tar")
                .args(tar_args)
                .stdin(Stdio::piped()),
        )?;
        let mut tar_in = tar.child.stdin.take().ok_or("tar stdin unavailable")?;

        let mut channel = self.exec_channel(remote_cmd).await?;

        // Any failure, cancellation included, must reap the local tar first.
        let drained = drain_channel(
            &mut channel,
            &mut tar_in,
            Some((app, transfer_id, 0)),
            Some(token),
        )
        .await;
        let (code, err) = match drained {
            Ok(v) => v,
            Err(e) => {
                tar.kill().await;
                return Err(e);
            }
        };
        drop(tar_in); // close stdin so local tar finishes
        let extracted = tar.finish("Local tar extraction failed").await;
        exit_error("download failed", code, &String::from_utf8_lossy(&err))?;
        extracted
    }
}

/// The docker-exec backend implements every `FileBackend` operation
/// directly; the private helpers above are the shell plumbing they share.
#[async_trait]
impl FileBackend for DockerFs {
    // ── Browse ──────────────────────────────────────────────────────────────

    async fn run_sh(&self, script: &str, args: &[&str]) -> Result<Captured, String> {
        run_captured(&self.ssh(), &self.dexec(script, args)).await
    }

    async fn canonicalize(&self, path: &str) -> Result<String, AppError> {
        // readlink -f resolves "." and relative paths to an absolute path; fall
        // back to `cd && pwd` for shells whose readlink lacks -f.
        let script = "readlink -f \"$1\" 2>/dev/null || { cd \"$1\" 2>/dev/null && pwd; }";
        let (out, err, code) = self.run(&self.dexec(script, &[path])).await?;
        let resolved = out.trim();
        if code != Some(0) || resolved.is_empty() {
            return Err(if err.trim().is_empty() {
                format!("Cannot resolve path: {path}")
            } else {
                err.trim().to_string()
            }
            .into());
        }
        Ok(resolved.to_string())
    }

    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, AppError> {
        // For each entry emit: is_symlink \t is_dir \t size \t mtime \t mode \t name
        // `./$e` everywhere so filenames beginning with '-' aren't parsed as test flags.
        let script = "cd \"$1\" || exit 3; \
             for e in * .*; do \
               [ \"$e\" = \".\" ] && continue; \
               [ \"$e\" = \"..\" ] && continue; \
               { [ -e \"./$e\" ] || [ -L \"./$e\" ]; } || continue; \
               if [ -L \"./$e\" ]; then L=1; else L=0; fi; \
               if [ -d \"./$e\" ]; then D=1; else D=0; fi; \
               S=$(stat -c %s \"./$e\" 2>/dev/null || echo 0); \
               M=$(stat -c %Y \"./$e\" 2>/dev/null || echo 0); \
               P=$(stat -c %a \"./$e\" 2>/dev/null || echo 0); \
               printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \"$L\" \"$D\" \"$S\" \"$M\" \"$P\" \"$e\"; \
             done";
        let (out, err, code) = self.run(&self.dexec(script, &[path])).await?;
        if code != Some(0) {
            return Err(format!(
                "read_dir failed: {}",
                if err.trim().is_empty() {
                    format!("cannot access {path}")
                } else {
                    err.trim().to_string()
                }
            )
            .into());
        }
        let base = path.trim_end_matches('/');
        let mut files: Vec<RemoteFile> = Vec::new();
        for line in out.lines() {
            let mut parts = line.splitn(6, '\t');
            let (Some(l), Some(d), Some(s), Some(m), Some(p), Some(name)) = (
                parts.next(),
                parts.next(),
                parts.next(),
                parts.next(),
                parts.next(),
                parts.next(),
            ) else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            let entry_path = if base.is_empty() {
                format!("/{name}")
            } else {
                format!("{base}/{name}")
            };
            files.push(RemoteFile {
                path: entry_path,
                name: name.to_string(),
                size: s.parse().unwrap_or(0),
                is_dir: d == "1",
                is_symlink: l == "1",
                modified: m.parse::<u64>().ok().filter(|&t| t > 0),
                permissions: u32::from_str_radix(p.trim(), 8).ok(),
            });
        }
        files.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(files)
    }

    /// Returns Some(is_dir) if path exists, None if it doesn't.
    ///
    /// Only exit 7 means "absent". Anything else non-zero — a container that is
    /// gone, a `docker exec` the host refused, a lost exit status — is an error,
    /// never a silent "exists, and is a file".
    async fn stat(&self, path: &str) -> Result<Option<bool>, String> {
        let script = "{ [ -e \"$1\" ] || [ -L \"$1\" ]; } || exit 7; \
             if [ -d \"$1\" ]; then echo d; else echo f; fi";
        let (out, err, code) = self.run(&self.dexec(script, &[path])).await?;
        if code == Some(7) {
            return Ok(None);
        }
        exit_error("stat failed", code, &err)?;
        Ok(Some(out.trim() == "d"))
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        self.simple("mkdir \"$1\"", &[path], "mkdir failed").await
    }

    async fn touch(&self, path: &str) -> Result<(), AppError> {
        self.simple("touch \"$1\"", &[path], "touch failed").await
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        self.simple("mv \"$1\" \"$2\"", &[from, to], "rename failed")
            .await
    }

    async fn delete(&self, path: &str) -> Result<(), AppError> {
        self.simple("rm -rf \"$1\"", &[path], "delete failed").await
    }

    async fn file_size(&self, path: &str) -> u64 {
        let script = "stat -c %s \"$1\" 2>/dev/null || echo 0";
        self.run(&self.dexec(script, &[path]))
            .await
            .ok()
            .and_then(|(out, _, _)| out.trim().parse().ok())
            .unwrap_or(0)
    }

    async fn read_file(&self, path: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
        // `head -c` stops at the limit inside the container, so an endless file
        // (`/dev/zero`) is cut off there rather than streamed here without end.
        // The channel carries raw bytes, so no base64 round trip is needed.
        let limit = read_limit(max_bytes).to_string();
        let script = self.dexec("head -c \"$2\" \"$1\"", &[path, &limit]);
        let (out, err, code) = self.run_bytes(&script).await?;
        exit_error("read failed", code, &err).map(|()| out)
    }

    async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let cmd = self.dexec("cat > \"$1\"", &[path]);
        let mut channel = self.exec_channel(&cmd).await?;
        let mut writer = channel.make_writer();
        writer
            .write_all(content.as_bytes())
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        writer.flush().await.ok();
        drop(writer);
        channel.eof().await.ok();
        self.drain_exit(&mut channel, "write").await
    }

    // ── Single file transfer ──────────────────────────────────────────────────

    async fn upload_file(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let mut local = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| format!("Cannot open local file: {e}"))?;
        let total = local.metadata().await.map(|m| m.len()).unwrap_or(0);

        let cmd = self.dexec("cat > \"$1\"", &[remote_path]);
        let mut channel = self.exec_channel(&cmd).await?;
        let mut writer = channel.make_writer();

        let mut transferred = 0u64;
        pump_chunks(
            app,
            &mut local,
            &mut writer,
            transfer_id,
            token,
            &mut transferred,
            total,
        )
        .await?;
        writer.flush().await.ok();
        drop(writer);
        channel.eof().await.ok();
        self.drain_exit(&mut channel, "upload").await
    }

    async fn download_file(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let total = self.file_size(remote_path).await;
        if let Some(parent) = Path::new(local_path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Cannot create local dir: {e}"))?;
        }
        let mut local = tokio::fs::File::create(local_path)
            .await
            .map_err(|e| format!("Cannot create local file: {e}"))?;

        let cmd = self.dexec("cat \"$1\"", &[remote_path]);
        let mut channel = self.exec_channel(&cmd).await?;

        let (code, err) = drain_channel(
            &mut channel,
            &mut local,
            Some((app, transfer_id, total)),
            Some(token),
        )
        .await?;
        local.flush().await.ok();
        exit_error("download failed", code, &String::from_utf8_lossy(&err))
    }

    // ── Directory / batch transfer (tar streaming) ─────────────────────────────

    /// Upload a local directory: `tar -c` locally → pipe into the container,
    /// where `tar -x --strip-components=1` lands the directory's contents in
    /// `remote_path` (mirrors the SFTP `*_dir_tar` semantics).
    async fn upload_dir(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let parent = Path::new(local_path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(".");
        let base = Path::new(local_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let remote_script = "mkdir -p \"$1\" && tar -C \"$1\" --strip-components=1 -xzf -";
        self.tar_into_container(
            app,
            &["-C", parent, "-czf", "-", "--", base],
            &self.dexec(remote_script, &[remote_path]),
            transfer_id,
            token,
        )
        .await
    }

    /// Upload several local items that share a parent directory into `remote_dir`.
    async fn upload_batch(
        &self,
        app: &AppHandle,
        local_paths: &[String],
        remote_dir: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        if local_paths.is_empty() {
            return Ok(());
        }
        let parent = Path::new(&local_paths[0])
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(".");
        let mut args: Vec<&str> = vec!["-C", parent, "-czf", "-", "--"];
        for p in local_paths {
            if let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) {
                args.push(name);
            }
        }
        let remote_script = "mkdir -p \"$1\" && tar -C \"$1\" -xzf -";
        self.tar_into_container(
            app,
            &args,
            &self.dexec(remote_script, &[remote_dir]),
            transfer_id,
            token,
        )
        .await
    }

    /// Download a container directory: `tar -c` in the container → pipe to local
    /// `tar -x --strip-components=1` so the directory's contents land in `local_path`.
    async fn download_dir(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let parent = parent_of(remote_path).to_string();
        let base = basename_of(remote_path).to_string();
        let remote_cmd = self.dexec("tar -C \"$1\" -czf - -- \"$2\"", &[&parent, &base]);
        self.tar_from_container(
            app,
            &remote_cmd,
            local_path,
            &["-C", local_path, "--strip-components=1", "-xzf", "-"],
            transfer_id,
            token,
        )
        .await
    }

    /// Download several container items that share a parent into `local_dir`.
    async fn download_batch(
        &self,
        app: &AppHandle,
        remote_paths: &[String],
        local_dir: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        if remote_paths.is_empty() {
            return Ok(());
        }
        let parent = parent_of(&remote_paths[0]).to_string();
        // sh -c 'cd "$1"; shift; tar -czf - -- "$@"' x <parent> <base…>
        let mut args: Vec<&str> = vec![&parent];
        let basenames: Vec<String> = remote_paths
            .iter()
            .map(|p| basename_of(p).to_string())
            .collect();
        for b in &basenames {
            args.push(b);
        }
        let remote_cmd = self.dexec("cd \"$1\" || exit 3; shift; tar -czf - -- \"$@\"", &args);
        self.tar_from_container(
            app,
            &remote_cmd,
            local_dir,
            &["-C", local_dir, "-xzf", "-"],
            transfer_id,
            token,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn read_tail_keeps_only_the_end() {
        let input: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
        let tail = read_tail(&input[..], 100).await;
        assert_eq!(tail, &input[input.len() - 100..]);
        assert_eq!(read_tail(&b"short"[..], 100).await, b"short");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_chatty_local_process_does_not_block_on_stderr() {
        // 1 MB of stderr: far past a pipe's buffer, so an undrained stderr hangs here.
        let tar = LocalTar::spawn(
            tokio::process::Command::new("sh")
                .args(["-c", "head -c 1000000 /dev/zero | tr '\\0' x >&2; exit 3"]),
        )
        .unwrap();
        let err =
            tokio::time::timeout(std::time::Duration::from_secs(10), tar.finish("tar failed"))
                .await
                .expect("stderr was not drained")
                .unwrap_err();
        assert!(err.starts_with("tar failed: xxx"));
        assert!(err.len() <= "tar failed: ".len() + STDERR_TAIL);
    }

    #[test]
    fn parent_and_basename_split_a_remote_path() {
        assert_eq!(parent_of("/srv/data/logs"), "/srv/data");
        assert_eq!(parent_of("/logs"), "/");
        assert_eq!(parent_of("logs"), ".");
        assert_eq!(basename_of("/srv/data/logs/"), "logs");
        assert_eq!(basename_of("logs"), "logs");
    }
}
