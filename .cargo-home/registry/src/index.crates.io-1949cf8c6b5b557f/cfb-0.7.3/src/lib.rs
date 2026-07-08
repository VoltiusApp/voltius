//! A library for reading/writing [Compound File Binary](
//! https://en.wikipedia.org/wiki/Compound_File_Binary_Format) (structured
//! storage) files.  See [MS-CFB](
//! https://msdn.microsoft.com/en-us/library/dd942138.aspx) for the format
//! specification.
//!
//! A Compound File Binary (CFB) file, also called a *structured storage file*
//! or simply a *compound file*, is a bit like a simple file system within a
//! file.  A compound file contains a tree of *storage* objects
//! (i.e. directories), each of which can contain *stream* objects (i.e. files)
//! or other storage objects.  The format is designed to allow reasonably
//! efficient in-place mutation and resizing of these stream and storage
//! objects, without having to completely rewrite the CFB file on disk.
//!
//! # Example usage
//!
//! ```no_run
//! use cfb;
//! use std::io::{Read, Seek, SeekFrom, Write};
//!
//! // Open an existing compound file in read-write mode.
//! let mut comp = cfb::open_rw("path/to/cfb/file").unwrap();
//!
//! // Read in all the data from one of the streams in that compound file.
//! let data = {
//!     let mut stream = comp.open_stream("/foo/bar").unwrap();
//!     let mut buffer = Vec::new();
//!     stream.read_to_end(&mut buffer).unwrap();
//!     buffer
//! };
//!
//! // Append that data to the end of another stream in the same file.
//! {
//!     let mut stream = comp.open_stream("/baz").unwrap();
//!     stream.seek(SeekFrom::End(0)).unwrap();
//!     stream.write_all(&data).unwrap();
//! }
//!
//! // Now create a new compound file, and create a new stream with the data.
//! let mut comp2 = cfb::create("some/other/path").unwrap();
//! comp2.create_storage("/spam/").unwrap();
//! let mut stream = comp2.create_stream("/spam/eggs").unwrap();
//! stream.write_all(&data).unwrap();
//! ```

#![warn(missing_docs)]

use crate::internal::consts::{self, NO_STREAM};
use crate::internal::{
    Allocator, DirEntry, Directory, Header, MiniAllocator, ObjType,
    SectorInit, Sectors,
};
pub use crate::internal::{Entries, Entry, Version};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use fnv::FnvHashSet;
use std::fs;
use std::io::{self, BufRead, Read, Seek, SeekFrom, Write};
use std::mem::size_of;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[macro_use]
mod internal;

//===========================================================================//

/// Opens an existing compound file at the given path in read-only mode.
pub fn open<P: AsRef<Path>>(path: P) -> io::Result<CompoundFile<fs::File>> {
    CompoundFile::open(fs::File::open(path)?)
}

/// Opens an existing compound file at the given path in read-write mode.
pub fn open_rw<P: AsRef<Path>>(path: P) -> io::Result<CompoundFile<fs::File>> {
    open_rw_with_path(path.as_ref())
}

fn open_rw_with_path(path: &Path) -> io::Result<CompoundFile<fs::File>> {
    let file = fs::OpenOptions::new().read(true).write(true).open(path)?;
    CompoundFile::open(file)
}

/// Creates a new compound file with no contents at the given path.
///
/// The returned `CompoundFile` object will be both readable and writable.  If
/// a file already exists at the given path, this will overwrite it.
pub fn create<P: AsRef<Path>>(path: P) -> io::Result<CompoundFile<fs::File>> {
    create_with_path(path.as_ref())
}

fn create_with_path(path: &Path) -> io::Result<CompoundFile<fs::File>> {
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    CompoundFile::create(file)
}

//===========================================================================//

/// A compound file, backed by an underlying reader/writer (such as a
/// [`File`](https://doc.rust-lang.org/std/fs/struct.File.html) or
/// [`Cursor`](https://doc.rust-lang.org/std/io/struct.Cursor.html)).
pub struct CompoundFile<F> {
    minialloc: MiniAllocator<F>,
}

impl<F> CompoundFile<F> {
    /// Returns the CFB format version used for this compound file.
    pub fn version(&self) -> Version {
        self.minialloc.version()
    }

    fn stream_id_for_name_chain(&self, names: &[&str]) -> Option<u32> {
        self.minialloc.stream_id_for_name_chain(names)
    }

    /// Returns information about the root storage object.  This is equivalent
    /// to `self.entry("/").unwrap()` (but always succeeds).
    pub fn root_entry(&self) -> Entry {
        Entry::new(self.minialloc.root_dir_entry(), PathBuf::from("/"))
    }

    /// Given a path within the compound file, get information about that
    /// stream or storage object.
    pub fn entry<P: AsRef<Path>>(&self, path: P) -> io::Result<Entry> {
        self.entry_with_path(path.as_ref())
    }

    fn entry_with_path(&self, path: &Path) -> io::Result<Entry> {
        let names = internal::path::name_chain_from_path(path)?;
        let path = internal::path::path_from_name_chain(&names);
        let stream_id = match self.stream_id_for_name_chain(&names) {
            Some(stream_id) => stream_id,
            None => not_found!("No such object: {:?}", path),
        };
        Ok(Entry::new(self.minialloc.dir_entry(stream_id), path))
    }

    /// Returns an iterator over the entries within the root storage object.
    /// This is equivalent to `self.read_storage("/").unwrap()` (but always
    /// succeeds).
    pub fn read_root_storage(&self) -> Entries {
        self.minialloc.root_storage_entries()
    }

    /// Returns an iterator over the entries within a storage object.
    pub fn read_storage<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> io::Result<Entries> {
        self.minialloc.storage_entries(path.as_ref())
    }

    /// Returns an iterator over all entries within the compound file, starting
    /// from and including the root entry.  The iterator walks the storage tree
    /// in a preorder traversal.  This is equivalent to
    /// `self.walk_storage("/").unwrap()` (but always succeeds).
    pub fn walk(&self) -> Entries {
        self.minialloc.walk()
    }

