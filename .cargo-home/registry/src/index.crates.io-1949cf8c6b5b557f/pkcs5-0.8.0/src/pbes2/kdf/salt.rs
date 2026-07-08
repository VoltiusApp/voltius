//! Stack-allocated salt storage buffer which works on `no_alloc` targets.
// TODO(tarcieri): replace this with an `ArrayVec`-like type?

use core::fmt;
use der::{DecodeValue, EncodeValue, Error, FixedTag, Header, Length, Reader, Result, Tag, Writer};

/// Salt as used by the PBES2 KDF.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct Salt {
    inner: [u8; Self::MAX_LEN],
    length: Length,
}

impl Salt {
    /// Maximum length of a salt that can be stored.
    pub const MAX_LEN: usize = 32;

    /// Create a new salt from the given byte slice.
    ///
    /// # Errors
    /// Returns [`Error`] in the event the length of `slice` exceeds [`Salt::MAX_LEN`].
    pub fn new(slice: impl AsRef<[u8]>) -> Result<Self> {
        let slice = slice.as_ref();
        let length = Length::new(u32::try_from(slice.len()).map_err(|_| Self::TAG.length_error())?);

        let mut inner = [0u8; Self::MAX_LEN];
        let mut i = 0;

        while i < slice.len() {
            inner[i] = slice[i];
            i += 1;
        }

        Ok(Self { inner, length })
    }

    /// Borrow the salt data as a byte slice.
    #[must_use]
    #[allow(clippy::missing_panics_doc, reason = "invariant should hold")]
    pub fn as_bytes(&self) -> &[u8] {
        let length = usize::try_from(self.length).expect("should be less than Self::MAX_LEN");
        &self.inner[..length]
    }

    /// Get the length of the salt data.
    #[must_use]
    pub fn len(&self) -> Length {
        self.length
    }
}

impl AsRef<[u8]> for Salt {
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl<'a> DecodeValue<'a> for Salt {
    type Error = Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self> {
        let length = usize::try_from(header.length())?;

        if length > Self::MAX_LEN {
            return Err(reader.error(Self::TAG.length_error()));
        }

        let mut inner = [0u8; Self::MAX_LEN];
        reader.read_into(&mut inner[..length])?;

        Ok(Self {
            inner,
            length: header.length(),
        })
    }
}

impl EncodeValue for Salt {
    fn value_len(&self) -> Result<Length> {
        Ok(self.length)
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<()> {
        writer.write(self.as_bytes())
    }
}

impl FixedTag for Salt {
    const TAG: Tag = Tag::OctetString;
}

impl TryFrom<&[u8]> for Salt {
    type Error = Error;

    fn try_from(slice: &[u8]) -> Result<Salt> {
        Self::new(slice)
    }
}

impl fmt::Debug for Salt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Salt").field(&self.as_bytes()).finish()
    }
}
