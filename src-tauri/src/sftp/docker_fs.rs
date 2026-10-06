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
use crate::commands::sftp::resume::endpoint::{Endpoint, Listed, Reader, Stat, Writer};
use crate::commands::sftp::resume::pipe::piped;
use crate::commands::sftp::TarProbe;
use crate::commands::sftp::{sort_listing, RemoteFile};
use crate::error::AppError;
use crate::sftp::backend::FileBackend;
use crate::sftp::link::{ssh_answers, wait_for_link};
use crate::ssh::client::SshClient;
use crate::ssh::exec::{
    docker_exec, drain_channel, exit_error, open_exec, run_captured, sh_c, Captured,
};
use crate::ssh::live_cells::{read_cell, Cell};
use async_trait::async_trait;
use russh::client::{Handle, Handler};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use tokio::io::AsyncWriteExt;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub struct DockerFs<H: Handler = SshClient> {
    /// Live handle of the host session, so exec channels are opened on whatever
    /// connection the terminal currently has rather than the one present when
    /// the panel was first opened.
    handle: Cell<Arc<Handle<H>>>,
    /// Knows the container's `docker exec -i <id>` prefix, which every command runs under.
    tar: Arc<TarProbe<H>>,
    /// The connection the latest transfer stream was opened on.
    streaming_on: Arc<StdMutex<Weak<Handle<H>>>>,
    closed: CancellationToken,
}

impl<H: Handler> Clone for DockerFs<H> {
    fn clone(&self) -> Self {
        Self {
            handle: Arc::clone(&self.handle),
            tar: Arc::clone(&self.tar),
            streaming_on: Arc::clone(&self.streaming_on),
            closed: self.closed.clone(),
        }
    }
}

impl DockerFs {
    pub fn new(handle: Cell<Arc<Handle<SshClient>>>, container_id: String) -> Self {
        Self {
            tar: Arc::new(TarProbe::new(
                Arc::clone(&handle),
                Some(docker_exec(&container_id)),
            )),
            handle,
            streaming_on: Arc::default(),
            closed: CancellationToken::new(),
        }
    }
}

impl<H: Handler> DockerFs<H> {
    fn ssh(&self) -> Arc<Handle<H>> {
        read_cell(&self.handle)
    }

    fn stream_ssh(&self) -> Arc<Handle<H>> {
        let ssh = self.ssh();
        *self.streaming_on.lock().unwrap() = Arc::downgrade(&ssh);
        ssh
    }

    /// Build a `docker exec -i <cid> sh -c '<script>' x <arg…>` command string.
    fn dexec(&self, script: &str, args: &[&str]) -> String {
        self.tar.run_in(&sh_c(script, args))
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

    async fn listing(&self, path: &str) -> Result<Vec<RemoteFile>, AppError> {
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
        Ok(files)
    }
}

/// Every operation is a short shell command in the container; transfers go
/// through the copy engine over this backend's `Endpoint`.
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
        let mut files = self.listing(path).await?;
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
        let mut w = self.open_write(path, 0, content.len() as u64).await?;
        w.write_all(content.as_bytes())
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        w.shutdown().await.map_err(|e| format!("write failed: {e}"))
    }

    fn endpoint(&self) -> Arc<dyn Endpoint> {
        Arc::new(self.clone())
    }

    async fn close(&self) {
        self.closed.cancel();
    }
}

fn parse_stat(out: &str) -> Option<Stat> {
    let mut f = out.split_whitespace();
    let is_dir = f.next()? == "d";
    let size = f.next()?.parse().ok()?;
    let mtime = f.next()?.parse().ok()?;
    let mode = f.next().and_then(|m| u32::from_str_radix(m, 8).ok());
    Some(Stat {
        size,
        mtime,
        is_dir,
        mode,
    })
}

