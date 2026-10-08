//! The FTP backend as one side of the copy engine: REST resumes a download,
//! APPE an upload.

use super::{abandon, call, failed, mtime_of, refused, FtpBackend};
use crate::commands::sftp::resume::endpoint::{Endpoint, Listed, Reader, Stat, Writer};
use crate::commands::sftp::resume::pipe::piped;
use crate::commands::sftp::CHUNK_SIZE;
use crate::error::{AppError, ErrorCode};
use crate::sftp::link::{wait_for_link, LINK_PROBE};
use crate::sftp::FileBackend;
use async_trait::async_trait;
use std::sync::Arc;
use suppaftp::list::File as FtpFile;
use suppaftp::Status;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration, Instant};
use tokio_util::sync::CancellationToken;

/// A data connection that moves nothing for this long is taken for lost.
const DATA_IDLE: Duration = Duration::from_secs(60);

/// suppaftp dates every listed entry (the epoch when the server sent none), so a listing
/// can't tell unknown from 1970. `mtime_of` is None only before 1970: that clamps to 0, as
/// MDTM's does.
fn listed_mtime(mtime: Option<u64>) -> Option<u64> {
    Some(mtime.unwrap_or(0))
}

fn stat_of(f: &FtpFile) -> Stat {
    Stat {
        size: f.size() as u64,
        mtime: listed_mtime(mtime_of(f)),
        is_dir: f.is_directory(),
        mode: None,
    }
}

fn stalled() -> AppError {
    AppError::coded(
        ErrorCode::ConnectionLost,
        format!(
            "The FTP data connection stalled for {} s",
            DATA_IDLE.as_secs()
        ),
    )
}

/// Copies to end of stream; only the network side (`net_reads` says which) is held to `DATA_IDLE`.
async fn copy_data<R, W>(from: &mut R, to: &mut W, net_reads: bool) -> Result<(), AppError>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let idle = |net: bool| if net { DATA_IDLE } else { Duration::MAX };
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = timeout(idle(net_reads), from.read(&mut buf))
            .await
            .map_err(|_| stalled())??;
        if n == 0 {
            return Ok(());
        }
        timeout(idle(!net_reads), to.write_all(&buf[..n]))
            .await
            .map_err(|_| stalled())??;
    }
}

fn cancelled() -> AppError {
    "Transfer cancelled".into()
}

impl FtpBackend {
    async fn revive(&self) -> bool {
        match timeout(LINK_PROBE, self.conn.lock()).await {
            Ok(mut conn) => self.answers(&mut conn).await.is_ok(),
            Err(_) => false,
        }
    }

    async fn reachable(&self) -> bool {
        let addr = (self.login.host.as_str(), self.login.port);
        matches!(
            timeout(LINK_PROBE, TcpStream::connect(addr)).await,
            Ok(Ok(_))
        )
    }
}

#[async_trait]
impl Endpoint for FtpBackend {
    fn is_local(&self) -> bool {
        false
    }

    fn overwrites_in_place(&self) -> bool {
        true
    }

    async fn stat(&self, path: &str) -> Result<Option<Stat>, AppError> {
        let mut s = self.session().await?;
        if self.mlsx {
            return match call!(*s, |ftp| ftp.mlst(Some(path))) {
                Ok(line) => FtpFile::try_from(line.as_str())
                    .map(|f| Some(stat_of(&f)))
                    .map_err(|e| format!("stat failed: {e}").into()),
                Err(e) if refused(&e) => Ok(None),
                Err(e) => Err(failed("stat", e)),
            };
        }
        let size = match call!(*s, |ftp| ftp.size(path)) {
            Ok(size) => size as u64,
            Err(e) if refused(&e) => {
                let dir = self.is_dir(&mut s, path).await?;
                return Ok(dir.then_some(Stat {
                    size: 0,
                    mtime: None,
                    is_dir: true,
                    mode: None,
                }));
            }
            Err(e) => return Err(failed("stat", e)),
        };
        let mtime = match call!(*s, |ftp| ftp.mdtm(path)) {
            Ok(t) => Some(t.and_utc().timestamp().max(0) as u64),
            Err(e) if refused(&e) => None,
            Err(e) => return Err(failed("stat", e)),
        };
        Ok(Some(Stat {
            size,
            mtime,
            is_dir: false,
            mode: None,
        }))
    }

    async fn list(&self, dir: &str) -> Result<Vec<Listed>, AppError> {
        let files = FileBackend::list_dir(self, dir).await?;
        let mut listed: Vec<Listed> = files.into_iter().map(Listed::from).collect();
        for s in listed.iter_mut().filter_map(|l| l.stat.as_mut()) {
            s.mtime = listed_mtime(s.mtime);
        }
        Ok(listed)
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        let mut s = self.session().await?;
        let made = call!(*s, |ftp| ftp.mkdir(path));
        match made {
            Err(e) if !refused(&e) || !self.is_dir(&mut s, path).await? => Err(failed("mkdir", e)),
            _ => Ok(()),
        }
    }

