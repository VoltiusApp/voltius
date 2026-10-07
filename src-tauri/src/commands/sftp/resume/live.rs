//! Live checks against real servers in docker: a transfer whose server is
//! restarted a third of the way in still lands byte-identical.

use super::copy_one;
use super::endpoint::{Endpoint, LocalFs};
use crate::sftp::backend::test_tree::Recorder;
use crate::ssh::test_docker::docker;
use std::process::Command;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub(crate) const BLOB: u64 = 200_000_000;

fn sha256(path: &std::path::Path) -> String {
    let out = Command::new("sha256sum").arg(path).output().unwrap();
    assert!(out.status.success());
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

async fn restart_a_third_in(rec: &Recorder, tid: &str, container: &str) {
    while transferred(rec, tid) < BLOB / 3 {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    docker(&["restart", "-t", "0", container]);
}

/// A fresh random blob at `path`, and its sha256.
fn random_blob(path: &std::path::Path) -> String {
    let made = Command::new("head")
        .args(["-c", &BLOB.to_string(), "/dev/urandom"])
        .stdout(std::fs::File::create(path).unwrap())
        .status()
        .unwrap();
    assert!(made.success());
    sha256(path)
}

/// Copies under transfer id `tid`, restarting `container` a third of the way in; whether it resumed.
async fn copy_through_restart(
    rec: &Recorder,
    (from_fs, from): (&dyn Endpoint, &str),
    (to_fs, to): (&dyn Endpoint, &str),
    tid: &str,
    container: &str,
) -> bool {
    let token = CancellationToken::new();
    let copy = copy_one(rec, from_fs, from, to_fs, to, tid, &token);
    let (r, _) = tokio::join!(copy, restart_a_third_in(rec, tid, container));
    r.unwrap();
    rec.count(&format!("sftp-resumed-{tid}")) > 0
}

/// Uploads a blob to `remote`, overwrites it with another and downloads that back,
/// restarting `container` during each; the download always resumes, uploads when `upload_resumes`.
pub(crate) async fn round_trip_through_restarts(
    fs: &dyn Endpoint,
    remote: &str,
    container: &str,
    upload_resumes: bool,
) {
    let local = tempfile::tempdir().unwrap();
    let src = local.path().join("blob");
    let src_s = src.to_string_lossy().into_owned();
    let rec = Recorder::default();

    random_blob(&src);
    let up = copy_through_restart(&rec, (&LocalFs, &src_s), (fs, remote), "up", container);
    assert_eq!(up.await, upload_resumes, "upload resumed");

    let want = random_blob(&src);
    let over = copy_through_restart(&rec, (&LocalFs, &src_s), (fs, remote), "over", container);
    assert_eq!(over.await, upload_resumes, "overwrite resumed");

    let back = local.path().join("back");
    let back_s = back.to_string_lossy().into_owned();
    let down = copy_through_restart(&rec, (fs, remote), (&LocalFs, &back_s), "down", container);
    assert!(down.await, "the download resumed");
    assert_eq!(sha256(&back), want);
    eprintln!("{container}: {BLOB} bytes up, over and down through three restarts; sha256 {want}");
}
