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

use crate::commands::sftp::{RemoteFile, TransferProgress};
use crate::ssh::client::SshClient;
use russh::client::Handle;
use russh::ChannelMsg;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

const CHUNK_SIZE: usize = 256 * 1024;

/// Single-quote a string for the host POSIX shell.
fn q(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
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
    trimmed.rfind('/').map(|i| &trimmed[i + 1..]).unwrap_or(trimmed)
}

#[derive(Clone)]
pub struct DockerFs {
    handle: Arc<Handle<SshClient>>,
    container_id: String,
}

impl DockerFs {
    pub fn new(handle: Arc<Handle<SshClient>>, container_id: String) -> Self {
        Self { handle, container_id }
    }

    /// Build a `docker exec -i <cid> sh -c '<script>' x <arg…>` command string.
    fn dexec(&self, script: &str, args: &[&str]) -> String {
        let mut cmd = format!(
            "docker exec -i {cid} sh -c {script} x",
            cid = q(&self.container_id),
            script = q(script),
        );
        for a in args {
            cmd.push(' ');
            cmd.push_str(&q(a));
        }
        cmd
    }

    /// Run a command on the host, capturing stdout, stderr, and exit code.
    async fn run(&self, cmd: &str) -> Result<(String, String, i32), String> {
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("channel error: {e}"))?;
        channel
            .exec(true, cmd)
            .await
            .map_err(|e| format!("exec error: {e}"))?;
        let mut out = Vec::new();
        let mut err = Vec::new();
        let mut code = 0i32;
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => out.extend_from_slice(&data),
                Some(ChannelMsg::ExtendedData { data, .. }) => err.extend_from_slice(&data),
                Some(ChannelMsg::ExitStatus { exit_status }) => code = exit_status as i32,
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
        Ok((
            String::from_utf8_lossy(&out).into_owned(),
            String::from_utf8_lossy(&err).into_owned(),
            code,
        ))
    }

    // ── Browse ──────────────────────────────────────────────────────────────

    pub async fn canonicalize(&self, path: &str) -> Result<String, String> {
        // readlink -f resolves "." and relative paths to an absolute path; fall
        // back to `cd && pwd` for shells whose readlink lacks -f.
        let script = "readlink -f \"$1\" 2>/dev/null || { cd \"$1\" 2>/dev/null && pwd; }";
        let (out, err, code) = self.run(&self.dexec(script, &[path])).await?;
        let resolved = out.trim();
        if code != 0 || resolved.is_empty() {
            return Err(if err.trim().is_empty() {
                format!("Cannot resolve path: {path}")
            } else {
                err.trim().to_string()
            });
        }
        Ok(resolved.to_string())
    }

    pub async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, String> {
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
        if code != 0 {
            return Err(format!(
                "read_dir failed: {}",
                if err.trim().is_empty() { format!("cannot access {path}") } else { err.trim().to_string() }
            ));
        }
        let base = path.trim_end_matches('/');
        let mut files: Vec<RemoteFile> = Vec::new();
        for line in out.lines() {
            let mut parts = line.splitn(6, '\t');
            let (Some(l), Some(d), Some(s), Some(m), Some(p), Some(name)) = (
                parts.next(), parts.next(), parts.next(), parts.next(), parts.next(), parts.next(),
            ) else { continue };
            if name.is_empty() { continue; }
            let entry_path = if base.is_empty() { format!("/{name}") } else { format!("{base}/{name}") };
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
    pub async fn stat(&self, path: &str) -> Result<Option<bool>, String> {
        let script = "{ [ -e \"$1\" ] || [ -L \"$1\" ]; } || exit 7; \
             if [ -d \"$1\" ]; then echo d; else echo f; fi";
        let (out, _err, code) = self.run(&self.dexec(script, &[path])).await?;
        if code == 7 {
            return Ok(None);
        }
        Ok(Some(out.trim() == "d"))
    }

    pub async fn mkdir(&self, path: &str) -> Result<(), String> {
        self.simple("mkdir \"$1\"", &[path], "mkdir failed").await
    }

    pub async fn touch(&self, path: &str) -> Result<(), String> {
        self.simple("touch \"$1\"", &[path], "touch failed").await
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        self.simple("mv \"$1\" \"$2\"", &[from, to], "rename failed").await
    }

    pub async fn delete(&self, path: &str) -> Result<(), String> {
        self.simple("rm -rf \"$1\"", &[path], "delete failed").await
    }

    async fn simple(&self, script: &str, args: &[&str], label: &str) -> Result<(), String> {
        let (_out, err, code) = self.run(&self.dexec(script, args)).await?;
        if code != 0 {
            return Err(format!(
                "{label}: {}",
                if err.trim().is_empty() { format!("exit {code}") } else { err.trim().to_string() }
            ));
        }
        Ok(())
    }

    async fn file_size(&self, path: &str) -> u64 {
        let script = "stat -c %s \"$1\" 2>/dev/null || echo 0";
        self.run(&self.dexec(script, &[path]))
            .await
            .ok()
            .and_then(|(out, _, _)| out.trim().parse().ok())
            .unwrap_or(0)
    }

    // ── Single file transfer ──────────────────────────────────────────────────

    pub async fn upload_file(
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
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("channel error: {e}"))?;
        channel.exec(true, cmd.as_str()).await.map_err(|e| format!("exec error: {e}"))?;
        let mut writer = channel.make_writer();

        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut transferred = 0u64;
        loop {
            if token.is_cancelled() {
                return Err("Transfer cancelled".into());
            }
            let n = local.read(&mut buf).await.map_err(|e| format!("Read error: {e}"))?;
            if n == 0 {
                break;
            }
            writer.write_all(&buf[..n]).await.map_err(|e| format!("Write error: {e}"))?;
            transferred += n as u64;
            let _ = app.emit(
                &format!("sftp-progress-{transfer_id}"),
                TransferProgress { transferred, total },
            );
        }
        writer.flush().await.ok();
        drop(writer);
        channel.eof().await.ok();
        self.drain_exit(&mut channel, "upload").await
    }

    pub async fn download_file(
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
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("channel error: {e}"))?;
        channel.exec(true, cmd.as_str()).await.map_err(|e| format!("exec error: {e}"))?;

        let mut transferred = 0u64;
        let mut err = Vec::new();
        let mut code = 0i32;
        loop {
            if token.is_cancelled() {
                return Err("Transfer cancelled".into());
            }
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    local.write_all(&data).await.map_err(|e| format!("Write error: {e}"))?;
                    transferred += data.len() as u64;
                    let _ = app.emit(
                        &format!("sftp-progress-{transfer_id}"),
                        TransferProgress { transferred, total },
                    );
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => err.extend_from_slice(&data),
                Some(ChannelMsg::ExitStatus { exit_status }) => code = exit_status as i32,
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
        local.flush().await.ok();
        if code != 0 {
            let msg = String::from_utf8_lossy(&err);
            return Err(format!("download failed: {}", msg.trim()));
        }
        Ok(())
    }

    /// Wait for a streaming-upload command to finish and report any error.
    async fn drain_exit(
        &self,
        channel: &mut russh::Channel<russh::client::Msg>,
        label: &str,
    ) -> Result<(), String> {
        let mut err = Vec::new();
        let mut code = 0i32;
        loop {
            match channel.wait().await {
                Some(ChannelMsg::ExtendedData { data, .. }) => err.extend_from_slice(&data),
                Some(ChannelMsg::ExitStatus { exit_status }) => code = exit_status as i32,
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
        if code != 0 {
            let msg = String::from_utf8_lossy(&err);
            return Err(format!("{label} failed: {}", msg.trim()));
        }
        Ok(())
    }

    // ── Directory / batch transfer (tar streaming) ─────────────────────────────

    /// Upload a local directory: `tar -c` locally → pipe into the container,
    /// where `tar -x --strip-components=1` lands the directory's contents in
    /// `remote_path` (mirrors the SFTP `*_dir_tar` semantics).
    pub async fn upload_dir(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let parent = Path::new(local_path).parent().and_then(|p| p.to_str()).unwrap_or(".");
        let base = Path::new(local_path).file_name().and_then(|n| n.to_str()).unwrap_or("");
        let remote_script = "mkdir -p \"$1\" && tar -C \"$1\" --strip-components=1 -xzf -";
        self.tar_into_container(
            app,
            &["-C", parent, "-czf", "-", base],
            &self.dexec(remote_script, &[remote_path]),
            transfer_id,
            token,
        )
        .await
    }

    /// Upload several local items that share a parent directory into `remote_dir`.
    pub async fn upload_batch(
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
        let parent = Path::new(&local_paths[0]).parent().and_then(|p| p.to_str()).unwrap_or(".");
        let mut args: Vec<&str> = vec!["-C", parent, "-czf", "-"];
        for p in local_paths {
            if let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) {
                args.push(name);
            }
        }
        let remote_script = "mkdir -p \"$1\" && tar -C \"$1\" -xzf -";
        self.tar_into_container(app, &args, &self.dexec(remote_script, &[remote_dir]), transfer_id, token)
            .await
    }

    /// Download a container directory: `tar -c` in the container → pipe to local
    /// `tar -x --strip-components=1` so the directory's contents land in `local_path`.
    pub async fn download_dir(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let parent = parent_of(remote_path).to_string();
        let base = basename_of(remote_path).to_string();
        let remote_cmd = self.dexec("tar -C \"$1\" -czf - \"$2\"", &[&parent, &base]);
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
    pub async fn download_batch(
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
        // sh -c 'cd "$1"; shift; tar -czf - "$@"' x <parent> <base…>
        let mut args: Vec<&str> = vec![&parent];
        let basenames: Vec<String> = remote_paths.iter().map(|p| basename_of(p).to_string()).collect();
        for b in &basenames {
            args.push(b);
        }
        let remote_cmd = self.dexec("cd \"$1\" || exit 3; shift; tar -czf - \"$@\"", &args);
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

    /// Spawn a local `tar` producer and stream its stdout into a container command's stdin.
    async fn tar_into_container(
        &self,
        app: &AppHandle,
        tar_args: &[&str],
        remote_cmd: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let mut tar_cmd = tokio::process::Command::new("tar");
        tar_cmd.args(tar_args).stdout(Stdio::piped()).stderr(Stdio::piped());
        crate::commands::win_proc::prevent_visible_child_window(&mut tar_cmd);
        let mut child = tar_cmd.spawn().map_err(|e| format!("tar not found: {e}"))?;
        let mut tar_out = child.stdout.take().ok_or("tar stdout unavailable")?;

        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("channel error: {e}"))?;
        channel.exec(true, remote_cmd).await.map_err(|e| format!("exec error: {e}"))?;
        let mut writer = channel.make_writer();

        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut transferred = 0u64;
        loop {
            if token.is_cancelled() {
                let _ = child.kill().await;
                return Err("Transfer cancelled".into());
            }
            let n = tar_out.read(&mut buf).await.map_err(|e| format!("tar read error: {e}"))?;
            if n == 0 {
                break;
            }
            writer.write_all(&buf[..n]).await.map_err(|e| format!("Write error: {e}"))?;
            transferred += n as u64;
            let _ = app.emit(
                &format!("sftp-progress-{transfer_id}"),
                TransferProgress { transferred, total: 0 },
            );
        }
        writer.flush().await.ok();
        drop(writer);
        channel.eof().await.ok();

        let status = child.wait().await.map_err(|e| format!("tar wait error: {e}"))?;
        if !status.success() {
            return Err("Local tar archiving failed".into());
        }
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

        let mut tar_cmd = tokio::process::Command::new("tar");
        tar_cmd.args(tar_args).stdin(Stdio::piped()).stderr(Stdio::piped());
        crate::commands::win_proc::prevent_visible_child_window(&mut tar_cmd);
        let mut child = tar_cmd.spawn().map_err(|e| format!("tar not found: {e}"))?;
        let mut tar_in = child.stdin.take().ok_or("tar stdin unavailable")?;

        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("channel error: {e}"))?;
        channel.exec(true, remote_cmd).await.map_err(|e| format!("exec error: {e}"))?;

        let mut transferred = 0u64;
        let mut err = Vec::new();
        let mut code = 0i32;
        loop {
            if token.is_cancelled() {
                let _ = child.kill().await;
                return Err("Transfer cancelled".into());
            }
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    tar_in.write_all(&data).await.map_err(|e| format!("tar write error: {e}"))?;
                    transferred += data.len() as u64;
                    let _ = app.emit(
                        &format!("sftp-progress-{transfer_id}"),
                        TransferProgress { transferred, total: 0 },
                    );
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => err.extend_from_slice(&data),
                Some(ChannelMsg::ExitStatus { exit_status }) => code = exit_status as i32,
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
        drop(tar_in); // close stdin so local tar finishes
        let status = child.wait().await.map_err(|e| format!("tar wait error: {e}"))?;
        if code != 0 {
            return Err(format!("download failed: {}", String::from_utf8_lossy(&err).trim()));
        }
        if !status.success() {
            return Err("Local tar extraction failed".into());
        }
        Ok(())
    }
}
