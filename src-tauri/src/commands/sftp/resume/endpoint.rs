use crate::commands::sftp::RemoteFile;
use crate::error::{AppError, ErrorCode};
use async_trait::async_trait;
use sha2::{Digest, Sha256};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncSeekExt, AsyncWrite};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Stat {
    pub size: u64,
    /// None when the server reports none: never stamped on a copy, never matched.
    pub mtime: Option<u64>,
    pub is_dir: bool,
    pub mode: Option<u32>,
}

pub(crate) struct Listed {
    pub name: String,
    /// None when the entry's metadata can't be read, e.g. a dangling symlink.
    pub stat: Option<Stat>,
    pub is_symlink: bool,
}

impl From<RemoteFile> for Listed {
    fn from(f: RemoteFile) -> Self {
        Listed {
            stat: Some(Stat {
                size: f.size,
                mtime: f.modified,
                is_dir: f.is_dir,
                mode: f.permissions,
            }),
            is_symlink: f.is_symlink,
            name: f.name,
        }
    }
}

pub(crate) type Reader = Box<dyn AsyncRead + Send + Unpin>;
pub(crate) type Writer = Box<dyn AsyncWrite + Send + Unpin>;

/// One side of a copy: this machine's disk or a remote file backend.
#[async_trait]
pub(crate) trait Endpoint: Send + Sync {
    fn is_local(&self) -> bool;
    fn split(&self, path: &str) -> (String, String) {
        let trimmed = path.trim_end_matches('/');
        match trimmed.rfind('/') {
            Some(0) => ("/".into(), trimmed[1..].into()),
            Some(i) => (trimmed[..i].into(), trimmed[i + 1..].into()),
            None => (".".into(), trimmed.into()),
        }
    }
    fn join(&self, dir: &str, rel: &str) -> String {
        format!("{}/{rel}", dir.trim_end_matches('/'))
    }
    async fn stat(&self, path: &str) -> Result<Option<Stat>, AppError>;
    async fn list(&self, dir: &str) -> Result<Vec<Listed>, AppError>;
    async fn mkdir(&self, path: &str) -> Result<(), AppError>;
    async fn open_read(&self, path: &str, offset: u64) -> Result<Reader, AppError>;
    /// `offset` is 0 (truncate) or the file's current size; `len` bytes follow.
    async fn open_write(&self, path: &str, offset: u64, len: u64) -> Result<Writer, AppError>;
    /// Whether a write can carry on from the `have` bytes `path` already holds.
    async fn appends(&self, _path: &str, _have: u64) -> bool {
        true
    }
    /// Rewrite an existing file rather than swap a temp in: the server keeps per-file state
    /// (mode, versions, shares) that a swap would lose.
    fn overwrites_in_place(&self) -> bool {
        false
    }
    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError>;
    async fn remove(&self, path: &str) -> Result<(), AppError>;
    async fn set_mtime(&self, path: &str, mtime: u64) -> Result<(), AppError>;
    async fn set_mode(&self, _path: &str, _mode: u32) -> Result<(), AppError> {
        Ok(())
    }
    /// The file a write to `path` lands in: a symlink's target, else `path` itself.
    async fn resolve(&self, path: &str) -> Result<String, AppError> {
        Ok(path.to_string())
    }
    /// None when no hash is to be had; an error only when the link died while hashing.
    async fn hash(&self, path: &str, token: &CancellationToken)
        -> Result<Option<String>, AppError>;
    /// Cheap check, polled while bytes flow: SFTP write acks never time out on a dead link.
    fn link_lost(&self) -> bool {
        false
    }
    async fn link_dead(&self) -> bool {
        false
    }
    async fn wait_for_link(
        &self,
        _token: &CancellationToken,
        _deadline: Instant,
    ) -> Result<(), AppError> {
        Ok(())
    }
    async fn replace(&self, part: &str, target: &str, old: &str) -> Result<(), AppError> {
        swap_aside(self, part, target, old).await
    }
}

fn in_the_way(target: &str) -> AppError {
    AppError::coded(
        ErrorCode::AlreadyExists,
        format!("A folder is in the way at {target}"),
    )
}

