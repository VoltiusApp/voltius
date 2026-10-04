use super::local_tar::{self, Sink};
use super::tar_failure::{explain, End};
use super::{pump, TransferProgress, CHUNK_SIZE};
use crate::sftp::backend::TransferEvents;
use crate::ssh::exec::{drain_channel, open_exec};
use russh::client::{Handle, Handler, Msg};
use russh::{ChannelReadHalf, ChannelWriteHalf};
use std::future::Future;
use std::io::{self, Read};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio::task::JoinHandle;
use tokio_util::io::SyncIoBridge;
use tokio_util::sync::CancellationToken;

const PIPE: usize = 256 * 1024;
const REMOTE_REASON_WAIT: Duration = Duration::from_secs(2);
const CLOSE_WAIT: Duration = Duration::from_millis(500);
const CANCELLED: &str = "Transfer cancelled";

type Status = Result<(Option<i32>, Vec<u8>), String>;
type Joined = Result<Status, tokio::task::JoinError>;

#[derive(Clone, Default)]
pub struct Progress {
    pub done: Arc<AtomicU64>,
    pub total: Arc<AtomicU64>,
    last_emitted: Arc<AtomicU64>,
}

impl Progress {
    pub fn set_total(&self, n: u64) {
        self.total.store(n, Ordering::Relaxed);
    }

    fn emit(&self, events: &impl TransferEvents, transfer_id: &str, force: bool) {
        let total = self.total.load(Ordering::Relaxed);
        let done = self.done.load(Ordering::Relaxed);
        let last = self.last_emitted.load(Ordering::Relaxed);
        if !force && done.saturating_sub(last) < CHUNK_SIZE as u64 {
            return;
        }
        self.last_emitted.store(done, Ordering::Relaxed);
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
        self.progress.emit(self.events, self.transfer_id, false);
    }

