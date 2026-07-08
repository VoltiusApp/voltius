//! The [`Sequence`] trait simplifies writing decoders/encoders which map ASN.1
//! `SEQUENCE`s to Rust structs.

use crate::{
    BytesRef, DecodeValue, EncodeValue, Error, ErrorKind, FixedTag, Header, Length, Reader, Result,
    Tag, Writer,
};

#[cfg(feature = "alloc")]
use alloc::boxed::Box;

/// Marker trait for ASN.1 `SEQUENCE`s.
///
/// This is mainly used for custom derive.
pub trait Sequence<'a> {}

impl<'a, S> FixedTag for S
where
    S: Sequence<'a>,
{
    const TAG: Tag = Tag::Sequence;
}

#[cfg(feature = "alloc")]
impl<'a, T> Sequence<'a> for Box<T> where T: Sequence<'a> {}

/// The [`SequenceRef`] type provides raw access to the octets which comprise a
/// DER-encoded `SEQUENCE`.
///
/// This is a zero-copy reference type which borrows from the input data.
#[derive(Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct SequenceRef {
    /// Body of the `SEQUENCE`.
    body: BytesRef,
}

impl SequenceRef {
    /// Create a new ASN.1 `SEQUENCE` from a byte slice.
    ///
    /// # Errors
    /// Returns [`Error`] in the event `slice` is too long.
    pub fn new(slice: &[u8]) -> Result<&Self> {
        BytesRef::new(slice)
            .map(Self::from_bytes_ref)
            .map_err(|_| ErrorKind::Length { tag: Tag::Sequence }.into())
    }

    /// Create a [`SequenceRef`] from a [`BytesRef`].
    ///
    /// Implemented as an inherent method to keep [`BytesRef`] out of the public API.
    fn from_bytes_ref(bytes_ref: &BytesRef) -> &Self {
        // SAFETY: `Self` is a `repr(transparent)` newtype for `BytesRef`
        #[allow(unsafe_code)]
        unsafe {
            &*(bytes_ref.as_ptr() as *const Self)
        }
    }

    /// Borrow the inner byte slice.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        self.body.as_slice()
    }
}

impl AsRef<[u8]> for SequenceRef {
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl<'a> DecodeValue<'a> for &'a SequenceRef {
    type Error = Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self> {
        <&'a BytesRef>::decode_value(reader, header).map(SequenceRef::from_bytes_ref)
    }
}

impl EncodeValue for SequenceRef {
    fn value_len(&self) -> Result<Length> {
        Ok(self.body.len())
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<()> {
        self.body.encode_value(writer)
    }
}

impl<'a> Sequence<'a> for &'a SequenceRef {}
