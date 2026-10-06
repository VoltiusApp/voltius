//! Downloads resume with `Range`. A cut PUT leaves nothing (servers spool the body), so where
//! `Content-Range` on PUT is honoured (Apache; rclone ignores it) uploads go up in ranged segments.

use super::{body_reader, empty, full, status_error, WebDavBackend};
use crate::commands::sftp::resume::endpoint::{Endpoint, Listed, Reader, Stat, Writer};
use crate::commands::sftp::resume::pipe::{piped, REFUSAL_GRACE};
use crate::error::AppError;
use crate::sftp::link::{wait_for_link, LINK_PROBE};
use async_trait::async_trait;
use futures_util::TryStreamExt;
use http_body_util::{BodyExt, StreamBody};
use hyper::body::Frame;
use hyper::header::{self, HeaderName};
use hyper::{Method, StatusCode};
use tokio::io::{AsyncReadExt, DuplexStream};
use tokio::time::{timeout, Instant};
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

const SEGMENT: u64 = 16 * 1024 * 1024;
const PIPE: usize = 256 * 1024;
const PROBE_NAME: &str = ".voltius-range-probe";

impl WebDavBackend {
    /// The server answers at all, whatever it answers.
    async fn answers(&self) -> bool {
        let probe = self.send_propfind("Probe", self.base.url(), "0");
        matches!(timeout(LINK_PROBE, probe).await, Ok(Ok(_)))
    }

    /// The body from `offset` on; a server that ignores `Range` has the skipped part read past.
    async fn read_from(&self, path: &str, offset: u64) -> Result<Reader, AppError> {
        let headers: Vec<(HeaderName, String)> = (offset > 0)
            .then(|| (header::RANGE, format!("bytes={offset}-")))
            .into_iter()
            .collect();
        let url = self.base.url_for(path);
        let resp = self
            .send("Download", Method::GET, &url, &headers, empty())
            .await?;
        let status = resp.status();
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            return Ok(Box::new(tokio::io::empty()));
        }
        if !status.is_success() {
            return Err(status_error("Download", status));
        }
        let mut body = body_reader(resp);
        if offset > 0 && status != StatusCode::PARTIAL_CONTENT {
            let mut skipped = (&mut body).take(offset);
            let n = tokio::io::copy(&mut skipped, &mut tokio::io::sink()).await?;
            if n != offset {
                return Err(format!("Download failed: {path} ended before byte {offset}").into());
            }
        }
        Ok(Box::new(body))
    }

    /// Writes a scratch file beside `path`, then one byte into it with a ranged
    /// PUT, and checks the server kept the rest. None when the probe itself failed.
    async fn honours_ranged_puts(&self, path: &str) -> Option<bool> {
        let (dir, _) = Endpoint::split(self, path);
        let url = self.base.url_for(&Endpoint::join(self, &dir, PROBE_NAME));
        let length = (header::CONTENT_LENGTH, "1".to_string());
        let made = [(header::CONTENT_LENGTH, "2".to_string())];
        let made = self
            .send("Probe", Method::PUT, &url, &made, full(&b"ab"[..]))
            .await;
        if !made.ok()?.status().is_success() {
            return None;
        }
        let ranged = [length, (header::CONTENT_RANGE, "bytes 1-1/*".to_string())];
        let honoured = match self
            .send("Probe", Method::PUT, &url, &ranged, full(&b"c"[..]))
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let probe = Endpoint::join(self, &dir, PROBE_NAME);
                let size = self
                    .stat_entry(&probe)
                    .await
                    .ok()
                    .flatten()
                    .and_then(|e| e.size);
                Some(size == Some(2))
            }
            Ok(_) => Some(false),
            Err(_) => None,
        };
        let _ = self.send("Probe", Method::DELETE, &url, &[], empty()).await;
        honoured
    }

    async fn ranged_puts(&self, path: &str) -> bool {
        if let Some(known) = self.ranged_puts.get() {
            return *known;
        }
        match self.honours_ranged_puts(path).await {
            Some(answer) => *self.ranged_puts.get_or_init(|| answer),
            None => false,
        }
    }

    /// PUTs the next `len` bytes of `from` at `at`, ranged unless it starts the file.
    async fn put_segment(
        &self,
        url: &url::Url,
        at: u64,
        len: u64,
        from: &mut DuplexStream,
    ) -> Result<(), AppError> {
        // nginx's dav module answers 411 to a chunked PUT, so the length is always sent.
        let mut headers = vec![(header::CONTENT_LENGTH, len.to_string())];
        if at > 0 {
            let end = at + len - 1;
            headers.push((header::CONTENT_RANGE, format!("bytes {at}-{end}/*")));
        }
        let (mut tx, rx) = tokio::io::duplex(PIPE);
        let body = StreamBody::new(ReaderStream::new(rx).map_ok(Frame::data)).boxed();
        let put = self.expect_ok("Upload", Method::PUT, url, &headers, body);
        let feed = async move {
            let fed = tokio::io::copy(&mut from.take(len), &mut tx).await;
            drop(tx);
            fed
        };
        tokio::pin!(put, feed);
        tokio::select! {
            put = &mut put => put.map(|_| ()),
            fed = &mut feed => match fed {
                Ok(_) => put.await.map(|_| ()),
                Err(e) => match timeout(REFUSAL_GRACE, put).await {
                    Ok(Err(refused)) => Err(refused),
                    _ => Err(e.into()),
                },
            }
        }
    }
}

