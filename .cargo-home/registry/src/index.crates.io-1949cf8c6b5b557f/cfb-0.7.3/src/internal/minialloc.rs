use crate::internal::{
    consts, Chain, DirEntry, Directory, Entries, MiniChain, ObjType, Sector,
    SectorInit, Version,
};
use byteorder::{LittleEndian, WriteBytesExt};
use fnv::FnvHashSet;
use std::io::{self, Seek, SeekFrom, Write};
use std::mem::size_of;
use std::path::Path;

//===========================================================================//

macro_rules! malformed {
    ($e:expr) => { invalid_data!("Malformed MiniFAT ({})", $e) };
    ($fmt:expr, $($arg:tt)+) => {
        invalid_data!("Malformed MiniFAT ({})", format!($fmt, $($arg)+))
    };
}

//===========================================================================//

/// A wrapper around the directory manager that additionally provides
/// mini-sector allocation via the MiniFAT.
pub struct MiniAllocator<F> {
    directory: Directory<F>,
    minifat: Vec<u32>,
    minifat_start_sector: u32,
}

impl<F> MiniAllocator<F> {
    pub fn new(
        directory: Directory<F>,
        minifat: Vec<u32>,
        minifat_start_sector: u32,
    ) -> io::Result<MiniAllocator<F>> {
        let minialloc =
            MiniAllocator { directory, minifat, minifat_start_sector };
        minialloc.validate()?;
        Ok(minialloc)
    }

    pub fn version(&self) -> Version {
        self.directory.version()
    }

    pub fn next_mini_sector(&self, sector_id: u32) -> io::Result<u32> {
        let index = sector_id as usize;
        if index >= self.minifat.len() {
            invalid_data!(
                "Found reference to mini sector {}, but MiniFAT has only {} \
                 entries",
                index,
                self.minifat.len()
            );
        }
        let next_id = self.minifat[index];
        if next_id != consts::END_OF_CHAIN
            && (next_id > consts::MAX_REGULAR_SECTOR
                || next_id as usize >= self.minifat.len())
        {
            invalid_data!("next_id ({}) is invalid", next_id);
        }
        Ok(next_id)
    }

    pub fn into_inner(self) -> F {
        self.directory.into_inner()
    }

    pub fn stream_id_for_name_chain(&self, names: &[&str]) -> Option<u32> {
        self.directory.stream_id_for_name_chain(names)
    }

    /// Returns an iterator over the entries within the root storage object.
    pub fn root_storage_entries(&self) -> Entries {
        self.directory.root_storage_entries()
    }

    /// Returns an iterator over the entries within a storage object.
    pub fn storage_entries(&self, path: &Path) -> io::Result<Entries> {
        self.directory.storage_entries(path)
    }

    /// Returns an iterator over all entries within the compound file, starting
    /// from and including the root entry.  The iterator walks the storage tree
    /// in a preorder traversal.
    pub fn walk(&self) -> Entries {
        self.directory.walk()
    }

    /// Returns an iterator over all entries under a storage subtree, including
    /// the given path itself.  The iterator walks the storage tree in a
    /// preorder traversal.
    pub fn walk_storage(&self, path: &Path) -> io::Result<Entries> {
        self.directory.walk_storage(path)
    }

    pub fn open_chain(
        &mut self,
        start_sector_id: u32,
        init: SectorInit,
    ) -> io::Result<Chain<F>> {
        self.directory.open_chain(start_sector_id, init)
    }

    pub fn open_mini_chain(
        &mut self,
        start_sector_id: u32,
    ) -> io::Result<MiniChain<F>> {
        MiniChain::new(self, start_sector_id)
    }

    pub fn root_dir_entry(&self) -> &DirEntry {
        self.directory.root_dir_entry()
    }

    pub fn dir_entry(&self, stream_id: u32) -> &DirEntry {
        self.directory.dir_entry(stream_id)
    }

