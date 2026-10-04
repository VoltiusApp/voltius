use crate::sftp::backend::is_plain_name;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub struct Counted<T> {
    inner: T,
    done: Arc<AtomicU64>,
}

impl<T> Counted<T> {
    pub fn new(inner: T, done: Arc<AtomicU64>) -> Self {
        Self { inner, done }
    }

    pub fn into_inner(self) -> T {
        self.inner
    }
}

impl<W: Write> Write for Counted<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.done.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.done.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

fn meta(path: &Path, deref: bool) -> io::Result<std::fs::Metadata> {
    if deref {
        std::fs::metadata(path)
    } else {
        std::fs::symlink_metadata(path)
    }
}

pub fn pack<W: Write>(
    out: W,
    parent: &Path,
    names: &[String],
    deref: bool,
    done: Arc<AtomicU64>,
) -> io::Result<()> {
    let mut tar = tar::Builder::new(Counted::new(
        GzEncoder::new(out, Compression::default()),
        done,
    ));
    tar.follow_symlinks(deref);
    for name in names {
        let path = parent.join(name);
        if meta(&path, deref)?.is_dir() {
            tar.append_dir_all(name, &path)?;
        } else {
            tar.append_path_with_name(&path, name)?;
        }
    }
    let mut out = tar.into_inner()?.into_inner().finish()?;
    out.flush()
}

