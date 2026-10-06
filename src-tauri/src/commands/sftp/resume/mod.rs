pub(crate) mod endpoint;
pub(crate) mod large;
#[cfg(all(test, unix))]
pub(crate) mod live;
pub(crate) mod names;
pub(crate) mod pipe;
pub(crate) mod sftp_fs;

use crate::commands::sftp::{pump, TransferProgress};
use crate::error::{AppError, ErrorCode};
use crate::sftp::backend::{report_skipped, skip_unsafe_name, TransferEvents};
use crate::sftp::link::LINK_POLL;
use endpoint::{Endpoint, Listed, Reader, Stat, Writer};
use names::{fingerprint, is_temp_of, temp_name, OLD_EXT, PART_EXT};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex as StdMutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub(crate) const OVERLAP: u64 = 64 * 1024;
pub(crate) const LARGE_FILE: u64 = 64 * 1024 * 1024;
pub(crate) const LINK_WAIT: Duration = Duration::from_secs(300);
pub(crate) const RESTARTS: u32 = 3;
pub(crate) const STALL: Duration = Duration::from_secs(15);

// Keyed by transfer id: the engine has no SftpManager to ask.
static RESUMING: LazyLock<StdMutex<HashSet<String>>> = LazyLock::new(Default::default);

pub fn mark_resume(tid: &str) {
    RESUMING.lock().unwrap().insert(tid.to_string());
}

pub fn is_resume(tid: &str) -> bool {
    RESUMING.lock().unwrap().contains(tid)
}

pub fn clear_resume(tid: &str) {
    RESUMING.lock().unwrap().remove(tid);
}

pub(crate) struct CopyCtx<'a, E: TransferEvents> {
    pub events: &'a E,
    pub transfer_id: &'a str,
    pub token: &'a CancellationToken,
    pub transferred: u64,
    pub total: u64,
    pub link_wait: Duration,
    pub stall: Duration,
    listings: HashMap<String, Vec<Listed>>,
}

impl<'a, E: TransferEvents> CopyCtx<'a, E> {
    pub fn new(
        events: &'a E,
        transfer_id: &'a str,
        token: &'a CancellationToken,
        total: u64,
    ) -> Self {
        Self {
            events,
            transfer_id,
            token,
            transferred: 0,
            total,
            link_wait: LINK_WAIT,
            stall: STALL,
            listings: HashMap::new(),
        }
    }

    pub fn progress(&self) {
        let progress = TransferProgress {
            transferred: self.transferred,
            total: self.total,
        };
        emit(self.events, "progress", self.transfer_id, progress);
    }

    async fn landed(&mut self, dst: &dyn Endpoint, path: &str, want: Stat) -> bool {
        let (dir, name) = dst.split(path);
        self.listing(dst, &dir).await.iter().any(|e| {
            e.name == name
                && e.stat.is_some_and(|s| {
                    !s.is_dir && s.size == want.size && s.mtime.is_some() && s.mtime == want.mtime
                })
        })
    }

    async fn revive(&self, ends: &[&dyn Endpoint]) -> Option<Result<(), AppError>> {
        revive(
            ends,
            self.events,
            self.transfer_id,
            self.token,
            self.link_wait,
        )
        .await
    }

    async fn listing(&mut self, fs: &dyn Endpoint, dir: &str) -> &[Listed] {
        if !self.listings.contains_key(dir) {
            let found = fs.list(dir).await.unwrap_or_default();
            self.listings.insert(dir.to_string(), found);
        }
        &self.listings[dir]
    }
}

enum Attempt {
    Done,
    SourceChanged,
    Mismatch,
}

fn cancelled() -> AppError {
    "Transfer cancelled".into()
}

pub(crate) fn connection_lost() -> AppError {
    AppError::coded(ErrorCode::ConnectionLost, "Connection lost")
}

pub(crate) async fn copy_one<E: TransferEvents>(
    events: &E,
    src: &dyn Endpoint,
    src_path: &str,
    dst: &dyn Endpoint,
    dst_path: &str,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), AppError> {
    let total = src.stat(src_path).await?.map_or(0, |s| s.size);
    let mut ctx = CopyCtx::new(events, transfer_id, token, total);
    resumable_copy(src, src_path, dst, dst_path, &mut ctx).await
}

pub(crate) struct TreeFile {
    pub rel: String,
    pub stat: Stat,
}