    async fn open_read(&self, path: &str, offset: u64) -> Result<Reader, AppError> {
        let mut s = self.session().await?;
        if offset > 0 {
            call!(*s, |ftp| ftp.resume_transfer(offset as usize))
                .map_err(|e| failed("resume", e))?;
        }
        let mut data =
            call!(*s, |ftp| ftp.retr_as_stream(path)).map_err(|e| failed("download", e))?;
        Ok(Box::new(piped(|mut tx, cancel| async move {
            let copied = tokio::select! {
                r = copy_data(&mut data, &mut tx, true) => r,
                _ = cancel.cancelled() => Err(cancelled()),
            };
            match copied {
                Ok(()) => call!(*s, |ftp| ftp.finalize_retr_stream(data))
                    .map_err(|e| failed("download", e)),
                Err(e) => {
                    abandon(&mut s, data);
                    Err(e)
                }
            }
        })))
    }

    async fn open_write(&self, path: &str, offset: u64, _len: u64) -> Result<Writer, AppError> {
        let mut s = self.session().await?;
        let mut data = if offset == 0 {
            call!(*s, |ftp| ftp.put_with_stream(path))
        } else {
            call!(*s, |ftp| ftp.append_with_stream(path))
        }
        .map_err(|e| failed("upload", e))?;
        Ok(Box::new(piped(|mut rx, cancel| async move {
            let copied = tokio::select! {
                r = copy_data(&mut rx, &mut data, false) => r,
                _ = cancel.cancelled() => Err(cancelled()),
            };
            match copied {
                Ok(()) => {
                    call!(*s, |ftp| ftp.finalize_put_stream(data)).map_err(|e| failed("upload", e))
                }
                Err(e) => {
                    abandon(&mut s, data);
                    Err(e)
                }
            }
        })))
    }

    /// An empty APPE: servers such as proftpd refuse appends unless configured to allow them.
    async fn appends(&self, path: &str, _have: u64) -> bool {
        if let Some(known) = self.appends.get() {
            return *known;
        }
        let Ok(mut s) = self.session().await else {
            return false;
        };
        let answer = match call!(*s, |ftp| ftp.append_with_stream(path)) {
            Ok(data) => call!(*s, |ftp| ftp.finalize_put_stream(data)).map(|()| true),
            Err(e) if refused(&e) => Ok(false),
            Err(e) => Err(e),
        };
        match answer {
            Ok(known) => *self.appends.get_or_init(|| known),
            Err(_) => false,
        }
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        let mut s = self.session().await?;
        call!(*s, |ftp| ftp.rename(from, to)).map_err(|e| failed("rename", e))
    }

    async fn remove(&self, path: &str) -> Result<(), AppError> {
        let mut s = self.session().await?;
        call!(*s, |ftp| ftp.rm(path)).map_err(|e| failed("delete", e))
    }

    async fn set_mtime(&self, path: &str, mtime: u64) -> Result<(), AppError> {
        // Without MFMT the server stamps the upload time; there is nothing to set.
        if !self.mfmt {
            return Ok(());
        }
        let Some(at) = chrono::DateTime::from_timestamp(mtime as i64, 0) else {
            return Ok(());
        };
        let cmd = format!("MFMT {} {path}", at.format("%Y%m%d%H%M%S"));
        let mut s = self.session().await?;
        call!(*s, |ftp| ftp.custom_command(&cmd, &[Status::File]))
            .map(|_| ())
            .map_err(|e| failed("MFMT", e))
    }

    async fn hash(&self, _: &str, _: &CancellationToken) -> Result<Option<String>, AppError> {
        Ok(None)
    }

    /// A busy connection is mid-transfer: then the server being reachable is all we can tell.
    async fn link_dead(&self) -> bool {
        match timeout(LINK_PROBE, Arc::clone(&self.conn).lock_owned()).await {
            Ok(mut conn) => self.answers(&mut conn).await.is_err(),
            Err(_) => !self.reachable().await,
        }
    }

    async fn wait_for_link(
        &self,
        token: &CancellationToken,
        deadline: Instant,
    ) -> Result<(), AppError> {
        wait_for_link(|| self.revive(), token, &self.closed, deadline).await
    }
}

#[cfg(test)]
mod tests {
    use super::super::{is_transport, lost};
    use super::*;
    use std::io;
    use suppaftp::types::Response;
    use suppaftp::FtpError;

    #[test]
    fn transport_failures_drop_the_connection_and_refusals_do_not() {
        let refusal = |status| FtpError::UnexpectedResponse(Response::new(status, Vec::new()));
        assert!(!is_transport(&refusal(Status::FileUnavailable)));
        assert!(refused(&refusal(Status::FileUnavailable)));
        assert!(is_transport(&refusal(Status::NotAvailable)));
        assert!(is_transport(&lost(io::ErrorKind::TimedOut)));
    }

    #[test]
    fn a_listed_date_before_1970_clamps_to_0_and_others_are_kept() {
        assert_eq!(listed_mtime(None), Some(0));
        assert_eq!(listed_mtime(Some(1_700_000_000)), Some(1_700_000_000));
    }
}

