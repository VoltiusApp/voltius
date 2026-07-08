//! Reader trait and associated implementations.

use crate::{Error, Result, decode::Decode};
use core::str;

/// Reader trait which decodes the binary SSH protocol serialization from
/// various inputs.
pub trait Reader: Sized {
    /// Read as much data as is needed to exactly fill `out`.
    ///
    /// This is the base decoding method on which the rest of the trait is implemented in terms of.
    ///
    /// Returns `out` reborrowed as an immutable byte slice.
    ///
    /// # Errors
    /// Returns `Err(Error::Length)` if the exact amount of data couldn't be read.
    fn read<'o>(&mut self, out: &'o mut [u8]) -> Result<&'o [u8]>;

    /// Get the length of the remaining data after Base64 decoding.
    fn remaining_len(&self) -> usize;

    /// Is decoding finished?
    fn is_finished(&self) -> bool {
        self.remaining_len() == 0
    }

    /// Decode length-prefixed data.
    ///
    /// Decodes a `uint32` which identifies the length of some encapsulated data, then calls the
    /// given reader function with the length of the remaining data.
    ///
    /// # Errors
    /// Propagates errors returned from `F`.
    fn read_prefixed<T, E, F>(&mut self, f: F) -> core::result::Result<T, E>
    where
        E: From<Error>,
        F: FnOnce(&mut Self) -> core::result::Result<T, E>;

    /// Decodes `[u8]` from `byte[n]` as described in [RFC4251 § 5]:
    ///
    /// > A byte represents an arbitrary 8-bit value (octet).  Fixed length
    /// > data is sometimes represented as an array of bytes, written
    /// > `byte[n]`, where n is the number of bytes in the array.
    ///
    /// Storage for the byte array must be provided as mutable byte slice in order to accommodate
    /// `no_alloc` use cases.
    ///
    /// The [`Decode`] impl on `Vec<u8>` can be used to allocate a buffer for the result.
    ///
    /// [RFC4251 § 5]: https://datatracker.ietf.org/doc/html/rfc4251#section-5
    ///
    /// # Errors
    /// - Returns [`Error::Length`] if `out` is too small to accommodate the full `byte[n]`.
    /// - Propagates errors returned from [`Reader::read`].
    fn read_byten<'o>(&mut self, out: &'o mut [u8]) -> Result<&'o [u8]> {
        self.read_prefixed(|reader| {
            let slice = out.get_mut(..reader.remaining_len()).ok_or(Error::Length)?;
            reader.read(slice)?;
            Ok(&*slice)
        })
    }

    /// Decode a `string` as described in [RFC4251 § 5]:
    ///
    /// > Arbitrary length binary string.  Strings are allowed to contain
    /// > arbitrary binary data, including null characters and 8-bit
    /// > characters.  They are stored as a uint32 containing its length
    /// > (number of bytes that follow) and zero (= empty string) or more
    /// > bytes that are the value of the string.  Terminating null
    /// > characters are not used.
    /// >
    /// > Strings are also used to store text.  In that case, US-ASCII is
    /// > used for internal names, and ISO-10646 UTF-8 for text that might
    /// > be displayed to the user.  The terminating null character SHOULD
    /// > NOT normally be stored in the string.  For example: the US-ASCII
    /// > string "testing" is represented as 00 00 00 07 t e s t i n g.  The
    /// > UTF-8 mapping does not alter the encoding of US-ASCII characters.
    ///
    /// Storage for the string data must be provided as mutable byte slice in order to accommodate
    /// `no_alloc` use cases.
    ///
    /// The [`Decode`] impl on `String` can be used to allocate a buffer for the result.
    ///
    /// [RFC4251 § 5]: https://datatracker.ietf.org/doc/html/rfc4251#section-5
    ///
    /// # Errors
    /// - Propagates errors returned from [`Reader::read_byten`].
    /// - Returns [`Error::CharacterEncoding`] if the data is not valid UTF-8.
    fn read_string<'o>(&mut self, buf: &'o mut [u8]) -> Result<&'o str> {
        Ok(str::from_utf8(self.read_byten(buf)?)?)
    }

    /// Drain the given number of bytes from the reader, discarding them.
    ///
    /// # Errors
    /// Propagates errors returned from [`Reader::read`].
    fn drain(&mut self, n_bytes: usize) -> Result<()> {
        let mut byte = [0];
        for _ in 0..n_bytes {
            self.read(&mut byte)?;
        }
        Ok(())
    }

    /// Decode a `u32` length prefix, and then drain the length of the body.
    ///
    /// Upon success, returns the number of bytes drained sans the length of the `u32` length prefix
    /// (4-bytes).
    ///
    /// # Errors
    /// - Propagates errors returned from [`Reader::read_prefixed`].
    /// - Propagates errors returned from [`Reader::drain`].
    fn drain_prefixed(&mut self) -> Result<usize> {
        self.read_prefixed(|reader| {
            let len = reader.remaining_len();
            reader.drain(len)?;
            Ok(len)
        })
    }

    /// Ensure that decoding is finished.
    ///
    /// # Errors
    /// Returns [`Error::TrailingData`] if there is data remaining in the encoder.
    fn ensure_finished(&self) -> Result<()> {
        if self.is_finished() {
            Ok(())
        } else {
            Err(Error::TrailingData {
                remaining: self.remaining_len(),
            })
        }
    }

    /// Finish decoding, returning the given value if there is no remaining data.
    ///
    /// # Errors
    /// Returns [`Error::TrailingData`] if there is data remaining in the encoder.
    fn finish<T>(self, value: T) -> Result<T> {
        self.ensure_finished()?;
        Ok(value)
    }
}

