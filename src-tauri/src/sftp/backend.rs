//! The `FileBackend` trait: the filesystem operations every SFTP-id speaks,
//! regardless of transport (real SFTP over SSH, `docker exec` shim, …).
//!
//! Server-to-server transfer and the tar fast paths are inherently SFTP-only;
//! they reach the raw session through `as_sftp_session()` (None for non-SFTP
//! backends, which fall back to the per-item `*_batch` methods).

use crate::commands::sftp::RemoteFile;
use async_trait::async_trait;
use russh_sftp::client::SftpSession;
use std::path::Path;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[async_trait]
pub trait FileBackend: Send + Sync {
    // ── Browse / metadata ──────────────────────────────────────────────────
    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, String>;
    /// Some(is_dir) if the path exists, None if it doesn't.
    async fn stat(&self, path: &str) -> Result<Option<bool>, String>;
    async fn canonicalize(&self, path: &str) -> Result<String, String>;
    async fn mkdir(&self, path: &str) -> Result<(), String>;
    async fn touch(&self, path: &str) -> Result<(), String>;
    async fn rename(&self, from: &str, to: &str) -> Result<(), String>;
    async fn delete(&self, path: &str) -> Result<(), String>;

    // ── Editor ─────────────────────────────────────────────────────────────
    async fn file_size(&self, path: &str) -> u64;
    /// At most `editor::read_limit(max_bytes)` bytes of `path`: a result longer
    /// than `max_bytes` means the file is too large for the editor.
    async fn read_file(&self, path: &str, max_bytes: u64) -> Result<Vec<u8>, String>;
    async fn write_file(&self, path: &str, content: &str) -> Result<(), String>;

    // ── Transfers ──────────────────────────────────────────────────────────
    async fn upload_file(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn download_file(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn upload_dir(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn download_dir(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    /// Per-item fallback: walk the selection and transfer each entry on its own.
    /// Backends with a bulk fast path (tar over `docker exec`) override it;
    /// real SFTP takes the tar path through `as_sftp_session` and only lands
    /// here as a safety net.
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
            // Local paths, so let `Path` handle the platform's separator.
            let Some(name) = Path::new(p).file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let remote = format!("{base}/{name}");
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
            // Remote paths are always POSIX, whatever the host runs.
            let name = p.trim_end_matches('/').rsplit('/').next().unwrap_or(p);
            let local = Path::new(local_dir).join(checked_remote_name(name, true)?);
            let local_str = local.to_string_lossy();
            let is_dir = self.stat(p).await?.unwrap_or(false);
            if is_dir {
                self.download_dir(app, p, &local_str, transfer_id, token)
                    .await?;
            } else {
                self.download_file(app, p, &local_str, transfer_id, token)
                    .await?;
            }
        }
        Ok(())
    }

    /// Raw SFTP session, for server-to-server transfer and tar fast paths.
    /// None for transports that don't speak real SFTP.
    fn as_sftp_session(&self) -> Option<Arc<Mutex<SftpSession>>> {
        None
    }
}

/// A server-chosen name, refused unless it is one plain path component. `local`:
/// the destination is this machine, so its platform's rules apply; else POSIX.
pub fn checked_remote_name(name: &str, local: bool) -> Result<&str, String> {
    if is_plain_name(name, local && cfg!(windows)) {
        Ok(name)
    } else {
        Err(format!(
            "Refusing unsafe file name from the server: {name:?}"
        ))
    }
}

/// `windows` adds what Windows reads into a name: `\` separates, `C:` is a
/// drive, and trailing dots and spaces are dropped, so `.. ` means `..`.
fn is_plain_name(name: &str, windows: bool) -> bool {
    let dots_only = if windows {
        name.trim_end_matches(['.', ' ']).is_empty()
    } else {
        name.is_empty() || name == "." || name == ".."
    };
    let bad_char = |c: char| c == '/' || c == '\0' || (windows && (c == '\\' || c == ':'));
    !dots_only && !name.contains(bad_char)
}

#[cfg(test)]
mod tests {
    use super::is_plain_name;

    #[test]
    fn plain_names_pass_everywhere() {
        for name in ["file.txt", ".bashrc", "a..b", "name with spaces", "ünïcode"] {
            assert!(is_plain_name(name, false), "{name}");
            assert!(is_plain_name(name, true), "{name}");
        }
    }

    #[test]
    fn traversal_is_refused_everywhere() {
        for name in ["", ".", "..", "../x", "a/b", "/etc/passwd", "a\0b"] {
            assert!(!is_plain_name(name, false), "{name:?}");
            assert!(!is_plain_name(name, true), "{name:?}");
        }
    }

    #[test]
    fn windows_separators_and_drives_are_refused_on_windows_only() {
        for name in [
            "..\\x",
            "a\\b",
            "C:\\Windows",
            "C:x",
            "\\\\srv\\share",
            "...",
            ".. ",
            "stream:x",
        ] {
            assert!(!is_plain_name(name, true), "{name:?}");
        }
        // Legal, and harmless, POSIX names.
        for name in ["a\\b", "10:30.log", "..."] {
            assert!(is_plain_name(name, false), "{name:?}");
        }
    }
}
