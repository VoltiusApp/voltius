use super::endpoint::{Endpoint, Listed, Reader, Stat, Writer};
use super::names::parse_sha256;
use crate::commands::sftp::{SftpFile, TarProbe};
use crate::error::AppError;
use crate::sftp::link::SftpLink;
use crate::ssh::client::SshClient;
use crate::ssh::exec::run_captured;
use crate::ssh::live_cells::read_cell;
use async_trait::async_trait;
use russh::client::Handler;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::fs::Metadata;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use std::io::SeekFrom;
use std::sync::Arc;
use tokio::io::AsyncSeekExt;
use tokio::sync::Mutex;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub(crate) struct SftpFs<H: Handler = SshClient> {
    session: Arc<Mutex<SftpSession>>,
    link: Option<Arc<SftpLink<H>>>,
    tar: Option<Arc<TarProbe<H>>>,
}

impl<H: Handler> Clone for SftpFs<H> {
    fn clone(&self) -> Self {
        Self {
            session: Arc::clone(&self.session),
            link: self.link.clone(),
            tar: self.tar.clone(),
        }
    }
}

impl<H: Handler> SftpFs<H> {
    pub(crate) fn new(
        session: Arc<Mutex<SftpSession>>,
        link: Arc<SftpLink<H>>,
        tar: Arc<TarProbe<H>>,
    ) -> Self {
        Self {
            session,
            link: Some(link),
            tar: Some(tar),
        }
    }

    /// A session with no SSH link behind it: never dead, never hashed.
    #[cfg(test)]
    pub(crate) fn detached(session: Arc<Mutex<SftpSession>>) -> Self {
        Self {
            session,
            link: None,
            tar: None,
        }
    }

    pub(crate) async fn close_session(&self) {
        let _ = self.session.lock().await.close().await;
    }
}

fn stat_of(m: &Metadata) -> Stat {
    Stat {
        size: m.size.unwrap_or(0),
        mtime: m.mtime.map_or(0, u64::from),
        is_dir: m.is_dir(),
    }
}

fn failed(what: &str, path: &str, e: &SftpError) -> AppError {
    AppError::caused(format_args!("{what} {path}"), e)
}

#[async_trait]
impl<H: Handler> Endpoint for SftpFs<H> {
    fn is_local(&self) -> bool {
        false
    }

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

    async fn stat(&self, path: &str) -> Result<Option<Stat>, AppError> {
        let sftp = self.session.lock().await;
        match sftp.metadata(path).await {
            Ok(m) => Ok(Some(stat_of(&m))),
            Err(SftpError::Status(s)) if s.status_code == StatusCode::NoSuchFile => Ok(None),
            Err(e) => Err(failed("stat", path, &e)),
        }
    }

    async fn list(&self, dir: &str) -> Result<Vec<Listed>, AppError> {
        let sftp = self.session.lock().await;
        let entries = sftp
            .read_dir(dir)
            .await
            .map_err(|e| failed("read_dir", dir, &e))?;
        Ok(entries
            .filter(|e| e.file_name() != "." && e.file_name() != "..")
            .map(|e| {
                let m = e.metadata();
                Listed {
                    name: e.file_name(),
                    stat: stat_of(&m),
                    is_symlink: m.is_symlink(),
                }
            })
            .collect())
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        let _ = self.session.lock().await.create_dir(path).await;
        Ok(())
    }

    async fn open_read(&self, path: &str, offset: u64) -> Result<Reader, AppError> {
        let file = self
            .session
            .lock()
            .await
            .open(path)
            .await
            .map_err(|e| failed("open", path, &e))?;
        let mut file = SftpFile::new(file, "Close error");
        file.seek(SeekFrom::Start(offset)).await?;
        Ok(Box::new(file))
    }

    async fn open_write(&self, path: &str, offset: u64) -> Result<Writer, AppError> {
        let mut flags = OpenFlags::CREATE | OpenFlags::WRITE;
        if offset == 0 {
            flags |= OpenFlags::TRUNCATE;
        }
        let file = self
            .session
            .lock()
            .await
            .open_with_flags(path, flags)
            .await
            .map_err(|e| failed("create", path, &e))?;
        let mut file = SftpFile::new(file, "Flush error");
        file.seek(SeekFrom::Start(offset)).await?;
        Ok(Box::new(file))
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        self.session
            .lock()
            .await
            .rename(from, to)
            .await
            .map_err(|e| failed("rename", from, &e))
    }

    async fn remove(&self, path: &str) -> Result<(), AppError> {
        self.session
            .lock()
            .await
            .remove_file(path)
            .await
            .map_err(|e| failed("remove", path, &e))
    }

