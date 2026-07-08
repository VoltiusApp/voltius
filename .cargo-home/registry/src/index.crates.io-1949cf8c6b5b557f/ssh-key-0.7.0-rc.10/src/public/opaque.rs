//! Opaque public keys.
//!
//! [`OpaquePublicKey`] represents a public key meant to be used with an algorithm unknown to this
//! crate, i.e. public keys that use a custom algorithm as specified in [RFC4251 § 6].
//!
//! They are said to be opaque, because the meaning of their underlying byte representation is not
//! specified.
//!
//! [RFC4251 § 6]: https://www.rfc-editor.org/rfc/rfc4251.html#section-6

use crate::{Algorithm, Error, Result};
use alloc::vec::Vec;
use encoding::{Decode, Encode, Reader, Writer};

/// An opaque public key with a custom algorithm name.
///
/// The encoded representation of an `OpaquePublicKey` is the encoded representation of its
/// [`OpaquePublicKeyBytes`].
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct OpaquePublicKey {
    /// The [`Algorithm`] of this public key.
    pub algorithm: Algorithm,
    /// The key data
    pub key: OpaquePublicKeyBytes,
}

impl OpaquePublicKey {
    /// Create a new `OpaquePublicKey`.
    #[must_use]
    pub fn new(key: Vec<u8>, algorithm: Algorithm) -> Self {
        Self {
            key: OpaquePublicKeyBytes(key),
            algorithm,
        }
    }

    /// Get the [`Algorithm`] for this public key type.
    #[must_use]
    pub fn algorithm(&self) -> Algorithm {
        self.algorithm.clone()
    }

    /// Decode [`OpaquePublicKey`] for the specified algorithm.
    pub(super) fn decode_as(reader: &mut impl Reader, algorithm: Algorithm) -> Result<Self> {
        Ok(Self {
            algorithm,
            key: OpaquePublicKeyBytes::decode(reader)?,
        })
    }
}

impl AsRef<[u8]> for OpaquePublicKey {
    fn as_ref(&self) -> &[u8] {
        self.key.as_ref()
    }
}

impl Encode for OpaquePublicKey {
    fn encoded_len(&self) -> encoding::Result<usize> {
        self.key.encoded_len()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.key.encode(writer)
    }
}

/// The underlying representation of an [`OpaquePublicKey`].
///
/// The encoded representation of an `OpaquePublicKeyBytes` consists of a 4-byte length prefix,
/// followed by its byte representation.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct OpaquePublicKeyBytes(Vec<u8>);

impl Decode for OpaquePublicKeyBytes {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        Ok(Self(Vec::decode(reader)?))
    }
}

impl Encode for OpaquePublicKeyBytes {
    fn encoded_len(&self) -> encoding::Result<usize> {
        self.0.encoded_len()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.0.encode(writer)
    }
}

impl AsRef<[u8]> for OpaquePublicKeyBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}
