//! Whether a selection holds a file big enough to send per file (resumable)
//! rather than as one tar stream that a drop would restart.

use super::endpoint::Endpoint;
use super::sftp_fs::SftpFs;
use crate::commands::sftp::remote_shell::{answer, RemoteShell};
use crate::commands::sftp::TarHost;
use crate::ssh::exec::run_captured;
use russh::client::{Handle, Handler};
use std::path::PathBuf;

pub(crate) async fn has_large_local(paths: &[String], min: u64) -> bool {
    let paths = paths.to_vec();
    tokio::task::spawn_blocking(move || {
        let mut stack: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        while let Some(p) = stack.pop() {
            let Ok(m) = std::fs::metadata(&p) else {
                continue;
            };
            if m.is_dir() {
                if let Ok(rd) = std::fs::read_dir(&p) {
                    stack.extend(rd.flatten().map(|e| e.path()));
                }
            } else if m.len() >= min {
                return true;
            }
        }
        false
    })
    .await
    .unwrap_or(true)
}

/// None when the host could not tell (no probe for its shell, or no answer).
pub(crate) async fn large_by_exec<H: Handler>(
    handle: &Handle<H>,
    wrap: impl Fn(&str) -> String,
    shell: &RemoteShell,
    parent: &str,
    items: &[String],
    min: u64,
) -> Option<bool> {
    let cmd = wrap(&shell.large_file_probe(parent, items, min)?);
    let out = answer(run_captured(handle, &cmd)).await.ok()?;
    (out.code == Some(0)).then(|| !out.stdout_text().trim().is_empty())
}

pub(crate) async fn has_large_remote(
    host: &TarHost,
    fs: &SftpFs,
    parent: &str,
    items: &[String],
    min: u64,
) -> bool {
    let ssh = host.ssh();
    if let Some(found) =
        large_by_exec(&ssh, |c| host.wrap(c), &host.shell, parent, items, min).await
    {
        return found;
    }
    let mut stack: Vec<String> = items.iter().map(|i| fs.join(parent, i)).collect();
    while let Some(p) = stack.pop() {
        match fs.stat(&p).await {
            Ok(Some(s)) if s.is_dir => match fs.list(&p).await {
                Ok(entries) => stack.extend(
                    entries
                        .into_iter()
                        .filter(|e| !e.is_symlink)
                        .map(|e| fs.join(&p, &e.name)),
                ),
                Err(_) => return true,
            },
            Ok(Some(s)) if s.size >= min => return true,
            Ok(_) => {}
            Err(_) => return true,
        }
    }
    false
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::commands::sftp::remote_shell::RemoteShell;
    use crate::ssh::test_proc_server::{proc_server, ProcOptions};

    fn sparse(dir: &std::path::Path, rel: &str, len: u64) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::File::create(&p).unwrap().set_len(len).unwrap();
    }

    #[tokio::test]
    async fn a_local_tree_is_large_when_any_file_reaches_the_threshold() {
        let d = tempfile::tempdir().unwrap();
        sparse(d.path(), "small/a", 10);
        let root = vec![d.path().to_string_lossy().into_owned()];
        assert!(!has_large_local(&root, 1000).await);
        sparse(d.path(), "deep/er/b", 1000);
        assert!(has_large_local(&root, 1000).await);
    }

    #[tokio::test]
    async fn the_posix_exec_probe_finds_a_large_file() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let d = tempfile::tempdir().unwrap();
        sparse(d.path(), "v/small", 10);
        let parent = d.path().to_string_lossy().into_owned();
        let items = vec!["v".to_string()];
        let posix = RemoteShell::Posix;
        let probe = |h| large_by_exec(h, |c: &str| c.to_string(), &posix, &parent, &items, 1000);
        assert_eq!(probe(&handle).await, Some(false));
        sparse(d.path(), "v/deep/big", 1000);
        assert_eq!(probe(&handle).await, Some(true));
    }
}