    /// Returns an iterator over all entries under a storage subtree, including
    /// the given path itself.  The iterator walks the storage tree in a
    /// preorder traversal.
    pub fn walk_storage<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> io::Result<Entries> {
        self.minialloc.walk_storage(path.as_ref())
    }

    /// Returns true if there is an existing stream or storage at the given
    /// path, or false if there is nothing at that path.
    pub fn exists<P: AsRef<Path>>(&self, path: P) -> bool {
        match internal::path::name_chain_from_path(path.as_ref()) {
            Ok(names) => self.stream_id_for_name_chain(&names).is_some(),
            Err(_) => false,
        }
    }

    /// Returns true if there is an existing stream at the given path, or false
    /// if there is a storage or nothing at that path.
    pub fn is_stream<P: AsRef<Path>>(&self, path: P) -> bool {
        match internal::path::name_chain_from_path(path.as_ref()) {
            Ok(names) => match self.stream_id_for_name_chain(&names) {
                Some(stream_id) => {
                    self.minialloc.dir_entry(stream_id).obj_type
                        == ObjType::Stream
                }
                None => false,
            },
            Err(_) => false,
        }
    }

    /// Returns true if there is an existing storage at the given path, or
    /// false if there is a stream or nothing at that path.
    pub fn is_storage<P: AsRef<Path>>(&self, path: P) -> bool {
        match internal::path::name_chain_from_path(path.as_ref()) {
            Ok(names) => match self.stream_id_for_name_chain(&names) {
                Some(stream_id) => {
                    self.minialloc.dir_entry(stream_id).obj_type
                        != ObjType::Stream
                }
                None => false,
            },
            Err(_) => false,
        }
    }

    // TODO: pub fn copy_stream

    // TODO: pub fn rename

    /// Consumes the `CompoundFile`, returning the underlying reader/writer.
    pub fn into_inner(self) -> F {
        self.minialloc.into_inner()
    }
}

impl<F: Seek> CompoundFile<F> {
    /// Opens an existing stream in the compound file for reading and/or
    /// writing (depending on what the underlying file supports).
    pub fn open_stream<P: AsRef<Path>>(
        &mut self,
        path: P,
    ) -> io::Result<Stream<F>> {
        self.open_stream_with_path(path.as_ref())
    }

    fn open_stream_with_path(&mut self, path: &Path) -> io::Result<Stream<F>> {
        let names = internal::path::name_chain_from_path(path)?;
        let path = internal::path::path_from_name_chain(&names);
        let stream_id = match self.stream_id_for_name_chain(&names) {
            Some(stream_id) => stream_id,
            None => not_found!("No such stream: {:?}", path),
        };
        if self.minialloc.dir_entry(stream_id).obj_type != ObjType::Stream {
            invalid_input!("Not a stream: {:?}", path);
        }
        Ok(Stream::new(self, stream_id))
    }
}