    async fn set_mtime(&self, path: &str, mtime: u64) -> Result<(), AppError> {
        let mut attrs = FileAttributes::empty();
        attrs.atime = Some(mtime as u32);
        attrs.mtime = Some(mtime as u32);
        self.session
            .lock()
            .await
            .set_metadata(path, attrs)
            .await
            .map_err(|e| failed("setstat", path, &e))
    }

    async fn hash(&self, path: &str, token: &CancellationToken) -> Option<String> {
        let link = self.link.as_ref().filter(|l| l.host_shell())?;
        let shell = self.tar.as_ref()?.shell().await?;
        let (handle, cmd) = (read_cell(&link.handle), shell.sha256(path));
        let out = tokio::select! {
            _ = token.cancelled() => return None,
            r = run_captured(&handle, &cmd) => r.ok()?,
        };
        (out.code == Some(0)).then(|| parse_sha256(&out.stdout_text()))?
    }

    fn link_lost(&self) -> bool {
        self.link.as_ref().is_some_and(|l| l.closed_now())
    }

    async fn link_dead(&self) -> bool {
        match &self.link {
            Some(link) => link.dead(&self.session).await,
            None => false,
        }
    }

    async fn wait_for_link(
        &self,
        token: &CancellationToken,
        deadline: Instant,
    ) -> Result<(), AppError> {
        match &self.link {
            Some(link) => link.wait(&self.session, token, deadline).await,
            None => Ok(()),
        }
    }
}

#[cfg(all(test, unix))]
pub(crate) mod tests {
    use super::*;
    use crate::commands::sftp::resume::endpoint::LocalFs;
    use crate::commands::sftp::resume::engine_tests::{noise, s};
    use crate::commands::sftp::resume::{copy_one, resumable_copy, CopyCtx};
    use crate::error::ErrorCode;
    use crate::port_forward::test_ssh::TestClient;
    use crate::sftp::backend::test_tree::Recorder;
    use crate::sftp::real::SftpOpener;
    use crate::ssh::live_cells::own_cell;
    use crate::ssh::test_proc_server::{proc_server, ProcOptions};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    pub(crate) async fn sftp_fs(opts: ProcOptions) -> SftpFs<TestClient> {
        let (handle, _) = proc_server(opts).await;
        let link = Arc::new(SftpLink {
            handle: own_cell(handle),
            opener: SftpOpener::Subsystem,
            closed: CancellationToken::new(),
        });
        let session = Arc::new(Mutex::new(link.open().await.unwrap()));
        let tar = Arc::new(TarProbe::new(Arc::clone(&link.handle), None));
        SftpFs::new(session, link, tar)
    }

    #[tokio::test]
    async fn sftp_round_trips_at_offsets_and_lists() {
        let fs = sftp_fs(ProcOptions::default()).await;
        let d = tempfile::tempdir().unwrap();
        let f = format!("{}/x", d.path().display());
        let mut w = fs.open_write(&f, 0).await.unwrap();
        w.write_all(b"hello").await.unwrap();
        w.shutdown().await.unwrap();
        let mut w = fs.open_write(&f, 3).await.unwrap();
        w.write_all(b"LO!").await.unwrap();
        w.shutdown().await.unwrap();
        let mut s = String::new();
        fs.open_read(&f, 2)
            .await
            .unwrap()
            .read_to_string(&mut s)
            .await
            .unwrap();
        assert_eq!(s, "lLO!");
        fs.set_mtime(&f, 1_000_000).await.unwrap();
        assert_eq!(fs.stat(&f).await.unwrap().unwrap().mtime, 1_000_000);
        let names: Vec<_> = fs
            .list(&d.path().to_string_lossy())
            .await
            .unwrap()
            .into_iter()
            .map(|l| l.name)
            .collect();
        assert_eq!(names, ["x"]);
        assert_eq!(fs.stat(&format!("{f}.nope")).await.unwrap(), None);
    }

