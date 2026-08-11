//! `FtpBackend`: a `FileBackend` over plain FTP or explicit FTPS (`AUTH TLS`).
//!
//! FTP has no shell and no SSH handle, so it never takes the tar/exec or
//! server-to-server fast paths (`as_sftp_session` stays `None`); the directory
//! and batch operations fall back to per-file transfers. Listing leans on
//! `suppaftp`'s `list::File` parser (POSIX/DOS/MLSx); permissions and symlink
//! info are best-effort.

use crate::commands::sftp::{pump_chunks, RemoteFile};
use crate::sftp::FileBackend;
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use suppaftp::list::File as FtpFile;
use suppaftp::tokio::{AsyncRustlsConnector, AsyncRustlsFtpStream};
use suppaftp::types::FileType;
use suppaftp::Mode;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_rustls::TlsConnector;
use tokio_util::sync::CancellationToken;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

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

pub struct FtpBackend {
    inner: Arc<Mutex<AsyncRustlsFtpStream>>,
}

/// Connect, optionally upgrade to explicit FTPS, log in, and switch to binary
/// passive mode. `username`/`password` empty-or-"anonymous" performs anonymous
/// login (the caller decides).
pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    secure: bool,
) -> Result<FtpBackend, String> {
    let mut ftp = timeout(CONNECT_TIMEOUT, AsyncRustlsFtpStream::connect((host, port)))
        .await
        .map_err(|_| format!("FTP connection timed out: {host}:{port} did not respond"))?
        .map_err(|e| format!("FTP connection failed: {e}"))?;

    if secure {
        let config = build_tls_config()?;
        let connector = AsyncRustlsConnector::from(TlsConnector::from(Arc::new(config)));
        ftp = ftp
            .into_secure(connector, host)
            .await
            .map_err(|e| format!("FTPS (AUTH TLS) handshake failed: {e}"))?;
    }

    ftp.login(username, resolve_password(username, password))
        .await
        .map_err(|e| format!("FTP login failed: {e}"))?;
    ftp.set_mode(Mode::Passive);
    ftp.transfer_type(FileType::Binary)
        .await
        .map_err(|e| format!("FTP setup failed: {e}"))?;

    Ok(FtpBackend {
        inner: Arc::new(Mutex::new(ftp)),
    })
}

/// rustls config trusting the OS root store, using the `ring` provider (matches
/// the rest of the tree). Self-signed/invalid certs are rejected.
fn build_tls_config() -> Result<ClientConfig, String> {
    let mut roots = RootCertStore::empty();
    let loaded = rustls_native_certs::load_native_certs();
    for cert in loaded.certs {
        let _ = roots.add(cert);
    }
    if roots.is_empty() {
        return Err("No system root certificates available for FTPS".into());
    }
    let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS setup failed: {e}"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(config)
}

fn file_name(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    trimmed.rsplit('/').next().unwrap_or(trimmed)
}

fn collect_local(
    base: &Path,
    current: &Path,
    dirs: &mut Vec<PathBuf>,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(current)
        .map_err(|e| format!("Cannot read dir {}: {e}", current.display()))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        let rel = p
            .strip_prefix(base)
            .map_err(|e| e.to_string())?
            .to_path_buf();
        if p.is_dir() {
            dirs.push(rel);
            collect_local(base, &p, dirs, files)?;
        } else {
            files.push(rel);
        }
    }
    Ok(())
}

