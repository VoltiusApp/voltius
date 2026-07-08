//! PKCS#8 `PrivateKeyInfo`.

use crate::{Error, Result, Version};
use core::fmt;
use der::{
    Decode, DecodeValue, Encode, EncodeValue, FixedTag, Header, Length, Reader, Sequence, TagMode,
    TagNumber, Writer,
    asn1::{AnyRef, BitStringRef, ContextSpecific, OctetStringRef, SequenceRef},
};
use spki::AlgorithmIdentifier;

#[cfg(feature = "ctutils")]
use ctutils::{Choice, CtEq};
#[cfg(feature = "pem")]
use der::pem::PemLabel;
#[cfg(feature = "alloc")]
use der::{
    SecretDocument,
    asn1::{Any, BitString, OctetString},
};
#[cfg(feature = "encryption")]
use {
    crate::EncryptedPrivateKeyInfoRef, der::zeroize::Zeroizing, pkcs5::pbes2,
    rand_core::TryCryptoRng,
};

/// Context-specific tag number for attributes.
const ATTRIBUTES_TAG: TagNumber = TagNumber(0);

/// Context-specific tag number for the public key.
const PUBLIC_KEY_TAG: TagNumber = TagNumber(1);

/// PKCS#8 `PrivateKeyInfo`.
///
/// ASN.1 structure containing an `AlgorithmIdentifier`, private key
/// data in an algorithm specific format, and optional attributes
/// (ignored by this implementation).
///
/// Supports PKCS#8 v1 as described in [RFC 5208] and PKCS#8 v2 as described
/// in [RFC 5958]. PKCS#8 v2 keys include an additional public key field.
///
/// # PKCS#8 v1 `PrivateKeyInfo`
///
/// Described in [RFC 5208 Section 5]:
///
/// ```text
/// PrivateKeyInfo ::= SEQUENCE {
///         version                   Version,
///         privateKeyAlgorithm       PrivateKeyAlgorithmIdentifier,
///         privateKey                PrivateKey,
///         attributes           [0]  IMPLICIT Attributes OPTIONAL }
///
/// Version ::= INTEGER
///
/// PrivateKeyAlgorithmIdentifier ::= AlgorithmIdentifier
///
/// PrivateKey ::= OCTET STRING
///
/// Attributes ::= SET OF Attribute
/// ```
///
/// # PKCS#8 v2 `OneAsymmetricKey`
///
/// PKCS#8 `OneAsymmetricKey` as described in [RFC 5958 Section 2]:
///
/// ```text
/// PrivateKeyInfo ::= OneAsymmetricKey
///
/// OneAsymmetricKey ::= SEQUENCE {
///     version                   Version,
///     privateKeyAlgorithm       PrivateKeyAlgorithmIdentifier,
///     privateKey                PrivateKey,
///     attributes            [0] Attributes OPTIONAL,
///     ...,
///     [[2: publicKey        [1] PublicKey OPTIONAL ]],
///     ...
///   }
///
/// Version ::= INTEGER { v1(0), v2(1) } (v1, ..., v2)
///
/// PrivateKeyAlgorithmIdentifier ::= AlgorithmIdentifier
///
/// PrivateKey ::= OCTET STRING
///
/// Attributes ::= SET OF Attribute
///
/// PublicKey ::= BIT STRING
/// ```
///
/// [RFC 5208]: https://tools.ietf.org/html/rfc5208
/// [RFC 5958]: https://datatracker.ietf.org/doc/html/rfc5958
/// [RFC 5208 Section 5]: https://tools.ietf.org/html/rfc5208#section-5
/// [RFC 5958 Section 2]: https://datatracker.ietf.org/doc/html/rfc5958#section-2
#[derive(Clone)]
pub struct PrivateKeyInfo<Params, Key, PubKey> {
    /// X.509 `AlgorithmIdentifier` for the private key type.
    pub algorithm: AlgorithmIdentifier<Params>,

    /// Private key data. Exact content format is different between algorithms.
    pub private_key: Key,

    /// Public key data, optionally available if version is V2.
    pub public_key: Option<PubKey>,
}