    fn validate(&self) -> io::Result<()> {
        let root_entry = self.directory.root_dir_entry();
        let root_stream_mini_sectors =
            root_entry.stream_len / (consts::MINI_SECTOR_LEN as u64);
        if root_stream_mini_sectors < (self.minifat.len() as u64) {
            malformed!(
                "MiniFAT has {} entries, but root stream has only {} mini \
                 sectors",
                self.minifat.len(),
                root_stream_mini_sectors
            );
        }
        let mut pointees = FnvHashSet::default();
        for (from_mini_sector, &to_mini_sector) in
            self.minifat.iter().enumerate()
        {
            if to_mini_sector <= consts::MAX_REGULAR_SECTOR {
                if to_mini_sector as usize >= self.minifat.len() {
                    malformed!(
                        "MiniFAT has {} entries, but mini sector {} points to \
                         {}",
                        self.minifat.len(),
                        from_mini_sector,
                        to_mini_sector
                    );
                }
                if pointees.contains(&to_mini_sector) {
                    malformed!(
                        "mini sector {} pointed to twice",
                        to_mini_sector
                    );
                }
                pointees.insert(to_mini_sector);
            }
        }
        Ok(())
    }
}

impl<F: Seek> MiniAllocator<F> {
    pub fn seek_within_mini_sector(
        &mut self,
        mini_sector: u32,
        offset_within_mini_sector: u64,
    ) -> io::Result<Sector<F>> {
        debug_assert!(
            offset_within_mini_sector < consts::MINI_SECTOR_LEN as u64
        );
        let mini_stream_start_sector =
            self.directory.root_dir_entry().start_sector;
        let chain = self
            .directory
            .open_chain(mini_stream_start_sector, SectorInit::Fat)?;
        chain.into_subsector(
            mini_sector,
            consts::MINI_SECTOR_LEN,
            offset_within_mini_sector,
        )
    }
}

impl<F: Write + Seek> MiniAllocator<F> {
    /// Given the start sector of a chain, deallocates the entire chain.
    pub fn free_chain(&mut self, start_sector_id: u32) -> io::Result<()> {
        self.directory.free_chain(start_sector_id)
    }

    /// Inserts a new directory entry into the tree under the specified parent
    /// entry, then returns the new stream ID.
    pub fn insert_dir_entry(
        &mut self,
        parent_id: u32,
        name: &str,
        obj_type: ObjType,
    ) -> io::Result<u32> {
        self.directory.insert_dir_entry(parent_id, name, obj_type)
    }

    /// Removes a directory entry from the tree and deallocates it.
    pub fn remove_dir_entry(
        &mut self,
        parent_id: u32,
        name: &str,
    ) -> io::Result<()> {
        self.directory.remove_dir_entry(parent_id, name)
    }

    /// Calls the given function with a mutable reference to the specified
    /// directory entry, then writes the updated directory entry to the
    /// underlying file once the function returns.
    pub fn with_dir_entry_mut<W>(
        &mut self,
        stream_id: u32,
        func: W,
    ) -> io::Result<()>
    where
        W: FnOnce(&mut DirEntry),
    {
        self.directory.with_dir_entry_mut(stream_id, func)
    }

    /// Allocates a new mini chain with one sector, and returns the starting
    /// sector number.
    pub fn begin_mini_chain(&mut self) -> io::Result<u32> {
        self.allocate_mini_sector(consts::END_OF_CHAIN)
    }

    /// Given the starting mini sector (or any internal mini sector) of a mini
    /// chain, extends the end of that chain by one mini sector and returns the
    /// new mini sector number, updating the MiniFAT as necessary.
    pub fn extend_mini_chain(
        &mut self,
        start_mini_sector: u32,
    ) -> io::Result<u32> {
        debug_assert_ne!(start_mini_sector, consts::END_OF_CHAIN);
        let mut last_mini_sector = start_mini_sector;
        loop {
            let next = self.minifat[last_mini_sector as usize];
            if next == consts::END_OF_CHAIN {
                break;
            }
            last_mini_sector = next;
        }
        let new_mini_sector =
            self.allocate_mini_sector(consts::END_OF_CHAIN)?;
        self.set_minifat(last_mini_sector, new_mini_sector)?;
        Ok(new_mini_sector)
    }

