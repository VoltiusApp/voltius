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
use crate::commands::sftp::{pump_chunks, sort_listing, RemoteFile};
use crate::commands::sftp::{TarProbe, TransferProgress};
use crate::error::AppError;
use crate::sftp::backend::{FileBackend, TransferEvents};
use crate::ssh::client::SshClient;
use crate::ssh::exec::{
    drain_channel, exit_error, open_exec, run_captured, sh_c, shell_quote, Captured,
};
use crate::ssh::live_cells::read_cell;
use crate::ssh::session::SessionHandle;
use async_trait::async_trait;
use russh::client::Handle;
use std::path::Path;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct DockerFs {
    /// Live handle of the host session, so exec channels are opened on whatever
    /// connection the terminal currently has rather than the one present when
    /// the panel was first opened.
    handle: SessionHandle,
    container_id: String,
    tar: Arc<TarProbe>,
}

impl DockerFs {
    pub fn new(handle: SessionHandle, container_id: String) -> Self {
        Self {
            tar: Arc::new(TarProbe::new(
                Arc::clone(&handle),
                Some(container_id.clone()),
            )),
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
}

/// The docker-exec backend implements every `FileBackend` operation
/// directly; the private helpers above are the shell plumbing they share.
#[async_trait]
impl FileBackend for DockerFs {
    fn tar_probe(&self) -> Option<&TarProbe> {
        Some(&self.tar)
    }

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
        sort_listing(&mut files);
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

        let mut transferred = 0u64;
        let mut on_data = |chunk: &[u8]| {
            transferred += chunk.len() as u64;
            app.send(
                &format!("sftp-progress-{transfer_id}"),
                TransferProgress { transferred, total },
            );
        };
        let (code, err) =
            drain_channel(&mut channel, &mut local, Some(&mut on_data), Some(token)).await?;
        local.flush().await.ok();
        exit_error("download failed", code, &String::from_utf8_lossy(&err))
    }
}