impl<F: Read + Seek> CompoundFile<F> {
    /// Opens an existing compound file, using the underlying reader.  If the
    /// underlying reader also supports the `Write` trait, then the
    /// `CompoundFile` object will be writable as well.
    pub fn open(mut inner: F) -> io::Result<CompoundFile<F>> {
        let inner_len = inner.seek(SeekFrom::End(0))?;
        if inner_len < consts::HEADER_LEN as u64 {
            invalid_data!(
                "Invalid CFB file ({} bytes is too small)",
                inner_len
            );
        }
        inner.seek(SeekFrom::Start(0))?;

        let header = Header::read_from(&mut inner)?;
        let sector_len = header.version.sector_len();
        if inner_len
            > ((consts::MAX_REGULAR_SECTOR + 1) as u64) * (sector_len as u64)
        {
            invalid_data!(
                "Invalid CFB file ({} bytes is too large)",
                inner_len
            );
        }

        if inner_len < header.version.sector_len() as u64 {
            invalid_data!(
                "Invalid CFB file (length of {} < sector length of {})",
                inner_len,
                header.version.sector_len()
            );
        }
        let mut sectors = Sectors::new(header.version, inner_len, inner);
        let num_sectors = sectors.num_sectors();

        // Read in DIFAT.
        let mut difat = Vec::<u32>::new();
        difat.extend_from_slice(&header.initial_difat_entries);
        let mut seen_sector_ids = FnvHashSet::default();
        let mut difat_sector_ids = Vec::new();
        let mut current_difat_sector = header.first_difat_sector;
        while current_difat_sector != consts::END_OF_CHAIN {
            if current_difat_sector > consts::MAX_REGULAR_SECTOR {
                invalid_data!(
                    "DIFAT chain includes invalid sector index {}",
                    current_difat_sector
                );
            } else if current_difat_sector >= num_sectors {
                invalid_data!(
                    "DIFAT chain includes sector index {}, but sector count \
                     is only {}",
                    current_difat_sector,
                    num_sectors
                );
            }
            if seen_sector_ids.contains(&current_difat_sector) {
                invalid_data!(
                    "DIFAT chain includes duplicate sector index {}",
                    current_difat_sector,
                );
            }
            seen_sector_ids.insert(current_difat_sector);
            difat_sector_ids.push(current_difat_sector);
            let mut sector = sectors.seek_to_sector(current_difat_sector)?;
            for _ in 0..(sector_len / size_of::<u32>() - 1) {
                let next = sector.read_u32::<LittleEndian>()?;
                if next != consts::FREE_SECTOR
                    && next > consts::MAX_REGULAR_SECTOR
                {
                    invalid_data!(
                        "DIFAT refers to invalid sector index {}",
                        next
                    );
                }
                difat.push(next);
            }
            current_difat_sector = sector.read_u32::<LittleEndian>()?;
        }
        if header.num_difat_sectors as usize != difat_sector_ids.len() {
            invalid_data!(
                "Incorrect DIFAT chain length (header says {}, actual is {})",
                header.num_difat_sectors,
                difat_sector_ids.len()
            );
        }
        while difat.last() == Some(&consts::FREE_SECTOR) {
            difat.pop();
        }
        if header.num_fat_sectors as usize != difat.len() {
            invalid_data!(
                "Incorrect number of FAT sectors (header says {}, DIFAT says \
                 {})",
                header.num_fat_sectors,
                difat.len()
            );
        }

        // Read in FAT.
        let mut fat = Vec::<u32>::new();
        for &sector_index in difat.iter() {
            if sector_index >= num_sectors {
                invalid_data!(
                    "DIFAT refers to sector {}, but sector count is only {}",
                    sector_index,
                    num_sectors
                );
            }
            let mut sector = sectors.seek_to_sector(sector_index)?;
            for _ in 0..(sector_len / size_of::<u32>()) {
                fat.push(sector.read_u32::<LittleEndian>()?);
            }
        }
        // If the number of sectors in the file is not a multiple of the number
        // of FAT entries per sector, then the last FAT sector must be padded
        // with FREE_SECTOR entries (see MS-CFB section 2.3).  However, some
        // CFB implementations incorrectly pad the last FAT sector with zeros
        // (see https://github.com/mdsteele/rust-cfb/issues/8).  Since zero is
        // normally a meaningful FAT entry (referring to sector 0), we only
        // want to strip zeros from the end of the FAT if they are beyond the
        // number of sectors in the file.
        while fat.len() > num_sectors as usize && fat.last() == Some(&0) {
            fat.pop();
        }
        // Strip FREE_SECTOR entries from the end of the FAT.  Unlike the zero
        // case above, we can remove these even if it makes the number of FAT
        // entries less than the number of sectors in the file; the allocator
        // will implicitly treat these extra sectors as free.
        while fat.last() == Some(&consts::FREE_SECTOR) {
            fat.pop();
        }

        let mut allocator =
            Allocator::new(sectors, difat_sector_ids, difat, fat)?;

        // Read in directory.
        let mut dir_entries = Vec::<DirEntry>::new();
        let mut seen_dir_sectors = FnvHashSet::default();
        let mut current_dir_sector = header.first_dir_sector;
        while current_dir_sector != consts::END_OF_CHAIN {
            if current_dir_sector > consts::MAX_REGULAR_SECTOR {
                invalid_data!(
                    "Directory chain includes invalid sector index {}",
                    current_dir_sector
                );
            } else if current_dir_sector >= num_sectors {
                invalid_data!(
                    "Directory chain includes sector index {}, but sector \
                     count is only {}",
                    current_dir_sector,
                    num_sectors
                );
            }
            if seen_dir_sectors.contains(&current_dir_sector) {
                invalid_data!(
                    "Directory chain includes duplicate sector index {}",
                    current_dir_sector,
                );
            }
            seen_dir_sectors.insert(current_dir_sector);
            {
                let mut sector =
                    allocator.seek_to_sector(current_dir_sector)?;
                for _ in 0..header.version.dir_entries_per_sector() {
                    dir_entries.push(DirEntry::read_from(
                        &mut sector,
                        header.version,
                    )?);
                }
            }
            current_dir_sector = allocator.next(current_dir_sector)?;
        }

        let mut directory =
            Directory::new(allocator, dir_entries, header.first_dir_sector)?;

        // Read in MiniFAT.
        let minifat = {
            let mut chain = directory
                .open_chain(header.first_minifat_sector, SectorInit::Fat)?;
            if header.num_minifat_sectors as usize != chain.num_sectors() {
                invalid_data!(
                    "Incorrect MiniFAT chain length (header says {}, actual \
                     is {})",
                    header.num_minifat_sectors,
                    chain.num_sectors()
                );
            }
            let num_minifat_entries = (chain.len() / 4) as usize;
            let mut minifat = Vec::<u32>::with_capacity(num_minifat_entries);
            for _ in 0..num_minifat_entries {
                minifat.push(chain.read_u32::<LittleEndian>()?);
            }
            while minifat.last() == Some(&consts::FREE_SECTOR) {
                minifat.pop();
            }
            minifat
        };

        let minialloc = MiniAllocator::new(
            directory,
            minifat,
            header.first_minifat_sector,
        )?;

        Ok(CompoundFile { minialloc })
    }

    fn read_data_from_stream(
        &mut self,
        stream_id: u32,
        buf_offset_from_start: u64,
        buf: &mut [u8],
    ) -> io::Result<usize> {
        let (start_sector, stream_len) = {
            let dir_entry = self.minialloc.dir_entry(stream_id);
            debug_assert_eq!(dir_entry.obj_type, ObjType::Stream);
            (dir_entry.start_sector, dir_entry.stream_len)
        };
        let num_bytes = if buf_offset_from_start >= stream_len {
            0
        } else {
            let remaining = stream_len - buf_offset_from_start;
            if remaining < buf.len() as u64 {
                remaining as usize
            } else {
                buf.len()
            }
        };
        if num_bytes > 0 {
            if stream_len < consts::MINI_STREAM_CUTOFF as u64 {
                let mut chain =
                    self.minialloc.open_mini_chain(start_sector)?;
                chain.seek(SeekFrom::Start(buf_offset_from_start))?;
                chain.read_exact(&mut buf[..num_bytes])?;
            } else {
                let mut chain = self
                    .minialloc
                    .open_chain(start_sector, SectorInit::Zero)?;
                chain.seek(SeekFrom::Start(buf_offset_from_start))?;
                chain.read_exact(&mut buf[..num_bytes])?;
            }
        }
        Ok(num_bytes)
    }
}

impl<F: Read + Write + Seek> CompoundFile<F> {
    /// Creates a new compound file with no contents, using the underlying
    /// reader/writer.  The reader/writer should be initially empty.
    pub fn create(inner: F) -> io::Result<CompoundFile<F>> {
        CompoundFile::create_with_version(Version::V4, inner)
    }