#[cfg(all(test, unix))]
mod live {
    use super::super::connect;
    use super::FtpBackend;
    use crate::commands::sftp::resume::live::round_trip_through_restarts;
    use crate::sftp::FileBackend;
    use crate::ssh::test_docker::Container;
    use std::time::{Duration, Instant};

    async fn connected(port: u16) -> FtpBackend {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            match connect("127.0.0.1", port, "u", Some("p"), false).await {
                Ok(b) => return b,
                Err(e) => assert!(Instant::now() < deadline, "{e}"),
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    /// vsftpd on `port` (no MLSD), with `setup` run in the container as root first.
    fn vsftpd(name: &str, port: u16, setup: &str) -> Container {
        let script = format!(
            "apk add -q vsftpd >/dev/null; adduser -D -h /home/u u; echo u:p | chpasswd; {setup} \
             exec vsftpd /etc/vsftpd/vsftpd.conf -olisten=YES -olisten_ipv6=NO \
             -olisten_port={port} -obackground=NO -oanonymous_enable=NO -olocal_enable=YES \
             -owrite_enable=YES -oseccomp_sandbox=NO -opasv_address=127.0.0.1 \
             -opasv_min_port=30000 -opasv_max_port=30009"
        );
        Container::run(
            format!("{name}-{}", std::process::id()),
            &[
                "--network=host",
                "--restart=on-failure",
                "alpine:3",
                "sh",
                "-c",
                &script,
            ],
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs docker and network; takes host port 2120"]
    async fn vsftpd_resumes_with_rest_and_appe_without_mlst() {
        let c = vsftpd("ftp-resume", 2120, "");
        let fs = connected(2120).await;
        assert!(!fs.mlsx && !fs.mfmt);
        round_trip_through_restarts(&fs, "/home/u/blob", &c.0, true).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs docker and network; takes host port 2122"]
    async fn links_list_as_their_target_and_delete_as_links() {
        let _c = vsftpd(
            "ftp-links",
            2122,
            "cd /home/u && mkdir folder tree && touch file folder/keep && \
             ln -s folder folder_link && ln -s file file_link && ln -s gone dangling && \
             ln -s /home/u/folder tree/out && chown -hR u /home/u;",
        );
        let fs = connected(2122).await;

        let kinds: Vec<_> = fs
            .list_dir("/home/u")
            .await
            .unwrap()
            .into_iter()
            .map(|f| (f.name, f.is_dir, f.is_symlink))
            .collect();
        let kinds: Vec<_> = kinds.iter().map(|(n, d, l)| (n.as_str(), *d, *l)).collect();
        assert_eq!(
            kinds,
            [
                ("folder", true, false),
                ("folder_link", true, true),
                ("tree", true, false),
                ("dangling", false, true),
                ("file", false, false),
                ("file_link", false, true),
            ]
        );

        fs.delete("/home/u/tree").await.unwrap();
        fs.delete("/home/u/folder_link").await.unwrap();
        let left: Vec<_> = fs
            .list_dir("/home/u/folder")
            .await
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert_eq!(left, ["keep"]);
        assert_eq!(FileBackend::stat(&fs, "/home/u/tree").await.unwrap(), None);
        assert_eq!(
            FileBackend::stat(&fs, "/home/u/folder_link").await.unwrap(),
            None
        );
    }

    const PROFTPD: &str = "ServerName t\nServerType standalone\nPort 2121\n\
        PassivePorts 30010 30019\nMasqueradeAddress 127.0.0.1\nUser nobody\nGroup nogroup\n\
        DefaultRoot ~\nRequireValidShell off\nAllowOverwrite on\nUseIPv6 off\n\
        ScoreboardFile /run/proftpd/scoreboard\nDelayTable none\n";

    async fn proftpd(allow_appends: bool) {
        let conf = tempfile::tempdir().unwrap();
        let store_restart = format!(
            "AllowStoreRestart {}\n",
            if allow_appends { "on" } else { "off" }
        );
        std::fs::write(
            conf.path().join("t.conf"),
            format!("{PROFTPD}{store_restart}"),
        )
        .unwrap();
        let mount = format!("{}:/etc/t:ro", conf.path().display());
        let c = Container::run(
            format!("proftpd-resume-{}", std::process::id()),
            &[
                "--network=host",
                "--restart=on-failure",
                "-v",
                &mount,
                "alpine:3",
                "sh",
                "-c",
                "apk add -q proftpd >/dev/null; mkdir -p /run/proftpd; \
                 addgroup -S nogroup; adduser -D -h /home/u u; echo u:p | chpasswd; \
                 exec proftpd -n -c /etc/t/t.conf",
            ],
        );
        let fs = connected(2121).await;
        assert!(fs.mlsx && fs.mfmt);
        round_trip_through_restarts(&fs, "/blob", &c.0, allow_appends).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs docker and network; takes host port 2121"]
    async fn proftpd_resumes_with_mlst_and_mfmt() {
        proftpd(true).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs docker and network; takes host port 2121"]
    async fn proftpd_refusing_appends_restarts_uploads() {
        proftpd(false).await;
    }
}
