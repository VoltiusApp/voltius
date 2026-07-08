use crate::internal::{consts, Version};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use std::io::{self, Read, Write};

//===========================================================================//

pub struct Header {
    pub version: Version,
    pub num_dir_sectors: u32,
    pub num_fat_sectors: u32,
    pub first_dir_sector: u32,
    pub first_minifat_sector: u32,
    pub num_minifat_sectors: u32,
    pub first_difat_sector: u32,
    pub num_difat_sectors: u32,
    pub initial_difat_entries: [u32; consts::NUM_DIFAT_ENTRIES_IN_HEADER],
}

impl Header {
    pub fn read_from<R: Read>(reader: &mut R) -> io::Result<Header> {
        let mut magic = [0u8; 8];
        reader.read_exact(&mut magic)?;
        if magic != consts::MAGIC_NUMBER {
            invalid_data!("Invalid CFB file (wrong magic number)");
        }
        reader.read_exact(&mut [0u8; 16])?; // reserved field

        // Read the version number, but don't try to interpret it until after
        // we've checked the byte order mark.
        let _minor_version = reader.read_u16::<LittleEndian>()?;
        let version_number = reader.read_u16::<LittleEndian>()?;

        let byte_order_mark = reader.read_u16::<LittleEndian>()?;
        if byte_order_mark != consts::BYTE_ORDER_MARK {
            invalid_data!(
                "Invalid CFB byte order mark (expected 0x{:04X}, found \
                 0x{:04X})",
                consts::BYTE_ORDER_MARK,
                byte_order_mark
            );
        }

        let version = match Version::from_number(version_number) {
            Some(version) => version,
            None => {
                invalid_data!(
                    "CFB version {} is not supported",
                    version_number
                );
            }
        };

        let sector_shift = reader.read_u16::<LittleEndian>()?;
        if sector_shift != version.sector_shift() {
            invalid_data!(
                "Incorrect sector shift for CFB version {} (expected {}, \
                 found {})",
                version.number(),
                version.sector_shift(),
                sector_shift
            );
        }

        let mini_sector_shift = reader.read_u16::<LittleEndian>()?;
        if mini_sector_shift != consts::MINI_SECTOR_SHIFT {
            invalid_data!(
                "Incorrect mini sector shift (expected {}, found {})",
                consts::MINI_SECTOR_SHIFT,
                mini_sector_shift
            );
        }
        reader.read_exact(&mut [0u8; 6])?; // reserved field

        let num_dir_sectors = reader.read_u32::<LittleEndian>()?;
        let num_fat_sectors = reader.read_u32::<LittleEndian>()?;
        let first_dir_sector = reader.read_u32::<LittleEndian>()?;
        let _transaction_signature = reader.read_u32::<LittleEndian>()?;

        let mini_stream_cutoff = reader.read_u32::<LittleEndian>()?;
        if mini_stream_cutoff != consts::MINI_STREAM_CUTOFF {
            invalid_data!(
                "Incorrect mini stream cutoff (expected {}, found {})",
                consts::MINI_STREAM_CUTOFF,
                mini_stream_cutoff
            );
        }

        let first_minifat_sector = reader.read_u32::<LittleEndian>()?;
        let num_minifat_sectors = reader.read_u32::<LittleEndian>()?;
        let mut first_difat_sector = reader.read_u32::<LittleEndian>()?;
        let num_difat_sectors = reader.read_u32::<LittleEndian>()?;

        // Some CFB implementations use FREE_SECTOR to indicate END_OF_CHAIN.
        if first_difat_sector == consts::FREE_SECTOR {
            first_difat_sector = consts::END_OF_CHAIN;
        }

        let mut initial_difat_entries =
            [consts::FREE_SECTOR; consts::NUM_DIFAT_ENTRIES_IN_HEADER];
        for entry in initial_difat_entries.iter_mut() {
            let next = reader.read_u32::<LittleEndian>()?;
            if next == consts::FREE_SECTOR {
                break;
            } else if next > consts::MAX_REGULAR_SECTOR {
                invalid_data!(
                    "Initial DIFAT array refers to invalid sector index \
                     0x{:08X}",
                    next
                );
            }
            *entry = next;
        }

        Ok(Header {
            version,
            num_dir_sectors,
            num_fat_sectors,
            first_dir_sector,
            first_minifat_sector,
            num_minifat_sectors,
            first_difat_sector,
            num_difat_sectors,
            initial_difat_entries,
        })
    }

