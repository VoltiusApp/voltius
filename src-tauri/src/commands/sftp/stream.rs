use super::local_tar::{self, Sink};
use super::tar_failure::{explain, End};
use super::{pump, TransferProgress};
use crate::sftp::backend::TransferEvents;
use crate::ssh::exec::{drain_channel, open_exec};
use russh::client::{Handle, Handler};
use std::io::{self, Read};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::task::JoinHandle;
use tokio_util::io::SyncIoBridge;
use tokio_util::sync::CancellationToken;

const PIPE: usize = 256 * 1024;
const REMOTE_REASON_WAIT: Duration = Duration::from_secs(2);
const CANCELLED: &str = "Transfer cancelled";

type Status = Result<(Option<i32>, Vec<u8>), String>;

#[derive(Clone, Default)]
pub struct Progress {
    pub done: Arc<AtomicU64>,
    pub total: Arc<AtomicU64>,
}

impl Progress {
    pub fn set_total(&self, n: u64) {
        self.total.store(n, Ordering::Relaxed);
    }

    fn emit(&self, events: &impl TransferEvents, transfer_id: &str) {
        let total = self.total.load(Ordering::Relaxed);
        let done = self.done.load(Ordering::Relaxed);
        let transferred = if total > 0 { done.min(total) } else { done };
        events.send(
            &format!("sftp-progress-{transfer_id}"),
            TransferProgress { transferred, total },
        );
    }
}

pub struct Job<'a, E> {
    pub events: &'a E,
    pub transfer_id: &'a str,
    pub token: &'a CancellationToken,
    pub progress: Progress,
}

impl<'a, E: TransferEvents> Job<'a, E> {
    pub fn new(events: &'a E, transfer_id: &'a str, token: &'a CancellationToken) -> Self {
        Self {
            events,
            transfer_id,
            token,
            progress: Progress::default(),
        }
    }

    fn emit(&self) {
        self.progress.emit(self.events, self.transfer_id);
    }

    fn report_skipped(&self, skipped: Vec<String>) {
        for path in skipped {
            self.events
                .send(&format!("sftp-skipped-{}", self.transfer_id), path);
        }
    }
}

pub struct LocalSide {
    pub parent: PathBuf,
    pub names: Vec<String>,
    pub deref: bool,
}

pub struct RemoteEnd<'a, H: Handler> {
    pub handle: &'a Handle<H>,
    pub cmd: String,
    pub dir: &'a str,
}

fn remote_result(end: End, dir: &str, code: Option<i32>, stderr: &[u8]) -> Result<(), String> {
    match code {
        Some(0) => Ok(()),
        _ => Err(explain(end, dir, &String::from_utf8_lossy(stderr))),
    }
}

fn joined<T>(r: Result<io::Result<T>, tokio::task::JoinError>) -> io::Result<T> {
    r.unwrap_or_else(|e| Err(io::Error::other(e)))
}

fn status(r: Result<Status, tokio::task::JoinError>) -> Status {
    r.unwrap_or_else(|e| Err(e.to_string()))
}

/// Waits briefly for a remote command that broke our stream to say why.
async fn remote_reason(
    end: End,
    dir: &str,
    status_task: &mut JoinHandle<Status>,
) -> Option<String> {
    match tokio::time::timeout(REMOTE_REASON_WAIT, status_task).await {
        Ok(Ok(Ok((code, err)))) => remote_result(end, dir, code, &err).err(),
        _ => None,
    }
}