/// Every directory and file under `root`, relative and `/`-joined; `dst_local` as in `skip_unsafe_name`.
pub(crate) async fn walk<E: TransferEvents>(
    events: &E,
    transfer_id: &str,
    src: &dyn Endpoint,
    root: &str,
    dst_local: bool,
) -> Result<(Vec<String>, Vec<TreeFile>), AppError> {
    let (mut dirs, mut files, mut stack) = (Vec::new(), Vec::new(), vec![String::new()]);
    while let Some(rel) = stack.pop() {
        let dir = if rel.is_empty() {
            root.to_string()
        } else {
            src.join(root, &rel)
        };
        for e in src.list(&dir).await? {
            let child = if rel.is_empty() {
                e.name.clone()
            } else {
                format!("{rel}/{}", e.name)
            };
            let path = src.join(&dir, &e.name);
            if e.is_symlink || skip_unsafe_name(events, transfer_id, &path, &e.name, dst_local) {
                continue;
            }
            let Some(stat) = e.stat else {
                report_skipped(events, transfer_id, &path);
                continue;
            };
            if stat.is_dir {
                dirs.push(child.clone());
                stack.push(child);
            } else {
                files.push(TreeFile { rel: child, stat });
            }
        }
    }
    Ok((dirs, files))
}

pub(crate) async fn copy_tree<E: TransferEvents>(
    events: &E,
    src: &dyn Endpoint,
    src_root: &str,
    dst: &dyn Endpoint,
    dst_root: &str,
    transfer_id: &str,
    token: &CancellationToken,
) -> Result<(), AppError> {
    let (dirs, files) = walk(events, transfer_id, src, src_root, dst.is_local()).await?;
    let total = files.iter().map(|f| f.stat.size).sum();
    let mut ctx = CopyCtx::new(events, transfer_id, token, total);
    let roots = std::iter::once(dst_root.to_string());
    for d in roots.chain(dirs.iter().map(|d| dst.join(dst_root, d))) {
        while let Err(e) = dst.mkdir(&d).await {
            match ctx.revive(&[dst]).await {
                Some(Ok(())) => continue,
                Some(Err(waited)) => return Err(waited),
                None => return Err(e),
            }
        }
    }
    let resume = is_resume(transfer_id);
    for f in &files {
        if token.is_cancelled() {
            return Err(cancelled());
        }
        let to = dst.join(dst_root, &f.rel);
        if resume && ctx.landed(dst, &to, f.stat).await {
            ctx.transferred += f.stat.size;
            ctx.progress();
            continue;
        }
        resumable_copy(src, &src.join(src_root, &f.rel), dst, &to, &mut ctx).await?;
    }
    ctx.progress();
    Ok(())
}

pub(crate) async fn resumable_copy<E: TransferEvents>(
    src: &dyn Endpoint,
    src_path: &str,
    dst: &dyn Endpoint,
    dst_path: &str,
    ctx: &mut CopyCtx<'_, E>,
) -> Result<(), AppError> {
    let base = ctx.transferred;
    let mut part = None;
    let (mut changed, mut mismatched, mut relost) = (0, 0, 0);
    loop {
        ctx.transferred = base;
        let err = match attempt(src, src_path, dst, dst_path, ctx, base, &mut part).await {
            Ok(Attempt::Done) => return Ok(()),
            Ok(Attempt::SourceChanged) => {
                changed += 1;
                if changed >= RESTARTS {
                    return Err(AppError::coded(
                        ErrorCode::TransferSourceChanged,
                        format!("{src_path} kept changing during the transfer"),
                    ));
                }
                continue;
            }
            Ok(Attempt::Mismatch) => {
                mismatched += 1;
                if mismatched >= 2 {
                    return Err(AppError::coded(
                        ErrorCode::TransferVerifyFailed,
                        format!("The copy of {src_path} did not match the original"),
                    ));
                }
                continue;
            }
            Err(e) => e,
        };
        let err = if ctx.token.is_cancelled() {
            err
        } else {
            match ctx.revive(&[src, dst]).await {
                Some(Ok(())) => continue,
                Some(Err(e)) => e,
                None if err.code() == Some(ErrorCode::ConnectionLost) && relost < RESTARTS => {
                    relost += 1;
                    continue;
                }
                None => err,
            }
        };
        if ctx.token.is_cancelled() {
            if let Some(p) = &part {
                let _ = tokio::time::timeout(Duration::from_millis(500), dst.remove(p)).await;
            }
            return Err(cancelled());
        }
        return Err(err);
    }
}

/// Waits (bounded) for every dead link among `ends`; None when none is dead.
pub(crate) async fn revive<E: TransferEvents>(
    ends: &[&dyn Endpoint],
    events: &E,
    transfer_id: &str,
    token: &CancellationToken,
    wait: Duration,
) -> Option<Result<(), AppError>> {
    let dead = tokio::select! {
        dead = dead_ends(ends) => dead,
        _ = token.cancelled() => return Some(Err(cancelled())),
    };
    if dead.is_empty() {
        return None;
    }
    let waiting = |on: bool| {
        emit(
            events,
            "waiting",
            transfer_id,
            serde_json::json!({ "waiting": on }),
        )
    };
    waiting(true);
    let deadline = Instant::now() + wait;
    let mut result = Ok(());
    for end in dead {
        result = end.wait_for_link(token, deadline).await;
        if result.is_err() {
            break;
        }
    }
    waiting(false);
    Some(result)
}