/// Moves `target` aside before `part` takes its name, and puts it back if that fails.
pub(crate) async fn swap_aside<E: Endpoint + ?Sized>(
    fs: &E,
    part: &str,
    target: &str,
    old: &str,
) -> Result<(), AppError> {
    match fs.stat(target).await? {
        None => return fs.rename(part, target).await,
        Some(s) if s.is_dir => return Err(in_the_way(target)),
        Some(_) => {}
    }
    if fs.stat(old).await?.is_some() {
        fs.remove(old).await?;
    }
    fs.rename(target, old).await?;
    if let Err(e) = fs.rename(part, target).await {
        let _ = fs.rename(old, target).await;
        return Err(e);
    }
    if let Err(e) = fs.remove(old).await {
        log::warn!("could not remove {old}: {e}");
    }
    Ok(())
}

fn local_stat(m: &std::fs::Metadata) -> Stat {
    // Unknown only when unreadable; a date before 1970 clamps to 0, as it always has.
    let mtime = m
        .modified()
        .ok()
        .map(|t| t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()));
    #[cfg(unix)]
    let mode = Some(std::os::unix::fs::PermissionsExt::mode(&m.permissions()));
    #[cfg(not(unix))]
    let mode = None;
    Stat {
        size: m.len(),
        mtime,
        is_dir: m.is_dir(),
        mode,
    }
}

pub(crate) struct LocalFs;

#[async_trait]
impl Endpoint for LocalFs {
    fn is_local(&self) -> bool {
        true
    }

    fn split(&self, path: &str) -> (String, String) {
        let p = Path::new(path);
        let dir = p
            .parent()
            .map_or_else(|| ".".into(), |d| d.to_string_lossy().into_owned());
        let name = p
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        (dir, name)
    }

    fn join(&self, dir: &str, rel: &str) -> String {
        rel.split('/')
            .fold(PathBuf::from(dir), |p, c| p.join(c))
            .to_string_lossy()
            .into_owned()
    }

