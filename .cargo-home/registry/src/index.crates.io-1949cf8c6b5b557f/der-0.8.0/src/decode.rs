//! Trait definition for [`Decode`].

use crate::{Error, FixedTag, Header, Reader, SliceReader, reader::read_value};

use core::marker::PhantomData;

#[cfg(feature = "pem")]
use crate::{PemReader, pem::PemLabel};

#[cfg(doc)]
use crate::{ErrorKind, Length, Tag};

#[cfg(feature = "alloc")]
use alloc::{
    borrow::{Cow, ToOwned},
    boxed::Box,
};

#[cfg(feature = "ber")]
use crate::EncodingRules;

/// Decode trait parses a complete TLV (Tag-Length-Value) structure.
///
/// This trait provides the core abstraction upon which all decoding operations
/// are based.
///
/// When decoding fails, a [`Decode::Error`] type is thrown.
/// Most ASN.1 DER objects return a builtin der [`Error`] type as [`Decode::Error`], which can be made from [`ErrorKind`].
///
/// ## Example
///
/// ```
/// # #[cfg(all(feature = "alloc", feature = "std"))]
/// # {
/// use der::{Any, Decode, Reader};
///
/// /// Wrapper around Any, with custom foreign trait support.
/// ///
/// /// For example: serde Serialize/Deserialize
/// pub struct AnySerde(pub Any);
///
/// impl<'a> Decode<'a> for AnySerde {
///     type Error = der::Error;
///
///     fn decode<R: Reader<'a>>(reader: &mut R) -> der::Result<Self> {
///         // calls impl Decode for Any
///         Ok(Self(Any::decode(reader)?))
///     }
/// }
/// # }
/// ```
#[diagnostic::on_unimplemented(
    note = "Consider adding impls of `DecodeValue` and `FixedTag` to `{Self}`"
)]
pub trait Decode<'a>: Sized + 'a {
    /// Type returned in the event of a decoding error.
    type Error: core::error::Error + From<Error> + 'static;

    /// Attempt to decode this TLV message using the provided decoder.
    ///
    /// # Errors
    /// Returns [`Self::Error`] in the event a decoding error occurred.
    fn decode<R: Reader<'a>>(decoder: &mut R) -> Result<Self, Self::Error>;

    /// Parse `Self` from the provided BER-encoded byte slice.
    ///
    /// Note that most usages should probably use [`Decode::from_der`]. This method allows some
    /// BER productions which are not allowed under DER.
    ///
    /// # Errors
    /// Returns [`Self::Error`] in the event a decoding error occurred.
    #[cfg(feature = "ber")]
    fn from_ber(bytes: &'a [u8]) -> Result<Self, Self::Error> {
        let mut reader = SliceReader::new_with_encoding_rules(bytes, EncodingRules::Ber)?;
        let result = Self::decode(&mut reader)?;
        reader.finish()?;
        Ok(result)
    }

    /// Parse `Self` from the provided DER-encoded byte slice.
    ///
    /// # Errors
    /// Returns [`Self::Error`] in the event a decoding error occurred.
    fn from_der(bytes: &'a [u8]) -> Result<Self, Self::Error> {
        let mut reader = SliceReader::new(bytes)?;
        let result = Self::decode(&mut reader)?;
        reader.finish()?;
        Ok(result)
    }

    /// Parse `Self` from the provided DER-encoded byte slice.
    ///
    /// Returns remaining byte slice, without checking for incomplete message.
    ///
    /// # Errors
    /// Returns [`Self::Error`] in the event a decoding error occurred.
    fn from_der_partial(bytes: &'a [u8]) -> Result<(Self, &'a [u8]), Self::Error> {
        let mut reader = SliceReader::new(bytes)?;
        let result = Self::decode(&mut reader)?;

        let remaining = reader.remaining()?;
        Ok((result, remaining))
    }
}

impl<'a, T> Decode<'a> for T
where
    T: DecodeValue<'a> + FixedTag + 'a,
{
    type Error = <T as DecodeValue<'a>>::Error;

    fn decode<R: Reader<'a>>(reader: &mut R) -> Result<T, <T as DecodeValue<'a>>::Error> {
        let header = Header::decode(reader)?;
        header.tag().assert_eq(T::TAG)?;
        read_value(reader, header, T::decode_value)
    }
}