    /// Creates a new compound file of the given version with no contents,
    /// using the underlying writer.  The writer should be initially empty.
    pub fn create_with_version(
        version: Version,
        mut inner: F,
    ) -> io::Result<CompoundFile<F>> {
        let mut header = Header {
            version,
            num_dir_sectors: 1,
            num_fat_sectors: 1,
            first_dir_sector: 1,
            first_minifat_sector: consts::END_OF_CHAIN,
            num_minifat_sectors: 0,
            first_difat_sector: consts::END_OF_CHAIN,
            num_difat_sectors: 0,
            initial_difat_entries: [consts::FREE_SECTOR;
                consts::NUM_DIFAT_ENTRIES_IN_HEADER],
        };
        header.initial_difat_entries[0] = 0;
        header.write_to(&mut inner)?;

        // Pad the header with zeroes so it's the length of a sector.
        let sector_len = version.sector_len();
        debug_assert!(sector_len >= consts::HEADER_LEN);
        if sector_len > consts::HEADER_LEN {
            inner.write_all(&vec![0; sector_len - consts::HEADER_LEN])?;
        }

        // Write FAT sector:
        let fat: Vec<u32> = vec![consts::FAT_SECTOR, consts::END_OF_CHAIN];
        for &entry in fat.iter() {
            inner.write_u32::<LittleEndian>(entry)?;
        }
        for _ in fat.len()..(sector_len / size_of::<u32>()) {
            inner.write_u32::<LittleEndian>(consts::FREE_SECTOR)?;
        }
        let difat: Vec<u32> = vec![0];
        let difat_sector_ids: Vec<u32> = vec![];

        // Write directory sector:
        let root_dir_entry = DirEntry::empty_root_entry();
        root_dir_entry.write_to(&mut inner)?;
        for _ in 1..version.dir_entries_per_sector() {
            DirEntry::unallocated().write_to(&mut inner)?;
        }

        let sectors = Sectors::new(version, 3 * sector_len as u64, inner);
        let allocator = Allocator::new(sectors, difat_sector_ids, difat, fat)
            .expect("allocator");
        let directory = Directory::new(allocator, vec![root_dir_entry], 1)
            .expect("directory");
        let minialloc =
            MiniAllocator::new(directory, vec![], consts::END_OF_CHAIN)
                .expect("minialloc");
        Ok(CompoundFile { minialloc })
    }

    /// Creates a new, empty storage object (i.e. "directory") at the provided
    /// path.  The parent storage object must already exist.
    pub fn create_storage<P: AsRef<Path>>(
        &mut self,
        path: P,
    ) -> io::Result<()> {
        self.create_storage_with_path(path.as_ref())
    }

    fn create_storage_with_path(&mut self, path: &Path) -> io::Result<()> {
        let mut names = internal::path::name_chain_from_path(path)?;
        if let Some(stream_id) = self.stream_id_for_name_chain(&names) {
            let path = internal::path::path_from_name_chain(&names);
            if self.minialloc.dir_entry(stream_id).obj_type != ObjType::Stream
            {
                already_exists!(
                    "Cannot create storage at {:?} because a \
                                 storage already exists there",
                    path
                );
            } else {
                already_exists!(
                    "Cannot create storage at {:?} because a \
                                 stream already exists there",
                    path
                );
            }
        }
        // If names is empty, that means we're trying to create the root.  But
        // the root always already exists and will have been rejected above.
        debug_assert!(!names.is_empty());
        let name = names.pop().unwrap();
        let parent_id = match self.stream_id_for_name_chain(&names) {
            Some(stream_id) => stream_id,
            None => {
                not_found!("Parent storage doesn't exist");
            }
        };
        self.minialloc.insert_dir_entry(parent_id, name, ObjType::Storage)?;
        Ok(())
    }

    /// Recursively creates a storage and all of its parent storages if they
    /// are missing.
    pub fn create_storage_all<P: AsRef<Path>>(
        &mut self,
        path: P,
    ) -> io::Result<()> {
        self.create_storage_all_with_path(path.as_ref())
    }

    fn create_storage_all_with_path(&mut self, path: &Path) -> io::Result<()> {
        let names = internal::path::name_chain_from_path(path)?;
        for length in 1..(names.len() + 1) {
            let prefix_path =
                internal::path::path_from_name_chain(&names[..length]);
            if self.is_storage(&prefix_path) {
                continue;
            }
            self.create_storage_with_path(&prefix_path)?;
        }
        Ok(())
    }

    /// Removes the storage object at the provided path.  The storage object
    /// must exist and have no children.
    pub fn remove_storage<P: AsRef<Path>>(
        &mut self,
        path: P,
    ) -> io::Result<()> {
        self.remove_storage_with_path(path.as_ref())
    }

    fn remove_storage_with_path(&mut self, path: &Path) -> io::Result<()> {
        let mut names = internal::path::name_chain_from_path(path)?;
        let stream_id = match self.stream_id_for_name_chain(&names) {
            Some(parent_id) => parent_id,
            None => not_found!("No such storage: {:?}", path),
        };
        {
            let dir_entry = self.minialloc.dir_entry(stream_id);
            if dir_entry.obj_type == ObjType::Root {
                invalid_input!("Cannot remove the root storage object");
            }
            if dir_entry.obj_type == ObjType::Stream {
                invalid_input!("Not a storage: {:?}", path);
            }
            debug_assert_eq!(dir_entry.obj_type, ObjType::Storage);
            if dir_entry.child != NO_STREAM {
                invalid_input!("Storage is not empty: {:?}", path);
            }
        }
        debug_assert!(!names.is_empty());
        let name = names.pop().unwrap();
        let parent_id = self.stream_id_for_name_chain(&names).unwrap();
        self.minialloc.remove_dir_entry(parent_id, name)?;
        Ok(())
    }

    /// Recursively removes a storage and all of its children.  If called on
    /// the root storage, recursively removes all of its children but not the
    /// root storage itself (which cannot be removed).
    pub fn remove_storage_all<P: AsRef<Path>>(
        &mut self,
        path: P,
    ) -> io::Result<()> {
        self.remove_storage_all_with_path(path.as_ref())
    }

    fn remove_storage_all_with_path(&mut self, path: &Path) -> io::Result<()> {
        let mut stack = Vec::<Entry>::new();
        for entry in self.minialloc.walk_storage(path)? {
            stack.push(entry);
        }
        while let Some(entry) = stack.pop() {
            if entry.is_stream() {
                self.remove_stream_with_path(entry.path())?;
            } else if !entry.is_root() {
                self.remove_storage_with_path(entry.path())?;
            }
        }
        Ok(())
    }