impl<Params, Key, PubKey> PrivateKeyInfo<Params, Key, PubKey> {
    /// Create a new PKCS#8 [`PrivateKeyInfo`] message.
    ///
    /// This is a helper method which initializes `attributes` and `public_key`
    /// to `None`, helpful if you aren't using those.
    pub fn new(algorithm: AlgorithmIdentifier<Params>, private_key: Key) -> Self {
        Self {
            algorithm,
            private_key,
            public_key: None,
        }
    }

    /// Get the PKCS#8 [`Version`] for this structure.
    ///
    /// [`Version::V1`] if `public_key` is `None`, [`Version::V2`] if `Some`.
    pub fn version(&self) -> Version {
        if self.public_key.is_some() {
            Version::V2
        } else {
            Version::V1
        }
    }
}

impl<'a, Params, Key, PubKey> PrivateKeyInfo<Params, Key, PubKey>
where
    Params: der::Choice<'a, Error = der::Error> + Encode,
    Key: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    Key: EncodeValue,
    PubKey: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    PubKey: BitStringLike,
{
    /// Encrypt this private key using an encryption key derived from the provided password.
    ///
    /// Uses the following algorithms for encryption:
    /// - PBKDF: scrypt with default parameters:
    ///   - log₂(N): 15
    ///   - r: 8
    ///   - p: 1
    /// - Cipher: AES-256-CBC (best available option for PKCS#5 encryption)
    ///
    /// # Errors
    /// - Propagates errors from calling [`Encode::to_der`] on `Self`.
    /// - Returns errors in the event encryption failed.
    #[cfg(feature = "getrandom")]
    pub fn encrypt(&self, password: impl AsRef<[u8]>) -> Result<SecretDocument> {
        let der = Zeroizing::new(self.to_der()?);
        EncryptedPrivateKeyInfoRef::encrypt(password, der.as_ref())
    }

    /// Encrypt this private key using an encryption key derived from the provided password.
    ///
    /// This function allows the RNG used to derive the salt/IV to be specified directly.
    ///
    /// # Errors
    /// - Propagates errors from calling [`Encode::to_der`] on `Self`.
    /// - Returns errors in the event encryption failed.
    #[cfg(feature = "encryption")]
    pub fn encrypt_with_rng<R: TryCryptoRng>(
        &self,
        rng: &mut R,
        password: impl AsRef<[u8]>,
    ) -> Result<SecretDocument> {
        let der = Zeroizing::new(self.to_der()?);
        EncryptedPrivateKeyInfoRef::encrypt_with_rng(rng, password, der.as_ref())
    }

    /// Encrypt this private key using a symmetric encryption key derived from the provided password
    /// and [`pbes2::Parameters`].
    ///
    /// # Errors
    /// - Propagates errors from calling [`Encode::to_der`] on `Self`.
    /// - Returns errors in the event encryption failed.
    #[cfg(feature = "encryption")]
    pub fn encrypt_with_params(
        &self,
        pbes2_params: pbes2::Parameters,
        password: impl AsRef<[u8]>,
    ) -> Result<SecretDocument> {
        let der = Zeroizing::new(self.to_der()?);
        EncryptedPrivateKeyInfoRef::encrypt_with_params(pbes2_params, password, der.as_ref())
    }
}

impl<'a, Params, Key, PubKey> PrivateKeyInfo<Params, Key, PubKey>
where
    Params: der::Choice<'a> + Encode,
    PubKey: BitStringLike,
{
    /// Get a `BIT STRING` representation of the public key, if present.
    fn public_key_bit_string(&self) -> Option<ContextSpecific<BitStringRef<'_>>> {
        self.public_key.as_ref().map(|pk| {
            let value = pk.as_bit_string();
            ContextSpecific {
                tag_number: PUBLIC_KEY_TAG,
                tag_mode: TagMode::Implicit,
                value,
            }
        })
    }
}

