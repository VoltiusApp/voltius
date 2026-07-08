//! Digital Signature Algorithm (DSA) public keys.

use crate::{Error, Mpint, Result};
use core::hash::{Hash, Hasher};
use encoding::{CheckedSum, Decode, Encode, Reader, Writer};

#[cfg(feature = "dsa")]
use encoding::Uint;

/// Digital Signature Algorithm (DSA) public key.
///
/// Described in [FIPS 186-4 § 4.1](https://csrc.nist.gov/publications/detail/fips/186/4/final).
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct DsaPublicKey {
    /// Prime modulus.
    p: Mpint,

    /// Prime divisor of `p - 1`.
    q: Mpint,

    /// Generator of a subgroup of order `q` in the multiplicative group `GF(p)`, such that
    /// `1 < g < p`.
    g: Mpint,

    /// The public key, where `y = gˣ mod p`.
    y: Mpint,
}

impl DsaPublicKey {
    /// Create a new [`DsaPublicKey`] with the following components:
    ///
    /// - `p`: prime modulus.
    /// - `q`: prime divisor of `p - 1`.
    /// - `g`: generator of a subgroup of order `q` in the multiplicative group `GF(p)`, such
    ///   that `1 < g < p`.
    /// - `y`: the public key, where `y = gˣ mod p`.
    ///
    /// # Errors
    /// Returns [`Error::FormatEncoding`] in the event any of the components are negative.
    pub fn new(p: Mpint, q: Mpint, g: Mpint, y: Mpint) -> Result<Self> {
        if p.is_positive() && q.is_positive() && g.is_positive() && y.is_positive() {
            Ok(Self { p, q, g, y })
        } else {
            Err(Error::FormatEncoding)
        }
    }

    /// Prime modulus.
    #[must_use]
    pub fn p(&self) -> &Mpint {
        &self.p
    }

    /// Prime divisor of `p - 1`.
    #[must_use]
    pub fn q(&self) -> &Mpint {
        &self.q
    }

    /// Generator of a subgroup of order `q` in the multiplicative group `GF(p)`, such that
    /// `1 < g < p`.
    #[must_use]
    pub fn g(&self) -> &Mpint {
        &self.g
    }

    /// The public key, where `y = gˣ mod p`.
    #[must_use]
    pub fn y(&self) -> &Mpint {
        &self.y
    }
}

impl Decode for DsaPublicKey {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        let p = Mpint::decode(reader)?;
        let q = Mpint::decode(reader)?;
        let g = Mpint::decode(reader)?;
        let y = Mpint::decode(reader)?;
        Self::new(p, q, g, y)
    }
}

impl Encode for DsaPublicKey {
    fn encoded_len(&self) -> encoding::Result<usize> {
        [
            self.p.encoded_len()?,
            self.q.encoded_len()?,
            self.g.encoded_len()?,
            self.y.encoded_len()?,
        ]
        .checked_sum()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.p.encode(writer)?;
        self.q.encode(writer)?;
        self.g.encode(writer)?;
        self.y.encode(writer)
    }
}

impl Hash for DsaPublicKey {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.p.as_bytes().hash(state);
        self.q.as_bytes().hash(state);
        self.g.as_bytes().hash(state);
        self.y.as_bytes().hash(state);
    }
}

#[cfg(feature = "dsa")]
impl TryFrom<DsaPublicKey> for dsa::VerifyingKey {
    type Error = Error;

    fn try_from(key: DsaPublicKey) -> Result<dsa::VerifyingKey> {
        dsa::VerifyingKey::try_from(&key)
    }
}

#[cfg(feature = "dsa")]
impl TryFrom<&DsaPublicKey> for dsa::VerifyingKey {
    type Error = Error;

    fn try_from(key: &DsaPublicKey) -> Result<dsa::VerifyingKey> {
        let p = Uint::try_from(&key.p)?;
        let q = Uint::try_from(&key.q)?;
        let g = Uint::try_from(&key.g)?;
        let y = Uint::try_from(&key.y)?;

        let components = dsa::Components::from_components(p, q, g)?;
        dsa::VerifyingKey::from_components(components, y).map_err(|_| Error::Crypto)
    }
}

#[cfg(feature = "dsa")]
impl From<dsa::VerifyingKey> for DsaPublicKey {
    fn from(key: dsa::VerifyingKey) -> DsaPublicKey {
        DsaPublicKey::from(&key)
    }
}

#[cfg(feature = "dsa")]
impl From<&dsa::VerifyingKey> for DsaPublicKey {
    fn from(key: &dsa::VerifyingKey) -> DsaPublicKey {
        DsaPublicKey {
            p: key.components().p().as_ref().into(),
            q: key.components().q().as_ref().into(),
            g: key.components().g().as_ref().into(),
            y: key.y().as_ref().into(),
        }
    }
}
