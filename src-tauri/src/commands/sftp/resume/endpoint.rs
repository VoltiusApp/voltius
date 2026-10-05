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
    pub mtime: u64,
    pub is_dir: bool,
}

pub(crate) struct Listed {
    pub name: String,
    pub stat: Stat,
    pub is_symlink: bool,
}

pub(crate) type Reader = Box<dyn AsyncRead + Send + Unpin>;
pub(crate) type Writer = Box<dyn AsyncWrite + Send + Unpin>;

/// One side of a copy: this machine's disk or an SFTP session.
#[async_trait]
pub(crate) trait Endpoint: Send + Sync {
    fn is_local(&self) -> bool;
    fn split(&self, path: &str) -> (String, String);
    fn join(&self, dir: &str, rel: &str) -> String;
    async fn stat(&self, path: &str) -> Result<Option<Stat>, AppError>;
    async fn list(&self, dir: &str) -> Result<Vec<Listed>, AppError>;
    async fn mkdir(&self, path: &str) -> Result<(), AppError>;
    async fn open_read(&self, path: &str, offset: u64) -> Result<Reader, AppError>;
    async fn open_write(&self, path: &str, offset: u64) -> Result<Writer, AppError>;
    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError>;
    async fn remove(&self, path: &str) -> Result<(), AppError>;
    async fn set_mtime(&self, path: &str, mtime: u64) -> Result<(), AppError>;
    async fn hash(&self, path: &str, token: &CancellationToken) -> Option<String>;
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
    let mtime = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    Stat {
        size: m.len(),
        mtime,
        is_dir: m.is_dir(),
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
            if let Ok(m) = tokio::fs::metadata(e.path()).await {
                out.push(Listed {
                    name: e.file_name().to_string_lossy().into_owned(),
                    stat: local_stat(&m),
                    is_symlink: false,
                });
            }
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

    async fn open_write(&self, path: &str, offset: u64) -> Result<Writer, AppError> {
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

    async fn hash(&self, path: &str, token: &CancellationToken) -> Option<String> {
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
        .ok()?
    }

    async fn replace(&self, part: &str, target: &str, _old: &str) -> Result<(), AppError> {
        if self.stat(target).await?.is_some_and(|s| s.is_dir) {
            return Err(in_the_way(target));
        }
        self.rename(part, target).await
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
        let mut w = LocalFs.open_write(&f, 0).await.unwrap();
        w.write_all(b"hello").await.unwrap();
        w.shutdown().await.unwrap();
        let mut w = LocalFs.open_write(&f, 3).await.unwrap();
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
        assert_eq!((s.size, s.mtime, s.is_dir), (3, 1_000_000, false));
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
    async fn local_hash_is_sha256() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("f"), b"").unwrap();
        assert_eq!(
            LocalFs
                .hash(&p(&d, "f"), &CancellationToken::new())
                .await
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
