//! Trait definition for [`Encode`].

use crate::{Header, Length, Result, SliceWriter, Tagged, Writer};
use core::marker::PhantomData;

#[cfg(feature = "alloc")]
use alloc::{
    borrow::{Cow, ToOwned},
    boxed::Box,
    vec::Vec,
};

#[cfg(feature = "pem")]
use {
    crate::PemWriter,
    alloc::string::String,
    pem_rfc7468::{self as pem, LineEnding, PemLabel},
};

#[cfg(any(feature = "alloc", feature = "pem"))]
use crate::ErrorKind;

#[cfg(doc)]
use crate::{FixedTag, Tag};

/// Encode trait produces a complete TLV (Tag-Length-Value) structure.
///
/// As opposed to [`EncodeValue`], implementer is expected to write whole ASN.1 DER header, before writing value.
///
/// ## Example
///
/// ```
/// # #[cfg(all(feature = "alloc", feature = "std"))]
/// # {
/// use der::{Any, Encode, Length, Reader, Writer};
///
/// /// Wrapper around Any, with custom foreign trait support.
/// ///
/// /// For example: serde Serialize/Deserialize
/// pub struct AnySerde(pub Any);
///
/// impl Encode for AnySerde {
///
///     fn encoded_len(&self) -> der::Result<Length> {
///         self.0.encoded_len()
///     }
///
///     fn encode(&self, writer: &mut impl Writer) -> der::Result<()> {
///         self.0.encode(writer)
///     }
/// }
/// # }
/// ```
#[diagnostic::on_unimplemented(
    note = "Consider adding impls of `EncodeValue` and `FixedTag` to `{Self}`"
)]
pub trait Encode {
    /// Compute the length of this TLV object in bytes when encoded as ASN.1 DER.
    ///
    /// # Errors
    /// Returns an error if the length could not be computed (e.g. overflow).
    fn encoded_len(&self) -> Result<Length>;

    /// Encode this TLV object as ASN.1 DER using the provided [`Writer`].
    ///
    /// # Errors
    /// In the event an encoding error occurred.
    fn encode(&self, writer: &mut impl Writer) -> Result<()>;

    /// Encode this TLV object to the provided byte slice, returning a sub-slice
    /// containing the encoded message.
    ///
    /// # Errors
    /// In the event an encoding error occurred.
    fn encode_to_slice<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8]> {
        let mut writer = SliceWriter::new(buf);
        self.encode(&mut writer)?;
        writer.finish()
    }

    /// Encode this TLV object as ASN.1 DER, appending it to the provided
    /// byte vector.
    ///
    /// # Errors
    /// In the event an encoding error occurred.
    #[cfg(feature = "alloc")]
    fn encode_to_vec(&self, buf: &mut Vec<u8>) -> Result<Length> {
        let expected_len = usize::try_from(self.encoded_len()?)?;
        let initial_len = buf.len();
        buf.resize(initial_len + expected_len, 0u8);

        let buf_slice = &mut buf[initial_len..];
        let actual_len = self.encode_to_slice(buf_slice)?.len();

        if expected_len != actual_len {
            return Err(ErrorKind::Incomplete {
                expected_len: expected_len.try_into()?,
                actual_len: actual_len.try_into()?,
            }
            .into());
        }

        actual_len.try_into()
    }

    /// Encode this TLV object as ASN.1 DER, returning a byte vector.
    ///
    /// # Errors
    /// In the event an encoding error occurred.
    #[cfg(feature = "alloc")]
    fn to_der(&self) -> Result<Vec<u8>> {
        let mut buf = Vec::new();
        self.encode_to_vec(&mut buf)?;
        Ok(buf)
    }
}

impl<T> Encode for T
where
    T: EncodeValue + Tagged + ?Sized,
{
    fn encoded_len(&self) -> Result<Length> {
        self.value_len().and_then(|len| len.for_tlv(self.tag()))
    }

    fn encode(&self, writer: &mut impl Writer) -> Result<()> {
        self.header()?.encode(writer)?;
        self.encode_value(writer)
    }
}

/// Dummy implementation for [`PhantomData`] which allows deriving
/// implementations on structs with phantom fields.
impl<T> Encode for PhantomData<T>
where
    T: ?Sized,
{
    fn encoded_len(&self) -> Result<Length> {
        Ok(Length::ZERO)
    }

    fn encode(&self, _writer: &mut impl Writer) -> Result<()> {
        Ok(())
    }
}