    async fn stat(&self, path: &str) -> Result<Option<Stat>, AppError> {
        match tokio::fs::metadata(path).await {
            Ok(m) => Ok(Some(local_stat(&m))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    async fn list(&self, dir: &str) -> Result<Vec<Listed>, AppError> {
        let mut rd = tokio::fs::read_dir(dir).await?;
        let mut out = Vec::new();
        while let Some(e) = rd.next_entry().await? {
            out.push(Listed {
                name: e.file_name().to_string_lossy().into_owned(),
                stat: tokio::fs::metadata(e.path())
                    .await
                    .ok()
                    .as_ref()
                    .map(local_stat),
                is_symlink: false,
            });
        }
        Ok(out)
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        Ok(tokio::fs::create_dir_all(path).await?)
    }

    async fn open_read(&self, path: &str, offset: u64) -> Result<Reader, AppError> {
        let mut f = tokio::fs::File::open(path).await?;
        f.seek(SeekFrom::Start(offset)).await?;
        Ok(Box::new(f))
    }

    async fn open_write(&self, path: &str, offset: u64, _len: u64) -> Result<Writer, AppError> {
        if let Some(parent) = Path::new(path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(offset == 0)
            .open(path)
            .await?;
        f.seek(SeekFrom::Start(offset)).await?;
        Ok(Box::new(f))
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        Ok(tokio::fs::rename(from, to).await?)
    }

    async fn remove(&self, path: &str) -> Result<(), AppError> {
        Ok(tokio::fs::remove_file(path).await?)
    }

    async fn set_mtime(&self, path: &str, mtime: u64) -> Result<(), AppError> {
        let path = path.to_string();
        tokio::task::spawn_blocking(move || {
            std::fs::File::options()
                .write(true)
                .open(&path)?
                .set_modified(UNIX_EPOCH + Duration::from_secs(mtime))
        })
        .await
        .map_err(|e| AppError::from(e.to_string()))??;
        Ok(())
    }

    #[cfg(unix)]
    async fn set_mode(&self, path: &str, mode: u32) -> Result<(), AppError> {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(mode & 0o7777);
        Ok(tokio::fs::set_permissions(path, perms).await?)
    }

    async fn resolve(&self, path: &str) -> Result<String, AppError> {
        match tokio::fs::symlink_metadata(path).await {
            Ok(m) if m.is_symlink() => Ok(tokio::fs::canonicalize(path)
                .await
                .map_or_else(|_| path.to_string(), |p| p.to_string_lossy().into_owned())),
            _ => Ok(path.to_string()),
        }
    }

    async fn hash(
        &self,
        path: &str,
        token: &CancellationToken,
    ) -> Result<Option<String>, AppError> {
        let (path, token) = (path.to_string(), token.clone());
        tokio::task::spawn_blocking(move || {
            let mut f = std::fs::File::open(&path).ok()?;
            let mut h = Sha256::new();
            let mut buf = vec![0u8; 1 << 20];
            loop {
                if token.is_cancelled() {
                    return None;
                }
                let n = std::io::Read::read(&mut f, &mut buf).ok()?;
                if n == 0 {
                    break;
                }
                h.update(&buf[..n]);
            }
            Some(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
        })
        .await
        .map_or(Ok(None), Ok)
    }

    async fn replace(&self, part: &str, target: &str, _old: &str) -> Result<(), AppError> {
        if self.stat(target).await?.is_some_and(|s| s.is_dir) {
            return Err(in_the_way(target));
        }
        self.rename(part, target).await
    }
}

#[cfg(test)]
pub(crate) mod tests_support {
    use super::*;
    use crate::commands::sftp::resume::connection_lost;
    use std::pin::Pin;
    use std::sync::Mutex;
    use std::task::{ready, Context, Poll};

    /// Passes `left` bytes through, flushed, then fails.
    struct CutAfter {
        inner: Writer,
        left: u64,
    }

    impl AsyncWrite for CutAfter {
        fn poll_write(
            mut self: Pin<&mut Self>,
            cx: &mut Context<'_>,
            buf: &[u8],
        ) -> Poll<std::io::Result<usize>> {
            let this = &mut *self;
            if this.left == 0 {
                ready!(Pin::new(&mut this.inner).poll_flush(cx))?;
                return Poll::Ready(Err(std::io::Error::other("cut")));
            }
            let n = buf.len().min(this.left as usize);
            let written = ready!(Pin::new(&mut this.inner).poll_write(cx, &buf[..n]))?;
            this.left -= written as u64;
            Poll::Ready(Ok(written))
        }
        fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Pin::new(&mut self.inner).poll_flush(cx)
        }
        fn poll_shutdown(
            mut self: Pin<&mut Self>,
            cx: &mut Context<'_>,
        ) -> Poll<std::io::Result<()>> {
            Pin::new(&mut self.inner).poll_shutdown(cx)
        }
    }

    /// LocalFs with faults: renames that fail by call number or never overwrite (as on SFTP),
    /// a hash that lies once, a link that reads dead until waited on, a server that reports
    /// no mtimes.
    #[derive(Default)]
    pub(crate) struct TestFs {
        pub fail_renames: Vec<usize>,
        pub sftp_rename: bool,
        pub no_mtime: bool,
        pub in_place: bool,
        pub lie_hash_once: bool,
        pub hash_fails_once: bool,
        pub cancel_on_hash: Option<CancellationToken>,
        pub lose_first_write: bool,
        pub cut_first_write_after: Option<u64>,
        pub lose_first_mkdir: bool,
        pub dead_until_waited: bool,
        pub state: Mutex<TestState>,
    }

    #[derive(Default)]
    pub(crate) struct TestState {
        pub renames: usize,
        pub lied: bool,
        pub hash_failed: bool,
        pub write_lost: bool,
        pub write_cut: bool,
        pub mkdir_lost: bool,
        pub waited: bool,
    }

    fn once(flag: bool, done: &mut bool) -> bool {
        flag && !std::mem::replace(done, true)
    }

    impl TestFs {
        fn shown(&self, mut s: Stat) -> Stat {
            if self.no_mtime {
                s.mtime = None;
            }
            s
        }
    }

    #[async_trait]
    impl Endpoint for TestFs {
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
            Ok(LocalFs.stat(p).await?.map(|s| self.shown(s)))
        }
        async fn list(&self, d: &str) -> Result<Vec<Listed>, AppError> {
            let mut listed = LocalFs.list(d).await?;
            for e in &mut listed {
                e.stat = e.stat.map(|s| self.shown(s));
            }
            Ok(listed)
        }
        async fn mkdir(&self, p: &str) -> Result<(), AppError> {
            if once(
                self.lose_first_mkdir,
                &mut self.state.lock().unwrap().mkdir_lost,
            ) {
                return Err(connection_lost());
            }
            LocalFs.mkdir(p).await
        }
        async fn open_read(&self, p: &str, o: u64) -> Result<Reader, AppError> {
            LocalFs.open_read(p, o).await
        }
        async fn open_write(&self, p: &str, o: u64, n: u64) -> Result<Writer, AppError> {
            if once(
                self.lose_first_write,
                &mut self.state.lock().unwrap().write_lost,
            ) {
                return Err(connection_lost());
            }
            let writer = LocalFs.open_write(p, o, n).await?;
            match self.cut_first_write_after {
                Some(left) if once(true, &mut self.state.lock().unwrap().write_cut) => {
                    Ok(Box::new(CutAfter {
                        inner: writer,
                        left,
                    }))
                }
                _ => Ok(writer),
            }
        }
        fn overwrites_in_place(&self) -> bool {
            self.in_place
        }
        async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
            let n = {
                let mut st = self.state.lock().unwrap();
                st.renames += 1;
                st.renames
            };
            if self.fail_renames.contains(&n)
                || (self.sftp_rename && LocalFs.stat(to).await?.is_some())
            {
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
        async fn hash(&self, p: &str, t: &CancellationToken) -> Result<Option<String>, AppError> {
            if let Some(token) = &self.cancel_on_hash {
                token.cancel();
                return Ok(None);
            }
            if once(
                self.hash_fails_once,
                &mut self.state.lock().unwrap().hash_failed,
            ) {
                return Err(connection_lost());
            }
            if once(self.lie_hash_once, &mut self.state.lock().unwrap().lied) {
                return Ok(Some("0".repeat(64)));
            }
            LocalFs.hash(p, t).await
        }
        async fn link_dead(&self) -> bool {
            self.dead_until_waited && !self.state.lock().unwrap().waited
        }
        async fn wait_for_link(
            &self,
            _token: &CancellationToken,
            _deadline: Instant,
        ) -> Result<(), AppError> {
            self.state.lock().unwrap().waited = true;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn p(dir: &tempfile::TempDir, name: &str) -> String {
        dir.path().join(name).to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn local_writes_at_an_offset_and_reads_from_one() {
        let d = tempfile::tempdir().unwrap();
        let f = p(&d, "sub/x");
        let mut w = LocalFs.open_write(&f, 0, 5).await.unwrap();
        w.write_all(b"hello").await.unwrap();
        w.shutdown().await.unwrap();
        let mut w = LocalFs.open_write(&f, 3, 3).await.unwrap();
        w.write_all(b"LO!").await.unwrap();
        w.shutdown().await.unwrap();
        let mut s = String::new();
        LocalFs
            .open_read(&f, 2)
            .await
            .unwrap()
            .read_to_string(&mut s)
            .await
            .unwrap();
        assert_eq!(s, "lLO!");
    }

    #[tokio::test]
    async fn local_stat_reports_absence_size_mtime_and_kind() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(LocalFs.stat(&p(&d, "nope")).await.unwrap(), None);
        std::fs::write(d.path().join("f"), b"abc").unwrap();
        LocalFs.set_mtime(&p(&d, "f"), 1_000_000).await.unwrap();
        let s = LocalFs.stat(&p(&d, "f")).await.unwrap().unwrap();
        assert_eq!((s.size, s.mtime, s.is_dir), (3, Some(1_000_000), false));
        assert!(
            LocalFs
                .stat(&d.path().to_string_lossy())
                .await
                .unwrap()
                .unwrap()
                .is_dir
        );
    }

    #[tokio::test]
    async fn local_stat_clamps_a_date_before_1970_to_0() {
        let d = tempfile::tempdir().unwrap();
        let f = std::fs::File::create(d.path().join("f")).unwrap();
        f.set_modified(UNIX_EPOCH - Duration::from_secs(86_400))
            .unwrap();
        let s = LocalFs.stat(&p(&d, "f")).await.unwrap().unwrap();
        assert_eq!(s.mtime, Some(0));
    }

    #[tokio::test]
    async fn local_hash_is_sha256() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("f"), b"").unwrap();
        assert_eq!(
            LocalFs
                .hash(&p(&d, "f"), &CancellationToken::new())
                .await
                .unwrap()
                .as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
    }

    #[test]
    fn local_join_and_split_use_the_platform_separator() {
        let joined = LocalFs.join("/base", "a/b");
        assert_eq!(Path::new(&joined), Path::new("/base").join("a").join("b"));
        let (dir, name) = LocalFs.split(&joined);
        assert_eq!(name, "b");
        assert_eq!(Path::new(&dir), Path::new("/base").join("a"));
    }
}
