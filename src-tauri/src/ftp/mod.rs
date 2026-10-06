//! `FtpBackend`: a `FileBackend` over plain FTP or explicit FTPS (`AUTH TLS`).
//! A control connection that fails is dropped and reopened with the same login on next use.

mod endpoint;

use crate::commands::sftp::editor::read_capped;
use crate::commands::sftp::resume::endpoint::Endpoint;
use crate::commands::sftp::{sort_listing, RemoteFile};
use crate::error::{AppError, ErrorCode};
use crate::sftp::link::LINK_PROBE;
use crate::sftp::FileBackend;
use async_trait::async_trait;
use std::io;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Instant, UNIX_EPOCH};
use suppaftp::list::File as FtpFile;
use suppaftp::tokio::{AsyncRustlsConnector, AsyncRustlsFtpStream};
use suppaftp::types::FileType;
use suppaftp::{FtpError, Mode, Status};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, OwnedMutexGuard};
use tokio::time::{timeout, Duration};
use tokio_rustls::TlsConnector;
use tokio_util::sync::CancellationToken;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const STALE: Duration = Duration::from_secs(20);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(30);

type Stream = AsyncRustlsFtpStream;
type Session = OwnedMutexGuard<Option<Stream>>;

/// Anonymous logins need a non-empty password on many servers (the RFC convention
/// is an email). Supply a conventional one when an anonymous user has none, so a
/// blank password field doesn't get rejected with "530 Login incorrect".
fn resolve_password<'a>(username: &str, password: Option<&'a str>) -> &'a str {
    match password {
        Some(p) if !p.is_empty() => p,
        _ if username.eq_ignore_ascii_case("anonymous") || username.eq_ignore_ascii_case("ftp") => {
            "anonymous@example.com"
        }
        _ => "",
    }
}

struct Login {
    host: String,
    port: u16,
    username: String,
    password: String,
    secure: bool,
}

#[derive(Clone)]
pub struct FtpBackend {
    conn: Arc<Mutex<Option<Stream>>>,
    login: Arc<Login>,
    /// The server lists with MLSD and stats with MLST (exact UTC times).
    mlsx: bool,
    /// The server sets modification times (MFMT).
    mfmt: bool,
    /// Whether the server lets APPE add to a file, once a resume has asked.
    appends: Arc<OnceLock<bool>>,
    used: Arc<StdMutex<Instant>>,
    closed: CancellationToken,
}

/// Connect, optionally upgrade to explicit FTPS, log in, and switch to binary
/// passive mode.
async fn open(login: &Login) -> Result<Stream, String> {
    let (host, port) = (login.host.as_str(), login.port);
    timeout(LOGIN_TIMEOUT, log_in(login))
        .await
        .map_err(|_| format!("FTP login timed out: {host}:{port} stopped answering"))?
}

async fn log_in(login: &Login) -> Result<Stream, String> {
    let (host, port) = (login.host.as_str(), login.port);
    let mut ftp = timeout(CONNECT_TIMEOUT, AsyncRustlsFtpStream::connect((host, port)))
        .await
        .map_err(|_| format!("FTP connection timed out: {host}:{port} did not respond"))?
        .map_err(|e| format!("FTP connection failed: {e}"))?;

    if login.secure {
        let config = crate::tls::client_config().map_err(|e| format!("FTPS: {e}"))?;
        let connector = AsyncRustlsConnector::from(TlsConnector::from(config));
        ftp = ftp
            .into_secure(connector, host)
            .await
            .map_err(|e| format!("FTPS (AUTH TLS) handshake failed: {e}"))?;
    }

    ftp.login(&login.username, &login.password)
        .await
        .map_err(|e| format!("FTP login failed: {e}"))?;
    ftp.set_mode(Mode::Passive);
    ftp.transfer_type(FileType::Binary)
        .await
        .map_err(|e| format!("FTP setup failed: {e}"))?;
    Ok(ftp)
}