/// PEM encoding trait.
///
/// This trait is automatically impl'd for any type which impls both
/// [`Encode`] and [`PemLabel`].
#[cfg(feature = "pem")]
#[diagnostic::on_unimplemented(
    note = "`EncodePem` is auto-impl'd for types which impl both `Encode` and `PemLabel`"
)]
pub trait EncodePem: Encode + PemLabel {
    /// Try to encode this type as PEM.
    ///
    /// # Errors
    /// If a PEM encoding error occurred.
    fn to_pem(&self, line_ending: LineEnding) -> Result<String>;
}

#[cfg(feature = "pem")]
impl<T> EncodePem for T
where
    T: Encode + PemLabel + ?Sized,
{
    fn to_pem(&self, line_ending: LineEnding) -> Result<String> {
        let der_len = usize::try_from(self.encoded_len()?)?;
        let pem_len = pem::encapsulated_len(Self::PEM_LABEL, line_ending, der_len)?;

        let mut buf = vec![0u8; pem_len];
        let mut writer = PemWriter::new(Self::PEM_LABEL, line_ending, &mut buf)?;
        self.encode(&mut writer)?;

        let actual_len = writer.finish()?;
        buf.truncate(actual_len);
        Ok(String::from_utf8(buf)?)
    }
}

/// Encode the value part of a Tag-Length-Value encoded field, sans the [`Tag`]
/// and [`Length`].
///
/// As opposed to [`Encode`], implementer is expected to write the inner content only,
/// without the [`Header`].
///
/// When [`EncodeValue`] is paired with [`FixedTag`],
/// it produces a complete TLV ASN.1 DER encoding as [`Encode`] trait.
///
/// ## Example
/// ```
/// use der::{Encode, EncodeValue, ErrorKind, FixedTag, Length, Tag, Writer};
///
/// /// 1-byte month
/// struct MyByteMonth(u8);
///
/// impl EncodeValue for MyByteMonth {
///
///     fn value_len(&self) -> der::Result<Length> {
///         Ok(Length::new(1))
///     }
///
///     fn encode_value(&self, writer: &mut impl Writer) -> der::Result<()> {
///         writer.write_byte(self.0)?;
///         Ok(())
///     }
/// }
///
/// impl FixedTag for MyByteMonth {
///     const TAG: Tag = Tag::OctetString;
/// }
///
/// let month = MyByteMonth(9);
/// let mut buf = [0u8; 16];
/// let month_der = month.encode_to_slice(&mut buf).expect("month to encode");
///
/// assert_eq!(month_der, b"\x04\x01\x09");
/// ```
pub trait EncodeValue {
    /// Get the [`Header`] used to encode this value.
    ///
    /// # Errors
    /// Returns an error if the header could not be computed.
    fn header(&self) -> Result<Header>
    where
        Self: Tagged,
    {
        Ok(Header::new(self.tag(), self.value_len()?))
    }

    /// Compute the length of this value (sans [`Tag`]+[`Length`] header) when
    /// encoded as ASN.1 DER.
    ///
    /// # Errors
    /// Returns an error if the value length could not be computed (e.g. overflow).
    fn value_len(&self) -> Result<Length>;

    /// Encode value (sans [`Tag`]+[`Length`] header) as ASN.1 DER using the
    /// provided [`Writer`].
    ///
    /// # Errors
    /// In the event an encoding error occurred.
    fn encode_value(&self, writer: &mut impl Writer) -> Result<()>;
}

#[cfg(feature = "alloc")]
impl<T> EncodeValue for Box<T>
where
    T: EncodeValue,
{
    fn value_len(&self) -> Result<Length> {
        T::value_len(self)
    }
    fn encode_value(&self, writer: &mut impl Writer) -> Result<()> {
        T::encode_value(self, writer)
    }
}

#[cfg(feature = "alloc")]
impl<T> EncodeValue for Cow<'_, T>
where
    T: ToOwned + ?Sized,
    for<'a> &'a T: EncodeValue,
{
    fn value_len(&self) -> Result<Length> {
        self.as_ref().value_len()
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<()> {
        self.as_ref().encode_value(writer)
    }
}

/// Encodes value only (without tag + length) to a slice.
pub(crate) fn encode_value_to_slice<'a, T>(buf: &'a mut [u8], value: &T) -> Result<&'a [u8]>
where
    T: EncodeValue,
{
    let mut writer = SliceWriter::new(buf);
    value.encode_value(&mut writer)?;
    writer.finish()
}
