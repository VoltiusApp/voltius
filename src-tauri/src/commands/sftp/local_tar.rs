use crate::sftp::backend::is_plain_name;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

struct Poisonable<W> {
    inner: W,
    poisoned: Arc<AtomicBool>,
}

impl<W> Poisonable<W> {
    fn check(&self) -> io::Result<()> {
        if self.poisoned.load(Ordering::Relaxed) {
            Err(io::Error::other("archive abandoned"))
        } else {
            Ok(())
        }
    }
}

impl<W: Write> Write for Poisonable<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.check()?;
        self.inner.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.check()?;
        self.inner.flush()
    }
}

#[derive(Clone, Copy)]
enum Kind {
    Dir,
    File(u64),
    Link,
}

const BLOCK: u64 = 512;

impl Kind {
    fn stream_len(self) -> u64 {
        match self {
            Kind::File(len) => BLOCK + len.next_multiple_of(BLOCK),
            Kind::Dir | Kind::Link => BLOCK,
        }
    }
}

/// `None` for what tar cannot carry here: sockets, FIFOs, devices, and under `deref`
/// links that lead nowhere.
fn kind_of(path: &Path, deref: bool) -> io::Result<Option<Kind>> {
    let stat = if deref {
        std::fs::metadata(path)
    } else {
        std::fs::symlink_metadata(path)
    };
    let meta = match stat {
        Ok(m) => m,
        Err(_) if deref && std::fs::symlink_metadata(path).is_ok_and(|m| m.is_symlink()) => {
            return Ok(None)
        }
        Err(e) => return Err(e),
    };
    let t = meta.file_type();
    Ok(if t.is_dir() {
        Some(Kind::Dir)
    } else if t.is_file() {
        Some(Kind::File(meta.len()))
    } else if t.is_symlink() {
        Some(Kind::Link)
    } else {
        None
    })
}

struct Walk<'a> {
    deref: bool,
    ancestors: Vec<PathBuf>,
    skipped: Vec<String>,
    visit: &'a mut dyn FnMut(&Path, &Path, Kind) -> io::Result<()>,
}

impl Walk<'_> {
    fn enter(&mut self, path: &Path, name: &Path) -> io::Result<()> {
        let kind = kind_of(path, self.deref)?;
        let real = match kind {
            Some(Kind::Dir) if self.deref => Some(path.canonicalize()?),
            _ => None,
        };
        let looped = real.as_ref().is_some_and(|r| self.ancestors.contains(r));
        let Some(kind) = kind.filter(|_| !looped) else {
            self.skipped.push(name.to_string_lossy().into_owned());
            return Ok(());
        };
        if !name.as_os_str().is_empty() {
            (self.visit)(path, name, kind)?;
        }
        if !matches!(kind, Kind::Dir) {
            return Ok(());
        }
        let mut children = std::fs::read_dir(path)?
            .map(|e| e.map(|e| e.file_name()))
            .collect::<io::Result<Vec<_>>>()?;
        children.sort();
        let depth = self.ancestors.len();
        self.ancestors.extend(real);
        for child in children {
            self.enter(&path.join(&child), &name.join(&child))?;
        }
        self.ancestors.truncate(depth);
        Ok(())
    }
}

fn walk(
    parent: &Path,
    names: &[String],
    deref: bool,
    visit: &mut dyn FnMut(&Path, &Path, Kind) -> io::Result<()>,
) -> io::Result<Vec<String>> {
    let mut walk = Walk {
        deref,
        ancestors: Vec::new(),
        skipped: Vec::new(),
        visit,
    };
    for name in names {
        walk.enter(&parent.join(name), Path::new(name))?;
    }
    Ok(walk.skipped)
}

