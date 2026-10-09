use crate::error::{AppError, ErrorCode};
use crate::ssh::exec::run_captured;
use russh::client::{Handle, Handler};
use sha2::{Digest, Sha256};
use std::future::Future;
use tokio_util::sync::CancellationToken;

pub(crate) const PART_EXT: &str = ".voltius-part";
pub(crate) const OLD_EXT: &str = ".voltius-old";
const FP_LEN: usize = 16;
const MAX_NAME: usize = 255;

pub(crate) fn fingerprint(src_path: &str, size: u64, mtime: Option<u64>) -> String {
    let mut h = Sha256::new();
    h.update(src_path.as_bytes());
    h.update(size.to_le_bytes());
    h.update(mtime.unwrap_or(0).to_le_bytes());
    h.finalize()[..FP_LEN / 2]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub(crate) fn temp_name(name: &str, fp: &str, ext: &str) -> String {
    let mut cut = name.len().min(MAX_NAME - 2 - fp.len() - ext.len());
    while !name.is_char_boundary(cut) {
        cut -= 1;
    }
    format!(".{}.{fp}{ext}", &name[..cut])
}

pub(crate) fn is_temp_of(entry: &str, name: &str, exts: &[&str]) -> bool {
    exts.iter().any(|ext| {
        entry
            .strip_suffix(ext)
            .and_then(|stem| stem.rsplit_once('.'))
            .is_some_and(|(_, fp)| {
                fp.len() == FP_LEN
                    && fp.bytes().all(|b| b.is_ascii_hexdigit())
                    && temp_name(name, fp, ext) == entry
            })
    })
}

/// Runs a hash command for `path`. Failing to run it is an error only when the
/// link died; a command that ran and printed no hash just means there is none.
pub(crate) async fn remote_hash<H: Handler>(
    handle: &Handle<H>,
    cmd: &str,
    path: &str,
    token: &CancellationToken,
    dead: impl Future<Output = bool>,
) -> Result<Option<String>, AppError> {
    let ran = tokio::select! {
        _ = token.cancelled() => return Ok(None),
        r = run_captured(handle, cmd) => r,
    };
    match ran {
        Ok(out) if out.code == Some(0) => Ok(parse_sha256(&out.stdout_text())),
        Ok(_) => Ok(None),
        Err(e) if dead.await => Err(AppError::coded(
            ErrorCode::ConnectionLost,
            format!("Connection lost while verifying {path}: {e}"),
        )),
        Err(_) => Ok(None),
    }
}

pub(crate) fn parse_sha256(out: &str) -> Option<String> {
    let is_hash = |s: &str| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    out.lines().find_map(|line| {
        let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
        // GNU sha256sum prefixes the line with `\` when it had to escape the path.
        let first = line.split_whitespace().next().unwrap_or("");
        let first = first.strip_prefix('\\').unwrap_or(first);
        let found = [compact.as_str(), first]
            .into_iter()
            .find(|s| is_hash(s))
            .map(str::to_ascii_lowercase);
        found
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fingerprint_follows_path_size_and_mtime() {
        let fp = fingerprint("/v/a.mp4", 10, Some(20));
        assert_eq!(fp.len(), 16);
        assert!(fp
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        assert_eq!(fp, fingerprint("/v/a.mp4", 10, Some(20)));
        assert_ne!(fp, fingerprint("/v/a.mp4", 11, Some(20)));
        assert_ne!(fp, fingerprint("/v/a.mp4", 10, Some(21)));
        assert_ne!(fp, fingerprint("/v/b.mp4", 10, Some(20)));
    }

    #[test]
    fn temp_names_are_hidden_and_tagged() {
        assert_eq!(
            temp_name("a.mp4", "0123456789abcdef", PART_EXT),
            ".a.mp4.0123456789abcdef.voltius-part"
        );
    }

    #[test]
    fn long_names_are_cut_on_a_char_boundary_to_255_bytes() {
        let name = "é".repeat(200);
        let t = temp_name(&name, "0123456789abcdef", OLD_EXT);
        assert!(t.len() <= 255, "{}", t.len());
        assert!(t.ends_with(".0123456789abcdef.voltius-old"));
    }

    #[test]
    fn only_our_own_temp_files_match_a_name() {
        const BOTH: &[&str] = &[PART_EXT, OLD_EXT];
        let fp = "0123456789abcdef";
        assert!(is_temp_of(&temp_name("a.mp4", fp, PART_EXT), "a.mp4", BOTH));
        assert!(is_temp_of(&temp_name("a.mp4", fp, OLD_EXT), "a.mp4", BOTH));
        assert!(!is_temp_of(&temp_name("a.mp4", fp, PART_EXT), "a.mp", BOTH));
        assert!(!is_temp_of(
            ".a.mp4.notahexfingerpr.voltius-part",
            "a.mp4",
            BOTH
        ));
        assert!(!is_temp_of("a.mp4", "a.mp4", BOTH));
        assert!(!is_temp_of(
            &temp_name("a.mp4", fp, OLD_EXT),
            "a.mp4",
            &[PART_EXT]
        ));
    }

    #[test]
    fn sha256_output_parses_in_every_dialect() {
        let h = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        assert_eq!(parse_sha256(&format!("{h}  /x/a b\n")).as_deref(), Some(h));
        // GNU escapes a path holding `\` or a newline and flags the line with a leading `\`.
        for escaped in ["/x/a\\\\b", "/x/a\\nb"] {
            assert_eq!(
                parse_sha256(&format!("\\{h}  {escaped}\n")).as_deref(),
                Some(h)
            );
        }
        assert_eq!(parse_sha256(&h.to_uppercase()).as_deref(), Some(h));
        let certutil = "SHA256 hash of C:\\a:\ne3 b0 c4 42 98 fc 1c 14 9a fb f4 c8 99 6f b9 24 27 ae 41 e4 64 9b 93 4c a4 95 99 1b 78 52 b8 55\nCertUtil: -hashfile command completed successfully.\n";
        assert_eq!(parse_sha256(certutil).as_deref(), Some(h));
        assert_eq!(parse_sha256("sha256sum: x: No such file"), None);
    }
}
