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

/// Uploads a blob to `remote` and downloads it back, restarting `container`
/// during each; the download always resumes, the upload when `upload_resumes`.
pub(crate) async fn round_trip_through_restarts(
    fs: &dyn Endpoint,
    remote: &str,
    container: &str,
    upload_resumes: bool,
) {
    let local = tempfile::tempdir().unwrap();
    let src = local.path().join("blob");
    let made = Command::new("head")
        .args(["-c", &BLOB.to_string(), "/dev/urandom"])
        .stdout(std::fs::File::create(&src).unwrap())
        .status()
        .unwrap();
    assert!(made.success());
    let want = sha256(&src);
    let (rec, token) = (Recorder::default(), CancellationToken::new());

    let src_s = src.to_string_lossy();
    let up = copy_one(&rec, &LocalFs, &src_s, fs, remote, "up", &token);
    let (r, _) = tokio::join!(up, restart_a_third_in(&rec, "up", container));
    r.unwrap();
    assert_eq!(
        rec.count("sftp-resumed-up") > 0,
        upload_resumes,
        "upload resumed"
    );

    let back = local.path().join("back");
    let back_s = back.to_string_lossy();
    let down = copy_one(&rec, fs, remote, &LocalFs, &back_s, "down", &token);
    let (r, _) = tokio::join!(down, restart_a_third_in(&rec, "down", container));
    r.unwrap();
    assert!(rec.count("sftp-resumed-down") > 0, "the download resumed");
    assert_eq!(sha256(&back), want);
    eprintln!("{container}: {BLOB} bytes up and down through two restarts; sha256 {want}");
}
