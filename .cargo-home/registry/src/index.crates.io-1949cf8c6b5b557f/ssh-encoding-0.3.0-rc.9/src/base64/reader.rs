//! Base64 reader support (constant-time).

use crate::{Decode, Error, Reader, Result};
use core::fmt::{self, Debug};

/// Inner constant-time Base64 reader type from the `base64ct` crate.
type Inner<'i> = base64ct::Decoder<'i, base64ct::Base64>;

/// Constant-time Base64 reader implementation.
pub struct Base64Reader<'i> {
    /// Inner Base64 reader.
    inner: Inner<'i>,

    /// Custom length of remaining data, used for nested length-prefixed reading.
    remaining_len: usize,
}

impl<'i> Base64Reader<'i> {
    /// Create a new Base64 reader for a byte slice containing contiguous (non-newline-delimited)
    /// Base64-encoded data.
    ///
    /// # Errors
    /// Returns [`Error::Base64`] if the `input` buffer is empty.
    pub fn new(input: &'i [u8]) -> Result<Self> {
        let inner = Inner::new(input)?;
        let remaining_len = inner.remaining_len();

        Ok(Self {
            inner,
            remaining_len,
        })
    }
}

impl Debug for Base64Reader<'_> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_struct("Base64Reader")
            .field("remaining_len", &self.remaining_len)
            .finish_non_exhaustive()
    }
}

impl_reader_for_newtype!(Base64Reader<'_>);