pub async fn upload<H: Handler, E: TransferEvents>(
    to: RemoteEnd<'_, H>,
    local: LocalSide,
    job: &Job<'_, E>,
) -> Result<(), String> {
    let (mut rx, tx) = open_exec(to.handle, &to.cmd).await?.split();
    let mut remote: JoinHandle<Status> =
        tokio::spawn(
            async move { drain_channel(&mut rx, &mut tokio::io::sink(), None, None).await },
        );
    let local_label = local.parent.display().to_string();
    let (pipe_w, mut pipe_r) = tokio::io::duplex(PIPE);
    let bridge = SyncIoBridge::new(pipe_w);
    let done = job.progress.done.clone();
    let packer = tokio::task::spawn_blocking(move || {
        local_tar::pack(bridge, &local.parent, &local.names, local.deref, done)
    });

    let mut writer = tx.make_writer();
    let sent = pump(&mut pipe_r, &mut writer, job.token, |_| job.emit()).await;
    drop(pipe_r);
    let packed = joined(packer.await);

    if let Err(e) = sent {
        let _ = tx.close().await;
        if job.token.is_cancelled() {
            return Err(CANCELLED.into());
        }
        return Err(remote_reason(End::Remote, to.dir, &mut remote)
            .await
            .unwrap_or(e));
    }
    if let Err(e) = packed {
        let _ = tx.close().await;
        return Err(explain(End::Local, &local_label, &e.to_string()));
    }
    let _ = writer.flush().await;
    drop(writer);
    tx.eof().await.map_err(|e| format!("Write error: {e}"))?;
    let (code, err) = status(remote.await)?;
    remote_result(End::Remote, to.dir, code, &err)
}

pub async fn download<H: Handler, E: TransferEvents>(
    from: RemoteEnd<'_, H>,
    local_dir: PathBuf,
    strip: bool,
    job: &Job<'_, E>,
) -> Result<(), String> {
    let mut channel = open_exec(from.handle, &from.cmd).await?;
    let local_label = local_dir.display().to_string();
    let (mut pipe_w, pipe_r) = tokio::io::duplex(PIPE);
    let bridge = SyncIoBridge::new(pipe_r);
    let done = job.progress.done.clone();
    let unpacker = tokio::task::spawn_blocking(move || {
        local_tar::unpack(bridge, Sink::Dir(&local_dir), strip, done)
    });

    let mut on_data = |_: &[u8]| job.emit();
    let drained = drain_channel(
        &mut channel,
        &mut pipe_w,
        Some(&mut on_data),
        Some(job.token),
    )
    .await;
    let _ = pipe_w.shutdown().await;
    drop(pipe_w);
    if drained.is_err() {
        let _ = channel.close().await;
    }
    let unpacked = joined(unpacker.await);

    if job.token.is_cancelled() {
        return Err(CANCELLED.into());
    }
    if let Ok((code @ Some(c), err)) = &drained {
        if *c != 0 {
            return remote_result(End::Remote, from.dir, *code, err);
        }
    }
    let skipped = unpacked.map_err(|e| explain(End::Local, &local_label, &e.to_string()))?;
    drained?;
    job.report_skipped(skipped);
    Ok(())
}

struct ChunkReader {
    rx: mpsc::Receiver<Vec<u8>>,
    buf: Vec<u8>,
    pos: usize,
}