impl Reader for &[u8] {
    fn read<'o>(&mut self, out: &'o mut [u8]) -> Result<&'o [u8]> {
        if self.len() >= out.len() {
            let (head, tail) = self.split_at(out.len());
            *self = tail;
            out.copy_from_slice(head);
            Ok(out)
        } else {
            Err(Error::Length)
        }
    }

    fn read_prefixed<T, E, F>(&mut self, f: F) -> core::result::Result<T, E>
    where
        E: From<Error>,
        F: FnOnce(&mut Self) -> core::result::Result<T, E>,
    {
        let prefix_len = usize::decode(self)?;

        if self.len() < prefix_len {
            return Err(Error::Length.into());
        }

        let (mut prefix, remaining) = self.split_at(prefix_len);
        let ret = f(&mut prefix)?;
        *self = remaining;
        Ok(ret)
    }

    fn remaining_len(&self) -> usize {
        self.len()
    }
}

/// Writes a `Reader` impl for the given newtype with a `remaining_len` field.
// TODO(tarcieri): non-macro abstraction over `Base64Reader` and `PemReader`
#[cfg(any(feature = "base64", feature = "pem"))]
macro_rules! impl_reader_for_newtype {
    ($type:ty) => {
        impl Reader for $type {
            fn read<'o>(&mut self, out: &'o mut [u8]) -> Result<&'o [u8]> {
                if out.is_empty() {
                    return Ok(out);
                }

                let remaining_len = self
                    .remaining_len
                    .checked_sub(out.len())
                    .ok_or(Error::Length)?;

                let ret = self.inner.decode(out)?;
                self.remaining_len = remaining_len;
                Ok(ret)
            }

            fn read_prefixed<T, E, F>(&mut self, f: F) -> core::result::Result<T, E>
            where
                E: From<Error>,
                F: FnOnce(&mut Self) -> core::result::Result<T, E>,
            {
                let prefix_len = usize::decode(self)?;
                let new_remaining_len = self
                    .remaining_len
                    .checked_sub(prefix_len)
                    .ok_or(Error::Length)?;

                self.remaining_len = prefix_len;
                let ret = f(self)?;
                self.ensure_finished()?;

                self.remaining_len = new_remaining_len;
                Ok(ret)
            }

            fn remaining_len(&self) -> usize {
                self.remaining_len
            }
        }
    };
}
