//! Base64 writer support (constant-time).

use crate::{Result, Writer};
use core::fmt::{self, Debug};

#[cfg(doc)]
use crate::Error;

/// Inner constant-time Base64 reader type from the `base64ct` crate.
type Inner<'o> = base64ct::Encoder<'o, base64ct::Base64>;

/// Constant-time Base64 writer implementation.
pub struct Base64Writer<'o> {
    inner: Inner<'o>,
}

impl<'o> Base64Writer<'o> {
    /// Create a new Base64 writer which writes output to the given byte slice.
    ///
    /// Output constructed using this method is not line-wrapped.
    ///
    /// # Errors
    /// Returns [`Error::Base64`] if the `output` buffer is empty.
    pub fn new(output: &'o mut [u8]) -> Result<Self> {
        Ok(Self {
            inner: Inner::new(output)?,
        })
    }

    /// Finish encoding data, returning the resulting Base64 as a `str`.
    ///
    /// # Errors
    /// Returns [`Error::Base64`] if there is insufficient space in the output buffer.
    pub fn finish(self) -> Result<&'o str> {
        Ok(self.inner.finish()?)
    }
}

impl Debug for Base64Writer<'_> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_struct("Base64Writer").finish_non_exhaustive()
    }
}

impl Writer for Base64Writer<'_> {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        Ok(self.inner.encode(bytes)?)
    }
}