    /// Sets the CLSID for the storage object at the provided path.  (To get
    /// the current CLSID for a storage object, use
    /// `self.entry(path)?.clsid()`.)
    pub fn set_storage_clsid<P: AsRef<Path>>(
        &mut self,
        path: P,
        clsid: Uuid,
    ) -> io::Result<()> {
        self.set_storage_clsid_with_path(path.as_ref(), clsid)
    }

    fn set_storage_clsid_with_path(
        &mut self,
        path: &Path,
        clsid: Uuid,
    ) -> io::Result<()> {
        let names = internal::path::name_chain_from_path(path)?;
        let stream_id = match self.stream_id_for_name_chain(&names) {
            Some(stream_id) => stream_id,
            None => not_found!(
                "No such storage: {:?}",
                internal::path::path_from_name_chain(&names)
            ),
        };
        if self.minialloc.dir_entry(stream_id).obj_type == ObjType::Stream {
            invalid_input!(
                "Not a storage: {:?}",
                internal::path::path_from_name_chain(&names)
            );
        }
        self.minialloc.with_dir_entry_mut(stream_id, |dir_entry| {
            dir_entry.clsid = clsid;
        })
    }

    /// Creates and returns a new, empty stream object at the provided path.
    /// If a stream already exists at that path, it will be replaced by the new
    /// stream.  The parent storage object must already exist.
    pub fn create_stream<P: AsRef<Path>>(
        &mut self,
        path: P,
    ) -> io::Result<Stream<F>> {
        self.create_stream_with_path(path.as_ref(), true)
    }

    /// Creates and returns a new, empty stream object at the provided path.
    /// Returns an error if a stream already exists at that path.  The parent
    /// storage object must already exist.
    pub fn create_new_stream<P: AsRef<Path>>(
        &mut self,
        path: P,
    ) -> io::Result<Stream<F>> {
        self.create_stream_with_path(path.as_ref(), false)
    }

    fn create_stream_with_path(
        &mut self,
        path: &Path,
        overwrite: bool,
    ) -> io::Result<Stream<F>> {
        let mut names = internal::path::name_chain_from_path(path)?;
        if let Some(stream_id) = self.stream_id_for_name_chain(&names) {
            if self.minialloc.dir_entry(stream_id).obj_type != ObjType::Stream
            {
                already_exists!(
                    "Cannot create stream at {:?} because a \
                                 storage already exists there",
                    internal::path::path_from_name_chain(&names)
                );
            } else if !overwrite {
                already_exists!(
                    "Cannot create new stream at {:?} because a \
                                 stream already exists there",
                    internal::path::path_from_name_chain(&names)
                );
            } else {
                let mut stream = Stream::new(self, stream_id);
                stream.set_len(0)?;
                return Ok(stream);
            }
        }
        // If names is empty, that means we're trying to create the root.  But
        // the root always already exists and will have been rejected above.
        debug_assert!(!names.is_empty());
        let name = names.pop().unwrap();
        let parent_id = match self.stream_id_for_name_chain(&names) {
            Some(stream_id) => stream_id,
            None => {
                not_found!("Parent storage doesn't exist");
            }
        };
        let new_stream_id = self.minialloc.insert_dir_entry(
            parent_id,
            name,
            ObjType::Stream,
        )?;
        return Ok(Stream::new(self, new_stream_id));
    }

    /// Removes the stream object at the provided path.
    pub fn remove_stream<P: AsRef<Path>>(
        &mut self,
        path: P,
    ) -> io::Result<()> {
        self.remove_stream_with_path(path.as_ref())
    }

    fn remove_stream_with_path(&mut self, path: &Path) -> io::Result<()> {
        let mut names = internal::path::name_chain_from_path(path)?;
        let stream_id = match self.stream_id_for_name_chain(&names) {
            Some(parent_id) => parent_id,
            None => not_found!("No such stream: {:?}", path),
        };
        let (start_sector_id, is_in_mini_stream) = {
            let dir_entry = self.minialloc.dir_entry(stream_id);
            if dir_entry.obj_type != ObjType::Stream {
                invalid_input!("Not a stream: {:?}", path);
            }
            debug_assert_eq!(dir_entry.child, NO_STREAM);
            (
                dir_entry.start_sector,
                dir_entry.stream_len < consts::MINI_STREAM_CUTOFF as u64,
            )
        };
        if is_in_mini_stream {
            self.minialloc.free_mini_chain(start_sector_id)?;
        } else {
            self.minialloc.free_chain(start_sector_id)?;
        }
        debug_assert!(!names.is_empty());
        let name = names.pop().unwrap();
        let parent_id = self.stream_id_for_name_chain(&names).unwrap();
        self.minialloc.remove_dir_entry(parent_id, name)?;
        Ok(())
    }

    /// Sets the user-defined bitflags for the object at the provided path.
    /// (To get the current state bits for an object, use
    /// `self.entry(path)?.state_bits()`.)
    pub fn set_state_bits<P: AsRef<Path>>(
        &mut self,
        path: P,
        bits: u32,
    ) -> io::Result<()> {
        self.set_state_bits_with_path(path.as_ref(), bits)
    }

    fn set_state_bits_with_path(
        &mut self,
        path: &Path,
        bits: u32,
    ) -> io::Result<()> {
        let names = internal::path::name_chain_from_path(path)?;
        let stream_id = match self.stream_id_for_name_chain(&names) {
            Some(stream_id) => stream_id,
            None => not_found!(
                "No such object: {:?}",
                internal::path::path_from_name_chain(&names)
            ),
        };
        self.minialloc.with_dir_entry_mut(stream_id, |dir_entry| {
            dir_entry.state_bits = bits;
        })
    }

    /// Sets the modified time for the object at the given path to now.  Has no
    /// effect when called on the root storage.
    pub fn touch<P: AsRef<Path>>(&mut self, path: P) -> io::Result<()> {
        self.touch_with_path(path.as_ref())
    }

