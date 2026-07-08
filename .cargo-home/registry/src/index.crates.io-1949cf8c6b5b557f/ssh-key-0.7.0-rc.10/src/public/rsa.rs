//! Rivest–Shamir–Adleman (RSA) public keys.

use crate::{Error, Mpint, Result};
use core::hash::{Hash, Hasher};
use encoding::{CheckedSum, Decode, Encode, Reader, Writer};

#[cfg(feature = "rsa")]
use {
    encoding::Uint,
    rsa::{pkcs1v15, traits::PublicKeyParts},
    sha2::{Digest, digest::const_oid::AssociatedOid},
};

/// RSA public key.
///
/// Described in [RFC4253 § 6.6](https://datatracker.ietf.org/doc/html/rfc4253#section-6.6).
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct RsaPublicKey {
    /// RSA public exponent.
    e: Mpint,

    /// RSA modulus.
    n: Mpint,

    /// Length of this key in bits.
    bits: u32,
}

impl RsaPublicKey {
    /// Create a new [`RsaPublicKey`] with the given components:
    ///
    /// - `e`: RSA public exponent.
    /// - `n`: RSA modulus.
    ///
    /// # Errors
    /// Returns [`Error::FormatEncoding`] in the event one of the components is odd.
    pub fn new(e: Mpint, n: Mpint) -> Result<Self> {
        if !e.is_positive() {
            return Err(Error::FormatEncoding);
        }

        let bits = match n.as_positive_bytes() {
            Some(bytes) => bytes
                .len()
                .checked_mul(8)
                .and_then(|bits| u32::try_from(bits).ok())
                .ok_or(Error::FormatEncoding)?,
            None => return Err(Error::FormatEncoding),
        };

        Ok(Self { e, n, bits })
    }

    /// Get the RSA public exponent.
    #[must_use]
    pub fn e(&self) -> &Mpint {
        &self.e
    }

    /// Get the RSA modulus.
    #[must_use]
    pub fn n(&self) -> &Mpint {
        &self.n
    }

    /// Get the size of the RSA modulus in bits.
    #[must_use]
    pub fn key_size(&self) -> u32 {
        self.bits
    }
}

impl Decode for RsaPublicKey {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        let e = Mpint::decode(reader)?;
        let n = Mpint::decode(reader)?;
        Self::new(e, n)
    }
}

impl Encode for RsaPublicKey {
    fn encoded_len(&self) -> encoding::Result<usize> {
        [self.e.encoded_len()?, self.n.encoded_len()?].checked_sum()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.e.encode(writer)?;
        self.n.encode(writer)
    }
}

impl Hash for RsaPublicKey {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.e.as_bytes().hash(state);
        self.n.as_bytes().hash(state);
    }
}

#[cfg(feature = "rsa")]
impl TryFrom<RsaPublicKey> for rsa::RsaPublicKey {
    type Error = Error;

    fn try_from(key: RsaPublicKey) -> Result<rsa::RsaPublicKey> {
        rsa::RsaPublicKey::try_from(&key)
    }
}

#[cfg(feature = "rsa")]
impl TryFrom<&RsaPublicKey> for rsa::RsaPublicKey {
    type Error = Error;

    fn try_from(key: &RsaPublicKey) -> Result<rsa::RsaPublicKey> {
        let n = Uint::try_from(&key.n)?;
        let e = Uint::try_from(&key.e)?;
        let ret = rsa::RsaPublicKey::new(n, e).map_err(|_| Error::Crypto)?;

        Ok(ret)
    }
}

#[cfg(feature = "rsa")]
impl TryFrom<rsa::RsaPublicKey> for RsaPublicKey {
    type Error = Error;

    fn try_from(key: rsa::RsaPublicKey) -> Result<RsaPublicKey> {
        RsaPublicKey::try_from(&key)
    }
}

#[cfg(feature = "rsa")]
impl TryFrom<&rsa::RsaPublicKey> for RsaPublicKey {
    type Error = Error;

    fn try_from(key: &rsa::RsaPublicKey) -> Result<RsaPublicKey> {
        RsaPublicKey::new(key.e().into(), key.n().as_ref().into())
    }
}

#[cfg(feature = "rsa")]
impl<D> TryFrom<&RsaPublicKey> for pkcs1v15::VerifyingKey<D>
where
    D: Digest + AssociatedOid,
{
    type Error = Error;

    fn try_from(key: &RsaPublicKey) -> Result<pkcs1v15::VerifyingKey<D>> {
        Ok(pkcs1v15::VerifyingKey::new(key.try_into()?))
    }
}