    fn finish(&self) {
        self.progress.emit(self.events, self.transfer_id, true);
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

fn status(r: Joined) -> Status {
    r.unwrap_or_else(|e| Err(e.to_string()))
}

fn watch_status(mut rx: ChannelReadHalf) -> JoinHandle<Status> {
    tokio::spawn(async move { drain_channel(&mut rx, &mut tokio::io::sink(), None, None).await })
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

/// Runs `work`, but returns the remote's status instead if the remote ends first:
/// a parked write to a closed channel never errors.
async fn race_status<T>(
    status_task: &mut JoinHandle<Status>,
    work: impl Future<Output = T>,
) -> Result<T, Joined> {
    tokio::select! {
        biased;
        r = work => Ok(r),
        s = status_task => Err(s),
    }
}

fn ended_early(end: End, dir: &str, ended: Joined) -> String {
    match status(ended) {
        Ok((code, err)) => remote_result(end, dir, code, &err)
            .err()
            .unwrap_or_else(|| explain(end, dir, "exited before the transfer finished")),
        Err(e) => e,
    }
}

/// A close request queues behind data the session loop may be unable to flush.
async fn close_bounded<E>(close: impl Future<Output = Result<(), E>>) {
    let _ = tokio::time::timeout(CLOSE_WAIT, close).await;
}

async fn abort_remote(tx: &ChannelWriteHalf<Msg>, status_task: &JoinHandle<Status>) {
    close_bounded(tx.close()).await;
    status_task.abort();
}

async fn fail_remote(
    tx: &ChannelWriteHalf<Msg>,
    token: &CancellationToken,
    end: End,
    dir: &str,
    status_task: &mut JoinHandle<Status>,
    cause: String,
) -> String {
    close_bounded(tx.close()).await;
    let message = if token.is_cancelled() {
        CANCELLED.into()
    } else {
        remote_reason(end, dir, status_task).await.unwrap_or(cause)
    };
    status_task.abort();
    message
}

async fn finish_remote(
    mut writer: impl AsyncWrite + Unpin,
    tx: &ChannelWriteHalf<Msg>,
    token: &CancellationToken,
    end: End,
    dir: &str,
    mut status_task: JoinHandle<Status>,
) -> Result<(), String> {
    let finish = async {
        let _ = writer.flush().await;
        tx.eof().await.map_err(|e| format!("Write error: {e}"))?;
        let (code, err) = status((&mut status_task).await)?;
        remote_result(end, dir, code, &err)
    };
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(CANCELLED.to_string()),
        r = finish => r,
    };
    if result.is_err() {
        abort_remote(tx, &status_task).await;
    }
    result
}

pub async fn upload<H: Handler, E: TransferEvents>(
    to: RemoteEnd<'_, H>,
    local: LocalSide,
    job: &Job<'_, E>,
) -> Result<(), String> {
    let (rx, tx) = open_exec(to.handle, &to.cmd).await?.split();
    let mut remote = watch_status(rx);
    let local_label = local.parent.display().to_string();
    let (pipe_w, mut pipe_r) = tokio::io::duplex(PIPE);
    let bridge = SyncIoBridge::new(pipe_w);
    let done = job.progress.done.clone();
    let packer = tokio::task::spawn_blocking(move || {
        local_tar::pack(bridge, &local.parent, &local.names, local.deref, done)
    });

    let mut writer = tx.make_writer();
    let sent = race_status(
        &mut remote,
        pump(&mut pipe_r, &mut writer, job.token, |_| job.emit()),
    )
    .await;
    drop(pipe_r);
    let sent = match sent {
        Ok(sent) => sent,
        Err(ended) => {
            close_bounded(tx.close()).await;
            return Err(ended_early(End::Remote, to.dir, ended));
        }
    };
    let packed = joined(packer.await);

    if let Err(e) = sent {
        return Err(fail_remote(&tx, job.token, End::Remote, to.dir, &mut remote, e).await);
    }
    if let Err(e) = packed {
        abort_remote(&tx, &remote).await;
        return Err(explain(End::Local, &local_label, &e.to_string()));
    }
    finish_remote(writer, &tx, job.token, End::Remote, to.dir, remote).await?;
    job.finish();
    Ok(())
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
    let mut drained = drain_channel(
        &mut channel,
        &mut pipe_w,
        Some(&mut on_data),
        Some(job.token),
    )
    .await;
    let _ = pipe_w.shutdown().await;
    drop(pipe_w);
    if drained.is_err() && !job.token.is_cancelled() {
        let mut discard = tokio::io::sink();
        let rest = drain_channel(&mut channel, &mut discard, None, Some(job.token));
        if let Ok(Ok(status)) = tokio::time::timeout(REMOTE_REASON_WAIT, rest).await {
            drained = Ok(status);
        }
    }
    if drained.is_err() {
        close_bounded(channel.close()).await;
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
    job.finish();
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
    let (rx, tx) = open_exec(dst.handle, &dst.cmd).await?.split();
    let mut sink = watch_status(rx);
    let (tap, taps) = mpsc::channel::<Vec<u8>>();
    let done = job.progress.done.clone();
    let counter = tokio::task::spawn_blocking(move || {
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
        race_status(
            &mut sink,
            drain_channel(
                &mut source,
                &mut writer,
                Some(&mut on_data),
                Some(job.token),
            ),
        )
        .await
    };
    drop(tap);
    let _ = counter.await;

    let (code, err) = match drained {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            close_bounded(source.close()).await;
            return Err(fail_remote(&tx, job.token, End::Destination, dst.dir, &mut sink, e).await);
        }
        Err(ended) => {
            close_bounded(source.close()).await;
            close_bounded(tx.close()).await;
            return Err(ended_early(End::Destination, dst.dir, ended));
        }
    };
    finish_remote(writer, &tx, job.token, End::Destination, dst.dir, sink).await?;
    remote_result(End::Source, src.dir, code, &err)?;
    job.finish();
    Ok(())
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
        let err = download(from, dst.path().into(), false, &job)
            .await
            .unwrap_err();
        assert!(err.starts_with("tar failed on this device"), "{err}");
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

    const DISK_FULL: &str = "echo 'tar: b: Cannot write: No space left on device' >&2; exit 2";

    fn noise_tree() -> tempfile::TempDir {
        let src = tempfile::tempdir().unwrap();
        let noise: Vec<u8> = (0..8_000_000u32)
            .map(|i| (i.wrapping_mul(2654435761) >> 13) as u8)
            .collect();
        fs::write(src.path().join("noise"), noise).unwrap();
        src
    }

    #[tokio::test]
    async fn an_early_remote_exit_cannot_hang_a_large_upload() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let src = noise_tree();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t11", &token);
        let to = RemoteEnd {
            handle: &handle,
            cmd: DISK_FULL.into(),
            dir: "/srv",
        };
        let local = LocalSide {
            parent: src.path().into(),
            names: vec!["noise".into()],
            deref: false,
        };
        let r = tokio::time::timeout(Duration::from_secs(20), upload(to, local, &job))
            .await
            .expect("upload hung");
        assert_eq!(
            r.unwrap_err(),
            "Not enough space in /srv on the remote host"
        );
    }

    #[tokio::test]
    async fn an_early_destination_exit_cannot_hang_a_large_relay() {
        let (a, _) = proc_server(ProcOptions::default()).await;
        let (b, _) = proc_server(ProcOptions::default()).await;
        let src = noise_tree();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t12", &token);
        let parent = s(src.path());
        let from = RemoteEnd {
            handle: &a,
            cmd: SH
                .create_to_stdout(&parent, &["noise".into()], false)
                .unwrap(),
            dir: &parent,
        };
        let to = RemoteEnd {
            handle: &b,
            cmd: DISK_FULL.into(),
            dir: "/dest",
        };
        let r = tokio::time::timeout(Duration::from_secs(20), relay(from, to, &job))
            .await
            .expect("relay hung");
        assert_eq!(
            r.unwrap_err(),
            "Not enough space in /dest on the destination host"
        );
    }

    #[tokio::test]
    async fn cancel_ends_a_relay_whose_destination_never_reads() {
        let (a, _) = proc_server(ProcOptions::default()).await;
        let (b, _) = proc_server(ProcOptions::default()).await;
        let src = noise_tree();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let job = Job::new(&rec, "t13", &token);
        let parent = s(src.path());
        let from = RemoteEnd {
            handle: &a,
            cmd: SH
                .create_to_stdout(&parent, &["noise".into()], false)
                .unwrap(),
            dir: &parent,
        };
        let to = RemoteEnd {
            handle: &b,
            cmd: "sleep 30".into(),
            dir: "/dest",
        };
        let t = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            t.cancel();
        });
        let r = tokio::time::timeout(Duration::from_secs(10), relay(from, to, &job))
            .await
            .expect("cancel did not end the relay");
        assert_eq!(r.unwrap_err(), "Transfer cancelled");
    }
}