impl<'a, Params, Key, PubKey> DecodeValue<'a> for PrivateKeyInfo<Params, Key, PubKey>
where
    Params: der::Choice<'a, Error = der::Error> + Encode,
    Key: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    PubKey: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
{
    type Error = der::Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, _header: Header) -> der::Result<Self> {
        // Parse and validate `version` INTEGER.
        let version = Version::decode(reader)?;
        let algorithm = reader.decode()?;
        let private_key = Key::decode(reader)?;

        let _attributes =
            reader.context_specific::<&SequenceRef>(ATTRIBUTES_TAG, TagMode::Implicit)?;

        let public_key = reader.context_specific::<PubKey>(PUBLIC_KEY_TAG, TagMode::Implicit)?;

        if version.has_public_key() != public_key.is_some() {
            return Err(reader.error(
                der::Tag::ContextSpecific {
                    constructed: true,
                    number: PUBLIC_KEY_TAG,
                }
                .value_error(),
            ));
        }

        // Ignore any remaining extension fields
        while !reader.is_finished() {
            reader.decode::<ContextSpecific<AnyRef<'_>>>()?;
        }

        Ok(Self {
            algorithm,
            private_key,
            public_key,
        })
    }
}

impl<'a, Params, Key, PubKey> EncodeValue for PrivateKeyInfo<Params, Key, PubKey>
where
    Params: der::Choice<'a, Error = der::Error> + Encode,
    Key: EncodeValue + FixedTag,
    PubKey: BitStringLike,
{
    fn value_len(&self) -> der::Result<Length> {
        self.version().encoded_len()?
            + self.algorithm.encoded_len()?
            + self.private_key.encoded_len()?
            + self.public_key_bit_string().encoded_len()?
    }

    fn encode_value(&self, writer: &mut impl Writer) -> der::Result<()> {
        self.version().encode(writer)?;
        self.algorithm.encode(writer)?;
        self.private_key.encode(writer)?;
        self.public_key_bit_string().encode(writer)?;
        Ok(())
    }
}

impl<'a, Params, Key, PubKey> Sequence<'a> for PrivateKeyInfo<Params, Key, PubKey>
where
    Params: der::Choice<'a, Error = der::Error> + Encode,
    Key: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    Key: EncodeValue,
    PubKey: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    PubKey: BitStringLike,
{
}

impl<'a, Params, Key, PubKey> TryFrom<&'a [u8]> for PrivateKeyInfo<Params, Key, PubKey>
where
    Params: der::Choice<'a, Error = der::Error> + Encode,
    Key: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    Key: EncodeValue,
    PubKey: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    PubKey: BitStringLike,
{
    type Error = Error;

    fn try_from(bytes: &'a [u8]) -> Result<Self> {
        Ok(Self::from_der(bytes)?)
    }
}

impl<Params, Key, PubKey> fmt::Debug for PrivateKeyInfo<Params, Key, PubKey>
where
    Params: fmt::Debug,
    PubKey: fmt::Debug,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PrivateKeyInfo")
            .field("version", &self.version())
            .field("algorithm", &self.algorithm)
            .field("public_key", &self.public_key)
            .finish_non_exhaustive()
    }
}

#[cfg(feature = "alloc")]
impl<'a, Params, Key, PubKey> TryFrom<PrivateKeyInfo<Params, Key, PubKey>> for SecretDocument
where
    Params: der::Choice<'a, Error = der::Error> + Encode,
    Key: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    Key: EncodeValue,
    PubKey: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    PubKey: BitStringLike,
{
    type Error = Error;

    fn try_from(private_key: PrivateKeyInfo<Params, Key, PubKey>) -> Result<SecretDocument> {
        SecretDocument::try_from(&private_key)
    }
}

#[cfg(feature = "alloc")]
impl<'a, Params, Key, PubKey> TryFrom<&PrivateKeyInfo<Params, Key, PubKey>> for SecretDocument
where
    Params: der::Choice<'a, Error = der::Error> + Encode,
    Key: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    Key: EncodeValue,
    PubKey: DecodeValue<'a, Error = der::Error> + FixedTag + 'a,
    PubKey: BitStringLike,
{
    type Error = Error;

    fn try_from(private_key: &PrivateKeyInfo<Params, Key, PubKey>) -> Result<SecretDocument> {
        Ok(Self::encode_msg(private_key)?)
    }
}

#[cfg(feature = "pem")]
impl<Params, Key, PubKey> PemLabel for PrivateKeyInfo<Params, Key, PubKey> {
    const PEM_LABEL: &'static str = "PRIVATE KEY";
}

