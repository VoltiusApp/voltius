use crate::internal::{consts, MiniAllocator};
use std::io::{self, Read, Seek, SeekFrom, Write};

//===========================================================================//

pub struct MiniChain<'a, F: 'a> {
    minialloc: &'a mut MiniAllocator<F>,
    sector_ids: Vec<u32>,
    offset_from_start: u64,
}

impl<'a, F> MiniChain<'a, F> {
    pub fn new(
        minialloc: &'a mut MiniAllocator<F>,
        start_sector_id: u32,
    ) -> io::Result<MiniChain<'a, F>> {
        let mut sector_ids = Vec::<u32>::new();
        let mut current_sector_id = start_sector_id;
        let first_sector_id = start_sector_id;
        while current_sector_id != consts::END_OF_CHAIN {
            sector_ids.push(current_sector_id);
            current_sector_id =
                minialloc.next_mini_sector(current_sector_id)?;
            if current_sector_id == first_sector_id {
                invalid_data!(
                    "Minichain contained duplicate sector id {}",
                    current_sector_id
                );
            }
        }
        Ok(MiniChain { minialloc, sector_ids, offset_from_start: 0 })
    }

    pub fn start_sector_id(&self) -> u32 {
        self.sector_ids.first().copied().unwrap_or(consts::END_OF_CHAIN)
    }

    pub fn len(&self) -> u64 {
        (consts::MINI_SECTOR_LEN as u64) * (self.sector_ids.len() as u64)
    }
}

impl<'a, F: Read + Write + Seek> MiniChain<'a, F> {
    /// Resizes the chain to the minimum number of sectors large enough to old
    /// `new_len` bytes, allocating or freeing sectors as needed.
    pub fn set_len(&mut self, new_len: u64) -> io::Result<()> {
        debug_assert!(new_len < consts::MINI_STREAM_CUTOFF as u64);
        let sector_len = consts::MINI_SECTOR_LEN as u64;
        let new_num_sectors =
            ((sector_len + new_len - 1) / sector_len) as usize;
        if new_num_sectors == 0 {
            if let Some(&start_sector) = self.sector_ids.first() {
                self.minialloc.free_mini_chain(start_sector)?;
            }
        } else if new_num_sectors <= self.sector_ids.len() {
            if new_num_sectors < self.sector_ids.len() {
                self.minialloc.free_mini_chain_after(
                    self.sector_ids[new_num_sectors - 1],
                )?;
            }
            // TODO: zero remainder of final sector
        } else {
            for _ in self.sector_ids.len()..new_num_sectors {
                let new_sector_id =
                    if let Some(&last_sector_id) = self.sector_ids.last() {
                        self.minialloc.extend_mini_chain(last_sector_id)?
                    } else {
                        self.minialloc.begin_mini_chain()?
                    };
                self.sector_ids.push(new_sector_id);
            }
        }
        Ok(())
    }

    pub fn free(self) -> io::Result<()> {
        self.minialloc.free_mini_chain(self.start_sector_id())
    }
}

impl<'a, F> Seek for MiniChain<'a, F> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let length = self.len();
        let new_offset = match pos {
            SeekFrom::Start(delta) => delta as i64,
            SeekFrom::End(delta) => delta + length as i64,
            SeekFrom::Current(delta) => delta + self.offset_from_start as i64,
        };
        if new_offset < 0 || (new_offset as u64) > length {
            invalid_input!(
                "Cannot seek to {}, chain length is {} bytes",
                new_offset,
                length
            );
        }
        self.offset_from_start = new_offset as u64;
        Ok(self.offset_from_start)
    }
}

impl<'a, F: Read + Seek> Read for MiniChain<'a, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let total_len = self.len();
        debug_assert!(self.offset_from_start <= total_len);
        let remaining_in_chain = total_len - self.offset_from_start;
        let max_len = remaining_in_chain.min(buf.len() as u64) as usize;
        if max_len == 0 {
            return Ok(0);
        }
        let sector_len = consts::MINI_SECTOR_LEN as u64;
        let current_sector_index =
            (self.offset_from_start / sector_len) as usize;
        debug_assert!(current_sector_index < self.sector_ids.len());
        let current_sector_id = self.sector_ids[current_sector_index];
        let offset_within_sector = self.offset_from_start % sector_len;
        let mut sector = self.minialloc.seek_within_mini_sector(
            current_sector_id,
            offset_within_sector,
        )?;
        let bytes_read = sector.read(&mut buf[0..max_len])?;
        self.offset_from_start += bytes_read as u64;
        debug_assert!(self.offset_from_start <= total_len);
        Ok(bytes_read)
    }
}

impl<'a, F: Read + Write + Seek> Write for MiniChain<'a, F> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let mut total_len = self.len();
        let sector_len = consts::MINI_SECTOR_LEN as u64;
        if self.offset_from_start == total_len {
            let new_sector_id =
                if let Some(&last_sector_id) = self.sector_ids.last() {
                    self.minialloc.extend_mini_chain(last_sector_id)?
                } else {
                    self.minialloc.begin_mini_chain()?
                };
            self.sector_ids.push(new_sector_id);
            total_len += sector_len;
            debug_assert_eq!(total_len, self.len());
        }
        let current_sector_index =
            (self.offset_from_start / sector_len) as usize;
        debug_assert!(current_sector_index < self.sector_ids.len());
        let current_sector_id = self.sector_ids[current_sector_index];
        let offset_within_sector = self.offset_from_start % sector_len;
        let mut sector = self.minialloc.seek_within_mini_sector(
            current_sector_id,
            offset_within_sector,
        )?;
        let bytes_written = sector.write(buf)?;
        self.offset_from_start += bytes_written as u64;
        debug_assert!(self.offset_from_start <= total_len);
        Ok(bytes_written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.minialloc.flush()
    }
}

//===========================================================================//
