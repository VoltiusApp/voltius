#![no_std]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc = include_str!("../README.md")]
#![doc(
    html_logo_url = "https://raw.githubusercontent.com/RustCrypto/media/6ee8e381/logo.svg",
    html_favicon_url = "https://raw.githubusercontent.com/RustCrypto/media/6ee8e381/logo.svg"
)]
#![forbid(unsafe_code)]

//! # Usage
//!
//! The main API for this crate is the [`EncryptionScheme`] enum, which impls
//! the [`Decode`] and [`Encode`] traits from the [`der`] crate, and can be
//! used for decoding/encoding PKCS#5 `AlgorithmIdentifier` fields.
//!
//! The [`pbes2::Parameters`] struct can be used to generate new encryption
//! parameters when encrypting new keys.
//!
//! [RFC 8018]: https://tools.ietf.org/html/rfc8018

#[cfg(all(feature = "alloc", feature = "pbes2"))]
extern crate alloc;

mod error;

pub mod pbes1;
pub mod pbes2;

pub use crate::error::{Error, Result};
pub use der::{self, asn1::ObjectIdentifier};
pub use spki::AlgorithmIdentifierRef;

use der::{
    Decode, DecodeValue, Encode, EncodeValue, Header, Length, Reader, Sequence, Tag, Writer,
};

#[cfg(feature = "pbes2")]
pub use scrypt;

#[cfg(all(feature = "alloc", feature = "pbes2"))]
use alloc::vec::Vec;

/// Configuration for supported PKCS#5 password-based encryption schemes.
///
/// <div class="warning">
/// <strong>Security Warning</strong>
///
/// This type should not be used to encrypt multiple plaintexts under the same IV/salt values.
///
/// Instead, new values should be randomly generated for every usage.
/// </div>
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
#[allow(clippy::large_enum_variant)]
pub enum EncryptionScheme {
    /// Password-Based Encryption Scheme 1 as defined in [RFC 8018 Section 6.1].
    ///
    /// [RFC 8018 Section 6.1]: https://tools.ietf.org/html/rfc8018#section-6.1
    Pbes1(pbes1::Algorithm),

    /// Password-Based Encryption Scheme 2 as defined in [RFC 8018 Section 6.2].
    ///
    /// [RFC 8018 Section 6.2]: https://tools.ietf.org/html/rfc8018#section-6.2
    Pbes2(pbes2::Parameters),
}

impl EncryptionScheme {
    /// Generate PBES2 parameters using recommended algorithm settings and parameters (salt/IV)
    /// generated using the system's secure random number generator.
    ///
    /// # Panics
    /// In the event the system's secure random generator experiences an internal failure.
    #[cfg(all(feature = "pbes2", feature = "getrandom"))]
    #[must_use]
    #[track_caller]
    pub fn generate() -> Self {
        Self::Pbes2(pbes2::Parameters::generate())
    }