/// `username`/`password` empty-or-"anonymous" performs anonymous login (the caller decides).
pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    secure: bool,
) -> Result<FtpBackend, String> {
    let login = Login {
        host: host.to_string(),
        port,
        username: username.to_string(),
        password: resolve_password(username, password).to_string(),
        secure,
    };
    let mut ftp = open(&login).await?;
    let feat = match timeout(COMMAND_TIMEOUT, ftp.feat()).await {
        Ok(Ok(feat)) => feat,
        _ => Default::default(),
    };
    Ok(FtpBackend {
        conn: Arc::new(Mutex::new(Some(ftp))),
        login: Arc::new(login),
        mlsx: feat.contains_key("MLST"),
        mfmt: feat.contains_key("MFMT"),
        appends: Arc::default(),
        used: Arc::new(StdMutex::new(Instant::now())),
        closed: CancellationToken::new(),
    })
}

/// The control connection can't be trusted after one of these: drop it.
fn is_transport(e: &FtpError) -> bool {
    match e {
        FtpError::UnexpectedResponse(r) => r.status == Status::NotAvailable,
        FtpError::InvalidAddress(_) => false,
        _ => true,
    }
}

fn lost(kind: io::ErrorKind) -> FtpError {
    FtpError::ConnectionError(io::Error::from(kind))
}

/// Runs one command on a session's connection, bounded by `COMMAND_TIMEOUT`;
/// a transport failure drops the connection so the next session reopens it.
macro_rules! call {
    ($session:expr, |$ftp:ident| $call:expr) => {{
        use $crate::ftp::{is_transport, lost, Stream, COMMAND_TIMEOUT};
        let conn: &mut Option<Stream> = &mut $session;
        let r = match conn.as_mut() {
            None => Err(lost(std::io::ErrorKind::ConnectionAborted)),
            Some($ftp) => match tokio::time::timeout(COMMAND_TIMEOUT, $call).await {
                Ok(r) => r,
                Err(_) => Err(lost(std::io::ErrorKind::TimedOut)),
            },
        };
        if r.as_ref().is_err_and(is_transport) {
            *conn = None;
        }
        r
    }};
}
pub(crate) use call;

fn failed(what: &str, e: FtpError) -> AppError {
    let message = format!("{what} failed: {e}");
    let code = match &e {
        FtpError::ConnectionError(io) if io.kind() == io::ErrorKind::TimedOut => {
            Some(ErrorCode::TimedOut)
        }
        FtpError::ConnectionError(io) => return AppError::caused(format!("{what} failed"), io),
        FtpError::UnexpectedResponse(r) => match r.status {
            Status::NotAvailable => Some(ErrorCode::ConnectionLost),
            Status::ExceededStorage | Status::RequestedActionNotTaken => {
                Some(ErrorCode::StorageFull)
            }
            Status::NotLoggedIn => Some(ErrorCode::LoginRejected),
            _ => None,
        },
        _ => Some(ErrorCode::ConnectionLost),
    };
    match code {
        Some(code) => AppError::coded(code, message),
        None => message.into(),
    }
}

/// A data stream stopped short leaves the control connection mid-reply, and
/// servers answer ABOR differently (proftpd sends two 226s): drop both instead.
fn abandon<T>(s: &mut Session, data: T) {
    drop(data);
    **s = None;
}

fn refused(e: &FtpError) -> bool {
    matches!(e, FtpError::UnexpectedResponse(_)) && !is_transport(e)
}

impl FtpBackend {
    /// The open connection if it still answers, else a fresh login.
    async fn answers(&self, conn: &mut Option<Stream>) -> Result<(), String> {
        if let Some(ftp) = conn.as_mut() {
            if matches!(timeout(LINK_PROBE, ftp.noop()).await, Ok(Ok(()))) {
                return Ok(());
            }
            *conn = None;
        }
        if self.closed.is_cancelled() {
            return Err("FTP session closed".into());
        }
        *conn = Some(open(&self.login).await?);
        Ok(())
    }

