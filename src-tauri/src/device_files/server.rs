use super::link::READ_ONLY_MESSAGE;
use super::roots::{normalize, Jail, Resolved, SharedRoots};
use russh_sftp::protocol::{
    Attrs, Data, File as Entry, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode,
};
use russh_sftp::server::StatusReply;
use std::collections::{HashMap, VecDeque};
use std::fs::{File, FileTimes, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, UNIX_EPOCH};

const MAX_HANDLES: usize = 256;
const MAX_READ: u32 = 1 << 18;
const BATCH: usize = 100;

// Process-wide: another session's rename must not swap a component between resolve and syscall.
static PATHS: Mutex<()> = Mutex::new(());

#[derive(Clone)]
struct OpenFile {
    file: Arc<File>,
    append: bool,
}

enum Open {
    File(OpenFile),
    Dir(VecDeque<Entry>),
}

pub struct SharedFs {
    roots: Arc<SharedRoots>,
    read_only: bool,
    open: HashMap<String, Open>,
    next: u64,
}

impl From<Jail> for StatusCode {
    fn from(_: Jail) -> Self {
        StatusCode::NoSuchFile
    }
}

fn io_status(e: io::Error) -> StatusCode {
    match e.kind() {
        io::ErrorKind::NotFound => StatusCode::NoSuchFile,
        io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
        _ => StatusCode::Failure,
    }
}

fn ok(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".into(),
        language_tag: "en-US".into(),
    }
}

fn dir_attrs() -> FileAttributes {
    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(0o755);
    attrs.set_dir(true);
    attrs
}

fn target(
    roots: &SharedRoots,
    vpath: &str,
    resolve: fn(&SharedRoots, &str) -> Result<Resolved, Jail>,
) -> Result<(usize, PathBuf), StatusCode> {
    if normalize(vpath).len() < 2 {
        return Err(StatusCode::PermissionDenied);
    }
    match resolve(roots, vpath)? {
        Resolved::Inside { root, path } => Ok((root, path)),
        _ => Err(StatusCode::PermissionDenied),
    }
}

fn no_follow(opts: &mut OpenOptions) -> &mut OpenOptions {
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::custom_flags(opts, libc::O_NOFOLLOW | libc::O_NONBLOCK);
    #[cfg(windows)]
    std::os::windows::fs::OpenOptionsExt::custom_flags(
        opts,
        windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT
            | windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS,
    );
    opts
}

fn open_for_times(path: &Path) -> io::Result<File> {
    let mut opts = OpenOptions::new();
    #[cfg(windows)]
    std::os::windows::fs::OpenOptionsExt::access_mode(
        &mut opts,
        windows_sys::Win32::Storage::FileSystem::FILE_WRITE_ATTRIBUTES,
    );
    #[cfg(not(windows))]
    opts.read(true);
    no_follow(&mut opts).open(path)
}

fn set_times(file: &File, attrs: &FileAttributes) -> Result<(), StatusCode> {
    let at = |secs: u32| UNIX_EPOCH + Duration::from_secs(secs.into());
    let mut times = FileTimes::new();
    if let Some(m) = attrs.mtime {
        times = times.set_modified(at(m));
    }
    if let Some(a) = attrs.atime {
        times = times.set_accessed(at(a));
    }
    file.set_times(times).map_err(io_status)
}

#[cfg(unix)]
fn read_at(file: &File, buf: &mut [u8], offset: u64) -> io::Result<usize> {
    std::os::unix::fs::FileExt::read_at(file, buf, offset)
}

#[cfg(windows)]
fn read_at(file: &File, buf: &mut [u8], offset: u64) -> io::Result<usize> {
    std::os::windows::fs::FileExt::seek_read(file, buf, offset)
}

#[cfg(unix)]
fn write_all_at(file: &File, data: &[u8], offset: u64) -> io::Result<()> {
    std::os::unix::fs::FileExt::write_all_at(file, data, offset)
}