    /// Allocates a new entry in the MiniFAT, sets its value to `value`, and
    /// returns the new mini sector number.
    fn allocate_mini_sector(&mut self, value: u32) -> io::Result<u32> {
        // If there's an existing free mini sector, use that.
        for mini_sector in 0..self.minifat.len() {
            if self.minifat[mini_sector] == consts::FREE_SECTOR {
                let mini_sector = mini_sector as u32;
                self.set_minifat(mini_sector, value)?;
                return Ok(mini_sector);
            }
        }
        // Otherwise, we need a new mini sector; if there's not room in the
        // MiniFAT to add it, then first we need to allocate a new MiniFAT
        // sector.
        let minifat_entries_per_sector = self.directory.sector_len() / 4;
        if self.minifat_start_sector == consts::END_OF_CHAIN {
            debug_assert!(self.minifat.is_empty());
            self.minifat_start_sector =
                self.directory.begin_chain(SectorInit::Fat)?;
            let mut header = self.directory.seek_within_header(60)?;
            header.write_u32::<LittleEndian>(self.minifat_start_sector)?;
            header.write_u32::<LittleEndian>(1)?;
        } else if self.minifat.len() % minifat_entries_per_sector == 0 {
            let start = self.minifat_start_sector;
            self.directory.extend_chain(start, SectorInit::Fat)?;
            let num_minifat_sectors = self
                .directory
                .open_chain(start, SectorInit::Fat)?
                .num_sectors() as u32;
            let mut header = self.directory.seek_within_header(64)?;
            header.write_u32::<LittleEndian>(num_minifat_sectors)?;
        }
        // Add a new mini sector to the end of the mini stream and return it.
        let new_mini_sector = self.minifat.len() as u32;
        self.set_minifat(new_mini_sector, value)?;
        self.append_mini_sector()?;
        Ok(new_mini_sector)
    }

    /// Adds a new mini sector to the end of the mini stream.
    fn append_mini_sector(&mut self) -> io::Result<()> {
        let mini_stream_start_sector =
            self.directory.root_dir_entry().start_sector;
        let mini_stream_len = self.directory.root_dir_entry().stream_len;
        debug_assert_eq!(mini_stream_len % consts::MINI_SECTOR_LEN as u64, 0);
        let sector_len = self.directory.sector_len();

        // If the mini stream doesn't have room for new mini sector, add
        // another regular sector to its chain.
        let new_start_sector =
            if mini_stream_start_sector == consts::END_OF_CHAIN {
                debug_assert_eq!(mini_stream_len, 0);
                self.directory.begin_chain(SectorInit::Zero)?
            } else {
                if mini_stream_len % sector_len as u64 == 0 {
                    self.directory.extend_chain(
                        mini_stream_start_sector,
                        SectorInit::Zero,
                    )?;
                }
                mini_stream_start_sector
            };

        // Update length of mini stream in root directory entry.
        self.directory.with_root_dir_entry_mut(|dir_entry| {
            dir_entry.start_sector = new_start_sector;
            dir_entry.stream_len += consts::MINI_SECTOR_LEN as u64;
        })
    }

    /// Deallocates the specified mini sector.
    fn free_mini_sector(&mut self, mini_sector: u32) -> io::Result<()> {
        self.set_minifat(mini_sector, consts::FREE_SECTOR)?;
        let mut mini_stream_len = self.directory.root_dir_entry().stream_len;
        debug_assert_eq!(mini_stream_len % consts::MINI_SECTOR_LEN as u64, 0);
        while self.minifat.last() == Some(&consts::FREE_SECTOR) {
            mini_stream_len -= consts::MINI_SECTOR_LEN as u64;
            self.minifat.pop();
            // TODO: Truncate MiniFAT if last MiniFAT sector is now all free.
        }

        if mini_stream_len != self.directory.root_dir_entry().stream_len {
            self.directory.with_root_dir_entry_mut(|dir_entry| {
                dir_entry.stream_len = mini_stream_len;
            })?;
        }
        Ok(())
    }

    /// Given the start sector of a mini chain, deallocates the entire chain.
    pub fn free_mini_chain(
        &mut self,
        start_mini_sector: u32,
    ) -> io::Result<()> {
        let mut mini_sector = start_mini_sector;
        while mini_sector != consts::END_OF_CHAIN {
            let next = self.minifat[mini_sector as usize];
            self.free_mini_sector(mini_sector)?;
            mini_sector = next;
        }
        Ok(())
    }