    /// The control connection, checked first after `STALE` idle since servers drop idle ones.
    async fn session(&self) -> Result<Session, AppError> {
        let mut conn = Arc::clone(&self.conn).lock_owned().await;
        let idle = std::mem::replace(&mut *self.used.lock().unwrap(), Instant::now()).elapsed();
        if conn.is_none() || idle > STALE {
            self.answers(&mut conn)
                .await
                .map_err(|e| AppError::coded(ErrorCode::ConnectionLost, e))?;
        }
        Ok(conn)
    }

    /// Each entry of `dir`, from MLSD when the server has it (exact times), else LIST.
    async fn entries(&self, dir: &str) -> Result<Vec<FtpFile>, AppError> {
        let mut s = self.session().await?;
        let mlsd = match self.mlsx {
            true => Some(call!(*s, |ftp| ftp.mlsd(Some(dir)))),
            false => None,
        };
        let lines = match mlsd {
            Some(r) if !r.as_ref().is_err_and(refused) => r,
            _ => call!(*s, |ftp| ftp.list(Some(dir))),
        }
        .map_err(|e| failed("list", e))?;
        Ok(lines
            .iter()
            .filter_map(|line| FtpFile::try_from(line.as_str()).ok())
            .filter(|f| !matches!(f.name(), "" | "." | ".."))
            .collect())
    }

    /// Whether `path` is a folder: one the server lets us change into.
    async fn is_dir(&self, s: &mut Session, path: &str) -> Result<bool, AppError> {
        let prev = call!(**s, |ftp| ftp.pwd()).ok();
        match call!(**s, |ftp| ftp.cwd(path)) {
            Ok(()) => {
                if let Some(p) = prev {
                    let _ = call!(**s, |ftp| ftp.cwd(&p));
                }
                Ok(true)
            }
            Err(e) if refused(&e) => Ok(false),
            Err(e) => Err(failed("stat", e)),
        }
    }
}