    fn touch_with_path(&mut self, path: &Path) -> io::Result<()> {
        let names = internal::path::name_chain_from_path(path)?;
        let path = internal::path::path_from_name_chain(&names);
        let stream_id = match self.stream_id_for_name_chain(&names) {
            Some(stream_id) => stream_id,
            None => not_found!("No such object: {:?}", path),
        };
        if stream_id != consts::ROOT_STREAM_ID {
            debug_assert_ne!(
                self.minialloc.dir_entry(stream_id).obj_type,
                ObjType::Root
            );
            self.minialloc.with_dir_entry_mut(stream_id, |dir_entry| {
                dir_entry.modified_time = internal::time::current_timestamp();
            })?;
        }
        Ok(())
    }

    /// Flushes all changes to the underlying file.
    pub fn flush(&mut self) -> io::Result<()> {
        self.minialloc.flush()
    }

    fn write_data_to_stream(
        &mut self,
        stream_id: u32,
        buf_offset_from_start: u64,
        buf: &[u8],
    ) -> io::Result<()> {
        let (old_start_sector, old_stream_len) = {
            let dir_entry = self.minialloc.dir_entry(stream_id);
            debug_assert_eq!(dir_entry.obj_type, ObjType::Stream);
            (dir_entry.start_sector, dir_entry.stream_len)
        };
        debug_assert!(buf_offset_from_start <= old_stream_len);
        let new_stream_len =
            old_stream_len.max(buf_offset_from_start + buf.len() as u64);
        let new_start_sector = if old_start_sector == consts::END_OF_CHAIN {
            // Case 1: The stream has no existing chain.  The stream is empty,
            // and we are writing at the start.
            debug_assert_eq!(old_stream_len, 0);
            debug_assert_eq!(buf_offset_from_start, 0);
            if new_stream_len < consts::MINI_STREAM_CUTOFF as u64 {
                // Case 1a: The data we're writing is small enough that it
                // should be placed into a new mini chain.
                let mut chain =
                    self.minialloc.open_mini_chain(consts::END_OF_CHAIN)?;
                chain.write_all(buf)?;
                chain.start_sector_id()
            } else {
                // Case 1b: The data we're writing is large enough that it
                // should be placed into a new regular chain.
                let mut chain = self
                    .minialloc
                    .open_chain(consts::END_OF_CHAIN, SectorInit::Zero)?;
                chain.write_all(buf)?;
                chain.start_sector_id()
            }
        } else if old_stream_len < consts::MINI_STREAM_CUTOFF as u64 {
            // Case 2: The stream currently exists in a mini chain.
            if new_stream_len < consts::MINI_STREAM_CUTOFF as u64 {
                // Case 2a: After the write, the stream will still be small
                // enough to stay in the mini stream.  Therefore, we should
                // write into this stream's existing mini chain.
                let mut chain =
                    self.minialloc.open_mini_chain(old_start_sector)?;
                chain.seek(SeekFrom::Start(buf_offset_from_start))?;
                chain.write_all(buf)?;
                debug_assert_eq!(chain.start_sector_id(), old_start_sector);
                old_start_sector
            } else {
                // Case 2b: After the write, the stream will be large enough
                // that it cannot be in the mini stream.  Therefore, we should
                // migrate the stream into a new regular chain.
                debug_assert!(
                    buf_offset_from_start < consts::MINI_STREAM_CUTOFF as u64
                );
                let mut tmp = vec![0u8; buf_offset_from_start as usize];
                let mut chain =
                    self.minialloc.open_mini_chain(old_start_sector)?;
                chain.read_exact(&mut tmp)?;
                chain.free()?;
                let mut chain = self
                    .minialloc
                    .open_chain(consts::END_OF_CHAIN, SectorInit::Zero)?;
                chain.write_all(&tmp)?;
                chain.write_all(buf)?;
                chain.start_sector_id()
            }
        } else {
            // Case 3: The stream currently exists in a regular chain.  After
            // the write, it will of course still be too big to be in the mini
            // stream.  Therefore, we should write into this stream's existing
            // chain.
            debug_assert!(new_stream_len >= consts::MINI_STREAM_CUTOFF as u64);
            let mut chain = self
                .minialloc
                .open_chain(old_start_sector, SectorInit::Zero)?;
            chain.seek(SeekFrom::Start(buf_offset_from_start))?;
            chain.write_all(buf)?;
            debug_assert_eq!(chain.start_sector_id(), old_start_sector);
            old_start_sector
        };
        // Update the directory entry for this stream.
        self.minialloc.with_dir_entry_mut(stream_id, |dir_entry| {
            dir_entry.start_sector = new_start_sector;
            dir_entry.stream_len = new_stream_len;
            dir_entry.modified_time = internal::time::current_timestamp();
        })
    }