    /// Sets the given mini sector to point to `END_OF_CHAIN`, and deallocates
    /// all subsequent mini sectors in the chain.
    pub fn free_mini_chain_after(
        &mut self,
        mini_sector: u32,
    ) -> io::Result<()> {
        let next = self.minifat[mini_sector as usize];
        self.set_minifat(mini_sector, consts::END_OF_CHAIN)?;
        self.free_mini_chain(next)?;
        Ok(())
    }

    /// Sets `self.minifat[index] = value`, and also writes that change to the
    /// underlying file.  The `index` must be <= `self.minifat.len()`.
    fn set_minifat(&mut self, index: u32, value: u32) -> io::Result<()> {
        debug_assert!(index as usize <= self.minifat.len());
        let mut chain = self
            .directory
            .open_chain(self.minifat_start_sector, SectorInit::Fat)?;
        let offset = (index as u64) * size_of::<u32>() as u64;
        debug_assert!(chain.len() >= offset + size_of::<u32>() as u64);
        chain.seek(SeekFrom::Start(offset))?;
        chain.write_u32::<LittleEndian>(value)?;
        if (index as usize) == self.minifat.len() {
            self.minifat.push(value);
        } else {
            self.minifat[index as usize] = value;
        }
        Ok(())
    }

    /// Flushes all changes to the underlying file.
    pub fn flush(&mut self) -> io::Result<()> {
        self.directory.flush()
    }
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::MiniAllocator;
    use crate::internal::{
        consts, Allocator, DirEntry, Directory, ObjType, Sectors, Version,
    };
    use std::io::Cursor;

    fn make_minialloc(minifat: Vec<u32>) -> MiniAllocator<Cursor<Vec<u8>>> {
        let root_stream_len = (consts::MINI_SECTOR_LEN * minifat.len()) as u64;
        make_minialloc_with_root_stream_len(minifat, root_stream_len)
    }

    fn make_minialloc_with_root_stream_len(
        minifat: Vec<u32>,
        root_stream_len: u64,
    ) -> MiniAllocator<Cursor<Vec<u8>>> {
        let version = Version::V3;
        let num_sectors = 4; // FAT, Directory, MiniFAT, and mini chain
        let data_len = (1 + num_sectors) * version.sector_len();
        let cursor = Cursor::new(vec![0; data_len]);
        let sectors = Sectors::new(version, data_len as u64, cursor);
        let mut fat = vec![consts::END_OF_CHAIN; num_sectors];
        fat[0] = consts::FAT_SECTOR;
        let allocator = Allocator::new(sectors, vec![], vec![0], fat).unwrap();
        let mut root_entry = DirEntry::empty_root_entry();
        root_entry.child = 1;
        root_entry.start_sector = 3;
        root_entry.stream_len = root_stream_len;
        let mut stream_entry = DirEntry::new("foo", ObjType::Stream, 0);
        stream_entry.start_sector = 0;
        stream_entry.stream_len = root_entry.stream_len;
        let entries = vec![root_entry, stream_entry];
        let directory = Directory::new(allocator, entries, 1).unwrap();
        MiniAllocator::new(directory, minifat, 2).unwrap()
    }

    #[test]
    #[should_panic(
        expected = "Malformed MiniFAT (MiniFAT has 3 entries, but root stream \
                    has only 2 mini sectors)"
    )]
    fn root_stream_too_short() {
        let minifat = vec![1, 2, consts::END_OF_CHAIN];
        let root_stream_len = (2 * consts::MINI_SECTOR_LEN) as u64;
        make_minialloc_with_root_stream_len(minifat, root_stream_len);
    }

    #[test]
    #[should_panic(
        expected = "Malformed MiniFAT (MiniFAT has 2 entries, but mini sector \
                    1 points to 3)"
    )]
    fn pointee_out_of_range() {
        let minifat = vec![1, 3];
        make_minialloc(minifat);
    }

    #[test]
    #[should_panic(
        expected = "Malformed MiniFAT (mini sector 1 pointed to twice)"
    )]
    fn double_pointee() {
        let minifat = vec![1, 2, 1];
        make_minialloc(minifat);
    }
}

//===========================================================================//