fn mtime_of(f: &FtpFile) -> Option<u64> {
    f.modified()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

#[async_trait]
impl FileBackend for FtpBackend {
    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, AppError> {
        let base = path.trim_end_matches('/');
        let mut files: Vec<RemoteFile> = self
            .entries(path)
            .await?
            .into_iter()
            .map(|f| RemoteFile {
                path: if base.is_empty() {
                    format!("/{}", f.name())
                } else {
                    format!("{base}/{}", f.name())
                },
                name: f.name().to_string(),
                size: f.size() as u64,
                is_dir: f.is_directory(),
                is_symlink: f.is_symlink(),
                modified: mtime_of(&f),
                permissions: None,
            })
            .collect();
        sort_listing(&mut files);
        Ok(files)
    }

    async fn stat(&self, path: &str) -> Result<Option<bool>, String> {
        Ok(Endpoint::stat(self, path).await?.map(|s| s.is_dir))
    }

    async fn canonicalize(&self, path: &str) -> Result<String, AppError> {
        let mut s = self.session().await?;
        let prev = call!(*s, |ftp| ftp.pwd()).ok();
        if call!(*s, |ftp| ftp.cwd(path)).is_err() {
            // A file or non-navigable path: hand it back unchanged.
            return Ok(path.to_string());
        }
        let canon = call!(*s, |ftp| ftp.pwd()).map_err(|e| failed("pwd", e))?;
        if let Some(p) = prev {
            let _ = call!(*s, |ftp| ftp.cwd(&p));
        }
        Ok(canon)
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        let mut s = self.session().await?;
        call!(*s, |ftp| ftp.mkdir(path)).map_err(|e| failed("mkdir", e))
    }

    async fn touch(&self, path: &str) -> Result<(), AppError> {
        let mut s = self.session().await?;
        call!(*s, |ftp| ftp.put_file(path, &mut tokio::io::empty()))
            .map(|_| ())
            .map_err(|e| failed("touch", e))
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        Endpoint::rename(self, from, to).await
    }

    async fn delete(&self, path: &str) -> Result<(), AppError> {
        // Files (and symlinks) delete directly; directories need their contents
        // removed first. Gather the tree breadth-first, then delete files, then
        // dirs deepest-first.
        if !matches!(FileBackend::stat(self, path).await?, Some(true)) {
            return Endpoint::remove(self, path).await;
        }
        let mut dirs = vec![path.to_string()];
        let mut files: Vec<String> = Vec::new();
        let mut i = 0;
        while i < dirs.len() {
            let dir = dirs[i].clone();
            i += 1;
            for e in self.list_dir(&dir).await? {
                if e.is_dir {
                    dirs.push(e.path);
                } else {
                    files.push(e.path);
                }
            }
        }
        let mut s = self.session().await?;
        for f in &files {
            call!(*s, |ftp| ftp.rm(f)).map_err(|e| failed("delete file", e))?;
        }
        for d in dirs.iter().rev() {
            call!(*s, |ftp| ftp.rmdir(d)).map_err(|e| failed("rmdir", e))?;
        }
        Ok(())
    }

    async fn file_size(&self, path: &str) -> u64 {
        let Ok(mut s) = self.session().await else {
            return 0;
        };
        call!(*s, |ftp| ftp.size(path)).map_or(0, |n| n as u64)
    }

    async fn read_file(&self, path: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
        let mut s = self.session().await?;
        let mut stream =
            call!(*s, |ftp| ftp.retr_as_stream(path)).map_err(|e| failed("open", e))?;
        let buf = read_capped(&mut stream, max_bytes)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        if buf.len() as u64 > max_bytes {
            abandon(&mut s, stream);
            return Ok(buf);
        }
        call!(*s, |ftp| ftp.finalize_retr_stream(stream))
            .map_err(|e| failed("read finalize", e))?;
        Ok(buf)
    }

    async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let mut w = self.open_write(path, 0, content.len() as u64).await?;
        w.write_all(content.as_bytes())
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        w.shutdown().await.map_err(|e| format!("write failed: {e}"))
    }

    fn endpoint(&self) -> Arc<dyn Endpoint> {
        Arc::new(self.clone())
    }

    async fn close(&self) {
        self.closed.cancel();
        if let Some(mut ftp) = self.conn.lock().await.take() {
            let _ = timeout(Duration::from_secs(2), ftp.quit()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anonymous_gets_a_nonempty_password() {
        assert_eq!(
            resolve_password("anonymous", Some("")),
            "anonymous@example.com"
        );
        assert_eq!(resolve_password("ftp", None), "anonymous@example.com");
        assert_eq!(resolve_password("Anonymous", Some("me@x.com")), "me@x.com");
        assert_eq!(resolve_password("realuser", Some("")), "");
        assert_eq!(resolve_password("realuser", Some("pw")), "pw");
    }

    // Live test against a local FTP server. Run with:
    //   docker run -d --name ftp --network host -e FTP_USER=testuser \
    //     -e FTP_PASS=testpass garethflowers/ftp-server
    //   cargo test --lib ftp::tests::ftp_smoke -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn ftp_smoke() {
        let b = connect("127.0.0.1", 21, "testuser", Some("testpass"), false)
            .await
            .expect("connect");

        b.write_file("/hello.txt", "hi there").await.expect("write");
        assert_eq!(
            b.read_file("/hello.txt", 1024).await.expect("read"),
            b"hi there"
        );
        assert_eq!(b.file_size("/hello.txt").await, 8);

        let files = b.list_dir("/").await.expect("list");
        assert!(files.iter().any(|f| f.name == "hello.txt" && !f.is_dir));

        FileBackend::mkdir(&b, "/sub").await.expect("mkdir");
        assert_eq!(
            FileBackend::stat(&b, "/sub").await.expect("stat dir"),
            Some(true)
        );
        assert_eq!(
            FileBackend::stat(&b, "/hello.txt")
                .await
                .expect("stat file"),
            Some(false)
        );
        assert_eq!(
            FileBackend::stat(&b, "/nope").await.expect("stat missing"),
            None
        );

        FileBackend::rename(&b, "/hello.txt", "/sub/renamed.txt")
            .await
            .expect("rename");
        b.delete("/sub").await.expect("recursive delete");
        assert_eq!(
            FileBackend::stat(&b, "/sub").await.expect("stat deleted"),
            None
        );
    }
}
