pub struct CrcTable([[u32; 256]; 4]);

#[allow(dead_code)]
impl CrcTable {
    pub fn at(&self, i: u8, j: u8) -> u32 {
        let i = i as usize;
        let j = j as usize;
        self.0[i][j]
    }

    pub fn shift_u32(&self, crc: u32) -> u32 {
        let mut result = self.at(0, crc as u8);

        for i in 1..4 {
            let shift = i * 8;
            result ^= self.at(i, (crc >> shift) as u8);
        }

        result
    }

    pub fn shift_u64(&self, crc: u64) -> u64 {
        let mut result = u64::from(self.at(0, crc as u8));

        for i in 1..4 {
            let shift = i * 8;
            result ^= u64::from(self.at(i, (crc >> shift) as u8));
        }

        result
    }
}

pub const LONG: usize = 8192;
pub const SHORT: usize = 256;
pub const LONG_TABLE: CrcTable = CrcTable(include!(concat!(env!("OUT_DIR"), "/", "hw.long.table")));
pub const SHORT_TABLE: CrcTable =
    CrcTable(include!(concat!(env!("OUT_DIR"), "/", "hw.short.table")));
