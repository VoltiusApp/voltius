//! Whether a selection holds a file big enough to send per file (resumable)
//! rather than as one tar stream that a drop would restart.

use super::endpoint::Endpoint;
use super::{visit, Step};
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
    fs: &dyn Endpoint,
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
    large_by_walk(fs, parent, items, min).await
}

/// The probe's answer from directory listings: one round trip per directory,
/// none per file, and none past the first big file. An entry whose listing
/// doesn't vouch for its type and size is stat'ed, and anything unreadable
/// counts as large, since per file is the safe route.
pub(crate) async fn large_by_walk(
    src: &dyn Endpoint,
    parent: &str,
    items: &[String],
    min: u64,
) -> bool {
    let mut pending: Vec<String> = items.iter().map(|i| src.join(parent, i)).collect();
    while let Some(path) = pending.pop() {
        match src.stat(&path).await {
            Ok(Some(s)) if s.is_dir => {
                let mut found = false;
                let walked = visit(src, &path, |_, path, e| match e.stat {
                    Some(s) if e.complete => {
                        found = !s.is_dir && s.size >= min;
                        if found {
                            Step::Stop
                        } else {
                            Step::Go
                        }
                    }
                    _ => {
                        pending.push(path.to_string());
                        Step::Prune
                    }
                })
                .await;
                if found || walked.is_err() {
                    return true;
                }
            }
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
    use crate::commands::sftp::resume::endpoint::tests_support::TestFs;
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

    fn walk_counts(fs: &TestFs) -> (usize, usize) {
        let st = fs.state.lock().unwrap();
        (st.stats, st.lists)
    }

    #[tokio::test]
    async fn the_listing_walk_finds_a_large_file_at_any_depth() {
        let d = tempfile::tempdir().unwrap();
        sparse(d.path(), "v/small", 10);
        sparse(d.path(), "lone", 10);
        let parent = d.path().to_string_lossy().into_owned();
        let items = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        let large = |names| {
            let items = items(names);
            let parent = parent.clone();
            async move { large_by_walk(&TestFs::default(), &parent, &items, 1000).await }
        };
        assert!(!large(&["v", "lone", "missing"]).await);
        sparse(d.path(), "v/deep/er/big", 1000);
        assert!(large(&["v"]).await);
        sparse(d.path(), "huge", 1000);
        assert!(large(&["huge"]).await);
    }

    #[tokio::test]
    async fn the_listing_walk_stats_only_the_selection_and_lists_each_dir_once() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..20 {
            sparse(d.path(), &format!("v/{}/f{i}", i % 4), 10);
        }
        let parent = d.path().to_string_lossy().into_owned();
        let fs = TestFs::default();
        assert!(!large_by_walk(&fs, &parent, &["v".to_string()], 1000).await);
        assert_eq!(walk_counts(&fs), (1, 5));
    }

    #[tokio::test]
    async fn the_listing_walk_stops_at_the_first_large_file() {
        let d = tempfile::tempdir().unwrap();
        sparse(d.path(), "v/big", 1000);
        for i in 0..4 {
            sparse(d.path(), &format!("v/sub{i}/f"), 10);
        }
        let parent = d.path().to_string_lossy().into_owned();
        let fs = TestFs::default();
        assert!(large_by_walk(&fs, &parent, &["v".to_string()], 1000).await);
        assert_eq!(walk_counts(&fs), (1, 1));
    }

    #[tokio::test]
    async fn a_listing_without_attributes_is_stated_entry_by_entry() {
        let d = tempfile::tempdir().unwrap();
        sparse(d.path(), "v/sub/small", 10);
        let parent = d.path().to_string_lossy().into_owned();
        let items = ["v".to_string()];
        let bare = || TestFs {
            bare_listing: true,
            ..Default::default()
        };
        assert!(!large_by_walk(&bare(), &parent, &items, 1000).await);
        sparse(d.path(), "v/sub/big", 1000);
        let fs = bare();
        assert!(large_by_walk(&fs, &parent, &items, 1000).await);
        assert!(walk_counts(&fs).0 > 1);
    }
}
