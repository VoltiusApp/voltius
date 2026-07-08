//! Digital Signature Algorithm (DSA) private keys.

use crate::{Error, Mpint, Result, public::DsaPublicKey};
use core::fmt;
use ctutils::{Choice, CtEq};
use encoding::{CheckedSum, Decode, Encode, Reader, Writer};
use zeroize::Zeroize;

#[cfg(feature = "dsa")]
use encoding::Uint;

#[cfg(all(feature = "dsa", feature = "rand_core"))]
use rand_core::CryptoRng;

/// Digital Signature Algorithm (DSA) private key.
///
/// Uniformly random integer `x`, such that `0 < x < q`, i.e. `x` is in the
/// range `[1, q–1]`.
///
/// Described in [FIPS 186-4 § 4.1](https://csrc.nist.gov/publications/detail/fips/186/4/final).
#[derive(Clone)]
pub struct DsaPrivateKey {
    /// Integer representing a DSA private key.
    inner: Mpint,
}

impl DsaPrivateKey {
    /// Create a new DSA private key given the value `x`.
    ///
    /// # Errors
    /// Returns [`Error::FormatEncoding`] if `x` is negative.
    pub fn new(x: Mpint) -> Result<Self> {
        if x.is_positive() {
            Ok(Self { inner: x })
        } else {
            Err(Error::FormatEncoding)
        }
    }

    /// Get the serialized private key as bytes.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        self.inner.as_bytes()
    }

    /// Get the inner [`Mpint`].
    #[must_use]
    pub fn as_mpint(&self) -> &Mpint {
        &self.inner
    }
}

impl AsRef<[u8]> for DsaPrivateKey {
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl CtEq for DsaPrivateKey {
    fn ct_eq(&self, other: &Self) -> Choice {
        self.inner.ct_eq(&other.inner)
    }
}

impl Eq for DsaPrivateKey {}

impl PartialEq for DsaPrivateKey {
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).into()
    }
}

impl TryFrom<Mpint> for DsaPrivateKey {
    type Error = Error;

    fn try_from(x: Mpint) -> Result<Self> {
        Self::new(x)
    }
}

impl Decode for DsaPrivateKey {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        Self::new(Mpint::decode(reader)?)
    }
}

impl Encode for DsaPrivateKey {
    fn encoded_len(&self) -> encoding::Result<usize> {
        self.inner.encoded_len()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.inner.encode(writer)
    }
}

impl fmt::Debug for DsaPrivateKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DsaPrivateKey").finish_non_exhaustive()
    }
}

impl Drop for DsaPrivateKey {
    fn drop(&mut self) {
        self.inner.zeroize();
    }
}

#[cfg(feature = "dsa")]
impl From<&dsa::SigningKey> for DsaPrivateKey {
    fn from(key: &dsa::SigningKey) -> DsaPrivateKey {
        DsaPrivateKey {
            inner: key.x().as_ref().into(),
        }
    }
}

#[cfg(feature = "dsa")]
impl From<dsa::SigningKey> for DsaPrivateKey {
    fn from(key: dsa::SigningKey) -> DsaPrivateKey {
        DsaPrivateKey::from(&key)
    }
}

#[cfg(feature = "dsa")]
impl TryFrom<DsaPrivateKey> for Uint {
    type Error = Error;

    fn try_from(key: DsaPrivateKey) -> Result<Uint> {
        Ok(Uint::try_from(&key.inner)?)
    }
}

#[cfg(feature = "dsa")]
impl TryFrom<&DsaPrivateKey> for Uint {
    type Error = Error;

    fn try_from(key: &DsaPrivateKey) -> Result<Uint> {
        Ok(Uint::try_from(&key.inner)?)
    }
}

/// Digital Signature Algorithm (DSA) private/public keypair.
#[derive(Clone)]
pub struct DsaKeypair {
    /// Public key.
    public: DsaPublicKey,