#[cfg(windows)]
fn write_all_at(file: &File, mut data: &[u8], mut offset: u64) -> io::Result<()> {
    while !data.is_empty() {
        let n = std::os::windows::fs::FileExt::seek_write(file, data, offset)?;
        if n == 0 {
            return Err(io::ErrorKind::WriteZero.into());
        }
        data = &data[n..];
        offset += n as u64;
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, StatusCode> + Send + 'static,
) -> Result<T, StatusCode> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|_| StatusCode::Failure)?
}

fn list(roots: &SharedRoots, vpath: &str) -> Result<VecDeque<Entry>, StatusCode> {
    let dir = match roots.resolve(vpath)? {
        Resolved::VirtualRoot => {
            return Ok(roots
                .names()
                .into_iter()
                .map(|n| Entry::new(n, dir_attrs()))
                .collect())
        }
        Resolved::Root(idx) => roots.root_dir(idx)?,
        Resolved::Inside { path, .. } => path,
    };
    Ok(std::fs::read_dir(dir)
        .map_err(io_status)?
        .filter_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().into_string().ok()?;
            Some(Entry::new(name, FileAttributes::from(&e.metadata().ok()?)))
        })
        .collect())
}

fn open_file(roots: &SharedRoots, vpath: &str, flags: OpenFlags) -> Result<File, StatusCode> {
    let create = flags.contains(OpenFlags::CREATE);
    let (_, path) = match target(roots, vpath, SharedRoots::resolve) {
        Err(StatusCode::NoSuchFile) if create => {
            target(roots, vpath, SharedRoots::resolve_for_create)?
        }
        r => r?,
    };
    let file = no_follow(
        OpenOptions::new()
            .read(flags.contains(OpenFlags::READ))
            .write(flags.intersects(OpenFlags::WRITE | OpenFlags::APPEND))
            .create(create)
            .truncate(flags.contains(OpenFlags::TRUNCATE))
            .create_new(create && flags.contains(OpenFlags::EXCLUDE)),
    )
    .open(&path)
    .map_err(io_status)?;
    if !file.metadata().map_err(io_status)?.is_file() {
        return Err(StatusCode::Failure);
    }
    Ok(file)
}

fn rename_entry(roots: &SharedRoots, from: &str, to: &str) -> Result<(), StatusCode> {
    let (a, from) = target(roots, from, SharedRoots::resolve_entry)?;
    let (b, to) = target(roots, to, SharedRoots::resolve_entry)?;
    if a != b {
        return Err(StatusCode::OpUnsupported);
    }
    if to.symlink_metadata().is_ok() {
        return Err(StatusCode::Failure);
    }
    std::fs::rename(from, to).map_err(io_status)
}

impl SharedFs {
    pub fn new(roots: SharedRoots, read_only: bool) -> Self {
        Self {
            roots: Arc::new(roots),
            read_only,
            open: HashMap::new(),
            next: 0,
        }
    }

    fn writable(&self) -> Result<(), StatusReply> {
        if self.read_only {
            Err(StatusCode::PermissionDenied.with_message(READ_ONLY_MESSAGE))
        } else {
            Ok(())
        }
    }

    fn room(&self) -> Result<(), StatusCode> {
        if self.open.len() >= MAX_HANDLES {
            Err(StatusCode::Failure)
        } else {
            Ok(())
        }
    }

    fn insert(&mut self, id: u32, open: Open) -> Handle {
        self.next += 1;
        let handle = self.next.to_string();
        self.open.insert(handle.clone(), open);
        Handle { id, handle }
    }

    fn file(&self, handle: &str) -> Result<OpenFile, StatusCode> {
        match self.open.get(handle) {
            Some(Open::File(f)) => Ok(f.clone()),
            _ => Err(StatusCode::Failure),
        }
    }