#[cfg(feature = "ctutils")]
impl<Params, Key, PubKey> CtEq for PrivateKeyInfo<Params, Key, PubKey>
where
    Params: Eq,
    Key: PartialEq + AsRef<[u8]>,
    PubKey: PartialEq,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        // NOTE: public fields are not compared in constant time
        let public_fields_eq =
            self.algorithm == other.algorithm && self.public_key == other.public_key;

        self.private_key.as_ref().ct_eq(other.private_key.as_ref())
            & Choice::from(u8::from(public_fields_eq))
    }
}

#[cfg(feature = "ctutils")]
impl<Params, Key, PubKey> Eq for PrivateKeyInfo<Params, Key, PubKey>
where
    Params: Eq,
    Key: AsRef<[u8]> + Eq,
    PubKey: Eq,
{
}

#[cfg(feature = "ctutils")]
impl<Params, Key, PubKey> PartialEq for PrivateKeyInfo<Params, Key, PubKey>
where
    Params: Eq,
    Key: PartialEq + AsRef<[u8]>,
    PubKey: PartialEq,
{
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).into()
    }
}

/// [`PrivateKeyInfo`] with [`AnyRef`] algorithm parameters, and `&[u8]` key.
pub type PrivateKeyInfoRef<'a> = PrivateKeyInfo<AnyRef<'a>, &'a OctetStringRef, BitStringRef<'a>>;

/// [`BitStringLike`] marks object that will act like a `BitString`.
///
/// It will allow to get a [`BitStringRef`] that points back to the underlying bytes.
// TODO(tarcieri): replace this with `AsRef<BitStringRef>` when we can have `&BitStringRef`.
pub trait BitStringLike {
    fn as_bit_string(&self) -> BitStringRef<'_>;
}

impl BitStringLike for BitStringRef<'_> {
    fn as_bit_string(&self) -> BitStringRef<'_> {
        BitStringRef::from(self)
    }
}

#[cfg(feature = "alloc")]
pub(crate) mod allocating {
    use super::*;
    use crate::{DecodePrivateKey, EncodePrivateKey};
    use alloc::borrow::ToOwned;
    use core::borrow::Borrow;
    use der::referenced::*;

    #[cfg(feature = "pem")]
    use der::DecodePem;

    /// [`PrivateKeyInfo`] with [`Any`] algorithm parameters, and `Box<[u8]>` key.
    pub type PrivateKeyInfoOwned = PrivateKeyInfo<Any, OctetString, BitString>;

    impl DecodePrivateKey for PrivateKeyInfoOwned {
        fn from_pkcs8_der(bytes: &[u8]) -> Result<Self> {
            Ok(Self::from_der(bytes)?)
        }

        #[cfg(feature = "pem")]
        fn from_pkcs8_pem(pem: &str) -> Result<Self> {
            Ok(Self::from_pem(pem)?)
        }
    }

    impl EncodePrivateKey for PrivateKeyInfoOwned {
        fn to_pkcs8_der(&self) -> Result<SecretDocument> {
            self.try_into()
        }
    }

    impl EncodePrivateKey for PrivateKeyInfoRef<'_> {
        fn to_pkcs8_der(&self) -> Result<SecretDocument> {
            self.try_into()
        }
    }

    impl<'a> RefToOwned<'a> for PrivateKeyInfoRef<'a> {
        type Owned = PrivateKeyInfoOwned;
        fn ref_to_owned(&self) -> Self::Owned {
            PrivateKeyInfoOwned {
                algorithm: self.algorithm.ref_to_owned(),
                private_key: self.private_key.to_owned(),
                public_key: self.public_key.ref_to_owned(),
            }
        }
    }

    impl OwnedToRef for PrivateKeyInfoOwned {
        type Borrowed<'a> = PrivateKeyInfoRef<'a>;
        fn owned_to_ref(&self) -> Self::Borrowed<'_> {
            PrivateKeyInfoRef {
                algorithm: self.algorithm.owned_to_ref(),
                private_key: self.private_key.borrow(),
                public_key: self.public_key.owned_to_ref(),
            }
        }
    }

    impl BitStringLike for BitString {
        fn as_bit_string(&self) -> BitStringRef<'_> {
            BitStringRef::from(self)
        }
    }
}