    pub fn write_to<W: Write>(&self, writer: &mut W) -> io::Result<()> {
        writer.write_all(&consts::MAGIC_NUMBER)?;
        writer.write_all(&[0; 16])?; // reserved field
        writer.write_u16::<LittleEndian>(consts::MINOR_VERSION)?;
        writer.write_u16::<LittleEndian>(self.version.number())?;
        writer.write_u16::<LittleEndian>(consts::BYTE_ORDER_MARK)?;
        writer.write_u16::<LittleEndian>(self.version.sector_shift())?;
        writer.write_u16::<LittleEndian>(consts::MINI_SECTOR_SHIFT)?;
        writer.write_all(&[0; 6])?; // reserved field
        writer.write_u32::<LittleEndian>(self.num_dir_sectors)?;
        writer.write_u32::<LittleEndian>(self.num_fat_sectors)?;
        writer.write_u32::<LittleEndian>(self.first_dir_sector)?;
        writer.write_u32::<LittleEndian>(0)?; // transaction signature (unused)
        writer.write_u32::<LittleEndian>(consts::MINI_STREAM_CUTOFF)?;
        writer.write_u32::<LittleEndian>(self.first_minifat_sector)?;
        writer.write_u32::<LittleEndian>(self.num_minifat_sectors)?;
        writer.write_u32::<LittleEndian>(self.first_difat_sector)?;
        writer.write_u32::<LittleEndian>(self.num_difat_sectors)?;
        for &entry in self.initial_difat_entries.iter() {
            writer.write_u32::<LittleEndian>(entry)?;
        }
        Ok(())
    }
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::Header;
    use crate::internal::{consts, Version};

    fn make_valid_header() -> Header {
        let mut header = Header {
            version: Version::V3,
            num_dir_sectors: 2,
            num_fat_sectors: 1,
            first_dir_sector: 1,
            first_minifat_sector: 2,
            num_minifat_sectors: 3,
            first_difat_sector: consts::END_OF_CHAIN,
            num_difat_sectors: 0,
            initial_difat_entries: [consts::FREE_SECTOR;
                consts::NUM_DIFAT_ENTRIES_IN_HEADER],
        };
        header.initial_difat_entries[0] = 0;
        header
    }

    fn make_valid_header_data() -> Vec<u8> {
        let header = make_valid_header();
        let mut data = Vec::<u8>::new();
        header.write_to(&mut data).unwrap();
        data
    }

    #[test]
    fn round_trip() {
        let header1 = make_valid_header();
        let mut data = Vec::<u8>::new();
        header1.write_to(&mut data).unwrap();
        let header2 = Header::read_from(&mut data.as_slice()).unwrap();
        assert_eq!(header1.version, header2.version);
        assert_eq!(header1.num_dir_sectors, header2.num_dir_sectors);
        assert_eq!(header1.num_fat_sectors, header2.num_fat_sectors);
        assert_eq!(header1.first_dir_sector, header2.first_dir_sector);
        assert_eq!(header1.first_minifat_sector, header2.first_minifat_sector);
        assert_eq!(header1.num_minifat_sectors, header2.num_minifat_sectors);
        assert_eq!(header1.first_difat_sector, header2.first_difat_sector);
        assert_eq!(header1.num_difat_sectors, header2.num_difat_sectors);
        assert_eq!(
            header1.initial_difat_entries,
            header2.initial_difat_entries
        );
    }

    #[test]
    #[should_panic(expected = "Invalid CFB file (wrong magic number)")]
    fn invalid_magic_number() {
        let mut data = make_valid_header_data();
        data[2] = 255;
        Header::read_from(&mut data.as_slice()).unwrap();
    }

    #[test]
    #[should_panic(expected = "CFB version 42 is not supported")]
    fn invalid_version() {
        let mut data = make_valid_header_data();
        data[26] = 42;
        Header::read_from(&mut data.as_slice()).unwrap();
    }

    #[test]
    #[should_panic(
        expected = "Invalid CFB byte order mark (expected 0xFFFE, found \
                    0x07FE)"
    )]
    fn invalid_byte_order_mark() {
        let mut data = make_valid_header_data();
        data[29] = 7;
        Header::read_from(&mut data.as_slice()).unwrap();
    }

    #[test]
    #[should_panic(
        expected = "Incorrect sector shift for CFB version 3 (expected 9, \
                    found 12)"
    )]
    fn invalid_sector_shift() {
        let mut data = make_valid_header_data();
        data[30] = 12;
        Header::read_from(&mut data.as_slice()).unwrap();
    }

    #[test]
    #[should_panic(
        expected = "Incorrect mini sector shift (expected 6, found 7)"
    )]
    fn invalid_mini_sector_shift() {
        let mut data = make_valid_header_data();
        data[32] = 7;
        Header::read_from(&mut data.as_slice()).unwrap();
    }

    #[test]
    #[should_panic(
        expected = "Incorrect mini stream cutoff (expected 4096, found 2048)"
    )]
    fn invalid_mini_stream_cutoff() {
        let mut data = make_valid_header_data();
        data[57] = 8;
        Header::read_from(&mut data.as_slice()).unwrap();
    }

    #[test]
    #[should_panic(
        expected = "Initial DIFAT array refers to invalid sector index \
                    0xFFFFFFFB"
    )]
    fn invalid_difat_array() {
        let mut data = make_valid_header_data();
        data[80] = 0xFB;
        Header::read_from(&mut data.as_slice()).unwrap();
    }
}

//===========================================================================//