impl Read for ChunkReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        while self.pos == self.buf.len() {
            match self.rx.recv() {
                Ok(next) => (self.buf, self.pos) = (next, 0),
                Err(_) => return Ok(0),
            }
        }
        let n = out.len().min(self.buf.len() - self.pos);
        out[..n].copy_from_slice(&self.buf[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

pub async fn relay<HS: Handler, HD: Handler, E: TransferEvents>(
    src: RemoteEnd<'_, HS>,
    dst: RemoteEnd<'_, HD>,
    job: &Job<'_, E>,
) -> Result<(), String> {
    let mut source = open_exec(src.handle, &src.cmd).await?;
    let (mut rx, tx) = open_exec(dst.handle, &dst.cmd).await?.split();
    let mut sink: JoinHandle<Status> =
        tokio::spawn(
            async move { drain_channel(&mut rx, &mut tokio::io::sink(), None, None).await },
        );
    let (tap, taps) = mpsc::channel::<Vec<u8>>();
    let done = job.progress.done.clone();
    tokio::task::spawn_blocking(move || {
        let reader = ChunkReader {
            rx: taps,
            buf: Vec::new(),
            pos: 0,
        };
        local_tar::unpack(reader, Sink::Count, false, done)
    });

    let mut writer = tx.make_writer();
    let drained = {
        let mut on_data = |chunk: &[u8]| {
            let _ = tap.send(chunk.to_vec());
            job.emit();
        };
        drain_channel(
            &mut source,
            &mut writer,
            Some(&mut on_data),
            Some(job.token),
        )
        .await
    };
    drop(tap);

    let (code, err) = match drained {
        Ok(v) => v,
        Err(e) => {
            let _ = tx.close().await;
            let _ = source.close().await;
            if job.token.is_cancelled() {
                return Err(CANCELLED.into());
            }
            return Err(remote_reason(End::Destination, dst.dir, &mut sink)
                .await
                .unwrap_or(e));
        }
    };
    let _ = writer.flush().await;
    drop(writer);
    tx.eof().await.map_err(|e| format!("Write error: {e}"))?;
    let (dst_code, dst_err) = status(sink.await)?;
    remote_result(End::Destination, dst.dir, dst_code, &dst_err)?;
    remote_result(End::Source, src.dir, code, &err)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::commands::sftp::remote_shell::RemoteShell;
    use crate::sftp::backend::test_tree::Recorder;
    use crate::ssh::test_proc_server::{proc_server, ProcOptions};
    use std::fs;

    const SH: RemoteShell = RemoteShell::Posix;

    fn tree() -> tempfile::TempDir {
        let src = tempfile::tempdir().unwrap();
        fs::create_dir_all(src.path().join("top/sub")).unwrap();
        fs::write(src.path().join("top/a.txt"), b"alpha").unwrap();
        fs::write(src.path().join("top/sub/b.bin"), vec![9u8; 300_000]).unwrap();
        src
    }

    fn s(p: &std::path::Path) -> String {
        p.to_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn upload_streams_a_tree_into_the_remote_tar() {
        let (handle, log) = proc_server(ProcOptions::default()).await;
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t1", &token);
        let dest = s(dst.path());
        let to = RemoteEnd {
            handle: &handle,
            cmd: SH.extract_from_stdin(&dest, true),
            dir: &dest,
        };
        let local = LocalSide {
            parent: src.path().into(),
            names: vec!["top".into()],
            deref: false,
        };
        upload(to, local, &job).await.unwrap();
        assert_eq!(fs::read(dst.path().join("a.txt")).unwrap(), b"alpha");
        assert_eq!(
            fs::read(dst.path().join("sub/b.bin")).unwrap().len(),
            300_000
        );
        assert_eq!(log.lock().unwrap().ran.len(), 1);
        assert!(rec.count("sftp-progress-t1") > 0);
    }

    #[tokio::test]
    async fn download_streams_the_remote_tar_into_a_local_dir() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t2", &token);
        let parent = s(src.path());
        let from = RemoteEnd {
            handle: &handle,
            cmd: SH
                .create_to_stdout(&parent, &["top".into()], false)
                .unwrap(),
            dir: &parent,
        };
        download(from, dst.path().join("out"), true, &job)
            .await
            .unwrap();
        assert_eq!(fs::read(dst.path().join("out/a.txt")).unwrap(), b"alpha");
        assert!(rec.count("sftp-progress-t2") > 0);
    }

    #[tokio::test]
    async fn relay_moves_a_tree_between_two_hosts() {
        let (a, _) = proc_server(ProcOptions::default()).await;
        let (b, _) = proc_server(ProcOptions::default()).await;
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t3", &token);
        let (parent, dest) = (s(src.path()), s(dst.path()));
        let from = RemoteEnd {
            handle: &a,
            cmd: SH
                .create_to_stdout(&parent, &["top".into()], false)
                .unwrap(),
            dir: &parent,
        };
        let to = RemoteEnd {
            handle: &b,
            cmd: SH.extract_from_stdin(&dest, false),
            dir: &dest,
        };
        relay(from, to, &job).await.unwrap();
        assert_eq!(fs::read(dst.path().join("top/a.txt")).unwrap(), b"alpha");
        assert!(job.progress.done.load(Ordering::Relaxed) >= 300_000);
    }

    #[tokio::test]
    async fn a_full_remote_disk_is_reported_in_plain_words() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let src = tree();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t4", &token);
        let to = RemoteEnd {
            handle: &handle,
            cmd: "echo 'tar: b.bin: Cannot write: No space left on device' >&2; exit 2".into(),
            dir: "/srv",
        };
        let local = LocalSide {
            parent: src.path().into(),
            names: vec!["top".into()],
            deref: false,
        };
        assert_eq!(
            upload(to, local, &job).await.unwrap_err(),
            "Not enough space in /srv on the remote host"
        );
    }

    #[tokio::test]
    async fn download_prefers_the_remote_reason_over_a_broken_archive() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let dst = tempfile::tempdir().unwrap();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t5", &token);
        let from = RemoteEnd {
            handle: &handle,
            cmd: "printf 'not gzip'; echo 'tar: x: Cannot open: Permission denied' >&2; exit 2"
                .into(),
            dir: "/srv",
        };
        let err = download(from, dst.path().into(), false, &job)
            .await
            .unwrap_err();
        assert_eq!(err, "Permission denied in /srv on the remote host");
    }

    #[tokio::test]
    async fn a_local_failure_names_this_device() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        let not_a_dir = dst.path().join("file");
        fs::write(&not_a_dir, b"x").unwrap();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t6", &token);
        let parent = s(src.path());
        let from = RemoteEnd {
            handle: &handle,
            cmd: SH
                .create_to_stdout(&parent, &["top".into()], false)
                .unwrap(),
            dir: &parent,
        };
        let err = download(from, not_a_dir, true, &job).await.unwrap_err();
        assert!(err.starts_with("tar failed on this device"), "{err}");
    }

    #[tokio::test]
    async fn a_cut_download_fails_even_with_exit_zero() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let src = tree();
        let mut whole = Vec::new();
        local_tar::pack(
            &mut whole,
            src.path(),
            &["top".into()],
            false,
            Arc::default(),
        )
        .unwrap();
        let cut = src.path().join("cut.tgz");
        fs::write(&cut, &whole[..whole.len() / 2]).unwrap();
        let dst = tempfile::tempdir().unwrap();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t7", &token);
        let from = RemoteEnd {
            handle: &handle,
            cmd: format!("cat '{}'", cut.display()),
            dir: "/srv",
        };
        assert!(download(from, dst.path().into(), false, &job)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn without_an_exit_status_only_a_complete_download_counts() {
        let (handle, _) = proc_server(ProcOptions {
            exit_status: false,
            ..Default::default()
        })
        .await;
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t8", &token);
        let parent = s(src.path());
        let from = RemoteEnd {
            handle: &handle,
            cmd: SH
                .create_to_stdout(&parent, &["top".into()], false)
                .unwrap(),
            dir: &parent,
        };
        download(from, dst.path().into(), false, &job)
            .await
            .unwrap();
        let dest = s(dst.path());
        let to = RemoteEnd {
            handle: &handle,
            cmd: SH.extract_from_stdin(&dest, false),
            dir: &dest,
        };
        let local = LocalSide {
            parent: src.path().into(),
            names: vec!["top".into()],
            deref: false,
        };
        assert_eq!(
            upload(to, local, &job).await.unwrap_err(),
            "tar failed on the remote host"
        );
    }

    #[tokio::test]
    async fn cancel_ends_the_remote_command_and_runs_nothing_after() {
        let (handle, log) = proc_server(ProcOptions::default()).await;
        let src = tempfile::tempdir().unwrap();
        let noise: Vec<u8> = (0..8_000_000u32)
            .map(|i| (i.wrapping_mul(2654435761) >> 13) as u8)
            .collect();
        fs::write(src.path().join("noise"), noise).unwrap();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t9", &token);
        let to = RemoteEnd {
            handle: &handle,
            cmd: "sleep 0.2; cat > /dev/null".into(),
            dir: "/srv",
        };
        let local = LocalSide {
            parent: src.path().into(),
            names: vec!["noise".into()],
            deref: false,
        };
        let t = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            t.cancel();
        });
        assert_eq!(
            upload(to, local, &job).await.unwrap_err(),
            "Transfer cancelled"
        );
        for _ in 0..100 {
            if log.lock().unwrap().exited == 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let log = log.lock().unwrap();
        assert_eq!(log.ran.len(), 1);
        assert_eq!(log.exited, 1);
    }

    #[tokio::test]
    async fn a_transfer_without_a_total_still_finishes() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t10", &token);
        assert_eq!(job.progress.total.load(Ordering::Relaxed), 0);
        let parent = s(src.path());
        let from = RemoteEnd {
            handle: &handle,
            cmd: SH
                .create_to_stdout(&parent, &["top".into()], false)
                .unwrap(),
            dir: &parent,
        };
        download(from, dst.path().into(), false, &job)
            .await
            .unwrap();
        assert!(dst.path().join("top/a.txt").exists());
    }
}