/// Ends `work` once a link is gone: closed outright, or failing a probe after `stall` without progress.
async fn unless_lost<T>(
    work: impl Future<Output = Result<T, AppError>>,
    ends: &[&dyn Endpoint],
    seen: &AtomicU64,
    stall: Duration,
    token: &CancellationToken,
) -> Result<T, AppError> {
    tokio::pin!(work);
    let mut last = (seen.load(Ordering::Relaxed), Instant::now());
    loop {
        tokio::select! {
            r = &mut work => return r,
            _ = tokio::time::sleep(LINK_POLL) => {
                let now = seen.load(Ordering::Relaxed);
                let stalled = if now != last.0 {
                    last = (now, Instant::now());
                    false
                } else if last.1.elapsed() >= stall {
                    last.1 = Instant::now();
                    tokio::select! {
                        dead = dead_ends(ends) => !dead.is_empty(),
                        _ = token.cancelled() => return Err(cancelled()),
                    }
                } else {
                    false
                };
                if stalled || ends.iter().any(|e| e.link_lost()) {
                    return Err(connection_lost());
                }
            }
        }
    }
}

async fn dead_ends<'a>(ends: &[&'a dyn Endpoint]) -> Vec<&'a dyn Endpoint> {
    let mut dead = Vec::new();
    for end in ends {
        if end.link_dead().await {
            dead.push(*end);
        }
    }
    dead
}

/// Sends `sftp-{kind}-{transfer_id}`, the shape every transfer event the queue listens to takes.
pub(crate) fn emit<E: TransferEvents, S: Serialize + Clone>(
    events: &E,
    kind: &str,
    transfer_id: &str,
    payload: S,
) {
    events.send(&format!("sftp-{kind}-{transfer_id}"), payload);
}

async fn attempt<E: TransferEvents>(
    src: &dyn Endpoint,
    src_path: &str,
    dst: &dyn Endpoint,
    dst_path: &str,
    ctx: &mut CopyCtx<'_, E>,
    base: u64,
    part: &mut Option<String>,
) -> Result<Attempt, AppError> {
    let resolved = dst.resolve(dst_path).await?;
    let dst_path = resolved.as_str();
    let (dir, name) = dst.split(dst_path);
    let stat = src.stat(src_path).await?.ok_or_else(|| {
        AppError::coded(ErrorCode::NotFound, format!("{src_path} no longer exists"))
    })?;
    let fp = fingerprint(src_path, stat.size, stat.mtime);
    let part_path = dst.join(&dir, &temp_name(&name, &fp, PART_EXT));
    let old_path = dst.join(&dir, &temp_name(&name, &fp, OLD_EXT));
    *part = Some(part_path.clone());
    if dst.stat(dst_path).await?.is_none() && dst.stat(&old_path).await?.is_some() {
        dst.rename(&old_path, dst_path).await?;
    }
    let offset = resume_offset(src, src_path, dst, &part_path, stat.size).await?;
    if offset > 0 {
        let offset = base + offset;
        emit(
            ctx.events,
            "resumed",
            ctx.transfer_id,
            serde_json::json!({ "offset": offset }),
        );
    }
    ctx.transferred = base + offset;
    ctx.progress();
    let mut writer = match dst.open_write(&part_path, offset, stat.size - offset).await {
        Err(e) if offset == 0 && e.code() == Some(ErrorCode::PermissionDenied) => {
            return copy_in_place(src, src_path, dst, dst_path, stat, ctx).await;
        }
        opened => opened?,
    };
    let mut reader = src.open_read(src_path, offset).await?;
    copy_bytes(&mut reader, &mut writer, &[src, dst], ctx).await?;
    drop(reader);
    let now = src.stat(src_path).await?.map(|s| (s.size, s.mtime));
    if now != Some((stat.size, stat.mtime)) {
        let _ = dst.remove(&part_path).await;
        return Ok(Attempt::SourceChanged);
    }
    if dst.stat(&part_path).await?.map_or(0, |s| s.size) != stat.size {
        let _ = dst.remove(&part_path).await;
        return Ok(Attempt::Mismatch);
    }
    if offset > 0 && !same_hash(src, src_path, dst, &part_path, ctx.token).await? {
        let _ = dst.remove(&part_path).await;
        return Ok(Attempt::Mismatch);
    }
    if ctx.token.is_cancelled() {
        return Err(cancelled());
    }
    if let Some(mode) = dst.stat(dst_path).await?.and_then(|t| t.mode) {
        if let Err(e) = dst.set_mode(&part_path, mode).await {
            log::warn!("could not keep the mode of {dst_path}: {e}");
        }
    }
    dst.replace(&part_path, dst_path, &old_path).await?;
    keep_mtime(dst, dst_path, stat.mtime).await;
    sweep(dst, &dir, &name, ctx).await;
    Ok(Attempt::Done)
}