#[async_trait]
impl Endpoint for WebDavBackend {
    fn is_local(&self) -> bool {
        false
    }

    async fn stat(&self, path: &str) -> Result<Option<Stat>, AppError> {
        Ok(self.stat_entry(path).await?.map(|e| Stat {
            size: e.size.unwrap_or(0),
            mtime: e.modified.unwrap_or(0),
            is_dir: e.is_dir,
            mode: None,
        }))
    }

    async fn list(&self, dir: &str) -> Result<Vec<Listed>, AppError> {
        let files = self.list_files(dir).await?;
        Ok(files.into_iter().map(Listed::from).collect())
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        match self.stat_entry(path).await? {
            Some(e) if e.is_dir => Ok(()),
            _ => self.make_dir(path).await,
        }
    }

    async fn open_read(&self, path: &str, offset: u64) -> Result<Reader, AppError> {
        self.read_from(path, offset).await
    }

    async fn open_write(&self, path: &str, offset: u64, len: u64) -> Result<Writer, AppError> {
        let step = if self.ranged_puts(path).await {
            SEGMENT
        } else {
            u64::MAX
        };
        let (this, url, end) = (self.clone(), self.base.url_for(path), offset + len);
        Ok(Box::new(piped(|mut rx, cancel| async move {
            let segments = async {
                let mut at = offset;
                loop {
                    let n = (end - at).min(step);
                    if n > 0 || at == 0 {
                        this.put_segment(&url, at, n, &mut rx).await?;
                    }
                    at += n;
                    if at >= end {
                        return Ok(());
                    }
                }
            };
            tokio::select! {
                done = segments => done,
                _ = cancel.cancelled() => Err("Transfer cancelled".into()),
            }
        })))
    }

    async fn appends(&self, _: &str, _: u64) -> bool {
        self.ranged_puts.get().copied().unwrap_or(false)
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        self.move_to(from, to).await
    }

    async fn remove(&self, path: &str) -> Result<(), AppError> {
        let url = self.base.url_for(path);
        self.expect_ok("Delete", Method::DELETE, &url, &[], empty())
            .await
            .map(|_| ())
    }

    async fn set_mtime(&self, _: &str, _: u64) -> Result<(), AppError> {
        // WebDAV has no portable way to set it; the server stamps the upload time.
        Ok(())
    }

    async fn hash(&self, _: &str, _: &CancellationToken) -> Result<Option<String>, AppError> {
        Ok(None)
    }

    async fn link_dead(&self) -> bool {
        !self.answers().await
    }

    async fn wait_for_link(
        &self,
        token: &CancellationToken,
        deadline: Instant,
    ) -> Result<(), AppError> {
        wait_for_link(|| self.answers(), token, &self.closed, deadline).await
    }
}

#[cfg(all(test, unix))]
mod live {
    use super::super::connect;
    use super::WebDavBackend;
    use crate::commands::sftp::resume::live::round_trip_through_restarts;
    use crate::known_hosts::KnownHostsStore;
    use crate::ssh::test_docker::Container;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    async fn connected(url: &str) -> WebDavBackend {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let known_hosts = Arc::new(KnownHostsStore::new());
            match connect(url, "u", "p", None, known_hosts, None).await {
                Ok(b) => return b,
                Err(e) => assert!(Instant::now() < deadline, "{e}"),
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    const DAV: &str = "LoadModule dav_module modules/mod_dav.so\n\
        LoadModule dav_fs_module modules/mod_dav_fs.so\n\
        DavLockDB /usr/local/apache2/var/DavLock\n\
        Alias /dav /usr/local/apache2/davroot\n\
        <Directory /usr/local/apache2/davroot>\nDav On\nRequire all granted\n</Directory>\n";

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs docker"]
    async fn apache_resumes_both_ways() {
        let conf = tempfile::tempdir().unwrap();
        std::fs::write(conf.path().join("dav.conf"), DAV).unwrap();
        let mount = format!(
            "{}/dav.conf:/usr/local/apache2/conf/dav.conf:ro",
            conf.path().display()
        );
        let c = Container::run(
            format!("dav-resume-{}", std::process::id()),
            &[
                "-p",
                "127.0.0.1:18090:80",
                "-v",
                &mount,
                "httpd:2.4",
                "sh",
                "-c",
                "mkdir -p var davroot && chown -R www-data var davroot && \
                 grep -q '^Include conf/dav.conf' conf/httpd.conf || echo 'Include conf/dav.conf' >> conf/httpd.conf; \
                 exec httpd-foreground",
            ],
        );
        let fs = connected("http://127.0.0.1:18090/dav/").await;
        round_trip_through_restarts(&fs, "/blob", &c.0, true).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs docker"]
    async fn rclone_resumes_downloads_and_restarts_uploads() {
        let c = Container::run(
            format!("rclone-resume-{}", std::process::id()),
            &[
                "-p",
                "127.0.0.1:18091:8080",
                "rclone/rclone",
                "serve",
                "webdav",
                "/data",
                "--addr",
                ":8080",
            ],
        );
        let fs = connected("http://127.0.0.1:18091/").await;
        round_trip_through_restarts(&fs, "/blob", &c.0, false).await;
    }
}