    #[tokio::test]
    async fn hash_quotes_awkward_names() {
        let fs = sftp_fs(ProcOptions::default()).await;
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("it's 100% \"raw\".mp4");
        std::fs::write(&f, b"").unwrap();
        assert_eq!(
            fs.hash(&f.to_string_lossy(), &CancellationToken::new())
                .await
                .as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
    }

    #[tokio::test]
    async fn a_plain_rename_onto_an_existing_file_fails_like_openssh() {
        let fs = sftp_fs(ProcOptions::default()).await;
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a"), d.path().join("b"));
        std::fs::write(&a, b"a").unwrap();
        std::fs::write(&b, b"b").unwrap();
        assert!(fs
            .rename(&a.to_string_lossy(), &b.to_string_lossy())
            .await
            .is_err());
    }

    fn relink_after(fs: &SftpFs<TestClient>, delay: Duration) -> tokio::task::JoinHandle<()> {
        let link = Arc::clone(fs.link.as_ref().unwrap());
        tokio::spawn(async move {
            while !read_cell(&link.handle).is_closed() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            tokio::time::sleep(delay).await;
            let (fresh, _) = proc_server(ProcOptions::default()).await;
            *link.handle.write().unwrap() = fresh;
        })
    }

    fn cut_at(bytes: u64) -> ProcOptions {
        ProcOptions {
            drop_after_bytes: Some(bytes),
            ..Default::default()
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_upload_cut_mid_file_resumes_byte_identical() {
        let fs = sftp_fs(cut_at(3_000_000)).await;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(8_000_000);
        std::fs::write(a.path().join("v"), &data).unwrap();
        let relink = relink_after(&fs, Duration::from_millis(200));
        let rec = Recorder::default();
        let (src, dst) = (s(&a.path().join("v")), s(&b.path().join("v")));
        copy_one(
            &rec,
            &LocalFs,
            &src,
            &fs,
            &dst,
            "t",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        relink.await.unwrap();
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert!(
            rec.last("sftp-resumed-t").unwrap()["offset"]
                .as_u64()
                .unwrap()
                > 0
        );
        assert_eq!(rec.last("sftp-waiting-t").unwrap()["waiting"], false);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_download_cut_mid_file_resumes_byte_identical() {
        let fs = sftp_fs(cut_at(3_000_000)).await;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(8_000_000);
        std::fs::write(a.path().join("v"), &data).unwrap();
        let relink = relink_after(&fs, Duration::from_millis(200));
        let (src, dst) = (s(&a.path().join("v")), s(&b.path().join("v")));
        let rec = Recorder::default();
        copy_one(
            &rec,
            &fs,
            &src,
            &LocalFs,
            &dst,
            "t",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        relink.await.unwrap();
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert!(rec.count("sftp-resumed-t") > 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_remote_to_remote_copy_cut_on_the_destination_resumes() {
        let src_fs = sftp_fs(ProcOptions::default()).await;
        let dst_fs = sftp_fs(cut_at(3_000_000)).await;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let data = noise(8_000_000);
        std::fs::write(a.path().join("v"), &data).unwrap();
        let relink = relink_after(&dst_fs, Duration::from_millis(200));
        let (src, dst) = (s(&a.path().join("v")), s(&b.path().join("v")));
        let rec = Recorder::default();
        copy_one(
            &rec,
            &src_fs,
            &src,
            &dst_fs,
            &dst,
            "t",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        relink.await.unwrap();
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), data);
        assert!(rec.count("sftp-resumed-t") > 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_unrelated_target_is_untouched_until_the_verified_swap() {
        let fs = sftp_fs(cut_at(3_000_000)).await;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), noise(8_000_000)).unwrap();
        std::fs::write(b.path().join("v"), b"unrelated").unwrap();
        let rec = Recorder::default();
        let token = CancellationToken::new();
        let mut ctx = CopyCtx::new(&rec, "t", &token, 8_000_000);
        ctx.link_wait = Duration::from_millis(300);
        let (src, dst) = (s(&a.path().join("v")), s(&b.path().join("v")));
        let e = resumable_copy(&LocalFs, &src, &fs, &dst, &mut ctx)
            .await
            .unwrap_err();
        assert_eq!(e.code(), Some(ErrorCode::ConnectionLost));
        assert_eq!(std::fs::read(b.path().join("v")).unwrap(), b"unrelated");
        assert!(std::fs::read_dir(b.path()).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".voltius-part")));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn cancel_during_a_dead_link_returns_promptly() {
        let fs = sftp_fs(cut_at(3_000_000)).await;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), noise(8_000_000)).unwrap();
        let token = CancellationToken::new();
        let rec = Recorder::default();
        let (src, dst) = (s(&a.path().join("v")), s(&b.path().join("v")));
        let run = copy_one(&rec, &LocalFs, &src, &fs, &dst, "t", &token);
        let cancel = async {
            while rec.count("sftp-waiting-t") == 0 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            token.cancel();
            std::time::Instant::now()
        };
        let (r, at) = tokio::join!(run, cancel);
        assert!(r.unwrap_err().to_string().contains("cancelled"));
        assert!(at.elapsed() < Duration::from_secs(2));
    }
}