    /// If `new_stream_len` is less than the stream's current length, then the
    /// stream will be truncated.  If it is greater than the stream's current
    /// size, then the stream will be padded with zero bytes.
    fn resize_stream(
        &mut self,
        stream_id: u32,
        new_stream_len: u64,
    ) -> io::Result<()> {
        let (old_start_sector, old_stream_len) = {
            let dir_entry = self.minialloc.dir_entry(stream_id);
            debug_assert_eq!(dir_entry.obj_type, ObjType::Stream);
            (dir_entry.start_sector, dir_entry.stream_len)
        };
        let new_start_sector = if old_start_sector == consts::END_OF_CHAIN {
            // Case 1: The stream has no existing chain.  We will allocate a
            // new chain that is all zeroes.
            debug_assert_eq!(old_stream_len, 0);
            if new_stream_len < consts::MINI_STREAM_CUTOFF as u64 {
                // Case 1a: The new length is small enough that it should be
                // placed into a new mini chain.
                let mut chain =
                    self.minialloc.open_mini_chain(consts::END_OF_CHAIN)?;
                chain.set_len(new_stream_len)?;
                chain.start_sector_id()
            } else {
                // Case 1b: The new length is large enough that it should be
                // placed into a new regular chain.
                let mut chain = self
                    .minialloc
                    .open_chain(consts::END_OF_CHAIN, SectorInit::Zero)?;
                chain.set_len(new_stream_len)?;
                chain.start_sector_id()
            }
        } else if old_stream_len < consts::MINI_STREAM_CUTOFF as u64 {
            // Case 2: The stream currently exists in a mini chain.
            if new_stream_len == 0 {
                // Case 2a: The new length is zero.  Free the existing mini
                // chain.
                self.minialloc.free_mini_chain(old_start_sector)?;
                consts::END_OF_CHAIN
            } else if new_stream_len < consts::MINI_STREAM_CUTOFF as u64 {
                // Case 2b: The new length is still small enough to fit in a
                // mini chain.  Therefore, we just need to adjust the length of
                // the existing chain.
                let mut chain =
                    self.minialloc.open_mini_chain(old_start_sector)?;
                chain.set_len(new_stream_len)?;
                debug_assert_eq!(chain.start_sector_id(), old_start_sector);
                old_start_sector
            } else {
                // Case 2c: The new length is too large to fit in a mini chain.
                // Therefore, we should migrate the stream into a new regular
                // chain.
                let mut tmp = vec![0u8; old_stream_len as usize];
                let mut chain =
                    self.minialloc.open_mini_chain(old_start_sector)?;
                chain.read_exact(&mut tmp)?;
                chain.free()?;
                let mut chain = self
                    .minialloc
                    .open_chain(consts::END_OF_CHAIN, SectorInit::Zero)?;
                chain.write_all(&tmp)?;
                chain.set_len(new_stream_len)?;
                chain.start_sector_id()
            }
        } else {
            // Case 3: The stream currently exists in a regular chain.
            if new_stream_len == 0 {
                // Case 3a: The new length is zero.  Free the existing chain.
                self.minialloc.free_chain(old_start_sector)?;
                consts::END_OF_CHAIN
            } else if new_stream_len < consts::MINI_STREAM_CUTOFF as u64 {
                // Case 3b: The new length is small enough to fit in a mini
                // chain.  Therefore, we should migrate the stream into a new
                // mini chain.
                debug_assert!(new_stream_len < old_stream_len);
                let mut tmp = vec![0u8; new_stream_len as usize];
                let mut chain = self
                    .minialloc
                    .open_chain(old_start_sector, SectorInit::Zero)?;
                chain.read_exact(&mut tmp)?;
                chain.free()?;
                let mut chain =
                    self.minialloc.open_mini_chain(consts::END_OF_CHAIN)?;
                chain.write_all(&tmp)?;
                chain.start_sector_id()
            } else {
                // Case 3c: The new length is still too large to fit in a mini
                // chain.  Therefore, we just need to adjust the length of the
                // existing chain.
                let mut chain = self
                    .minialloc
                    .open_chain(old_start_sector, SectorInit::Zero)?;
                chain.set_len(new_stream_len)?;
                debug_assert_eq!(chain.start_sector_id(), old_start_sector);
                old_start_sector
            }
        };
        // Update the directory entry for this stream.
        self.minialloc.with_dir_entry_mut(stream_id, |dir_entry| {
            dir_entry.start_sector = new_start_sector;
            dir_entry.stream_len = new_stream_len;
            dir_entry.modified_time = internal::time::current_timestamp();
        })
    }
}

//===========================================================================//

const BUFFER_SIZE: usize = 8192;

/// A stream entry in a compound file, much like a filesystem file.
pub struct Stream<'a, F: 'a> {
    comp: &'a mut CompoundFile<F>,
    stream_id: u32,
    total_len: u64,
    buffer: Box<[u8; BUFFER_SIZE]>,
    buf_pos: usize,
    buf_cap: usize,
    buf_offset_from_start: u64,
    flusher: Option<Box<dyn Flusher<F>>>,
}

impl<'a, F> Stream<'a, F> {
    pub(crate) fn new(
        comp: &'a mut CompoundFile<F>,
        stream_id: u32,
    ) -> Stream<'a, F> {
        let total_len = comp.minialloc.dir_entry(stream_id).stream_len;
        Stream {
            comp,
            stream_id,
            total_len,
            buffer: Box::new([0; BUFFER_SIZE]),
            buf_pos: 0,
            buf_cap: 0,
            buf_offset_from_start: 0,
            flusher: None,
        }
    }

    /// Returns the current length of the stream, in bytes.
    pub fn len(&self) -> u64 {
        self.total_len
    }

    /// Returns true if the stream is empty.
    pub fn is_empty(&self) -> bool {
        self.total_len == 0
    }

    fn current_position(&self) -> u64 {
        self.buf_offset_from_start + (self.buf_pos as u64)
    }

    fn flush_changes(&mut self) -> io::Result<()> {
        if let Some(flusher) = self.flusher.take() {
            flusher.flush_changes(self)?;
        }
        Ok(())
    }
}

impl<'a, F: Read + Write + Seek> Stream<'a, F> {
    /// Truncates or extends the stream, updating the size of this stream to
    /// become `size`.
    ///
    /// If `size` is less than the stream's current size, then the stream will
    /// be shrunk.  If it is greater than the stream's current size, then the
    /// stream will be padded with zero bytes.
    ///
    /// Does not change the current read/write position within the stream,
    /// unless the stream is truncated to before the current position, in which
    /// case the position becomes the new end of the stream.
    pub fn set_len(&mut self, size: u64) -> io::Result<()> {
        if size != self.total_len {
            let new_position = self.current_position().min(size);
            self.flush_changes()?;
            self.comp.resize_stream(self.stream_id, size)?;
            self.total_len = size;
            self.buf_offset_from_start = new_position;
            self.buf_pos = 0;
            self.buf_cap = 0;
        }
        Ok(())
    }

    fn mark_modified(&mut self) {
        if self.flusher.is_none() {
            let flusher: Box<dyn Flusher<F>> = Box::new(FlushBuffer);
            self.flusher = Some(flusher);
        }
    }
}

impl<'a, F: Read + Seek> BufRead for Stream<'a, F> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        if self.buf_pos >= self.buf_cap
            && self.current_position() < self.total_len
        {
            self.flush_changes()?;
            self.buf_offset_from_start += self.buf_pos as u64;
            self.buf_pos = 0;
            self.buf_cap = self.comp.read_data_from_stream(
                self.stream_id,
                self.buf_offset_from_start,
                &mut self.buffer[..],
            )?;
        }
        Ok(&self.buffer[self.buf_pos..self.buf_cap])
    }

    fn consume(&mut self, amt: usize) {
        self.buf_pos = self.buf_cap.min(self.buf_pos + amt);
    }
}

