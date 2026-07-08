//! Streaming PEM writer.

use super::Writer;
use crate::Result;
use core::fmt;
use pem_rfc7468::{Encoder, LineEnding};

/// `Writer` type which outputs PEM-encoded data.
pub struct PemWriter<'w>(Encoder<'static, 'w>);

impl<'w> PemWriter<'w> {
    /// Create a new PEM writer which outputs into the provided buffer.
    ///
    /// Uses the default 64-character line wrapping.
    ///
    /// # Errors
    /// If the type label is invalid.
    pub fn new(
        type_label: &'static str,
        line_ending: LineEnding,
        out: &'w mut [u8],
    ) -> Result<Self> {
        Ok(Self(Encoder::new(type_label, line_ending, out)?))
    }

    /// Get the PEM label which will be used in the encapsulation boundaries
    /// for this document.
    #[must_use]
    pub fn type_label(&self) -> &'static str {
        self.0.type_label()
    }

    /// Finish encoding PEM, writing the post-encapsulation boundary.
    ///
    /// On success, returns the total number of bytes written to the output buffer.
    ///
    /// # Errors
    /// If internal finalization failed.
    pub fn finish(self) -> Result<usize> {
        Ok(self.0.finish()?)
    }
}

impl Writer for PemWriter<'_> {
    fn write(&mut self, slice: &[u8]) -> Result<()> {
        self.0.encode(slice)?;
        Ok(())
    }
}

impl fmt::Debug for PemWriter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PemWriter").finish_non_exhaustive()
    }
}