#[async_trait]
impl FileBackend for FtpBackend {
    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, String> {
        let lines = {
            let mut ftp = self.inner.lock().await;
            ftp.list(Some(path))
                .await
                .map_err(|e| format!("list failed: {e}"))?
        };
        let base = path.trim_end_matches('/');
        let mut files: Vec<RemoteFile> = Vec::new();
        for line in &lines {
            let Ok(f) = FtpFile::try_from(line.as_str()) else {
                continue;
            };
            let name = f.name().to_string();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }
            let entry_path = if base.is_empty() {
                format!("/{name}")
            } else {
                format!("{base}/{name}")
            };
            files.push(RemoteFile {
                path: entry_path,
                name,
                size: f.size() as u64,
                is_dir: f.is_directory(),
                is_symlink: f.is_symlink(),
                modified: f
                    .modified()
                    .duration_since(UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_secs()),
                permissions: None,
            });
        }
        files.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(files)
    }

    async fn stat(&self, path: &str) -> Result<Option<bool>, String> {
        let mut ftp = self.inner.lock().await;
        if ftp.size(path).await.is_ok() {
            return Ok(Some(false));
        }
        let prev = ftp.pwd().await.ok();
        if ftp.cwd(path).await.is_ok() {
            if let Some(p) = prev {
                let _ = ftp.cwd(p).await;
            }
            return Ok(Some(true));
        }
        Ok(None)
    }

    async fn canonicalize(&self, path: &str) -> Result<String, String> {
        let mut ftp = self.inner.lock().await;
        let prev = ftp.pwd().await.ok();
        if ftp.cwd(path).await.is_ok() {
            let canon = ftp.pwd().await.map_err(|e| format!("pwd failed: {e}"))?;
            if let Some(p) = prev {
                let _ = ftp.cwd(p).await;
            }
            Ok(canon)
        } else {
            // A file or non-navigable path: hand it back unchanged.
            Ok(path.to_string())
        }
    }

    async fn mkdir(&self, path: &str) -> Result<(), String> {
        let mut ftp = self.inner.lock().await;
        ftp.mkdir(path)
            .await
            .map_err(|e| format!("mkdir failed: {e}"))
    }

    async fn touch(&self, path: &str) -> Result<(), String> {
        let mut ftp = self.inner.lock().await;
        ftp.put_file(path, &mut tokio::io::empty())
            .await
            .map(|_| ())
            .map_err(|e| format!("touch failed: {e}"))
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let mut ftp = self.inner.lock().await;
        ftp.rename(from, to)
            .await
            .map_err(|e| format!("rename failed: {e}"))
    }

    async fn delete(&self, path: &str) -> Result<(), String> {
        // Files (and symlinks) delete directly; directories need their contents
        // removed first. Gather the tree breadth-first, then delete files, then
        // dirs deepest-first.
        if !matches!(self.stat(path).await?, Some(true)) {
            let mut ftp = self.inner.lock().await;
            return ftp
                .rm(path)
                .await
                .map_err(|e| format!("delete failed: {e}"));
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
        let mut ftp = self.inner.lock().await;
        for f in &files {
            ftp.rm(f)
                .await
                .map_err(|e| format!("delete file failed: {e}"))?;
        }
        for d in dirs.iter().rev() {
            ftp.rmdir(d)
                .await
                .map_err(|e| format!("rmdir failed: {e}"))?;
        }
        Ok(())
    }

    async fn file_size(&self, path: &str) -> u64 {
        let mut ftp = self.inner.lock().await;
        ftp.size(path).await.map(|s| s as u64).unwrap_or(0)
    }

    async fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let mut ftp = self.inner.lock().await;
        let mut stream = ftp
            .retr_as_stream(path)
            .await
            .map_err(|e| format!("open failed: {e}"))?;
        let mut buf = Vec::new();
        stream
            .read_to_end(&mut buf)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        ftp.finalize_retr_stream(stream)
            .await
            .map_err(|e| format!("read finalize failed: {e}"))?;
        Ok(buf)
    }

    async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let mut ftp = self.inner.lock().await;
        let mut data = content.as_bytes();
        ftp.put_file(path, &mut data)
            .await
            .map(|_| ())
            .map_err(|e| format!("write failed: {e}"))
    }

    async fn upload_file(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let mut local = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| format!("Cannot open local file: {e}"))?;
        let total = local.metadata().await.map(|m| m.len()).unwrap_or(0);

        let mut ftp = self.inner.lock().await;
        let mut data = ftp
            .put_with_stream(remote_path)
            .await
            .map_err(|e| format!("Cannot create remote file: {e}"))?;

        let mut transferred = 0u64;
        // Any failure, cancellation included, has to abort the data connection
        // rather than finalize it.
        if let Err(e) = pump_chunks(
            app,
            &mut local,
            &mut data,
            transfer_id,
            token,
            &mut transferred,
            total,
        )
        .await
        {
            let _ = ftp.abort(data).await;
            return Err(e);
        }
        ftp.finalize_put_stream(data)
            .await
            .map_err(|e| format!("upload finalize failed: {e}"))
    }

    async fn download_file(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        if let Some(parent) = Path::new(local_path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Cannot create local dir: {e}"))?;
        }
        let mut local = tokio::fs::File::create(local_path)
            .await
            .map_err(|e| format!("Cannot create local file: {e}"))?;

        let mut ftp = self.inner.lock().await;
        let total = ftp.size(remote_path).await.map(|s| s as u64).unwrap_or(0);
        let mut stream = ftp
            .retr_as_stream(remote_path)
            .await
            .map_err(|e| format!("Cannot open remote file: {e}"))?;

        let mut transferred = 0u64;
        // A failed or cancelled read drops the data connection instead of
        // finalizing it.
        if let Err(e) = pump_chunks(
            app,
            &mut stream,
            &mut local,
            transfer_id,
            token,
            &mut transferred,
            total,
        )
        .await
        {
            drop(stream);
            return Err(e);
        }
        ftp.finalize_retr_stream(stream)
            .await
            .map_err(|e| format!("download finalize failed: {e}"))?;
        local.flush().await.ok();
        Ok(())
    }

    async fn upload_dir(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let local_base = PathBuf::from(local_path);
        let mut dirs: Vec<PathBuf> = Vec::new();
        let mut files: Vec<PathBuf> = Vec::new();
        collect_local(&local_base, &local_base, &mut dirs, &mut files)?;

        let base = remote_path.trim_end_matches('/');
        let _ = self.mkdir(base).await;
        for d in &dirs {
            let rd = format!("{}/{}", base, d.to_string_lossy().replace('\\', "/"));
            let _ = self.mkdir(&rd).await;
        }
        for f in &files {
            if token.is_cancelled() {
                return Err("Transfer cancelled".into());
            }
            let la = local_base.join(f);
            let rp = format!("{}/{}", base, f.to_string_lossy().replace('\\', "/"));
            self.upload_file(app, &la.to_string_lossy(), &rp, transfer_id, token)
                .await?;
        }
        Ok(())
    }

    async fn download_dir(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let mut stack = vec![(remote_path.to_string(), PathBuf::from(local_path))];
        while let Some((rdir, ldir)) = stack.pop() {
            tokio::fs::create_dir_all(&ldir)
                .await
                .map_err(|e| format!("Cannot create directory: {e}"))?;
            for e in self.list_dir(&rdir).await? {
                if token.is_cancelled() {
                    return Err("Transfer cancelled".into());
                }
                let lpath = ldir.join(&e.name);
                if e.is_dir {
                    stack.push((e.path, lpath));
                } else {
                    self.download_file(app, &e.path, &lpath.to_string_lossy(), transfer_id, token)
                        .await?;
                }
            }
        }
        Ok(())
    }

    async fn upload_batch(
        &self,
        app: &AppHandle,
        local_paths: &[String],
        remote_dir: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let base = remote_dir.trim_end_matches('/');
        let _ = self.mkdir(base).await;
        for p in local_paths {
            if token.is_cancelled() {
                return Err("Transfer cancelled".into());
            }
            let remote = format!("{}/{}", base, file_name(p));
            if Path::new(p).is_dir() {
                self.upload_dir(app, p, &remote, transfer_id, token).await?;
            } else {
                self.upload_file(app, p, &remote, transfer_id, token)
                    .await?;
            }
        }
        Ok(())
    }

    async fn download_batch(
        &self,
        app: &AppHandle,
        remote_paths: &[String],
        local_dir: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        for p in remote_paths {
            if token.is_cancelled() {
                return Err("Transfer cancelled".into());
            }
            let local = Path::new(local_dir).join(file_name(p));
            let is_dir = self.stat(p).await?.unwrap_or(false);
            if is_dir {
                self.download_dir(app, p, &local.to_string_lossy(), transfer_id, token)
                    .await?;
            } else {
                self.download_file(app, p, &local.to_string_lossy(), transfer_id, token)
                    .await?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Live test against a local FTP server. Run with:
    //   docker run -d --name ftp --network host -e FTP_USER=testuser \
    //     -e FTP_PASS=testpass garethflowers/ftp-server
    //   cargo test --lib ftp::tests::ftp_smoke -- --ignored --nocapture
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

    #[tokio::test]
    #[ignore]
    async fn ftp_smoke() {
        let b = connect("127.0.0.1", 21, "testuser", Some("testpass"), false)
            .await
            .expect("connect");

        b.write_file("/hello.txt", "hi there").await.expect("write");
        assert_eq!(b.read_file("/hello.txt").await.expect("read"), b"hi there");
        assert_eq!(b.file_size("/hello.txt").await, 8);

        let files = b.list_dir("/").await.expect("list");
        assert!(files.iter().any(|f| f.name == "hello.txt" && !f.is_dir));

        b.mkdir("/sub").await.expect("mkdir");
        assert_eq!(b.stat("/sub").await.expect("stat dir"), Some(true));
        assert_eq!(b.stat("/hello.txt").await.expect("stat file"), Some(false));
        assert_eq!(b.stat("/nope").await.expect("stat missing"), None);

        b.rename("/hello.txt", "/sub/renamed.txt")
            .await
            .expect("rename");
        b.delete("/sub").await.expect("recursive delete");
        assert_eq!(b.stat("/sub").await.expect("stat deleted"), None);
    }
}