/// Pumps and flushes under the dead-link watchdog.
async fn copy_bytes<E: TransferEvents>(
    reader: &mut Reader,
    writer: &mut Writer,
    ends: &[&dyn Endpoint],
    ctx: &mut CopyCtx<'_, E>,
) -> Result<(), AppError> {
    let (seen, stall, token) = (AtomicU64::new(ctx.transferred), ctx.stall, ctx.token);
    let copied = async {
        pump(reader, writer, token, |n| {
            ctx.transferred += n as u64;
            ctx.progress();
            seen.store(ctx.transferred, Ordering::Relaxed);
        })
        .await?;
        writer
            .shutdown()
            .await
            .map_err(|e| AppError::caused("Flush error", &e))
    };
    unless_lost(copied, ends, &seen, stall, token).await
}

/// For a folder that lets us rewrite the file but not create a temp next to it: the old way.
async fn copy_in_place<E: TransferEvents>(
    src: &dyn Endpoint,
    src_path: &str,
    dst: &dyn Endpoint,
    dst_path: &str,
    stat: Stat,
    ctx: &mut CopyCtx<'_, E>,
) -> Result<Attempt, AppError> {
    log::info!("no room for a temp file next to {dst_path}; writing it in place");
    let mut writer = dst.open_write(dst_path, 0, stat.size).await?;
    let mut reader = src.open_read(src_path, 0).await?;
    copy_bytes(&mut reader, &mut writer, &[src, dst], ctx).await?;
    keep_mtime(dst, dst_path, stat.mtime).await;
    Ok(Attempt::Done)
}

async fn keep_mtime(dst: &dyn Endpoint, path: &str, mtime: Option<u64>) {
    let Some(mtime) = mtime else { return };
    if let Err(e) = dst.set_mtime(path, mtime).await {
        log::warn!("could not keep the mtime of {path}: {e}");
    }
}

async fn resume_offset(
    src: &dyn Endpoint,
    src_path: &str,
    dst: &dyn Endpoint,
    part: &str,
    size: u64,
) -> Result<u64, AppError> {
    let Some(have) = dst.stat(part).await?.map(|s| s.size) else {
        return Ok(0);
    };
    if have == 0 || have > size || !dst.appends(part, have).await {
        return Ok(0);
    }
    let (a, b) = tokio::try_join!(tail(src, src_path, have), tail(dst, part, have))?;
    Ok(if a == b { have } else { 0 })
}

async fn tail(fs: &dyn Endpoint, path: &str, end: u64) -> Result<Vec<u8>, AppError> {
    let len = end.min(OVERLAP);
    let mut buf = vec![0u8; len as usize];
    fs.open_read(path, end - len)
        .await?
        .read_exact(&mut buf)
        .await
        .map_err(|e| AppError::caused("Read error", &e))?;
    Ok(buf)
}

async fn same_hash(
    src: &dyn Endpoint,
    src_path: &str,
    dst: &dyn Endpoint,
    part: &str,
    token: &CancellationToken,
) -> Result<bool, AppError> {
    match tokio::try_join!(src.hash(src_path, token), dst.hash(part, token))? {
        (Some(a), Some(b)) => Ok(a.eq_ignore_ascii_case(&b)),
        _ => {
            log::info!("no end-to-end hash for {src_path}; kept the size and overlap checks");
            Ok(true)
        }
    }
}

async fn sweep<E: TransferEvents>(
    dst: &dyn Endpoint,
    dir: &str,
    name: &str,
    ctx: &mut CopyCtx<'_, E>,
) {
    let stale: Vec<String> = ctx
        .listing(dst, dir)
        .await
        .iter()
        .filter(|e| is_temp_of(&e.name, name))
        .map(|e| dst.join(dir, &e.name))
        .collect();
    for path in stale {
        let _ = dst.remove(&path).await;
    }
}

#[cfg(test)]
pub(crate) mod engine_tests {
    use super::*;
    use crate::commands::sftp::resume::endpoint::tests_support::TestFs;
    use crate::commands::sftp::resume::endpoint::{Endpoint, LocalFs};
    use crate::error::{AppError, ErrorCode};
    use crate::sftp::backend::test_tree::Recorder;
    use tokio_util::sync::CancellationToken;