    async fn on_roots<T: Send + 'static>(
        &self,
        f: impl FnOnce(&SharedRoots) -> Result<T, StatusCode> + Send + 'static,
    ) -> Result<T, StatusCode> {
        let roots = Arc::clone(&self.roots);
        blocking(move || {
            let _held = PATHS.lock().unwrap_or_else(PoisonError::into_inner);
            f(&roots)
        })
        .await
    }

    async fn path_attrs(&self, vpath: String, follow: bool) -> Result<FileAttributes, StatusCode> {
        self.on_roots(move |roots| {
            let resolved = if follow {
                roots.resolve(&vpath)?
            } else {
                roots.resolve_entry(&vpath)?
            };
            let Resolved::Inside { path, .. } = resolved else {
                return Ok(dir_attrs());
            };
            let meta = if follow {
                std::fs::metadata(path)
            } else {
                std::fs::symlink_metadata(path)
            };
            Ok(FileAttributes::from(&meta.map_err(io_status)?))
        })
        .await
    }

    async fn change(
        &self,
        id: u32,
        f: impl FnOnce(&SharedRoots) -> Result<(), StatusCode> + Send + 'static,
    ) -> Result<Status, StatusReply> {
        self.writable()?;
        self.on_roots(f).await?;
        Ok(ok(id))
    }
}

impl russh_sftp::server::Handler for SharedFs {
    type Error = StatusReply;

