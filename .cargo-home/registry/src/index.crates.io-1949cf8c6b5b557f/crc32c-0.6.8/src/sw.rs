//! Implements crc32c without hardware support.

use crate::util::{self, U64Le};

/// 8-KiB lookup table.
pub struct CrcTable([[u32; 256]; 8]);

impl CrcTable {
    /// Returns an entry from the table.
    #[inline]
    pub fn at(&self, i: u8, j: u8) -> u64 {
        let i = i as usize;
        let j = j as usize;
        u64::from(self.0[i][j])
    }
}

const CRC_TABLE: CrcTable = CrcTable(include!(concat!(env!("OUT_DIR"), "/", "sw.table")));

/// Software implementation of the algorithm.
pub fn crc32c(crci: u32, buffer: &[u8]) -> u32 {
    let mut crc = u64::from(!crci);

    let (start, mid, end) = util::split(buffer);

    crc = crc_u8(crc, start);

    crc = crc_u64(crc, mid);

    crc = crc_u8(crc, end);

    !(crc as u32)
}

#[inline]
fn crc_u8(crc: u64, buffer: &[u8]) -> u64 {
    buffer.iter().fold(crc, |crc, &next| {
        let index = (crc ^ u64::from(next)) as u8;
        CRC_TABLE.at(0, index) ^ (crc >> 8)
    })
}

#[inline]
fn crc_u64(crci: u64, buffer: &[U64Le]) -> u64 {
    buffer.iter().fold(crci, |crc, &next| {
        let crc = crc ^ next.get();

        // Note: I've tried refactoring this to a for-loop,
        // but then it gets worse performance.
        CRC_TABLE.at(7, crc as u8)
            ^ CRC_TABLE.at(6, (crc >> 8) as u8)
            ^ CRC_TABLE.at(5, (crc >> 16) as u8)
            ^ CRC_TABLE.at(4, (crc >> 24) as u8)
            ^ CRC_TABLE.at(3, (crc >> 32) as u8)
            ^ CRC_TABLE.at(2, (crc >> 40) as u8)
            ^ CRC_TABLE.at(1, (crc >> 48) as u8)
            ^ CRC_TABLE.at(0, (crc >> 56) as u8)
    })
}