    pub(crate) fn noise(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 31 % 251) as u8).collect()
    }

    pub(crate) fn s(p: &std::path::Path) -> String {
        p.to_string_lossy().into_owned()
    }

    pub(crate) fn entries(dir: &std::path::Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    async fn copy_local(
        rec: &Recorder,
        src: &std::path::Path,
        dst: &dyn Endpoint,
        to: &std::path::Path,
        token: &CancellationToken,
    ) -> Result<(), AppError> {
        copy_one(rec, &LocalFs, &s(src), dst, &s(to), "t", token).await
    }

    #[tokio::test]
    async fn a_fresh_copy_lands_with_the_source_mtime_and_no_temp_left() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(1_000_000);
        std::fs::write(a.path().join("v.mp4"), &data).unwrap();
        LocalFs
            .set_mtime(&s(&a.path().join("v.mp4")), 1_700_000_000)
            .await
            .unwrap();
        let rec = Recorder::default();
        copy_local(
            &rec,
            &a.path().join("v.mp4"),
            &LocalFs,
            &b.path().join("v.mp4"),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(b.path().join("v.mp4")).unwrap(), data);
        let landed = LocalFs.stat(&s(&b.path().join("v.mp4"))).await.unwrap();
        assert_eq!(landed.unwrap().mtime, Some(1_700_000_000));
        assert_eq!(entries(b.path()), ["v.mp4"]);
        assert_eq!(
            rec.last("sftp-progress-t").unwrap()["transferred"],
            1_000_000
        );
        assert_eq!(rec.count("sftp-resumed-t"), 0);
    }

    #[tokio::test]
    async fn a_source_without_an_mtime_never_dates_the_copy_1970() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"data").unwrap();
        let src = TestFs {
            no_mtime: true,
            ..Default::default()
        };
        let (from, to) = (s(&a.path().join("v")), s(&b.path().join("v")));
        let (rec, token) = (Recorder::default(), CancellationToken::new());
        copy_one(&rec, &src, &from, &LocalFs, &to, "t", &token)
            .await
            .unwrap();
        let landed = std::fs::metadata(&to).unwrap().modified().unwrap();
        let a_day = std::time::Duration::from_secs(86_400);
        assert!(landed > std::time::UNIX_EPOCH + a_day);
    }

    #[tokio::test]
    async fn an_empty_file_lands() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("e"), b"").unwrap();
        copy_local(
            &Recorder::default(),
            &a.path().join("e"),
            &LocalFs,
            &b.path().join("e"),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(b.path().join("e")).unwrap(), b"");
    }

    #[tokio::test]
    async fn a_stale_temp_of_the_same_name_is_swept_and_others_are_kept() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"new").unwrap();
        let stale = names::temp_name("v", "ffffffffffffffff", names::PART_EXT);
        let other = names::temp_name("w", "ffffffffffffffff", names::PART_EXT);
        std::fs::write(b.path().join(&stale), b"old").unwrap();
        std::fs::write(b.path().join(&other), b"old").unwrap();
        copy_local(
            &Recorder::default(),
            &a.path().join("v"),
            &LocalFs,
            &b.path().join("v"),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(entries(b.path()), [other, "v".to_string()]);
    }

    #[tokio::test]
    async fn a_directory_in_the_way_is_never_moved() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"x").unwrap();
        std::fs::create_dir(b.path().join("v")).unwrap();
        std::fs::write(b.path().join("v/keep"), b"k").unwrap();
        let e = copy_local(
            &Recorder::default(),
            &a.path().join("v"),
            &LocalFs,
            &b.path().join("v"),
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert_eq!(e.code(), Some(ErrorCode::AlreadyExists));
        assert_eq!(std::fs::read(b.path().join("v/keep")).unwrap(), b"k");
    }

    #[tokio::test]
    async fn cancel_removes_the_temp_and_leaves_the_target_alone() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), noise(4_000_000)).unwrap();
        std::fs::write(b.path().join("v"), b"original").unwrap();
        let token = CancellationToken::new();
        token.cancel();
        let e = copy_local(
            &Recorder::default(),
            &a.path().join("v"),
            &LocalFs,
            &b.path().join("v"),
            &token,
        )
        .await
        .unwrap_err();
        assert!(e.to_string().contains("cancelled"));
        assert_eq!(entries(b.path()), ["v"]);
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), b"original");
    }

    #[tokio::test]
    async fn a_failed_swap_puts_the_original_back() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"new").unwrap();
        std::fs::write(b.path().join("v"), b"original").unwrap();
        let dst = TestFs {
            fail_renames: vec![2],
            ..Default::default()
        };
        let r = copy_local(
            &Recorder::default(),
            &a.path().join("v"),
            &dst,
            &b.path().join("v"),
            &CancellationToken::new(),
        )
        .await;
        assert!(r.is_err());
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), b"original");
        assert!(entries(b.path())
            .iter()
            .any(|n| n.ends_with(names::PART_EXT)));
    }

    #[tokio::test]
    async fn an_old_file_left_by_a_crash_is_restored_first() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let src = a.path().join("v");
        std::fs::write(&src, b"new").unwrap();
        let st = LocalFs.stat(&s(&src)).await.unwrap().unwrap();
        let fp = names::fingerprint(&s(&src), st.size, st.mtime);
        let old = names::temp_name("v", &fp, names::OLD_EXT);
        std::fs::write(b.path().join(old), b"original").unwrap();
        let dst = TestFs {
            fail_renames: vec![3],
            ..Default::default()
        };
        let _ = copy_local(
            &Recorder::default(),
            &src,
            &dst,
            &b.path().join("v"),
            &CancellationToken::new(),
        )
        .await;
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), b"original");
    }

    #[tokio::test]
    async fn an_old_file_left_beside_the_target_does_not_block_the_overwrite() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let src = a.path().join("v");
        std::fs::write(&src, b"new").unwrap();
        let st = LocalFs.stat(&s(&src)).await.unwrap().unwrap();
        let fp = names::fingerprint(&s(&src), st.size, st.mtime);
        std::fs::write(b.path().join("v"), b"current").unwrap();
        std::fs::write(
            b.path().join(names::temp_name("v", &fp, names::OLD_EXT)),
            b"superseded",
        )
        .unwrap();
        let dst = TestFs {
            sftp_rename: true,
            ..Default::default()
        };
        copy_local(
            &Recorder::default(),
            &src,
            &dst,
            &b.path().join("v"),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), b"new");
        assert_eq!(entries(b.path()), ["v"]);
    }

    async fn seed_part(
        src: &std::path::Path,
        dst_dir: &std::path::Path,
        name: &str,
        bytes: &[u8],
    ) -> std::path::PathBuf {
        let st = LocalFs.stat(&s(src)).await.unwrap().unwrap();
        let fp = names::fingerprint(&s(src), st.size, st.mtime);
        let part = dst_dir.join(names::temp_name(name, &fp, names::PART_EXT));
        std::fs::write(&part, bytes).unwrap();
        part
    }

    async fn copy_ab(rec: &Recorder, a: &tempfile::TempDir, b: &tempfile::TempDir) {
        copy_local(
            rec,
            &a.path().join("v"),
            &LocalFs,
            &b.path().join("v"),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_matching_part_is_resumed_from_its_end() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(3_000_000);
        std::fs::write(a.path().join("v"), &data).unwrap();
        seed_part(&a.path().join("v"), b.path(), "v", &data[..1_000_000]).await;
        let rec = Recorder::default();
        copy_ab(&rec, &a, &b).await;
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert_eq!(rec.last("sftp-resumed-t").unwrap()["offset"], 1_000_000);
        assert_eq!(entries(b.path()), ["v"]);
    }

    #[tokio::test]
    async fn a_tampered_part_restarts_from_zero() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(3_000_000);
        std::fs::write(a.path().join("v"), &data).unwrap();
        let mut bad = data[..1_000_000].to_vec();
        bad[999_000] ^= 0xff;
        seed_part(&a.path().join("v"), b.path(), "v", &bad).await;
        let rec = Recorder::default();
        copy_ab(&rec, &a, &b).await;
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert_eq!(rec.count("sftp-resumed-t"), 0);
    }

    #[tokio::test]
    async fn a_part_longer_than_the_source_restarts_from_zero() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"short").unwrap();
        seed_part(
            &a.path().join("v"),
            b.path(),
            "v",
            b"much longer than the source",
        )
        .await;
        copy_ab(&Recorder::default(), &a, &b).await;
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), b"short");
    }

    #[tokio::test]
    async fn a_changed_source_never_resumes_an_old_part() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let old = noise(2_000_000);
        std::fs::write(a.path().join("v"), &old).unwrap();
        let stale = seed_part(&a.path().join("v"), b.path(), "v", &old[..1_000_000]).await;
        let new: Vec<u8> = old.iter().map(|b| b.wrapping_add(1)).collect();
        std::fs::write(a.path().join("v"), &new).unwrap();
        LocalFs
            .set_mtime(&s(&a.path().join("v")), 1_800_000_000)
            .await
            .unwrap();
        let rec = Recorder::default();
        copy_ab(&rec, &a, &b).await;
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), new);
        assert_eq!(rec.count("sftp-resumed-t"), 0);
        assert!(!stale.exists(), "the old fingerprint's part is swept");
    }

    #[tokio::test]
    async fn a_complete_but_uncommitted_part_is_verified_and_committed() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(500_000);
        std::fs::write(a.path().join("v"), &data).unwrap();
        seed_part(&a.path().join("v"), b.path(), "v", &data).await;
        let rec = Recorder::default();
        copy_ab(&rec, &a, &b).await;
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert_eq!(rec.last("sftp-resumed-t").unwrap()["offset"], 500_000);
    }

    #[tokio::test]
    async fn a_hash_mismatch_discards_the_part_and_copies_again_once() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(2_000_000);
        std::fs::write(a.path().join("v"), &data).unwrap();
        seed_part(&a.path().join("v"), b.path(), "v", &data[..1_000_000]).await;
        let dst = TestFs {
            lie_hash_once: true,
            ..Default::default()
        };
        let rec = Recorder::default();
        copy_local(
            &rec,
            &a.path().join("v"),
            &dst,
            &b.path().join("v"),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert!(dst.state.lock().unwrap().lied, "the hash was consulted");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_source_that_keeps_changing_gives_up() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let src = a.path().join("v");
        std::fs::write(&src, noise(8_000_000)).unwrap();
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let writer = {
            let (src, stop) = (src.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut t = 1_700_000_000u64;
                while !stop.load(Ordering::Relaxed) {
                    t += 1;
                    let mut f = std::fs::File::options().append(true).open(&src).unwrap();
                    std::io::Write::write_all(&mut f, b"x").unwrap();
                    f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(t))
                        .unwrap();
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            })
        };
        let e = copy_local(
            &Recorder::default(),
            &src,
            &LocalFs,
            &b.path().join("v"),
            &CancellationToken::new(),
        )
        .await
        .unwrap_err();
        stop.store(true, Ordering::Relaxed);
        writer.join().unwrap();
        assert_eq!(e.code(), Some(ErrorCode::TransferSourceChanged));
        assert!(!b.path().join("v").exists());
    }

    async fn seeded(data: &[u8]) -> (tempfile::TempDir, tempfile::TempDir) {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), data).unwrap();
        seed_part(&a.path().join("v"), b.path(), "v", &data[..data.len() / 2]).await;
        (a, b)
    }

    #[tokio::test]
    async fn cancel_during_the_hash_never_commits() {
        let data = noise(2_000_000);
        let (a, b) = seeded(&data).await;
        std::fs::write(b.path().join("v"), b"original").unwrap();
        let token = CancellationToken::new();
        let dst = TestFs {
            cancel_on_hash: Some(token.clone()),
            ..Default::default()
        };
        let e = copy_local(
            &Recorder::default(),
            &a.path().join("v"),
            &dst,
            &b.path().join("v"),
            &token,
        )
        .await
        .unwrap_err();
        assert!(e.to_string().contains("cancelled"), "{e}");
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), b"original");
    }

    #[tokio::test]
    async fn a_hash_lost_with_the_link_is_retried_not_skipped() {
        let data = noise(2_000_000);
        let (a, b) = seeded(&data).await;
        let dst = TestFs {
            hash_fails_once: true,
            dead_until_waited: true,
            ..Default::default()
        };
        let token = CancellationToken::new();
        copy_local(
            &Recorder::default(),
            &a.path().join("v"),
            &dst,
            &b.path().join("v"),
            &token,
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert!(
            dst.state.lock().unwrap().waited,
            "waited for the link before verifying again"
        );
    }

    #[tokio::test]
    async fn a_lost_link_that_answers_again_resumes_instead_of_failing() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), noise(500_000)).unwrap();
        let dst = TestFs {
            lose_first_write: true,
            ..Default::default()
        };
        let token = CancellationToken::new();
        copy_local(
            &Recorder::default(),
            &a.path().join("v"),
            &dst,
            &b.path().join("v"),
            &token,
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), noise(500_000));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_overwrite_keeps_the_target_mode() {
        use std::os::unix::fs::PermissionsExt;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"new").unwrap();
        std::fs::write(b.path().join("v"), b"old").unwrap();
        std::fs::set_permissions(b.path().join("v"), std::fs::Permissions::from_mode(0o750))
            .unwrap();
        copy_ab(&Recorder::default(), &a, &b).await;
        let mode = std::fs::metadata(b.path().join("v"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o750);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_overwrite_through_a_symlink_updates_what_it_points_at() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"new").unwrap();
        std::fs::write(b.path().join("real.conf"), b"old").unwrap();
        std::os::unix::fs::symlink("real.conf", b.path().join("v")).unwrap();
        copy_ab(&Recorder::default(), &a, &b).await;
        assert!(std::fs::symlink_metadata(b.path().join("v"))
            .unwrap()
            .is_symlink());
        assert_eq!(std::fs::read(b.path().join("real.conf")).unwrap(), b"new");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_folder_without_create_rights_is_written_in_place() {
        use std::os::unix::fs::PermissionsExt;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"new").unwrap();
        let locked = b.path().join("locked");
        std::fs::create_dir(&locked).unwrap();
        std::fs::write(locked.join("v"), b"old").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        let token = CancellationToken::new();
        let r = copy_local(
            &Recorder::default(),
            &a.path().join("v"),
            &LocalFs,
            &locked.join("v"),
            &token,
        )
        .await;
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        r.unwrap();
        assert_eq!(std::fs::read(locked.join("v")).unwrap(), b"new");
    }

    fn tree(root: &std::path::Path) {
        std::fs::create_dir_all(root.join("sub/empty")).unwrap();
        std::fs::write(root.join("a"), noise(300_000)).unwrap();
        std::fs::write(root.join("sub/b"), noise(200_000)).unwrap();
        std::fs::write(root.join("sub/c"), b"").unwrap();
    }

    async fn copy_dir(rec: &Recorder, from: &std::path::Path, to: &std::path::Path, tid: &str) {
        let token = CancellationToken::new();
        copy_tree(rec, &LocalFs, &s(from), &LocalFs, &s(to), tid, &token)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_folder_lands_whole_with_empty_subfolders() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        tree(a.path());
        let dst = b.path().join("copy");
        copy_dir(&Recorder::default(), a.path(), &dst, "t").await;
        assert_eq!(std::fs::read(dst.join("sub/b")).unwrap(), noise(200_000));
        assert!(dst.join("sub/empty").is_dir());
        assert_eq!(std::fs::read(dst.join("sub/c")).unwrap(), b"");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_entry_without_metadata_is_skipped_and_reported() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        tree(a.path());
        let dangling = a.path().join("sub/dangling");
        std::os::unix::fs::symlink("missing", &dangling).unwrap();
        let dst = b.path().join("copy");
        let rec = Recorder::default();
        copy_dir(&rec, a.path(), &dst, "t3").await;
        assert_eq!(rec.skipped("t3"), [s(&dangling)]);
        assert_eq!(std::fs::read(dst.join("sub/b")).unwrap(), noise(200_000));
    }

    async fn copy_dir_to(
        dst: &TestFs,
        from: &std::path::Path,
        to: &std::path::Path,
    ) -> Result<(), AppError> {
        let token = CancellationToken::new();
        copy_tree(
            &Recorder::default(),
            &LocalFs,
            &s(from),
            dst,
            &s(to),
            "t",
            &token,
        )
        .await
    }

    #[tokio::test]
    async fn a_folder_mkdir_lost_with_the_link_waits_and_carries_on() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        tree(a.path());
        let dst = TestFs {
            lose_first_mkdir: true,
            dead_until_waited: true,
            ..Default::default()
        };
        let to = b.path().join("copy");
        copy_dir_to(&dst, a.path(), &to).await.unwrap();
        assert!(dst.state.lock().unwrap().waited);
        assert_eq!(std::fs::read(to.join("sub/b")).unwrap(), noise(200_000));
        assert!(to.join("sub/empty").is_dir());
    }

    #[tokio::test]
    async fn a_folder_mkdir_failing_on_a_live_link_fails_the_copy() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        tree(a.path());
        let dst = TestFs {
            lose_first_mkdir: true,
            ..Default::default()
        };
        let e = copy_dir_to(&dst, a.path(), &b.path().join("copy"))
            .await
            .unwrap_err();
        assert_eq!(e.code(), Some(ErrorCode::ConnectionLost));
    }

    #[tokio::test]
    async fn a_resumed_folder_skips_landed_files_and_redoes_the_rest() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        tree(a.path());
        let dst = b.path().join("copy");
        copy_dir(&Recorder::default(), a.path(), &dst, "t0").await;
        std::fs::write(dst.join("sub/b"), b"cut").unwrap();
        let before = std::fs::metadata(dst.join("a"))
            .unwrap()
            .modified()
            .unwrap();
        mark_resume("t1");
        let rec = Recorder::default();
        copy_dir(&rec, a.path(), &dst, "t1").await;
        clear_resume("t1");
        assert_eq!(std::fs::read(dst.join("sub/b")).unwrap(), noise(200_000));
        let after = std::fs::metadata(dst.join("a"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(after, before);
        assert_eq!(
            rec.last("sftp-progress-t1").unwrap()["transferred"],
            500_000
        );
    }

    #[tokio::test]
    async fn a_resumed_folder_never_skips_a_file_whose_mtime_is_unknown() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("f"), b"new!").unwrap();
        let dst = b.path().join("copy");
        std::fs::create_dir(&dst).unwrap();
        std::fs::write(dst.join("f"), b"old!").unwrap();
        let blind = TestFs {
            no_mtime: true,
            ..Default::default()
        };
        let (rec, token) = (Recorder::default(), CancellationToken::new());
        mark_resume("t3");
        let (from, to) = (s(a.path()), s(&dst));
        let copied = copy_tree(&rec, &blind, &from, &blind, &to, "t3", &token).await;
        clear_resume("t3");
        copied.unwrap();
        assert_eq!(std::fs::read(dst.join("f")).unwrap(), b"new!");
    }

    #[tokio::test]
    async fn a_first_run_never_skips_an_identical_looking_file() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("f"), b"new!").unwrap();
        let dst = b.path().join("copy");
        std::fs::create_dir(&dst).unwrap();
        std::fs::write(dst.join("f"), b"old!").unwrap();
        let st = LocalFs
            .stat(&s(&a.path().join("f")))
            .await
            .unwrap()
            .unwrap();
        LocalFs
            .set_mtime(&s(&dst.join("f")), st.mtime.unwrap())
            .await
            .unwrap();
        copy_dir(&Recorder::default(), a.path(), &dst, "t2").await;
        assert_eq!(std::fs::read(dst.join("f")).unwrap(), b"new!");
    }
}

#[cfg(test)]
mod mark_tests {
    use super::*;

    #[test]
    fn a_mark_lasts_until_cleared() {
        assert!(!is_resume("m1"));
        mark_resume("m1");
        assert!(is_resume("m1"));
        clear_resume("m1");
        assert!(!is_resume("m1"));
    }
}
