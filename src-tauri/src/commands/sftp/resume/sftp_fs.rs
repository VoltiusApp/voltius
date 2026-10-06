use super::endpoint::{Endpoint, Listed, Reader, Stat, Writer};
use crate::commands::sftp::{SftpFile, TarProbe};
use crate::error::AppError;
use crate::sftp::link::SftpLink;
use crate::ssh::client::SshClient;
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

    pub(crate) async fn close_session(&self) {
        let _ = self.session.lock().await.close().await;
    }
}

#[cfg(test)]
impl SftpFs {
    /// A session with no SSH link behind it: never dead, never hashed.
    pub(crate) fn detached(session: Arc<Mutex<SftpSession>>) -> Self {
        Self {
            session,
            link: None,
            tar: None,
        }
    }
}

fn stat_of(m: &Metadata) -> Stat {
    Stat {
        size: m.size.unwrap_or(0),
        mtime: m.mtime.map_or(0, u64::from),
        is_dir: m.is_dir(),
        mode: m.permissions,
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
                    stat: Some(stat_of(&m)),
                    is_symlink: m.is_symlink(),
                }
            })
            .collect())
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        let sftp = self.session.lock().await;
        match sftp.create_dir(path).await {
            Ok(()) => Ok(()),
            // Servers answer an existing directory with Failure or FileAlreadyExists.
            Err(e @ SftpError::Status(_)) => match sftp.metadata(path).await {
                Ok(m) if m.is_dir() => Ok(()),
                _ => Err(failed("mkdir", path, &e)),
            },
            Err(e) => Err(failed("mkdir", path, &e)),
        }
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

    async fn open_write(&self, path: &str, offset: u64, _len: u64) -> Result<Writer, AppError> {
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

    async fn set_mode(&self, path: &str, mode: u32) -> Result<(), AppError> {
        let mut attrs = FileAttributes::empty();
        attrs.permissions = Some(mode & 0o7777);
        self.session
            .lock()
            .await
            .set_metadata(path, attrs)
            .await
            .map_err(|e| failed("chmod", path, &e))
    }

    async fn resolve(&self, path: &str) -> Result<String, AppError> {
        let sftp = self.session.lock().await;
        match sftp.symlink_metadata(path).await {
            Ok(m) if m.is_symlink() => Ok(sftp
                .canonicalize(path)
                .await
                .unwrap_or_else(|_| path.to_string())),
            _ => Ok(path.to_string()),
        }
    }

    async fn hash(
        &self,
        path: &str,
        token: &CancellationToken,
    ) -> Result<Option<String>, AppError> {
        match &self.tar {
            Some(tar) => tar.hash(path, token, self.link_dead()).await,
            None => Ok(None),
        }
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
    use crate::ssh::exec::shell_quote;
    use crate::ssh::live_cells::{own_cell, read_cell};
    use crate::ssh::test_proc_server::{no_tar, proc_server, sftp_server_path, ProcOptions};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    pub(crate) async fn sftp_fs(opts: ProcOptions) -> SftpFs<TestClient> {
        sftp_fs_via(opts, SftpOpener::Subsystem).await
    }

    async fn sftp_fs_via(opts: ProcOptions, opener: SftpOpener) -> SftpFs<TestClient> {
        let (handle, _) = proc_server(opts).await;
        let link = Arc::new(SftpLink {
            handle: own_cell(handle),
            opener,
            closed: CancellationToken::new(),
        });
        let session = Arc::new(Mutex::new(link.open().await.unwrap()));
        let tar = Arc::new(TarProbe::new(
            Arc::clone(&link.handle),
            link.opener.inside(),
        ));
        SftpFs::new(session, link, tar)
    }

    #[tokio::test]
    async fn sftp_round_trips_at_offsets_and_lists() {
        let fs = sftp_fs(ProcOptions::default()).await;
        let d = tempfile::tempdir().unwrap();
        let f = format!("{}/x", d.path().display());
        let mut w = fs.open_write(&f, 0, 5).await.unwrap();
        w.write_all(b"hello").await.unwrap();
        w.shutdown().await.unwrap();
        let mut w = fs.open_write(&f, 3, 3).await.unwrap();
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
    async fn mkdir_accepts_an_existing_folder_and_nothing_else() {
        let fs = sftp_fs(ProcOptions::default()).await;
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("sub");
        let dir = dir.to_string_lossy();
        fs.mkdir(&dir).await.unwrap();
        fs.mkdir(&dir).await.unwrap();
        assert!(fs.stat(&dir).await.unwrap().unwrap().is_dir);
        std::fs::write(d.path().join("f"), b"").unwrap();
        assert!(fs
            .mkdir(&format!("{}/f", d.path().display()))
            .await
            .is_err());
        assert!(fs
            .mkdir(&format!("{}/nope/sub", d.path().display()))
            .await
            .is_err());
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
                .unwrap()
                .as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
    }

    #[tokio::test]
    async fn an_exec_session_without_tar_hashes_inside_its_container() {
        let (_bin, no_tar) = no_tar();
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("f"), b"").unwrap();
        // Only inside `root` does the relative path name the file.
        let inside = format!(
            r#"{no_tar} sh -c 'cd "$1" && shift && exec "$@"' x {}"#,
            shell_quote(&root.path().to_string_lossy())
        );
        let opener = SftpOpener::Exec {
            inside,
            server: sftp_server_path().to_string(),
        };
        let fs = sftp_fs_via(ProcOptions::default(), opener).await;
        assert_eq!(
            fs.hash("f", &CancellationToken::new())
                .await
                .unwrap()
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
            loop {
                let h = read_cell(&link.handle);
                let probe =
                    tokio::time::timeout(Duration::from_millis(500), h.channel_open_session());
                if h.is_closed() || !matches!(probe.await, Ok(Ok(_))) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
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
    async fn cancel_on_a_half_open_link_returns_promptly() {
        let fs = sftp_fs(ProcOptions {
            blackhole_after_bytes: Some(3_000_000),
            ..Default::default()
        })
        .await;
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(a.path().join("v"), noise(8_000_000)).unwrap();
        let (rec, token) = (Recorder::default(), CancellationToken::new());
        let mut ctx = CopyCtx::new(&rec, "t", &token, 8_000_000);
        ctx.stall = Duration::from_secs(2);
        let (src, dst) = (s(&a.path().join("v")), s(&b.path().join("v")));
        let run = resumable_copy(&LocalFs, &src, &fs, &dst, &mut ctx);
        let cancel = async {
            while rec.count("sftp-waiting-t") == 0 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
            token.cancel();
            std::time::Instant::now()
        };
        let (r, at) =
            tokio::time::timeout(Duration::from_secs(60), async { tokio::join!(run, cancel) })
                .await
                .expect("the copy never noticed the half-open link");
        assert!(r.unwrap_err().to_string().contains("cancelled"));
        assert!(at.elapsed() < Duration::from_secs(2), "{:?}", at.elapsed());
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

#[cfg(all(test, unix))]
mod live {
    use crate::commands::sftp::resume::copy_one;
    use crate::commands::sftp::resume::endpoint::LocalFs;
    use crate::known_hosts::KnownHostsStore;
    use crate::sftp::backend::test_tree::Recorder;
    use crate::sftp::real::{RealSftp, SftpOpener};
    use crate::ssh::client::{connect_authenticated, SshClient};
    use crate::ssh::live_cells::{own_cell, read_cell};
    use crate::ssh::session::SessionHandle;
    use crate::ssh::test_docker::{docker, Container};
    use russh::client::Handle;
    use std::process::Command;
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tokio_util::sync::CancellationToken;

    const IMAGE: &str = "lscr.io/linuxserver/openssh-server:latest";
    const BLOB: u64 = 200_000_000;

    fn host() -> Container {
        Container::run(
            format!("resume-{}", std::process::id()),
            &[
                "-p",
                "127.0.0.1::2222",
                "-e",
                "USER_NAME=t",
                "-e",
                "USER_PASSWORD=t",
                "-e",
                "PASSWORD_ACCESS=true",
                IMAGE,
            ],
        )
    }

    async fn ssh(c: &Container) -> Handle<SshClient> {
        let mapped = String::from_utf8(docker(&["port", &c.0, "2222"]).stdout).unwrap();
        let port: u16 = mapped.trim().rsplit(':').next().unwrap().parse().unwrap();
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let known_hosts = Arc::new(KnownHostsStore::new());
            let attempt = connect_authenticated(
                known_hosts,
                "127.0.0.1",
                port,
                "t",
                Some("t"),
                None,
                None,
                false,
                None,
            );
            match attempt.await {
                Ok(h) => return h,
                Err(e) => assert!(Instant::now() < deadline, "{e}"),
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    fn sha256(cmd: &mut Command) -> String {
        let out = cmd.output().unwrap();
        assert!(out.status.success(), "{cmd:?}");
        String::from_utf8_lossy(&out.stdout)
            .split_whitespace()
            .next()
            .unwrap()
            .to_string()
    }

    fn transferred(rec: &Recorder, tid: &str) -> u64 {
        rec.last(&format!("sftp-progress-{tid}"))
            .and_then(|p| p["transferred"].as_u64())
            .unwrap_or(0)
    }

    /// Kills the SSH connection a third of the way in, then reconnects into the
    /// same cell once the old link stops answering, as a relink does.
    async fn cut_then_relink(c: &Container, rec: &Recorder, tid: &str, cell: SessionHandle) {
        while transferred(rec, tid) < BLOB / 3 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        docker(&["exec", &c.0, "pkill", "-f", "sshd.*: t"]);
        loop {
            let h = read_cell(&cell);
            let probe = tokio::time::timeout(Duration::from_secs(1), h.channel_open_session());
            if h.is_closed() || !matches!(probe.await, Ok(Ok(_))) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        *cell.write().unwrap() = Arc::new(ssh(c).await);
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs docker"]
    async fn a_200mb_upload_and_download_survive_a_killed_connection() {
        let c = host();
        let cell = own_cell(Arc::new(ssh(&c).await));
        let backend = RealSftp::open(
            Arc::clone(&cell),
            SftpOpener::Subsystem,
            CancellationToken::new(),
        )
        .await
        .unwrap();
        let fs = backend.fs();
        let local = tempfile::tempdir().unwrap();
        let src = local.path().join("blob");
        let status = Command::new("head")
            .args(["-c", &BLOB.to_string(), "/dev/urandom"])
            .stdout(std::fs::File::create(&src).unwrap())
            .status()
            .unwrap();
        assert!(status.success());
        let want = sha256(Command::new("sha256sum").arg(&src));
        let (rec, token) = (Recorder::default(), CancellationToken::new());

        let src_s = src.to_string_lossy();
        let up = copy_one(&rec, &LocalFs, &src_s, &fs, "/config/blob", "up", &token);
        let (r, _) = tokio::join!(up, cut_then_relink(&c, &rec, "up", Arc::clone(&cell)));
        r.unwrap();
        assert!(rec.count("sftp-resumed-up") > 0, "the upload resumed");
        let remote =
            sha256(Command::new("docker").args(["exec", &c.0, "sha256sum", "/config/blob"]));
        assert_eq!(remote, want);

        let back = local.path().join("back");
        let back_str = back.to_string_lossy();
        let down = copy_one(
            &rec,
            &fs,
            "/config/blob",
            &LocalFs,
            &back_str,
            "down",
            &token,
        );
        let (r, _) = tokio::join!(down, cut_then_relink(&c, &rec, "down", Arc::clone(&cell)));
        r.unwrap();
        assert!(rec.count("sftp-resumed-down") > 0, "the download resumed");
        assert_eq!(sha256(Command::new("sha256sum").arg(&back)), want);
        eprintln!(
            "live resume: upload and download of {BLOB} bytes each survived a killed connection; sha256 {want}"
        );
    }
}
