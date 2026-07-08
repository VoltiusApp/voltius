use crate::internal::consts;

// ========================================================================= //

/// The CFB format version to use.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Version {
    /// Version 3, which uses 512-byte sectors.
    V3,
    /// Version 4, which uses 4096-byte sectors.
    V4,
}

impl Version {
    /// Returns the version enum for the given version number, or `None`.
    pub fn from_number(number: u16) -> Option<Version> {
        match number {
            3 => Some(Version::V3),
            4 => Some(Version::V4),
            _ => None,
        }
    }

    /// Returns the version number for this version.
    pub fn number(self) -> u16 {
        match self {
            Version::V3 => 3,
            Version::V4 => 4,
        }
    }

    /// Returns the sector shift used in this version.
    pub fn sector_shift(self) -> u16 {
        match self {
            Version::V3 => 9,  // 512-byte sectors
            Version::V4 => 12, // 4096-byte sectors
        }
    }

    /// Returns the length of sectors used in this version.
    ///
    /// ```
    /// use cfb::Version;
    /// assert_eq!(Version::V3.sector_len(), 512);
    /// assert_eq!(Version::V4.sector_len(), 4096);
    /// ```
    pub fn sector_len(self) -> usize {
        1 << (self.sector_shift() as usize)
    }

    /// Returns the bitmask used for reading stream lengths in this version.
    pub fn stream_len_mask(self) -> u64 {
        match self {
            Version::V3 => 0xffffffff,
            Version::V4 => 0xffffffffffffffff,
        }
    }

    /// Returns the number of directory entries per sector in this version.
    pub fn dir_entries_per_sector(self) -> usize {
        self.sector_len() / consts::DIR_ENTRY_LEN
    }
}

// ========================================================================= //

#[cfg(test)]
mod tests {
    use super::Version;

    #[test]
    fn number_round_trip() {
        for &version in &[Version::V3, Version::V4] {
            assert_eq!(Version::from_number(version.number()), Some(version));
        }
    }
}

// ========================================================================= //
