//! Provides wrappers for [Read] and [Write] types which checksum the bytes being read/written.
use std::io::{Read, Write};

use crate::crc32c_append;

/// [Read]er wrapper which tracks the checksum of all bytes read.
pub struct Crc32cReader<R: Read> {
    checksum: u32,
    inner: R,
}

impl<R: Read> Crc32cReader<R> {
    /// Wrap an instance of a [Read]er.
    pub fn new(r: R) -> Self {
        Self::new_with_seed(r, 0)
    }

    /// Wrap a [Read]er, with the checksum seeded with a particular value.
    pub fn new_with_seed(r: R, seed: u32) -> Self {
        Self {
            checksum: seed,
            inner: r,
        }
    }

    /// Unwrap the inner [Read]er.
    pub fn into_inner(self) -> R {
        self.inner
    }

    /// Get the checksum of all bytes read.
    pub fn crc32c(&self) -> u32 {
        self.checksum
    }
}

impl<R: Read> Read for Crc32cReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let out = self.inner.read(buf)?;
        self.checksum = crc32c_append(self.checksum, &buf[..out]);
        Ok(out)
    }
}

/// [Write]r wrapper which tracks the checksum of all bytes written.
pub struct Crc32cWriter<W: Write> {
    checksum: u32,
    inner: W,
}

impl<W: Write> Crc32cWriter<W> {
    /// Wrap an instance of a [Write]r.
    pub fn new(w: W) -> Self {
        Self::new_with_seed(w, 0)
    }

    /// Wrap a [Write]r, with the checksum seeded with a particular value.
    pub fn new_with_seed(w: W, seed: u32) -> Self {
        Self {
            checksum: seed,
            inner: w,
        }
    }

    /// Unwrap the inner [Write]r.
    pub fn into_inner(self) -> W {
        self.inner
    }

    /// Get the checksum of all bytes written.
    pub fn crc32c(&self) -> u32 {
        self.checksum
    }
}

impl<W: Write> Write for Crc32cWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let out = self.inner.write(buf)?;
        self.checksum = crc32c_append(self.checksum, &buf[..out]);
        Ok(out)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    const TEST_STRING: &[u8] =
        b"This is a very long string which is used to test the CRC-32-Castagnoli function.";
    const CHECKSUM: u32 = 0x20_CB_1E_59;

    #[test]
    fn can_read() {
        let mut reader = Crc32cReader::new(TEST_STRING);
        let mut buf = Vec::default();
        let n_read = reader.read_to_end(&mut buf).unwrap();
        assert_eq!(n_read, TEST_STRING.len());
        assert_eq!(buf.as_slice(), TEST_STRING);
        assert_eq!(reader.crc32c(), CHECKSUM);
    }

    #[test]
    fn can_write() {
        let mut buf = Vec::<u8>::default();

        let mut writer = Crc32cWriter::<Cursor<&mut Vec<u8>>>::new(Cursor::new(&mut buf));
        writer.write_all(TEST_STRING).unwrap();
        let checksum = writer.crc32c();

        assert_eq!(buf.as_slice(), TEST_STRING);
        assert_eq!(checksum, CHECKSUM);
    }
}