#[async_trait]
impl<H: Handler + 'static> Endpoint for DockerFs<H> {
    fn is_local(&self) -> bool {
        false
    }

    async fn stat(&self, path: &str) -> Result<Option<Stat>, AppError> {
        let script = "[ -e \"$1\" ] || exit 7; \
             if [ -d \"$1\" ]; then printf 'd '; else printf 'f '; fi; \
             stat -L -c '%s %Y %a' \"$1\"";
        let (out, err, code) = self.run(&self.dexec(script, &[path])).await?;
        if code == Some(7) {
            return Ok(None);
        }
        exit_error("stat failed", code, &err)?;
        parse_stat(&out)
            .map(Some)
            .ok_or_else(|| format!("stat failed: unexpected answer {out:?}").into())
    }

    async fn list(&self, dir: &str) -> Result<Vec<Listed>, AppError> {
        Ok(self
            .listing(dir)
            .await?
            .into_iter()
            .map(Listed::from)
            .collect())
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        self.simple("mkdir -p \"$1\"", &[path], "mkdir failed")
            .await
    }

    async fn open_read(&self, path: &str, offset: u64) -> Result<Reader, AppError> {
        let from = (offset + 1).to_string();
        let cmd = self.dexec("tail -c +\"$2\" \"$1\"", &[path, &from]);
        let ssh = self.stream_ssh();
        Ok(Box::new(piped(|mut tx, cancel| async move {
            let mut channel = open_exec(&ssh, &cmd).await?;
            let (code, err) = drain_channel(&mut channel, &mut tx, None, Some(&cancel)).await?;
            Ok(exit_error(
                "read failed",
                code,
                &String::from_utf8_lossy(&err),
            )?)
        })))
    }

    async fn open_write(&self, path: &str, offset: u64, _len: u64) -> Result<Writer, AppError> {
        let script = if offset == 0 {
            "cat > \"$1\""
        } else {
            "cat >> \"$1\""
        };
        let cmd = self.dexec(script, &[path]);
        let ssh = self.stream_ssh();
        Ok(Box::new(piped(|mut rx, cancel| async move {
            let mut channel = open_exec(&ssh, &cmd).await?;
            let mut writer = channel.make_writer();
            tokio::select! {
                copied = tokio::io::copy(&mut rx, &mut writer) => copied?,
                _ = cancel.cancelled() => return Err("Transfer cancelled".into()),
            };
            writer.flush().await?;
            drop(writer);
            let _ = channel.eof().await;
            let (code, err) =
                drain_channel(&mut channel, &mut tokio::io::sink(), None, Some(&cancel)).await?;
            Ok(exit_error(
                "write failed",
                code,
                &String::from_utf8_lossy(&err),
            )?)
        })))
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        self.simple("mv \"$1\" \"$2\"", &[from, to], "rename failed")
            .await
    }

    async fn remove(&self, path: &str) -> Result<(), AppError> {
        self.simple("rm -f \"$1\"", &[path], "remove failed").await
    }

    async fn set_mtime(&self, path: &str, mtime: u64) -> Result<(), AppError> {
        let at = format!("@{mtime}");
        self.simple("touch -c -d \"$2\" \"$1\"", &[path, &at], "touch failed")
            .await
    }

    async fn set_mode(&self, path: &str, mode: u32) -> Result<(), AppError> {
        let mode = format!("{:o}", mode & 0o7777);
        self.simple("chmod \"$2\" \"$1\"", &[path, &mode], "chmod failed")
            .await
    }

    async fn resolve(&self, path: &str) -> Result<String, AppError> {
        let script = "[ -L \"$1\" ] && readlink -f \"$1\"";
        let (out, _, code) = self.run(&self.dexec(script, &[path])).await?;
        let resolved = out.trim();
        Ok(if code == Some(0) && !resolved.is_empty() {
            resolved.to_string()
        } else {
            path.to_string()
        })
    }

    async fn hash(
        &self,
        path: &str,
        token: &CancellationToken,
    ) -> Result<Option<String>, AppError> {
        self.tar.hash(path, token, self.link_dead()).await
    }

    /// A stream on a connection the terminal has since replaced is as good as cut.
    fn link_lost(&self) -> bool {
        let current = self.ssh();
        match self.streaming_on.lock().unwrap().upgrade() {
            Some(used) => used.is_closed() || !Arc::ptr_eq(&used, &current),
            None => current.is_closed(),
        }
    }

    async fn link_dead(&self) -> bool {
        self.link_lost() || !ssh_answers(&self.ssh()).await
    }

    async fn wait_for_link(
        &self,
        token: &CancellationToken,
        deadline: Instant,
    ) -> Result<(), AppError> {
        let alive = || async { ssh_answers(&self.ssh()).await };
        wait_for_link(alive, token, &self.closed, deadline).await
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::commands::sftp::resume::copy_one;
    use crate::commands::sftp::resume::endpoint::LocalFs;
    use crate::commands::sftp::resume::engine_tests::{noise, s};
    use crate::port_forward::test_ssh::TestClient;
    use crate::sftp::backend::test_tree::Recorder;
    use crate::ssh::live_cells::own_cell;
    use crate::ssh::test_proc_server::{proc_server, ProcOptions};
    use std::time::Duration;
    use tokio::io::AsyncReadExt;

    /// A "container" that is the test host itself: `env` runs each command as is.
    async fn docker_fs(opts: ProcOptions) -> DockerFs<TestClient> {
        let (handle, _) = proc_server(opts).await;
        let handle = own_cell(handle);
        DockerFs {
            tar: Arc::new(TarProbe::new(Arc::clone(&handle), Some("env".into()))),
            handle,
            streaming_on: Arc::default(),
            closed: CancellationToken::new(),
        }
    }

    #[tokio::test]
    async fn exec_endpoint_round_trips_at_offsets_stats_and_hashes() {
        let fs = docker_fs(ProcOptions::default()).await;
        let d = tempfile::tempdir().unwrap();
        let f = format!("{}/it's x", d.path().display());
        let mut w = fs.open_write(&f, 0, 5).await.unwrap();
        w.write_all(b"hello").await.unwrap();
        w.shutdown().await.unwrap();
        let mut w = fs.open_write(&f, 5, 3).await.unwrap();
        w.write_all(b"LO!").await.unwrap();
        w.shutdown().await.unwrap();
        let mut got = String::new();
        let mut r = fs.open_read(&f, 2).await.unwrap();
        r.read_to_string(&mut got).await.unwrap();
        assert_eq!(got, "lloLO!");

        fs.set_mtime(&f, 1_000_000).await.unwrap();
        fs.set_mode(&f, 0o640).await.unwrap();
        let st = Endpoint::stat(&fs, &f).await.unwrap().unwrap();
        assert_eq!(
            (st.size, st.mtime, st.is_dir, st.mode),
            (8, 1_000_000, false, Some(0o640))
        );
        assert!(
            Endpoint::stat(&fs, &d.path().to_string_lossy())
                .await
                .unwrap()
                .unwrap()
                .is_dir
        );
        assert_eq!(
            Endpoint::stat(&fs, &format!("{f}.nope")).await.unwrap(),
            None
        );
        let names: Vec<_> = fs
            .list(&d.path().to_string_lossy())
            .await
            .unwrap()
            .into_iter()
            .map(|l| l.name)
            .collect();
        assert_eq!(names, ["it's x"]);
        let token = CancellationToken::new();
        let hashed = fs.hash(&f, &token).await.unwrap();
        assert!(hashed.is_some());
        assert_eq!(hashed, LocalFs.hash(&f, &token).await.unwrap());
    }

    #[tokio::test]
    async fn a_failed_read_reports_why() {
        let fs = docker_fs(ProcOptions::default()).await;
        let mut r = fs.open_read("/no/such/file", 0).await.unwrap();
        let e = r.read_to_end(&mut Vec::new()).await.unwrap_err();
        assert!(e.to_string().contains("read failed"), "{e}");
    }

    fn relink_after(fs: &DockerFs<TestClient>, delay: Duration) -> tokio::task::JoinHandle<()> {
        let handle = Arc::clone(&fs.handle);
        tokio::spawn(async move {
            while ssh_answers(&read_cell::<Arc<Handle<TestClient>>>(&handle)).await {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            tokio::time::sleep(delay).await;
            let (fresh, _) = proc_server(ProcOptions::default()).await;
            *handle.write().unwrap() = fresh;
        })
    }

    async fn cut_mid_file(upload: bool) {
        let fs = docker_fs(ProcOptions {
            drop_after_bytes: Some(3_000_000),
            ..Default::default()
        })
        .await;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(8_000_000);
        std::fs::write(a.path().join("v"), &data).unwrap();
        let relink = relink_after(&fs, Duration::from_millis(200));
        let rec = Recorder::default();
        let (src, dst) = (s(&a.path().join("v")), s(&b.path().join("v")));
        let token = CancellationToken::new();
        let copied = if upload {
            copy_one(&rec, &LocalFs, &src, &fs, &dst, "t", &token).await
        } else {
            copy_one(&rec, &fs, &src, &LocalFs, &dst, "t", &token).await
        };
        copied.unwrap();
        relink.await.unwrap();
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert!(
            rec.last("sftp-resumed-t").unwrap()["offset"]
                .as_u64()
                .unwrap()
                > 0
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_upload_cut_mid_file_resumes_byte_identical() {
        cut_mid_file(true).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_download_cut_mid_file_resumes_byte_identical() {
        cut_mid_file(false).await;
    }
}