pub fn pack_bytes(name: &str, data: &[u8]) -> io::Result<Vec<u8>> {
    let mut tar = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
    let mut header = tar::Header::new_gnu();
    header.set_size(data.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar.append_data(&mut header, name, data)?;
    tar.into_inner()?.finish()
}

pub fn walk_size(parent: &Path, names: &[String], deref: bool) -> u64 {
    fn size(path: &Path, deref: bool) -> u64 {
        match meta(path, deref) {
            Ok(m) if m.is_dir() => std::fs::read_dir(path)
                .map(|rd| rd.flatten().map(|e| size(&e.path(), deref)).sum())
                .unwrap_or(0),
            Ok(m) if m.is_file() => m.len(),
            _ => 0,
        }
    }
    names.iter().map(|n| size(&parent.join(n), deref)).sum()
}

pub enum Sink<'a> {
    Dir(&'a Path),
    Count,
}

/// `raw` as a path under the destination, or `None` when any component is not a plain name here.
fn safe_relative(raw: &str, strip: bool) -> Option<PathBuf> {
    let mut parts = raw.split('/').filter(|p| !p.is_empty() && *p != ".");
    if strip {
        parts.next();
    }
    let mut rel = PathBuf::new();
    for part in parts {
        if !is_plain_name(part, cfg!(windows)) {
            return None;
        }
        rel.push(part);
    }
    Some(rel)
}

fn truncated(e: io::Error) -> io::Error {
    if e.kind() == io::ErrorKind::UnexpectedEof {
        io::Error::new(e.kind(), "archive truncated")
    } else {
        e
    }
}

pub fn unpack<R: Read>(
    input: R,
    sink: Sink<'_>,
    strip: bool,
    done: Arc<AtomicU64>,
) -> io::Result<Vec<String>> {
    let mut archive = tar::Archive::new(Counted::new(GzDecoder::new(input), done));
    archive.set_preserve_permissions(cfg!(unix));
    archive.set_preserve_mtime(true);
    archive.set_overwrite(true);
    let root = match sink {
        Sink::Dir(dir) => {
            std::fs::create_dir_all(dir)?;
            Some(dir.canonicalize()?)
        }
        Sink::Count => None,
    };
    let mut skipped: Vec<String> = Vec::new();
    for entry in archive.entries().map_err(truncated)? {
        let mut entry = entry.map_err(truncated)?;
        let Some(root) = &root else {
            io::copy(&mut entry, &mut io::sink()).map_err(truncated)?;
            continue;
        };
        let raw = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
        if skipped.iter().any(|s| raw.starts_with(&format!("{s}/"))) {
            continue;
        }
        let Some(rel) = safe_relative(&raw, strip) else {
            skipped.push(raw.trim_end_matches('/').to_string());
            continue;
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let kind = entry.header().entry_type();
        if kind.is_symlink() && cfg!(windows) {
            skipped.push(raw);
            continue;
        }
        let target = root.join(&rel);
        let parent = target.parent().unwrap_or(root);
        std::fs::create_dir_all(parent)?;
        if !parent.canonicalize()?.starts_with(root) {
            skipped.push(raw);
            continue;
        }
        if kind.is_hard_link() {
            let link = entry
                .link_name_bytes()
                .map(|b| String::from_utf8_lossy(&b).into_owned());
            match link.as_deref().and_then(|l| safe_relative(l, strip)) {
                Some(src) if !src.as_os_str().is_empty() => {
                    let src = root.join(src);
                    let _ = std::fs::remove_file(&target);
                    if std::fs::hard_link(&src, &target).is_err() {
                        std::fs::copy(&src, &target)?;
                    }
                }
                _ => skipped.push(raw),
            }
            continue;
        }
        entry.unpack(&target).map_err(truncated)?;
    }
    io::copy(&mut archive.into_inner(), &mut io::sink()).map_err(truncated)?;
    Ok(skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;

    fn counter() -> Arc<AtomicU64> {
        Arc::new(AtomicU64::new(0))
    }

    fn archive(parent: &Path, names: &[&str], deref: bool) -> Vec<u8> {
        let names: Vec<String> = names.iter().map(|s| s.to_string()).collect();
        let mut buf = Vec::new();
        pack(&mut buf, parent, &names, deref, counter()).unwrap();
        buf
    }

    fn raw_archive(entries: &[(&str, tar::EntryType, &str, &[u8])]) -> Vec<u8> {
        let mut tar = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
        for (name, kind, link, data) in entries {
            let mut h = tar::Header::new_gnu();
            h.as_gnu_mut().unwrap().name[..name.len()].copy_from_slice(name.as_bytes());
            h.as_gnu_mut().unwrap().linkname[..link.len()].copy_from_slice(link.as_bytes());
            h.set_entry_type(*kind);
            h.set_size(data.len() as u64);
            h.set_mode(0o644);
            h.set_cksum();
            tar.append(&h, *data).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn round_trips_files_dirs_and_awkward_names() {
        let (src, dst) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let top = src.path().join("top");
        let deep = top
            .join("d".repeat(60))
            .join("é ü 漢字 space")
            .join("x".repeat(60));
        fs::create_dir_all(&deep).unwrap();
        fs::create_dir_all(top.join("empty")).unwrap();
        fs::write(top.join("a.txt"), b"alpha").unwrap();
        fs::write(top.join("--version"), b"v").unwrap();
        fs::write(deep.join("naïve file.txt"), b"deep").unwrap();

        let skipped = unpack(
            &archive(src.path(), &["top"], false)[..],
            Sink::Dir(dst.path()),
            false,
            counter(),
        )
        .unwrap();

        assert!(skipped.is_empty());
        let out = dst.path().join("top");
        assert_eq!(fs::read(out.join("a.txt")).unwrap(), b"alpha");
        assert_eq!(fs::read(out.join("--version")).unwrap(), b"v");
        assert!(out.join("empty").is_dir());
        let deep_out = out
            .join("d".repeat(60))
            .join("é ü 漢字 space")
            .join("x".repeat(60));
        assert_eq!(fs::read(deep_out.join("naïve file.txt")).unwrap(), b"deep");
    }

    #[test]
    fn strip_lands_the_directory_contents_in_the_destination() {
        let (src, dst) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::create_dir_all(src.path().join("top/sub")).unwrap();
        fs::write(src.path().join("top/sub/b"), b"b").unwrap();
        unpack(
            &archive(src.path(), &["top"], false)[..],
            Sink::Dir(dst.path()),
            true,
            counter(),
        )
        .unwrap();
        assert_eq!(fs::read(dst.path().join("sub/b")).unwrap(), b"b");
        assert!(!dst.path().join("top").exists());
    }

    #[test]
    fn extracting_into_a_populated_folder_overwrites_and_keeps() {
        let (src, dst) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::write(src.path().join("a.txt"), b"new").unwrap();
        fs::write(dst.path().join("a.txt"), b"old").unwrap();
        fs::write(dst.path().join("keep.txt"), b"keep").unwrap();
        unpack(
            &archive(src.path(), &["a.txt"], false)[..],
            Sink::Dir(dst.path()),
            false,
            counter(),
        )
        .unwrap();
        assert_eq!(fs::read(dst.path().join("a.txt")).unwrap(), b"new");
        assert_eq!(fs::read(dst.path().join("keep.txt")).unwrap(), b"keep");
    }

    #[cfg(unix)]
    #[test]
    fn mode_bits_survive() {
        use std::os::unix::fs::PermissionsExt;
        let (src, dst) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let f = src.path().join("run.sh");
        fs::write(&f, b"#!/bin/sh").unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o750)).unwrap();
        unpack(
            &archive(src.path(), &["run.sh"], false)[..],
            Sink::Dir(dst.path()),
            false,
            counter(),
        )
        .unwrap();
        let mode = fs::metadata(dst.path().join("run.sh"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o750);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_kept_unless_dereferenced() {
        let (src, kept, deref) = (
            tempfile::tempdir().unwrap(),
            tempfile::tempdir().unwrap(),
            tempfile::tempdir().unwrap(),
        );
        fs::create_dir(src.path().join("top")).unwrap();
        fs::write(src.path().join("top/target"), b"t").unwrap();
        std::os::unix::fs::symlink("target", src.path().join("top/link")).unwrap();
        unpack(
            &archive(src.path(), &["top"], false)[..],
            Sink::Dir(kept.path()),
            false,
            counter(),
        )
        .unwrap();
        unpack(
            &archive(src.path(), &["top"], true)[..],
            Sink::Dir(deref.path()),
            false,
            counter(),
        )
        .unwrap();
        assert!(fs::symlink_metadata(kept.path().join("top/link"))
            .unwrap()
            .is_symlink());
        let followed = deref.path().join("top/link");
        assert!(!fs::symlink_metadata(&followed).unwrap().is_symlink());
        assert_eq!(fs::read(followed).unwrap(), b"t");
    }

    #[test]
    fn unsafe_names_are_skipped_reported_and_never_written() {
        let dst = tempfile::tempdir().unwrap();
        let inner = dst.path().join("inner");
        let mut entries: Vec<(&str, tar::EntryType, &str, &[u8])> = vec![
            ("ok.txt", tar::EntryType::Regular, "", b"ok"),
            ("../x", tar::EntryType::Regular, "", b"x"),
            ("a/../../y", tar::EntryType::Regular, "", b"y"),
        ];
        if cfg!(windows) {
            entries.push(("b:c", tar::EntryType::Regular, "", b"c"));
        }
        let skipped = unpack(
            &raw_archive(&entries)[..],
            Sink::Dir(&inner),
            false,
            counter(),
        )
        .unwrap();
        assert_eq!(fs::read(inner.join("ok.txt")).unwrap(), b"ok");
        assert!(!dst.path().join("x").exists());
        assert!(!dst.path().join("y").exists());
        let mut want = vec!["../x".to_string(), "a/../../y".to_string()];
        if cfg!(windows) {
            want.push("b:c".into());
        }
        assert_eq!(skipped, want);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_behind_a_planted_symlink_never_leaves_the_destination() {
        let (dst, outside) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let outside_path = outside.path().to_str().unwrap();
        let entries: Vec<(&str, tar::EntryType, &str, &[u8])> = vec![
            ("evil", tar::EntryType::Symlink, outside_path, b""),
            ("evil/x", tar::EntryType::Regular, "", b"pwned"),
        ];
        let skipped = unpack(
            &raw_archive(&entries)[..],
            Sink::Dir(dst.path()),
            false,
            counter(),
        )
        .unwrap();
        assert!(!outside.path().join("x").exists());
        assert_eq!(skipped, ["evil/x"]);
    }

    #[test]
    fn a_cut_stream_fails() {
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("big"), vec![7u8; 200_000]).unwrap();
        let whole = archive(src.path(), &["big"], false);
        let half = &whole[..whole.len() / 2];
        let dst = tempfile::tempdir().unwrap();
        assert!(unpack(half, Sink::Dir(dst.path()), false, counter()).is_err());
        let no_trailer = &whole[..whole.len() - 4];
        let err = unpack(no_trailer, Sink::Count, false, counter()).unwrap_err();
        assert!(err.to_string().contains("truncated"), "{err}");
    }

    #[test]
    fn counting_reads_the_same_bytes_without_writing() {
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("f"), vec![1u8; 50_000]).unwrap();
        let buf = archive(src.path(), &["f"], false);
        let (written, counted) = (counter(), counter());
        let dst = tempfile::tempdir().unwrap();
        unpack(&buf[..], Sink::Dir(dst.path()), false, written.clone()).unwrap();
        unpack(&buf[..], Sink::Count, false, counted.clone()).unwrap();
        assert_eq!(
            written.load(Ordering::Relaxed),
            counted.load(Ordering::Relaxed)
        );
        assert!(counted.load(Ordering::Relaxed) >= 50_000);
    }

    #[test]
    fn walk_size_sums_file_bytes() {
        let src = tempfile::tempdir().unwrap();
        fs::create_dir_all(src.path().join("top/sub")).unwrap();
        fs::write(src.path().join("top/a"), vec![0u8; 10]).unwrap();
        fs::write(src.path().join("top/sub/b"), vec![0u8; 32]).unwrap();
        fs::write(src.path().join("c"), vec![0u8; 5]).unwrap();
        assert_eq!(
            walk_size(src.path(), &["top".into(), "c".into()], false),
            47
        );
    }

    #[test]
    fn pack_bytes_makes_a_one_file_archive() {
        let dst = tempfile::tempdir().unwrap();
        let buf = pack_bytes("probe.bin", b"\n\r\n\x1a\x00\xff").unwrap();
        unpack(&buf[..], Sink::Dir(dst.path()), false, counter()).unwrap();
        assert_eq!(
            fs::read(dst.path().join("probe.bin")).unwrap(),
            b"\n\r\n\x1a\x00\xff"
        );
    }
}
