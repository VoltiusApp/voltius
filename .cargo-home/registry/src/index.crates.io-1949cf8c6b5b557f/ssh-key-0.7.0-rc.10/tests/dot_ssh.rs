//! Tests for `~/.ssh` support. Uses the `tests/examples` directory instead.

#![cfg(feature = "std")]

use hex_literal::hex;
use ssh_key::{Algorithm, DotSsh, Fingerprint};

/// Open `.ssh` using the `test/examples`.
fn dot_ssh() -> DotSsh {
    DotSsh::open("tests/examples")
}

#[test]
fn path_round_trip() {
    let dot_ssh = dot_ssh();
    dbg!(dot_ssh.path());
    assert!(dot_ssh.path().ends_with("tests/examples"));
}

#[test]
fn private_keys() {
    let dot_ssh = dot_ssh();
    assert_eq!(dot_ssh.private_keys().unwrap().count(), 22);
}

#[test]
fn private_key_with_fingerprint() {
    let fingerprint = Fingerprint::Sha256(hex!(
        "5025222ebecf8ecf7014524c0c1c8b81cdcdaed754df8e0e814338e7064f7084"
    ));

    let dot_ssh = dot_ssh();
    let key = dot_ssh.private_key_with_fingerprint(fingerprint).unwrap();
    assert_eq!(key.algorithm(), Algorithm::Ed25519);
}

#[test]
fn public_keys() {
    let dot_ssh = dot_ssh();
    assert_eq!(dot_ssh.public_keys().unwrap().count(), 12);
}

#[test]
fn public_key_with_fingerprint() {
    let fingerprint = Fingerprint::Sha256(hex!(
        "5025222ebecf8ecf7014524c0c1c8b81cdcdaed754df8e0e814338e7064f7084"
    ));

    let dot_ssh = dot_ssh();
    let key = dot_ssh.public_key_with_fingerprint(fingerprint).unwrap();
    assert_eq!(key.algorithm(), Algorithm::Ed25519);
}