/// Dummy implementation for [`PhantomData`] which allows deriving
/// implementations on structs with phantom fields.
impl<'a, T> Decode<'a> for PhantomData<T>
where
    T: ?Sized + 'a,
{
    type Error = Error;

    fn decode<R: Reader<'a>>(_reader: &mut R) -> Result<PhantomData<T>, Error> {
        Ok(PhantomData)
    }
}

/// Marker trait for data structures that can be decoded from DER without
/// borrowing any data from the decoder.
///
/// This is primarily useful for trait bounds on functions which require that
/// no data is borrowed from the decoder, for example a PEM decoder which needs
/// to first decode data from Base64.
///
/// This trait is inspired by the [`DeserializeOwned` trait from `serde`](https://docs.rs/serde/latest/serde/de/trait.DeserializeOwned.html).
#[diagnostic::on_unimplemented(
    note = "`DecodeOwned` is auto-impl'd for all lifetime-free types which impl `Decode`"
)]
pub trait DecodeOwned: for<'a> Decode<'a> {}

impl<T> DecodeOwned for T where T: for<'a> Decode<'a> {}

/// PEM decoding trait.
///
/// This trait is automatically impl'd for any type which impls both
/// [`DecodeOwned`] and [`PemLabel`].
#[cfg(feature = "pem")]
#[diagnostic::on_unimplemented(
    note = "`DecodePem` is auto-impl'd for all lifetime-free types which impl both `Decode` and `PemLabel`"
)]
pub trait DecodePem: DecodeOwned + PemLabel {
    /// Try to decode this type from PEM.
    ///
    /// # Errors
    /// If a PEM or DER decoding error occurred.
    fn from_pem(pem: impl AsRef<[u8]>) -> Result<Self, <Self as Decode<'static>>::Error>;
}

#[cfg(feature = "pem")]
impl<T: DecodeOwned<Error = Error> + PemLabel> DecodePem for T {
    fn from_pem(pem: impl AsRef<[u8]>) -> Result<T, Error> {
        let mut reader = PemReader::new(pem.as_ref())?;
        Self::validate_pem_label(reader.type_label()).map_err(Error::from)?;
        T::decode(&mut reader)
    }
}

/// `DecodeValue` trait parses the value part of a Tag-Length-Value object,
/// sans the [`Tag`] and [`Length`].
///
/// As opposed to [`Decode`], implementer is expected to read the inner content only,
/// without the [`Header`], which was decoded beforehand.
///
/// ## Example
/// ```
/// use der::{Decode, DecodeValue, ErrorKind, FixedTag, Header, Reader, Tag};
///
/// /// 1-byte month
/// struct MyByteMonth(u8);
///
/// impl<'a> DecodeValue<'a> for MyByteMonth {
///     type Error = der::Error;
///
///     fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> der::Result<Self> {
///         let month = reader.read_byte()?;
///         
///         if (0..12).contains(&month) {
///             Ok(Self(month))
///         } else {
///             Err(reader.error(ErrorKind::DateTime))
///         }
///     }
/// }
///
/// impl FixedTag for MyByteMonth {
///     const TAG: Tag = Tag::OctetString;
/// }
///
/// let month = MyByteMonth::from_der(b"\x04\x01\x09").expect("month to decode");
///
/// assert_eq!(month.0, 9);
/// ```
pub trait DecodeValue<'a>: Sized {
    /// Type returned in the event of a decoding error.
    type Error: core::error::Error + From<Error> + 'static;

    /// Attempt to decode this value using the provided [`Reader`].
    ///
    /// # Errors
    /// Returns [`Self::Error`] in the event a decoding error occurred.
    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self, Self::Error>;
}

#[cfg(feature = "alloc")]
impl<'a, T> DecodeValue<'a> for Box<T>
where
    T: DecodeValue<'a>,
{
    type Error = T::Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self, Self::Error> {
        Ok(Box::new(T::decode_value(reader, header)?))
    }
}

#[cfg(feature = "alloc")]
impl<'a, T, E> DecodeValue<'a> for Cow<'a, T>
where
    T: ToOwned + ?Sized,
    &'a T: DecodeValue<'a, Error = E>,
    T::Owned: for<'b> DecodeValue<'b, Error = E>,
    E: core::error::Error + From<Error> + 'static,
{
    type Error = E;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self, Self::Error> {
        if R::CAN_READ_SLICE {
            <&'a T>::decode_value(reader, header).map(Cow::Borrowed)
        } else {
            T::Owned::decode_value(reader, header).map(Cow::Owned)
        }
    }
}
