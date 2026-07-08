//! Writer trait and associated implementations.

use crate::Result;

#[cfg(feature = "alloc")]
use alloc::vec::Vec;

#[cfg(feature = "bytes")]
use bytes::{BufMut, BytesMut};

#[cfg(feature = "digest")]
use digest::Digest;

/// Writer trait which encodes the SSH binary format to various output
/// encodings.
pub trait Writer: Sized {
    /// Write the given bytes to the writer.
    ///
    /// # Errors
    /// Returns errors specific to the concrete implementation of this trait.
    fn write(&mut self, bytes: &[u8]) -> Result<()>;
}

#[cfg(feature = "alloc")]
impl Writer for Vec<u8> {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.extend_from_slice(bytes);
        Ok(())
    }
}

#[cfg(feature = "bytes")]
impl Writer for BytesMut {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.put(bytes);
        Ok(())
    }
}

/// Wrapper for digests.
///
/// This allows to update digests from the serializer directly.
#[cfg(feature = "digest")]
#[derive(Debug)]
pub struct DigestWriter<'d, D>(pub &'d mut D);

#[cfg(feature = "digest")]
impl<D> Writer for DigestWriter<'_, D>
where
    D: Digest,
{
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.0.update(bytes);
        Ok(())
    }
}