    /// Attempt to decrypt the given ciphertext, allocating and returning a byte vector containing
    /// the plaintext.
    ///
    /// # Errors
    /// Returns an error if the algorithm specified in this scheme's parameters is unsupported
    /// (e.g. PBES1 is completely unsupported), or if the ciphertext is malformed (e.g. ciphertext
    /// length is not a multiple of a block mode's padding).
    #[cfg(all(feature = "alloc", feature = "pbes2"))]
    pub fn decrypt(&self, password: impl AsRef<[u8]>, ciphertext: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Pbes2(params) => params.decrypt(password, ciphertext),
            Self::Pbes1(_) => Err(Error::NoPbes1CryptSupport),
        }
    }

    /// Attempt to decrypt the given ciphertext in-place using a key derived from the provided
    /// password and this scheme's parameters.
    ///
    /// # Errors
    /// Returns an error if the algorithm specified in this scheme's parameters is unsupported
    /// (e.g. PBES1 is completely unsupported), or if the ciphertext is malformed (e.g. not a
    /// multiple of a block mode's padding).
    #[cfg(feature = "pbes2")]
    pub fn decrypt_in_place<'a>(
        &self,
        password: impl AsRef<[u8]>,
        buffer: &'a mut [u8],
    ) -> Result<&'a [u8]> {
        match self {
            Self::Pbes2(params) => params.decrypt_in_place(password, buffer),
            Self::Pbes1(_) => Err(Error::NoPbes1CryptSupport),
        }
    }

    /// Encrypt the given plaintext, allocating and returning a vector containing the ciphertext.
    ///
    /// # Errors
    /// - For PBES1, simply returns [`Error::NoPbes1CryptSupport`] unconditionally.
    /// - Returns [`Error::UnsupportedAlgorithm`] if support for the requested algorithm has not
    ///   been enabled in this crate's features.
    #[cfg(all(feature = "alloc", feature = "pbes2"))]
    pub fn encrypt(&self, password: impl AsRef<[u8]>, plaintext: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Pbes2(params) => params.encrypt(password, plaintext),
            Self::Pbes1(_) => Err(Error::NoPbes1CryptSupport),
        }
    }

    /// Encrypt the given ciphertext in-place using a key derived from the provided password and
    /// this scheme's parameters.
    ///
    /// # Errors
    /// - For PBES1, simply returns [`Error::NoPbes1CryptSupport`] unconditionally.
    /// - Returns [`Error::UnsupportedAlgorithm`] if support for the requested algorithm has not
    ///   been enabled in this crate's features.
    #[cfg(feature = "pbes2")]
    pub fn encrypt_in_place<'a>(
        &self,
        password: impl AsRef<[u8]>,
        buffer: &'a mut [u8],
        pos: usize,
    ) -> Result<&'a [u8]> {
        match self {
            Self::Pbes2(params) => params.encrypt_in_place(password, buffer, pos),
            Self::Pbes1(_) => Err(Error::NoPbes1CryptSupport),
        }
    }

    /// Get the [`ObjectIdentifier`] (a.k.a OID) for this algorithm.
    #[must_use]
    pub fn oid(&self) -> ObjectIdentifier {
        match self {
            Self::Pbes1(params) => params.oid(),
            Self::Pbes2(_) => pbes2::PBES2_OID,
        }
    }

    /// Get [`pbes1::Parameters`] if it is the selected algorithm.
    #[must_use]
    pub fn pbes1(&self) -> Option<&pbes1::Algorithm> {
        match self {
            Self::Pbes1(alg) => Some(alg),
            _ => None,
        }
    }

    /// Get [`pbes2::Parameters`] if it is the selected algorithm.
    #[must_use]
    pub fn pbes2(&self) -> Option<&pbes2::Parameters> {
        match self {
            Self::Pbes2(params) => Some(params),
            _ => None,
        }
    }
}

impl<'a> DecodeValue<'a> for EncryptionScheme {
    type Error = der::Error;

    fn decode_value<R: Reader<'a>>(decoder: &mut R, header: Header) -> der::Result<Self> {
        AlgorithmIdentifierRef::decode_value(decoder, header)?.try_into()
    }
}

impl EncodeValue for EncryptionScheme {
    fn value_len(&self) -> der::Result<Length> {
        match self {
            Self::Pbes1(pbes1) => pbes1.oid().encoded_len()? + pbes1.parameters.encoded_len()?,
            Self::Pbes2(pbes2) => pbes2::PBES2_OID.encoded_len()? + pbes2.encoded_len()?,
        }
    }

    fn encode_value(&self, writer: &mut impl Writer) -> der::Result<()> {
        match self {
            Self::Pbes1(pbes1) => {
                pbes1.oid().encode(writer)?;
                pbes1.parameters.encode(writer)?;
            }
            Self::Pbes2(pbes2) => {
                pbes2::PBES2_OID.encode(writer)?;
                pbes2.encode(writer)?;
            }
        }

        Ok(())
    }
}

impl Sequence<'_> for EncryptionScheme {}

impl From<pbes1::Algorithm> for EncryptionScheme {
    fn from(alg: pbes1::Algorithm) -> EncryptionScheme {
        Self::Pbes1(alg)
    }
}

impl From<pbes2::Parameters> for EncryptionScheme {
    fn from(params: pbes2::Parameters) -> EncryptionScheme {
        Self::Pbes2(params)
    }
}

impl TryFrom<AlgorithmIdentifierRef<'_>> for EncryptionScheme {
    type Error = der::Error;

    fn try_from(alg: AlgorithmIdentifierRef<'_>) -> der::Result<EncryptionScheme> {
        if alg.oid == pbes2::PBES2_OID {
            match alg.parameters {
                Some(params) => pbes2::Parameters::try_from(params).map(Into::into),
                None => Err(Tag::OctetString.value_error().into()),
            }
        } else {
            pbes1::Algorithm::try_from(alg).map(Into::into)
        }
    }
}

impl TryFrom<&[u8]> for EncryptionScheme {
    type Error = der::Error;

    fn try_from(bytes: &[u8]) -> der::Result<EncryptionScheme> {
        AlgorithmIdentifierRef::from_der(bytes)?.try_into()
    }
}