impl<'a, F: Read + Seek> Read for Stream<'a, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let num_bytes = {
            let mut buffered_data = self.fill_buf()?;
            buffered_data.read(buf)?
        };
        self.consume(num_bytes);
        Ok(num_bytes)
    }
}

impl<'a, F: Read + Seek> Seek for Stream<'a, F> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let new_pos: u64 =
            match pos {
                SeekFrom::Start(delta) => {
                    if delta > self.total_len {
                        invalid_input!(
                        "Cannot seek to {} bytes from start, because stream \
                         length is only {} bytes",
                        delta, self.total_len,
                    );
                    }
                    delta
                }
                SeekFrom::End(delta) => {
                    if delta > 0 {
                        invalid_input!(
                        "Cannot seek to {} bytes past the end of the stream",
                        delta,
                    );
                    } else {
                        let delta = (-delta) as u64;
                        if delta > self.total_len {
                            invalid_input!(
                                "Cannot seek to {} bytes before end, because \
                             stream length is only {} bytes",
                                delta,
                                self.total_len,
                            );
                        }
                        self.total_len - delta
                    }
                }
                SeekFrom::Current(delta) => {
                    let old_pos = self.current_position();
                    debug_assert!(old_pos <= self.total_len);
                    if delta < 0 {
                        let delta = (-delta) as u64;
                        if delta > old_pos {
                            invalid_input!(
                            "Cannot seek to {} bytes before current position, \
                             which is only {}",
                            delta, old_pos,
                        );
                        }
                        old_pos - delta
                    } else {
                        let delta = delta as u64;
                        let remaining = self.total_len - old_pos;
                        if delta > remaining {
                            invalid_input!(
                            "Cannot seek to {} bytes after current position, \
                             because there are only {} bytes remaining in the \
                             stream",
                            delta, remaining,
                        );
                        }
                        old_pos + delta
                    }
                }
            };
        if new_pos < self.buf_offset_from_start
            || new_pos > self.buf_offset_from_start + self.buf_cap as u64
        {
            self.flush_changes()?;
            self.buf_offset_from_start = new_pos;
            self.buf_pos = 0;
            self.buf_cap = 0;
        } else {
            self.buf_pos = (new_pos - self.buf_offset_from_start) as usize;
        }
        Ok(new_pos)
    }
}

impl<'a, F: Read + Write + Seek> Write for Stream<'a, F> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        debug_assert!(self.buf_pos <= self.buffer.len());
        if self.buf_pos >= self.buffer.len() {
            self.flush_changes()?;
            self.buf_offset_from_start += self.buf_pos as u64;
            self.buf_pos = 0;
            self.buf_cap = 0;
        }
        let num_bytes_written =
            (&mut self.buffer[self.buf_pos..]).write(buf)?;
        self.mark_modified();
        self.buf_pos += num_bytes_written;
        debug_assert!(self.buf_pos <= self.buffer.len());
        self.buf_cap = self.buf_cap.max(self.buf_pos);
        self.total_len = self
            .total_len
            .max(self.buf_offset_from_start + self.buf_cap as u64);
        Ok(num_bytes_written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.flush_changes()?;
        self.comp.minialloc.flush()
    }
}

impl<'a, F> Drop for Stream<'a, F> {
    fn drop(&mut self) {
        let _ = self.flush_changes();
    }
}

//===========================================================================//

trait Flusher<F> {
    fn flush_changes(&self, stream: &mut Stream<F>) -> io::Result<()>;
}

struct FlushBuffer;

impl<F: Read + Write + Seek> Flusher<F> for FlushBuffer {
    fn flush_changes(&self, stream: &mut Stream<F>) -> io::Result<()> {
        stream.comp.write_data_to_stream(
            stream.stream_id,
            stream.buf_offset_from_start,
            &stream.buffer[..stream.buf_cap],
        )?;
        debug_assert_eq!(
            stream.comp.minialloc.dir_entry(stream.stream_id).stream_len,
            stream.total_len
        );
        Ok(())
    }
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::CompoundFile;
    use crate::internal::{consts, DirEntry, Header, Version};
    use byteorder::{LittleEndian, WriteBytesExt};
    use std::io::{self, Cursor};
    use std::mem::size_of;

    /// Regression test for https://github.com/mdsteele/rust-cfb/issues/8.
    #[test]
    fn zero_padded_fat() -> io::Result<()> {
        let version = Version::V3;
        let mut data = Vec::<u8>::new();
        let mut header = Header {
            version,
            num_dir_sectors: 1,
            num_fat_sectors: 1,
            first_dir_sector: 1,
            first_minifat_sector: consts::END_OF_CHAIN,
            num_minifat_sectors: 0,
            first_difat_sector: consts::END_OF_CHAIN,
            num_difat_sectors: 0,
            initial_difat_entries: [consts::FREE_SECTOR;
                consts::NUM_DIFAT_ENTRIES_IN_HEADER],
        };
        header.initial_difat_entries[0] = 0;
        header.write_to(&mut data)?;

        // Write FAT sector:
        let fat: Vec<u32> = vec![consts::FAT_SECTOR, consts::END_OF_CHAIN];
        for &entry in fat.iter() {
            data.write_u32::<LittleEndian>(entry)?;
        }
        // Pad the FAT sector with zeros instead of FREE_SECTOR.  Technically
        // this violates the MS-CFB spec (section 2.3), but apparently some CFB
        // implementations do this.
        for _ in fat.len()..(version.sector_len() / size_of::<u32>()) {
            data.write_u32::<LittleEndian>(0)?;
        }

        // Write directory sector:
        DirEntry::empty_root_entry().write_to(&mut data)?;
        for _ in 1..version.dir_entries_per_sector() {
            DirEntry::unallocated().write_to(&mut data)?;
        }

        // Despite the zero-padded FAT, we should be able to read this file.
        CompoundFile::open(Cursor::new(data)).expect("open");
        Ok(())
    }
}

//===========================================================================//