pub fn pack<W: Write>(
    out: W,
    parent: &Path,
    names: &[String],
    deref: bool,
    done: Arc<AtomicU64>,
) -> io::Result<Vec<String>> {
    let poisoned = Arc::new(AtomicBool::new(false));
    let out = Poisonable {
        inner: out,
        poisoned: poisoned.clone(),
    };
    let mut tar = tar::Builder::new(Counted::new(
        GzEncoder::new(out, Compression::default()),
        done,
    ));
    tar.follow_symlinks(deref);
    // busybox tar cannot read GNU sparse entries.
    tar.sparse(false);
    let walked = walk(parent, names, deref, &mut |path, name, kind| match kind {
        Kind::Dir => tar.append_dir(name, path),
        Kind::File(_) | Kind::Link => tar.append_path_with_name(path, name),
    });
    let skipped = match walked {
        Ok(skipped) => skipped,
        Err(e) => {
            // Builder and GzEncoder finish the archive when dropped; poison first.
            poisoned.store(true, Ordering::Relaxed);
            return Err(e);
        }
    };
    let mut out = tar.into_inner()?.into_inner().finish()?;
    out.flush()?;
    Ok(skipped)
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

/// The length of the tar stream `pack` writes for the same items, before compression.
pub fn walk_size(parent: &Path, names: &[String], deref: bool) -> u64 {
    let mut total = 2 * BLOCK;
    let _ = walk(parent, names, deref, &mut |_, _, kind| {
        total += kind.stream_len();
        Ok(())
    });
    total
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

struct Input<R> {
    inner: R,
    ended: bool,
    failed: bool,
}

impl<R: Read> Read for Input<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buf);
        match &read {
            Ok(0) if !buf.is_empty() => self.ended = true,
            Err(e) if e.kind() != io::ErrorKind::Interrupted => self.failed = true,
            _ => {}
        }
        read
    }
}

/// True when `unpack` failed because the stream it was given was cut short or unreadable.
pub fn is_broken_stream(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::UnexpectedEof
}

fn broken(e: io::Error) -> io::Error {
    let message = if e.kind() == io::ErrorKind::UnexpectedEof {
        "archive truncated".to_string()
    } else {
        format!("archive unreadable: {e}")
    };
    io::Error::new(io::ErrorKind::UnexpectedEof, message)
}

fn skip(skipped: &mut Vec<String>, raw: &str) {
    skipped.push(raw.trim_end_matches('/').to_string());
}

/// True when every existing ancestor of `rel` under `root` is a real directory; missing ones are created if `create`.
fn confined_parent(root: &Path, rel: &Path, create: bool) -> io::Result<bool> {
    let mut cur = root.to_path_buf();
    for part in rel.parent().into_iter().flat_map(|p| p.components()) {
        cur.push(part);
        match std::fs::symlink_metadata(&cur) {
            Ok(m) if m.is_dir() => {}
            Ok(_) => return Ok(false),
            Err(e) if e.kind() == io::ErrorKind::NotFound && create => std::fs::create_dir(&cur)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e),
        }
    }
    Ok(true)
}

const SPECIAL_MODE_BITS: u32 = 0o7000;

