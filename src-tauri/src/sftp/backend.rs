//! The `FileBackend` trait: the filesystem operations every SFTP-id speaks,
//! regardless of transport (real SFTP over SSH, `docker exec` shim, …).
//!
//! Server-to-server transfer and the tar fast paths are inherently SFTP-only;
//! they reach the raw session through `as_sftp_session()` (None for non-SFTP
//! backends, which fall back to the per-item `*_batch` methods).

use crate::commands::sftp::RemoteFile;
use async_trait::async_trait;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Where a transfer's progress and skipped-name events go: the app, or a test's recorder.
pub trait TransferEvents: Send + Sync {
    fn send<S: Serialize + Clone>(&self, event: &str, payload: S);
}

impl<R: Runtime> TransferEvents for AppHandle<R> {
    fn send<S: Serialize + Clone>(&self, event: &str, payload: S) {
        let _ = self.emit(event, payload);
    }
}

#[async_trait]
pub trait FileBackend<E: TransferEvents = AppHandle>: Send + Sync {
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
    async fn read_file(&self, path: &str) -> Result<Vec<u8>, String>;
    async fn write_file(&self, path: &str, content: &str) -> Result<(), String>;

    // ── Transfers ──────────────────────────────────────────────────────────
    async fn upload_file(
        &self,
        app: &E,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn download_file(
        &self,
        app: &E,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    async fn upload_dir(
        &self,
        app: &E,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String>;
    /// Per-item fallback: walk the listing and download each file on its own.
    async fn download_dir(
        &self,
        app: &E,
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
                if skip_unsafe_name(app, transfer_id, &e.path, &e.name, true) {
                    continue;
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
    /// Per-item fallback: walk the selection and transfer each entry on its own.
    /// Backends with a bulk fast path (tar over `docker exec`) override it;
    /// real SFTP takes the tar path through `as_sftp_session` and only lands
    /// here as a safety net.
    async fn upload_batch(
        &self,
        app: &E,
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
        app: &E,
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
            if skip_unsafe_name(app, transfer_id, p, name, true) {
                continue;
            }
            let local = Path::new(local_dir).join(name);
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

/// True, after reporting `path` on `sftp-skipped-<id>`, when the server-chosen `name` is not
/// one plain path component. `local`: the destination is this machine, so its rules apply.
pub fn skip_unsafe_name(
    app: &impl TransferEvents,
    transfer_id: &str,
    path: &str,
    name: &str,
    local: bool,
) -> bool {
    let skip = !is_plain_name(name, local && cfg!(windows));
    if skip {
        app.send(&format!("sftp-skipped-{transfer_id}"), path);
    }
    skip
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

/// A remote tree holding names some local systems can't store, and one that
/// escapes on every system; shared by the backend and SFTP download tests.
#[cfg(test)]
pub(crate) mod test_tree {
    use super::TransferEvents;
    use serde::Serialize;
    use std::path::Path;
    use std::sync::Mutex;

    pub const ROOT: &str = "/src";
    /// `(parent, name, Some(content))` for a file, `None` for a directory.
    pub const TREE: &[(&str, &str, Option<&str>)] = &[
        ("/src", "ok.txt", Some("ok")),
        ("/src", "10:30.log", Some("log")),
        ("/src", "a\\b", Some("ab")),
        ("/src", "../escape", Some("escaped")),
        ("/src", "sub", None),
        ("/src/sub", "inner.txt", Some("inner")),
    ];

    pub fn children(dir: &str) -> impl Iterator<Item = (&'static str, Option<&'static str>)> + '_ {
        TREE.iter()
            .filter(move |(parent, _, _)| *parent == dir)
            .map(|(_, name, content)| (*name, *content))
    }

    /// `Some(None)` for a directory, `Some(Some(content))` for a file.
    pub fn lookup(path: &str) -> Option<Option<&'static str>> {
        if path == ROOT {
            return Some(None);
        }
        TREE.iter()
            .find(|(parent, name, _)| format!("{parent}/{name}") == path)
            .map(|(_, _, content)| *content)
    }

    /// Keeps every event a transfer sends, for the test to read back.
    #[derive(Default)]
    pub struct Recorder(Mutex<Vec<(String, serde_json::Value)>>);

    impl TransferEvents for Recorder {
        fn send<S: Serialize + Clone>(&self, event: &str, payload: S) {
            let payload = serde_json::to_value(payload).unwrap();
            self.0.lock().unwrap().push((event.to_string(), payload));
        }
    }

    impl Recorder {
        pub fn skipped(&self, transfer_id: &str) -> Vec<String> {
            let event = format!("sftp-skipped-{transfer_id}");
            let events = self.0.lock().unwrap();
            events
                .iter()
                .filter(|(name, _)| *name == event)
                .map(|(_, payload)| payload.as_str().unwrap().to_string())
                .collect()
        }
    }

    pub fn expected_skips() -> Vec<String> {
        let mut skips = vec!["/src/../escape"];
        if cfg!(windows) {
            skips.extend(["/src/10:30.log", "/src/a\\b"]);
        }
        let mut skips: Vec<String> = skips.into_iter().map(String::from).collect();
        skips.sort();
        skips
    }

    /// `dst` must sit in a directory of its own, so an escape would land beside it.
    pub fn assert_downloaded(dst: &Path, mut skipped: Vec<String>) {
        skipped.sort();
        assert_eq!(skipped, expected_skips());

        let read = |rel: &str| std::fs::read_to_string(dst.join(rel)).unwrap();
        assert_eq!(read("ok.txt"), "ok");
        assert_eq!(read("sub/inner.txt"), "inner");
        assert!(!dst.parent().unwrap().join("escape").exists());

        let mut names: Vec<String> = std::fs::read_dir(dst)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        if cfg!(windows) {
            assert_eq!(names, ["ok.txt", "sub"]);
        } else {
            assert_eq!(names, ["10:30.log", "a\\b", "ok.txt", "sub"]);
            assert_eq!(read("10:30.log"), "log");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_tree::{assert_downloaded, children, lookup, Recorder};
    use super::{is_plain_name, FileBackend};
    use crate::commands::sftp::RemoteFile;
    use async_trait::async_trait;
    use tokio_util::sync::CancellationToken;

    struct TreeBackend;

    #[async_trait]
    impl FileBackend<Recorder> for TreeBackend {
        async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, String> {
            Ok(children(path)
                .map(|(name, content)| RemoteFile {
                    name: name.into(),
                    path: format!("{path}/{name}"),
                    size: content.map_or(0, |c| c.len() as u64),
                    is_dir: content.is_none(),
                    is_symlink: false,
                    modified: None,
                    permissions: None,
                })
                .collect())
        }
        async fn stat(&self, path: &str) -> Result<Option<bool>, String> {
            Ok(lookup(path).map(|content| content.is_none()))
        }
        async fn download_file(
            &self,
            _: &Recorder,
            remote_path: &str,
            local_path: &str,
            _: &str,
            _: &CancellationToken,
        ) -> Result<(), String> {
            let content = lookup(remote_path).flatten().ok_or("not a file")?;
            std::fs::write(local_path, content).map_err(|e| e.to_string())
        }
        async fn canonicalize(&self, _: &str) -> Result<String, String> {
            unimplemented!()
        }
        async fn mkdir(&self, _: &str) -> Result<(), String> {
            unimplemented!()
        }
        async fn touch(&self, _: &str) -> Result<(), String> {
            unimplemented!()
        }
        async fn rename(&self, _: &str, _: &str) -> Result<(), String> {
            unimplemented!()
        }
        async fn delete(&self, _: &str) -> Result<(), String> {
            unimplemented!()
        }
        async fn file_size(&self, _: &str) -> u64 {
            unimplemented!()
        }
        async fn read_file(&self, _: &str) -> Result<Vec<u8>, String> {
            unimplemented!()
        }
        async fn write_file(&self, _: &str, _: &str) -> Result<(), String> {
            unimplemented!()
        }
        async fn upload_file(
            &self,
            _: &Recorder,
            _: &str,
            _: &str,
            _: &str,
            _: &CancellationToken,
        ) -> Result<(), String> {
            unimplemented!()
        }
        async fn upload_dir(
            &self,
            _: &Recorder,
            _: &str,
            _: &str,
            _: &str,
            _: &CancellationToken,
        ) -> Result<(), String> {
            unimplemented!()
        }
    }

    #[tokio::test]
    async fn folder_download_skips_and_reports_names_this_system_cannot_hold() {
        let events = Recorder::default();
        let tmp = tempfile::tempdir().unwrap();
        let dst = tmp.path().join("dst");

        TreeBackend
            .download_dir(
                &events,
                "/src",
                &dst.to_string_lossy(),
                "t-dir",
                &CancellationToken::new(),
            )
            .await
            .unwrap();

        assert_downloaded(&dst, events.skipped("t-dir"));
    }

    #[tokio::test]
    async fn batch_download_skips_a_selected_name_this_system_cannot_hold() {
        let events = Recorder::default();
        let tmp = tempfile::tempdir().unwrap();
        let paths = ["/src/ok.txt", "/src/10:30.log", "/src/sub", "/src/.."].map(String::from);

        TreeBackend
            .download_batch(
                &events,
                &paths,
                &tmp.path().to_string_lossy(),
                "t-batch",
                &CancellationToken::new(),
            )
            .await
            .unwrap();

        let expected: &[&str] = if cfg!(windows) {
            &["/src/10:30.log", "/src/.."]
        } else {
            &["/src/.."]
        };
        assert_eq!(events.skipped("t-batch"), expected);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("ok.txt")).unwrap(),
            "ok"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("sub/inner.txt")).unwrap(),
            "inner"
        );
        assert_eq!(tmp.path().join("10:30.log").exists(), !cfg!(windows));
    }

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