    fn unimplemented(&self) -> StatusReply {
        StatusCode::OpUnsupported.into()
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, StatusReply> {
        let vpath = self
            .on_roots(move |_| Ok(format!("/{}", normalize(&path).join("/"))))
            .await?;
        Ok(Name {
            id,
            files: vec![Entry::dummy(vpath)],
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, StatusReply> {
        let attrs = self.path_attrs(path, true).await?;
        Ok(Attrs { id, attrs })
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, StatusReply> {
        let attrs = self.path_attrs(path, false).await?;
        Ok(Attrs { id, attrs })
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, StatusReply> {
        let f = self.file(&handle)?;
        let meta = blocking(move || f.file.metadata().map_err(io_status)).await?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&meta),
        })
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, StatusReply> {
        self.room()?;
        let entries = self.on_roots(move |roots| list(roots, &path)).await?;
        Ok(self.insert(id, Open::Dir(entries)))
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, StatusReply> {
        let Some(Open::Dir(entries)) = self.open.get_mut(&handle) else {
            return Err(StatusCode::Failure.into());
        };
        if entries.is_empty() {
            return Err(StatusCode::Eof.into());
        }
        let n = entries.len().min(BATCH);
        Ok(Name {
            id,
            files: entries.drain(..n).collect(),
        })
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _: FileAttributes,
    ) -> Result<Handle, StatusReply> {
        let writes = OpenFlags::WRITE | OpenFlags::APPEND | OpenFlags::CREATE | OpenFlags::TRUNCATE;
        if pflags.intersects(writes) {
            self.writable()?;
        }
        self.room()?;
        let file = self
            .on_roots(move |roots| open_file(roots, &filename, pflags))
            .await?;
        let append = pflags.contains(OpenFlags::APPEND);
        Ok(self.insert(
            id,
            Open::File(OpenFile {
                file: Arc::new(file),
                append,
            }),
        ))
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusReply> {
        let f = self.file(&handle)?;
        let data = blocking(move || {
            let mut buf = vec![0; len.min(MAX_READ) as usize];
            let n = read_at(&f.file, &mut buf, offset).map_err(io_status)?;
            if n == 0 {
                return Err(StatusCode::Eof);
            }
            buf.truncate(n);
            Ok(buf)
        })
        .await?;
        Ok(Data { id, data })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, StatusReply> {
        let f = self.file(&handle)?;
        blocking(move || {
            let at = if f.append {
                f.file.metadata().map_err(io_status)?.len()
            } else {
                offset
            };
            write_all_at(&f.file, &data, at).map_err(io_status)
        })
        .await?;
        Ok(ok(id))
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, StatusReply> {
        self.open.remove(&handle).ok_or(StatusCode::Failure)?;
        Ok(ok(id))
    }

    async fn setstat(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusReply> {
        self.change(id, move |roots| {
            let (_, path) = target(roots, &path, SharedRoots::resolve_entry)?;
            set_times(&open_for_times(&path).map_err(io_status)?, &attrs)
        })
        .await
    }

    async fn fsetstat(
        &mut self,
        id: u32,
        handle: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusReply> {
        self.writable()?;
        let f = self.file(&handle)?;
        blocking(move || set_times(&f.file, &attrs)).await?;
        Ok(ok(id))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _: FileAttributes,
    ) -> Result<Status, StatusReply> {
        self.change(id, move |roots| {
            std::fs::create_dir(target(roots, &path, SharedRoots::resolve_for_create)?.1)
                .map_err(io_status)
        })
        .await
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, StatusReply> {
        self.change(id, move |roots| {
            std::fs::remove_dir(target(roots, &path, SharedRoots::resolve_entry)?.1)
                .map_err(io_status)
        })
        .await
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, StatusReply> {
        self.change(id, move |roots| {
            std::fs::remove_file(target(roots, &filename, SharedRoots::resolve_entry)?.1)
                .map_err(io_status)
        })
        .await
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, StatusReply> {
        self.change(id, move |roots| rename_entry(roots, &oldpath, &newpath))
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sftp::resume::endpoint::LocalFs;
    use crate::commands::sftp::resume::engine_tests::{noise, s, tree};
    use crate::commands::sftp::resume::sftp_fs::SftpFs;
    use crate::commands::sftp::resume::{clear_resume, copy_tree, mark_resume};
    use crate::sftp::backend::test_tree::Recorder;
    use russh_sftp::client::error::Error as SftpError;
    use russh_sftp::client::SftpSession;
    use russh_sftp::protocol::{FileAttributes, OpenFlags};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
    use tokio::sync::Mutex;
    use tokio_util::sync::CancellationToken;

    struct Served {
        dir: tempfile::TempDir,
        sftp: SftpSession,
    }

    impl Served {
        fn alpha(&self) -> PathBuf {
            self.dir.path().join("alpha")
        }
    }

    async fn serve(read_only: bool) -> Served {
        let dir = tempfile::tempdir().unwrap();
        let shares: Vec<PathBuf> = ["alpha", "beta"]
            .iter()
            .map(|n| dir.path().join(n))
            .collect();
        for p in &shares {
            fs::create_dir(p).unwrap();
        }
        fs::create_dir(dir.path().join("secret")).unwrap();
        fs::write(dir.path().join("secret/pw"), b"hunter2").unwrap();
        fs::write(dir.path().join("alpha/f.txt"), b"keep").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.path().join("secret"), dir.path().join("alpha/out"))
            .unwrap();
        let (client, server) = tokio::io::duplex(1 << 16);
        russh_sftp::server::run(server, SharedFs::new(SharedRoots::new(&shares), read_only)).await;
        let sftp = SftpSession::new(client).await.unwrap();
        Served { dir, sftp }
    }

    fn code<T>(r: Result<T, SftpError>) -> StatusCode {
        match r {
            Err(SftpError::Status(s)) => s.status_code,
            Err(e) => panic!("expected a status, got {e:?}"),
            Ok(_) => panic!("expected a status, got Ok"),
        }
    }

    async fn write_at(sftp: &SftpSession, path: &str, flags: OpenFlags, at: u64, data: &[u8]) {
        let mut f = sftp.open_with_flags(path, flags).await.unwrap();
        f.seek(std::io::SeekFrom::Start(at)).await.unwrap();
        f.write_all(data).await.unwrap();
        f.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn virtual_root_lists_share_names() {
        let t = serve(false).await;
        let mut names: Vec<(String, bool)> = t
            .sftp
            .read_dir("/")
            .await
            .unwrap()
            .map(|e| (e.file_name(), e.metadata().is_dir()))
            .collect();
        names.sort();
        assert_eq!(
            names,
            [("alpha".to_string(), true), ("beta".to_string(), true)]
        );
        assert!(t.sftp.metadata("/").await.unwrap().is_dir());
        assert!(t.sftp.metadata("/beta").await.unwrap().is_dir());
        assert_eq!(t.sftp.canonicalize(".").await.unwrap(), "/");
        assert_eq!(t.sftp.canonicalize("").await.unwrap(), "/");
        assert_eq!(
            t.sftp.canonicalize("/alpha/x/../f.txt").await.unwrap(),
            "/alpha/f.txt"
        );
    }

    #[tokio::test]
    async fn read_write_roundtrip_at_offset() {
        let t = serve(false).await;
        let create = OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
        write_at(&t.sftp, "/alpha/n.txt", create, 0, b"hello").await;
        write_at(&t.sftp, "/alpha/n.txt", OpenFlags::WRITE, 3, b"LO!").await;
        let mut f = t.sftp.open("/alpha/n.txt").await.unwrap();
        f.seek(std::io::SeekFrom::Start(2)).await.unwrap();
        let mut got = String::new();
        f.read_to_string(&mut got).await.unwrap();
        assert_eq!(got, "lLO!");
        assert_eq!(fs::read(t.alpha().join("n.txt")).unwrap(), b"helLO!");
        assert_eq!(t.sftp.metadata("/alpha/n.txt").await.unwrap().size, Some(6));
        t.sftp.create_dir("/alpha/d").await.unwrap();
        t.sftp
            .rename("/alpha/n.txt", "/alpha/d/m.txt")
            .await
            .unwrap();
        assert_eq!(fs::read(t.alpha().join("d/m.txt")).unwrap(), b"helLO!");
        t.sftp.remove_file("/alpha/d/m.txt").await.unwrap();
        t.sftp.remove_dir("/alpha/d").await.unwrap();
        assert!(!t.alpha().join("d").exists());
    }

    #[tokio::test]
    async fn append_extends_file() {
        let t = serve(false).await;
        write_at(
            &t.sftp,
            "/alpha/f.txt",
            OpenFlags::WRITE | OpenFlags::APPEND,
            0,
            b"+more",
        )
        .await;
        assert_eq!(fs::read(t.alpha().join("f.txt")).unwrap(), b"keep+more");
    }

    #[tokio::test]
    async fn rename_across_roots_unsupported() {
        let t = serve(false).await;
        assert_eq!(
            code(t.sftp.rename("/alpha/f.txt", "/beta/f.txt").await),
            StatusCode::OpUnsupported
        );
        assert!(t.alpha().join("f.txt").exists());
    }

    #[tokio::test]
    async fn read_only_refusal_classifies_as_device_read_only() {
        use crate::error::{Classify, ErrorCode};
        let t = serve(true).await;
        let err = t.sftp.create_dir("/alpha/d").await.unwrap_err();
        assert_eq!(err.error_code(), Some(ErrorCode::DeviceReadOnly));
        let t = serve(false).await;
        t.sftp.create_dir("/alpha/ok").await.unwrap();
        let err = t.sftp.create_dir("/alpha/ok/../../zz/y").await.unwrap_err();
        assert_ne!(err.error_code(), Some(ErrorCode::DeviceReadOnly));
    }

    #[tokio::test]
    async fn read_only_refuses_every_write() {
        let t = serve(true).await;
        let denied = StatusCode::PermissionDenied;
        let write = OpenFlags::WRITE;
        let create = OpenFlags::CREATE | OpenFlags::WRITE;
        assert_eq!(
            code(t.sftp.open_with_flags("/alpha/f.txt", write).await),
            denied
        );
        assert_eq!(
            code(t.sftp.open_with_flags("/alpha/new", create).await),
            denied
        );
        assert_eq!(code(t.sftp.create_dir("/alpha/d").await), denied);
        assert_eq!(code(t.sftp.remove_file("/alpha/f.txt").await), denied);
        assert_eq!(
            code(t.sftp.rename("/alpha/f.txt", "/alpha/g").await),
            denied
        );
        let mut attrs = FileAttributes::empty();
        attrs.mtime = Some(1_000_000);
        assert_eq!(
            code(t.sftp.set_metadata("/alpha/f.txt", attrs).await),
            denied
        );
        assert_eq!(fs::read(t.alpha().join("f.txt")).unwrap(), b"keep");
        assert_eq!(t.sftp.read("/alpha/f.txt").await.unwrap(), b"keep");
    }

    #[tokio::test]
    async fn writes_to_virtual_root_or_a_root_are_denied() {
        let t = serve(false).await;
        let denied = StatusCode::PermissionDenied;
        assert_eq!(code(t.sftp.create_dir("/alpha").await), denied);
        assert_eq!(code(t.sftp.create_dir("/").await), denied);
        assert_eq!(code(t.sftp.remove_dir("/beta").await), denied);
        assert_eq!(code(t.sftp.rename("/alpha", "/gamma").await), denied);
        assert_eq!(code(t.sftp.rename("/alpha/f.txt", "/gamma").await), denied);
        assert_eq!(code(t.sftp.create_dir("/gamma").await), denied);
        let create = OpenFlags::CREATE | OpenFlags::WRITE;
        assert_eq!(code(t.sftp.open_with_flags("/gamma", create).await), denied);
        assert_eq!(code(t.sftp.open_with_flags("/alpha", create).await), denied);
        assert!(t.alpha().is_dir());
    }

    #[tokio::test]
    async fn escape_attempt_is_no_such_file() {
        let t = serve(false).await;
        let host = s(&t.dir.path().join("secret/pw"));
        let none = StatusCode::NoSuchFile;
        for p in [
            "/alpha/../secret/pw",
            "/alpha/../../secret/pw",
            "/alpha/out/pw",
            host.as_str(),
            &format!("/alpha{host}"),
        ] {
            assert_eq!(code(t.sftp.metadata(p).await), none, "{p}");
            assert_eq!(code(t.sftp.open(p).await), none, "{p}");
        }
        assert_eq!(code(t.sftp.read_dir("/alpha/out").await), none);
        let create = OpenFlags::CREATE | OpenFlags::WRITE;
        assert_eq!(
            code(t.sftp.open_with_flags("/alpha/out/new", create).await),
            none
        );
        assert!(!t.dir.path().join("secret/new").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn remove_symlink_removes_link_not_target() {
        let t = serve(false).await;
        fs::write(t.alpha().join("target.txt"), b"t").unwrap();
        std::os::unix::fs::symlink(t.alpha().join("target.txt"), t.alpha().join("ln")).unwrap();
        assert!(t
            .sftp
            .symlink_metadata("/alpha/ln")
            .await
            .unwrap()
            .is_symlink());
        assert!(t
            .sftp
            .symlink_metadata("/alpha/out")
            .await
            .unwrap()
            .is_symlink());
        t.sftp.remove_file("/alpha/ln").await.unwrap();
        t.sftp.remove_file("/alpha/out").await.unwrap();
        assert!(t.alpha().join("ln").symlink_metadata().is_err());
        assert_eq!(fs::read(t.alpha().join("target.txt")).unwrap(), b"t");
        assert_eq!(
            fs::read(t.dir.path().join("secret/pw")).unwrap(),
            b"hunter2"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn damaging_escapes_through_a_symlink_are_no_such_file() {
        let t = serve(false).await;
        let none = StatusCode::NoSuchFile;
        assert_eq!(
            code(t.sftp.rename("/alpha/out/pw", "/alpha/stolen").await),
            none
        );
        assert_eq!(code(t.sftp.remove_file("/alpha/out/pw").await), none);
        assert_eq!(code(t.sftp.create_dir("/alpha/out/x").await), none);
        assert_eq!(
            fs::read(t.dir.path().join("secret/pw")).unwrap(),
            b"hunter2"
        );
        assert!(!t.dir.path().join("secret/x").exists());
        assert!(!t.alpha().join("stolen").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fifo_in_share_is_refused_not_hung() {
        let t = serve(false).await;
        let fifo = std::ffi::CString::new(s(&t.alpha().join("pipe"))).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o644) }, 0);
        let soon = std::time::Duration::from_secs(5);
        let read = tokio::time::timeout(soon, t.sftp.open("/alpha/pipe")).await;
        assert_eq!(code(read.expect("open hung")), StatusCode::Failure);
        let wrote = tokio::time::timeout(
            soon,
            t.sftp.open_with_flags("/alpha/pipe", OpenFlags::WRITE),
        )
        .await;
        assert!(wrote.expect("open for write hung").is_err());
        assert!(t.sftp.metadata("/alpha/f.txt").await.is_ok());
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn every_path_op_waits_for_the_path_lock() {
        let t = serve(false).await;
        let open = t.sftp.open("/alpha/f.txt").await.unwrap();
        let blocked = std::time::Duration::from_millis(150);
        macro_rules! waits {
            ($op:expr) => {{
                let held = PATHS.lock().unwrap_or_else(PoisonError::into_inner);
                let done = tokio::time::timeout(blocked, $op).await;
                drop(held);
                assert!(done.is_err(), "{}", stringify!($op));
                t.sftp.canonicalize("/").await.unwrap();
            }};
        }
        waits!(t.sftp.canonicalize("/alpha"));
        waits!(t.sftp.metadata("/alpha/f.txt"));
        waits!(t.sftp.symlink_metadata("/alpha/f.txt"));
        waits!(t.sftp.set_metadata("/alpha/f.txt", FileAttributes::empty()));
        waits!(t.sftp.read_dir("/alpha"));
        waits!(t.sftp.open("/alpha/f.txt"));
        waits!(t.sftp.create_dir("/alpha/d"));
        waits!(t.sftp.remove_dir("/alpha/d"));
        waits!(t.sftp.remove_file("/alpha/nope"));
        waits!(t.sftp.rename("/alpha/nope", "/alpha/nope2"));
        let held = PATHS.lock().unwrap_or_else(PoisonError::into_inner);
        let fstat = tokio::time::timeout(std::time::Duration::from_secs(10), open.metadata()).await;
        drop(held);
        assert_eq!(
            fstat.expect("fstat waited for the path lock").unwrap().size,
            Some(4)
        );
    }

    #[tokio::test]
    async fn links_are_unsupported() {
        let t = serve(false).await;
        let unsupported = StatusCode::OpUnsupported;
        assert_eq!(
            code(t.sftp.symlink("/alpha/l", "/alpha/f.txt").await),
            unsupported
        );
        assert_eq!(code(t.sftp.read_link("/alpha/out").await), unsupported);
    }

    #[tokio::test]
    async fn handle_table_is_capped() {
        let t = serve(false).await;
        let mut open = Vec::new();
        for _ in 0..256 {
            open.push(t.sftp.open("/alpha/f.txt").await.unwrap());
        }
        assert_eq!(code(t.sftp.open("/alpha/f.txt").await), StatusCode::Failure);
        assert_eq!(code(t.sftp.read_dir("/alpha").await), StatusCode::Failure);
    }

    fn assert_same(a: &Path, b: &Path) {
        for rel in ["a", "sub/b", "sub/c"] {
            assert_eq!(
                fs::read(a.join(rel)).unwrap(),
                fs::read(b.join(rel)).unwrap(),
                "{rel}"
            );
        }
        assert!(b.join("sub/empty").is_dir());
    }

    #[tokio::test]
    async fn resumable_engine_copies_tree() {
        let t = serve(false).await;
        let src = t.alpha().join("tree");
        tree(&src);
        let out = tempfile::tempdir().unwrap();
        let dst = out.path().join("copy");
        let remote = SftpFs::detached(Arc::new(Mutex::new(t.sftp)));
        let token = CancellationToken::new();
        let rec = Recorder::default();
        copy_tree(
            &rec,
            &remote,
            "/alpha/tree",
            &LocalFs,
            &s(&dst),
            "dev-1",
            &token,
        )
        .await
        .unwrap();
        assert_same(&src, &dst);
        let half = fs::metadata(dst.join("sub/b")).unwrap().len() / 2;
        fs::OpenOptions::new()
            .write(true)
            .open(dst.join("sub/b"))
            .unwrap()
            .set_len(half)
            .unwrap();
        mark_resume("dev-2");
        let resumed = copy_tree(
            &rec,
            &remote,
            "/alpha/tree",
            &LocalFs,
            &s(&dst),
            "dev-2",
            &token,
        )
        .await;
        clear_resume("dev-2");
        resumed.unwrap();
        assert_same(&src, &dst);
        assert_eq!(fs::read(dst.join("sub/b")).unwrap(), noise(200_000));
    }
}
