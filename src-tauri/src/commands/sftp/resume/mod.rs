pub(crate) mod endpoint;
pub(crate) mod names;
pub(crate) mod sftp_fs;

use crate::commands::sftp::{pump_chunks, TransferProgress};
use crate::error::{AppError, ErrorCode};
use crate::sftp::backend::TransferEvents;
use endpoint::{Endpoint, Listed};
use names::{fingerprint, is_temp_of, temp_name, OLD_EXT, PART_EXT};
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex as StdMutex};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

pub(crate) const OVERLAP: u64 = 64 * 1024;
pub(crate) const LARGE_FILE: u64 = 64 * 1024 * 1024;
pub(crate) const LINK_WAIT: Duration = Duration::from_secs(300);
pub(crate) const RESTARTS: u32 = 3;

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
            listings: HashMap::new(),
        }
    }

    pub fn progress(&self) {
        self.events.send(
            &format!("sftp-progress-{}", self.transfer_id),
            TransferProgress {
                transferred: self.transferred,
                total: self.total,
            },
        );
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

pub(crate) async fn resumable_copy<E: TransferEvents>(
    src: &dyn Endpoint,
    src_path: &str,
    dst: &dyn Endpoint,
    dst_path: &str,
    ctx: &mut CopyCtx<'_, E>,
) -> Result<(), AppError> {
    let base = ctx.transferred;
    let mut part = None;
    let (mut changed, mut mismatched) = (0, 0);
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
        if ctx.token.is_cancelled() {
            if let Some(p) = &part {
                let _ = dst.remove(p).await;
            }
            return Err(cancelled());
        }
        return Err(err);
    }
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
    let offset = 0;
    ctx.transferred = base + offset;
    ctx.progress();
    let mut reader = src.open_read(src_path, offset).await?;
    let mut writer = dst.open_write(&part_path, offset).await?;
    pump_chunks(
        ctx.events,
        &mut reader,
        &mut writer,
        ctx.transfer_id,
        ctx.token,
        &mut ctx.transferred,
        ctx.total,
    )
    .await?;
    writer
        .shutdown()
        .await
        .map_err(|e| AppError::from(format!("Flush error: {e}")))?;
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
    dst.replace(&part_path, dst_path, &old_path).await?;
    if let Err(e) = dst.set_mtime(dst_path, stat.mtime).await {
        log::warn!("could not keep the mtime of {dst_path}: {e}");
    }
    sweep(dst, &dir, &name, ctx).await;
    Ok(Attempt::Done)
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
    use crate::commands::sftp::resume::endpoint::{
        Endpoint, Listed, LocalFs, Reader, Stat, Writer,
    };
    use crate::error::{AppError, ErrorCode};
    use crate::sftp::backend::test_tree::Recorder;
    use std::sync::Mutex as StdMutex;
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
        assert_eq!(landed.unwrap().mtime, 1_700_000_000);
        assert_eq!(entries(b.path()), ["v.mp4"]);
        assert_eq!(
            rec.last("sftp-progress-t").unwrap()["transferred"],
            1_000_000
        );
        assert_eq!(rec.count("sftp-resumed-t"), 0);
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

    /// LocalFs whose `rename` fails on the given call numbers (1-based).
    pub(crate) struct FailingRename {
        fail_on: Vec<usize>,
        calls: StdMutex<usize>,
    }

    impl FailingRename {
        pub(crate) fn new(fail_on: Vec<usize>) -> Self {
            Self {
                fail_on,
                calls: StdMutex::new(0),
            }
        }
    }

    #[async_trait::async_trait]
    impl Endpoint for FailingRename {
        fn is_local(&self) -> bool {
            true
        }
        fn split(&self, p: &str) -> (String, String) {
            LocalFs.split(p)
        }
        fn join(&self, d: &str, r: &str) -> String {
            LocalFs.join(d, r)
        }
        async fn stat(&self, p: &str) -> Result<Option<Stat>, AppError> {
            LocalFs.stat(p).await
        }
        async fn list(&self, d: &str) -> Result<Vec<Listed>, AppError> {
            LocalFs.list(d).await
        }
        async fn mkdir(&self, p: &str) -> Result<(), AppError> {
            LocalFs.mkdir(p).await
        }
        async fn open_read(&self, p: &str, o: u64) -> Result<Reader, AppError> {
            LocalFs.open_read(p, o).await
        }
        async fn open_write(&self, p: &str, o: u64) -> Result<Writer, AppError> {
            LocalFs.open_write(p, o).await
        }
        async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
            let n = {
                let mut c = self.calls.lock().unwrap();
                *c += 1;
                *c
            };
            if self.fail_on.contains(&n) {
                return Err("rename refused".into());
            }
            LocalFs.rename(from, to).await
        }
        async fn remove(&self, p: &str) -> Result<(), AppError> {
            LocalFs.remove(p).await
        }
        async fn set_mtime(&self, p: &str, m: u64) -> Result<(), AppError> {
            LocalFs.set_mtime(p, m).await
        }
        async fn hash(&self, p: &str, t: &CancellationToken) -> Option<String> {
            LocalFs.hash(p, t).await
        }
    }

    #[tokio::test]
    async fn a_failed_swap_puts_the_original_back() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), b"new").unwrap();
        std::fs::write(b.path().join("v"), b"original").unwrap();
        let dst = FailingRename::new(vec![2]);
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
        let dst = FailingRename::new(vec![3]);
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