pub fn unpack<R: Read>(
    input: R,
    sink: Sink<'_>,
    strip: bool,
    done: Arc<AtomicU64>,
) -> io::Result<Vec<String>> {
    let mut archive = tar::Archive::new(Input {
        inner: Counted::new(GzDecoder::new(input), done),
        ended: false,
        failed: false,
    });
    archive.set_preserve_permissions(cfg!(unix));
    archive.set_mask(SPECIAL_MODE_BITS);
    archive.set_preserve_mtime(true);
    archive.set_overwrite(true);
    let extracted = extract(&mut archive, sink, strip);
    let mut input = archive.into_inner();
    let checked = extracted.and_then(|skipped| {
        // tar takes a clean end of stream at a header boundary for the end of the archive.
        if input.ended {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        io::copy(&mut input, &mut io::sink())?;
        Ok(skipped)
    });
    checked.map_err(|e| {
        if input.ended || input.failed || e.kind() == io::ErrorKind::UnexpectedEof {
            broken(e)
        } else {
            e
        }
    })
}

/// The name to report for an entry this side cannot extract faithfully.
fn unsupported<R: Read>(entry: &mut tar::Entry<'_, R>, raw: &str) -> io::Result<Option<String>> {
    let kind = entry.header().entry_type();
    if kind.is_fifo()
        || kind.is_character_special()
        || kind.is_block_special()
        || (kind.is_symlink() && cfg!(windows))
    {
        return Ok(Some(raw.to_string()));
    }
    let Some(extensions) = entry.pax_extensions()? else {
        return Ok(None);
    };
    let mut sparse = None;
    for ext in extensions {
        let ext = ext?;
        match ext.key() {
            Ok("GNU.sparse.name") => sparse = Some(ext.value().unwrap_or(raw).to_string()),
            Ok(key) if key.starts_with("GNU.sparse.") => {
                sparse.get_or_insert_with(|| raw.to_string());
            }
            _ => {}
        }
    }
    Ok(sparse)
}

fn extract<R: Read>(
    archive: &mut tar::Archive<R>,
    sink: Sink<'_>,
    strip: bool,
) -> io::Result<Vec<String>> {
    let root = match sink {
        Sink::Dir(dir) => {
            std::fs::create_dir_all(dir)?;
            Some(dir.canonicalize()?)
        }
        Sink::Count => None,
    };
    let mut skipped: Vec<String> = Vec::new();
    let mut dirs = Vec::new();
    for entry in archive.entries()? {
        let mut entry = entry?;
        let Some(root) = &root else {
            io::copy(&mut entry, &mut io::sink())?;
            continue;
        };
        let raw = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
        if skipped.iter().any(|s| raw.starts_with(&format!("{s}/"))) {
            continue;
        }
        let Some(rel) = safe_relative(&raw, strip) else {
            skip(&mut skipped, &raw);
            continue;
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        if let Some(name) = unsupported(&mut entry, &raw)? {
            skip(&mut skipped, &name);
            continue;
        }
        let kind = entry.header().entry_type();
        let target = root.join(&rel);
        if !confined_parent(root, &rel, true)? {
            skip(&mut skipped, &raw);
            continue;
        }
        if kind.is_dir() {
            match std::fs::symlink_metadata(&target) {
                Ok(m) if m.is_dir() => {}
                Ok(_) => {
                    skip(&mut skipped, &raw);
                    continue;
                }
                Err(_) => std::fs::create_dir(&target)?,
            }
            dirs.push((target, entry));
            continue;
        }
        if kind.is_hard_link() {
            let src = entry
                .link_name_bytes()
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .and_then(|l| safe_relative(&l, strip))
                .filter(|r| !r.as_os_str().is_empty())
                .map(|r| (root.join(&r), r));
            let linked = match src {
                Some((src, r))
                    if confined_parent(root, &r, false)?
                        && std::fs::symlink_metadata(&src).is_ok_and(|m| m.is_file()) =>
                {
                    let _ = std::fs::remove_file(&target);
                    std::fs::hard_link(&src, &target).is_ok()
                        || std::fs::copy(&src, &target).is_ok()
                }
                _ => false,
            };
            if !linked {
                skip(&mut skipped, &raw);
            }
            continue;
        }
        entry.unpack(&target)?;
    }
    dirs.sort_by(|a, b| b.0.cmp(&a.0));
    for (target, mut entry) in dirs {
        if std::fs::symlink_metadata(&target).is_ok_and(|m| m.is_dir()) {
            entry.unpack(&target)?;
        }
    }
    Ok(skipped)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;

    fn counter() -> Arc<AtomicU64> {
        Arc::new(AtomicU64::new(0))
    }

    /// `a` holds `first`, then `b` cannot be read; `None` when this process can read it anyway, as root can.
    #[cfg(unix)]
    pub(crate) fn then_unreadable(first: &[u8]) -> Option<tempfile::TempDir> {
        use std::os::unix::fs::PermissionsExt;
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("a"), first).unwrap();
        let secret = src.path().join("b");
        fs::write(&secret, b"secret").unwrap();
        fs::set_permissions(&secret, fs::Permissions::from_mode(0o000)).unwrap();
        fs::File::open(&secret).is_err().then_some(src)
    }

    fn archive(parent: &Path, names: &[&str], deref: bool) -> Vec<u8> {
        let names: Vec<String> = names.iter().map(|s| s.to_string()).collect();
        let mut buf = Vec::new();
        pack(&mut buf, parent, &names, deref, counter()).unwrap();
        buf
    }

    type RawEntry<'a> = (&'a str, tar::EntryType, &'a str, &'a [u8]);

    fn header(name: &str, kind: tar::EntryType, link: &str, mode: u32, len: usize) -> tar::Header {
        let mut h = tar::Header::new_gnu();
        h.as_gnu_mut().unwrap().name[..name.len()].copy_from_slice(name.as_bytes());
        h.as_gnu_mut().unwrap().linkname[..link.len()].copy_from_slice(link.as_bytes());
        h.set_entry_type(kind);
        h.set_size(len as u64);
        h.set_mode(mode);
        h.set_cksum();
        h
    }

    fn tar_of(entries: &[(tar::Header, &[u8])]) -> Vec<u8> {
        let mut tar = tar::Builder::new(Vec::new());
        for (h, data) in entries {
            tar.append(h, *data).unwrap();
        }
        tar.into_inner().unwrap()
    }

    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(data).unwrap();
        gz.finish().unwrap()
    }

    fn raw_archive(entries: &[RawEntry]) -> Vec<u8> {
        let entries: Vec<_> = entries
            .iter()
            .map(|(name, kind, link, data)| (header(name, *kind, link, 0o644, data.len()), *data))
            .collect();
        gzip(&tar_of(&entries))
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
        let mut entries: Vec<RawEntry> = vec![
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
        let entries: Vec<RawEntry> = vec![
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
    fn walk_size_matches_the_tar_stream_pack_writes() {
        let src = tempfile::tempdir().unwrap();
        fs::create_dir_all(src.path().join("top/sub")).unwrap();
        fs::create_dir_all(src.path().join("top/empty")).unwrap();
        fs::write(src.path().join("top/a"), vec![0u8; 10]).unwrap();
        fs::write(src.path().join("top/sub/b"), vec![0u8; 1024]).unwrap();
        fs::write(src.path().join("c"), vec![0u8; 513]).unwrap();
        let names = ["top".to_string(), "c".to_string()];
        let done = counter();
        pack(&mut Vec::new(), src.path(), &names, false, done.clone()).unwrap();
        let size = walk_size(src.path(), &names, false);
        assert_eq!(
            size,
            3 * 512 + (512 + 512) + (512 + 1024) + (512 + 1024) + 1024
        );
        assert_eq!(size, done.load(Ordering::Relaxed));
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

    #[cfg(unix)]
    #[test]
    fn a_planted_symlink_never_gets_directories_created_behind_it() {
        let (dst, outside) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let entries: Vec<RawEntry> = vec![
            (
                "evil",
                tar::EntryType::Symlink,
                outside.path().to_str().unwrap(),
                b"",
            ),
            ("evil/sub/x", tar::EntryType::Regular, "", b"pwned"),
        ];
        let skipped = unpack(
            &raw_archive(&entries)[..],
            Sink::Dir(dst.path()),
            false,
            counter(),
        )
        .unwrap();
        assert!(!outside.path().join("sub").exists());
        assert_eq!(skipped, ["evil/sub/x"]);
    }

    #[cfg(unix)]
    #[test]
    fn hard_links_round_trip() {
        let dst = tempfile::tempdir().unwrap();
        let entries: Vec<RawEntry> = vec![
            ("a", tar::EntryType::Regular, "", b"same"),
            ("h", tar::EntryType::Link, "a", b""),
        ];
        let skipped = unpack(
            &raw_archive(&entries)[..],
            Sink::Dir(dst.path()),
            false,
            counter(),
        )
        .unwrap();
        assert!(skipped.is_empty());
        assert_eq!(fs::read(dst.path().join("h")).unwrap(), b"same");
    }

    #[cfg(unix)]
    #[test]
    fn hard_links_through_a_planted_symlink_or_to_nothing_are_skipped() {
        let (dst, outside) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::write(outside.path().join("secret"), b"s").unwrap();
        let entries: Vec<RawEntry> = vec![
            (
                "evil",
                tar::EntryType::Symlink,
                outside.path().to_str().unwrap(),
                b"",
            ),
            ("h", tar::EntryType::Link, "evil/secret", b""),
            ("m", tar::EntryType::Link, "missing", b""),
        ];
        let skipped = unpack(
            &raw_archive(&entries)[..],
            Sink::Dir(dst.path()),
            false,
            counter(),
        )
        .unwrap();
        assert!(!dst.path().join("h").exists());
        assert!(!dst.path().join("m").exists());
        assert_eq!(skipped, ["h", "m"]);
    }

    #[cfg(unix)]
    #[test]
    fn read_only_directories_extract_and_keep_their_mode() {
        use std::os::unix::fs::PermissionsExt;
        let (src, dst) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ro = src.path().join("ro");
        fs::create_dir(&ro).unwrap();
        fs::write(ro.join("f"), b"f").unwrap();
        fs::set_permissions(&ro, fs::Permissions::from_mode(0o555)).unwrap();
        let buf = archive(src.path(), &["ro"], false);
        fs::set_permissions(&ro, fs::Permissions::from_mode(0o755)).unwrap();
        let result = unpack(&buf[..], Sink::Dir(dst.path()), false, counter());
        let out = dst.path().join("ro");
        let mode = fs::metadata(&out).map(|m| m.permissions().mode() & 0o777);
        let _ = fs::set_permissions(&out, fs::Permissions::from_mode(0o755));
        result.unwrap();
        assert_eq!(fs::read(out.join("f")).unwrap(), b"f");
        assert_eq!(mode.unwrap(), 0o555);
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_pack_never_leaves_a_complete_archive() {
        let Some(src) = then_unreadable(b"alpha") else {
            return;
        };
        let mut buf = Vec::new();
        let names = ["a".to_string(), "b".to_string()];
        let err = pack(&mut buf, src.path(), &names, false, counter()).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
        let mut decoded = Vec::new();
        assert!(
            GzDecoder::new(&buf[..]).read_to_end(&mut decoded).is_err(),
            "a failed pack wrote a whole gzip stream"
        );
        assert!(unpack(&buf[..], Sink::Count, false, counter()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn sockets_and_fifos_are_left_out_and_reported() {
        let src = tempfile::tempdir().unwrap();
        let top = src.path().join("top");
        fs::create_dir(&top).unwrap();
        fs::write(top.join("a"), b"a").unwrap();
        let _sock = std::os::unix::net::UnixListener::bind(top.join("sock")).unwrap();
        let fifo = std::ffi::CString::new(top.join("fifo").to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o644) }, 0);
        let mut buf = Vec::new();
        let skipped = pack(&mut buf, src.path(), &["top".into()], false, counter()).unwrap();
        assert_eq!(skipped, ["top/fifo", "top/sock"]);
        let dst = tempfile::tempdir().unwrap();
        unpack(&buf[..], Sink::Dir(dst.path()), false, counter()).unwrap();
        assert_eq!(fs::read(dst.path().join("top/a")).unwrap(), b"a");
        assert_eq!(fs::read_dir(dst.path().join("top")).unwrap().count(), 1);
    }

    #[test]
    fn an_archive_without_its_end_blocks_is_truncated() {
        let whole = tar_of(&[(
            header("a.txt", tar::EntryType::Regular, "", 0o644, 5),
            &b"alpha"[..],
        )]);
        let cut = gzip(&whole[..whole.len() - 1024]);
        let dst = tempfile::tempdir().unwrap();
        for sink in [Sink::Dir(dst.path()), Sink::Count] {
            let err = unpack(&cut[..], sink, false, counter()).unwrap_err();
            assert!(err.to_string().contains("archive truncated"), "{err}");
        }
        unpack(&gzip(&whole)[..], Sink::Count, false, counter()).unwrap();
        unpack(&gzip(&whole)[..], Sink::Dir(dst.path()), false, counter()).unwrap();
    }

    fn pax(records: &[(&str, &str)]) -> Vec<u8> {
        let mut out = String::new();
        for (key, value) in records {
            let body = format!(" {key}={value}\n");
            let mut len = body.len();
            while len != body.len() + len.to_string().len() {
                len = body.len() + len.to_string().len();
            }
            out.push_str(&format!("{len}{body}"));
        }
        out.into_bytes()
    }

    #[test]
    fn pax_sparse_entries_are_skipped_under_their_real_name() {
        let dst = tempfile::tempdir().unwrap();
        let named = pax(&[
            ("GNU.sparse.major", "1"),
            ("GNU.sparse.minor", "0"),
            ("GNU.sparse.name", "big.img"),
            ("GNU.sparse.realsize", "4096"),
        ]);
        let unnamed = pax(&[("GNU.sparse.size", "4096")]);
        let map = b"1\n0\n512\n";
        let archive = gzip(&tar_of(&[
            (
                header(
                    "PaxHeaders/big.img",
                    tar::EntryType::XHeader,
                    "",
                    0o644,
                    named.len(),
                ),
                &named,
            ),
            (
                header(
                    "GNUSparseFile.0/big.img",
                    tar::EntryType::Regular,
                    "",
                    0o644,
                    map.len(),
                ),
                map,
            ),
            (
                header(
                    "PaxHeaders/old",
                    tar::EntryType::XHeader,
                    "",
                    0o644,
                    unnamed.len(),
                ),
                &unnamed,
            ),
            (header("old", tar::EntryType::Regular, "", 0o644, 0), b""),
            (
                header("ok.txt", tar::EntryType::Regular, "", 0o644, 2),
                b"ok",
            ),
        ]));
        let skipped = unpack(&archive[..], Sink::Dir(dst.path()), false, counter()).unwrap();
        assert_eq!(skipped, ["big.img", "old"]);
        assert!(!dst.path().join("GNUSparseFile.0").exists());
        assert!(!dst.path().join("big.img").exists());
        assert!(!dst.path().join("old").exists());
        assert_eq!(fs::read(dst.path().join("ok.txt")).unwrap(), b"ok");
    }

    #[cfg(unix)]
    #[test]
    fn fifos_and_devices_are_skipped_not_written_as_files() {
        let dst = tempfile::tempdir().unwrap();
        let entries: Vec<RawEntry> = vec![
            ("p", tar::EntryType::Fifo, "", b""),
            ("c", tar::EntryType::Char, "", b""),
            ("b", tar::EntryType::Block, "", b""),
            ("f", tar::EntryType::Regular, "", b"f"),
        ];
        let skipped = unpack(
            &raw_archive(&entries)[..],
            Sink::Dir(dst.path()),
            false,
            counter(),
        )
        .unwrap();
        assert_eq!(skipped, ["p", "c", "b"]);
        assert_eq!(fs::read_dir(dst.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn setuid_setgid_and_sticky_bits_are_dropped() {
        use std::os::unix::fs::PermissionsExt;
        let dst = tempfile::tempdir().unwrap();
        let archive = gzip(&tar_of(&[
            (
                header("d/", tar::EntryType::Directory, "", 0o3755, 0),
                &b""[..],
            ),
            (
                header("d/run", tar::EntryType::Regular, "", 0o4755, 1),
                b"x",
            ),
        ]));
        unpack(&archive[..], Sink::Dir(dst.path()), false, counter()).unwrap();
        let mode = |p: &str| {
            fs::metadata(dst.path().join(p))
                .unwrap()
                .permissions()
                .mode()
                & 0o7777
        };
        assert_eq!(mode("d/run"), 0o755);
        assert_eq!(mode("d"), 0o755);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn holed_files_pack_as_plain_entries_and_extract_whole() {
        use std::io::Seek;
        let src = tempfile::tempdir().unwrap();
        let mut f = fs::File::create(src.path().join("holey")).unwrap();
        f.set_len(1 << 20).unwrap();
        f.seek(io::SeekFrom::Start(700_000)).unwrap();
        f.write_all(b"hello").unwrap();
        drop(f);
        let mut data = vec![0u8; 1 << 20];
        data[700_000..700_005].copy_from_slice(b"hello");
        let buf = archive(src.path(), &["holey"], false);
        let mut kinds = tar::Archive::new(GzDecoder::new(&buf[..]));
        let sparse = kinds
            .entries()
            .unwrap()
            .any(|e| e.unwrap().header().entry_type().is_gnu_sparse());
        let dst = tempfile::tempdir().unwrap();
        let skipped = unpack(&buf[..], Sink::Dir(dst.path()), false, counter()).unwrap();
        assert!(skipped.is_empty());
        assert_eq!(fs::read(dst.path().join("holey")).unwrap(), data);
        assert!(!sparse);
    }
}