    /// Private key.
    private: DsaPrivateKey,
}

impl DsaKeypair {
    /// Key size.
    #[cfg(all(feature = "dsa", feature = "rand_core"))]
    #[allow(deprecated)]
    pub(crate) const KEY_SIZE: dsa::KeySize = dsa::KeySize::DSA_1024_160;

    /// Generate a random DSA private key.
    #[cfg(all(feature = "dsa", feature = "rand_core"))]
    #[expect(clippy::missing_errors_doc, reason = "TODO")]
    pub fn random<R: CryptoRng + ?Sized>(rng: &mut R) -> Result<Self> {
        let components = dsa::Components::generate(rng, Self::KEY_SIZE);
        Ok(dsa::SigningKey::generate(rng, components).into())
    }

    /// Create a new [`DsaKeypair`] with the given `public` and `private` components.
    ///
    /// # Errors
    /// Returns [`Error::Crypto`] if the `public` key does not match the `private` key (TODO).
    pub fn new(public: DsaPublicKey, private: DsaPrivateKey) -> Result<Self> {
        // TODO(tarcieri): actually validate the `public` and `private` components match
        Ok(Self { public, private })
    }

    /// Get the public component of this key.
    #[must_use]
    pub fn public(&self) -> &DsaPublicKey {
        &self.public
    }

    /// Get the private component of this key.
    #[must_use]
    pub fn private(&self) -> &DsaPrivateKey {
        &self.private
    }
}

impl CtEq for DsaKeypair {
    fn ct_eq(&self, other: &Self) -> Choice {
        Choice::from(u8::from(self.public == other.public)) & self.private.ct_eq(&other.private)
    }
}

impl PartialEq for DsaKeypair {
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).into()
    }
}

impl Eq for DsaKeypair {}

impl Decode for DsaKeypair {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        let public = DsaPublicKey::decode(reader)?;
        let private = DsaPrivateKey::decode(reader)?;
        DsaKeypair::new(public, private)
    }
}

impl Encode for DsaKeypair {
    fn encoded_len(&self) -> encoding::Result<usize> {
        [self.public.encoded_len()?, self.private.encoded_len()?].checked_sum()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.public.encode(writer)?;
        self.private.encode(writer)
    }
}

impl From<DsaKeypair> for DsaPublicKey {
    fn from(keypair: DsaKeypair) -> DsaPublicKey {
        keypair.public
    }
}

impl From<&DsaKeypair> for DsaPublicKey {
    fn from(keypair: &DsaKeypair) -> DsaPublicKey {
        keypair.public.clone()
    }
}

impl fmt::Debug for DsaKeypair {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DsaKeypair")
            .field("public", &self.public)
            .finish_non_exhaustive()
    }
}

#[cfg(feature = "dsa")]
impl TryFrom<DsaKeypair> for dsa::SigningKey {
    type Error = Error;

    fn try_from(key: DsaKeypair) -> Result<dsa::SigningKey> {
        dsa::SigningKey::try_from(&key)
    }
}

#[cfg(feature = "dsa")]
impl TryFrom<&DsaKeypair> for dsa::SigningKey {
    type Error = Error;

    fn try_from(key: &DsaKeypair) -> Result<dsa::SigningKey> {
        Ok(dsa::SigningKey::from_components(
            dsa::VerifyingKey::try_from(&key.public)?,
            key.private.as_mpint().try_into()?,
        )?)
    }
}

#[cfg(feature = "dsa")]
impl From<dsa::SigningKey> for DsaKeypair {
    fn from(key: dsa::SigningKey) -> DsaKeypair {
        DsaKeypair::from(&key)
    }
}

#[cfg(feature = "dsa")]
impl From<&dsa::SigningKey> for DsaKeypair {
    fn from(key: &dsa::SigningKey) -> DsaKeypair {
        DsaKeypair {
            private: key.into(),
            public: key.verifying_key().into(),
        }
    }
}
