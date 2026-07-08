//! PKCS#8 encoding support.
//!
//! When the `pkcs8` feature of this crate is enabled, the [`DecodePrivateKey`] trait is impl'd for
//! [`DecapsulationKey`], and the [`DecodePublicKey`] trait is impl'd for [`EncapsulationKey`].
//!
//! When both the `pkcs8` and `alloc` features are enabled, the [`EncodePrivateKey`] trait is
//! impl'd for [`DecapsulationKey`], and the [`EncodePublicKey`] trait is impl'd for
//! [`EncapsulationKey`].

#![cfg(feature = "pkcs8")]

pub use ::pkcs8::{DecodePrivateKey, DecodePublicKey, spki::AssociatedAlgorithmIdentifier};
pub use const_oid::AssociatedOid;

#[cfg(feature = "alloc")]
pub use ::pkcs8::{EncodePrivateKey, EncodePublicKey};

use crate::{
    DecapsulationKey, EncapsulationKey, MlKem512, MlKem768, MlKem1024,
    param::{EncapsulationKeySize, KemParams},
    pke::EncryptionKey,
};
use ::pkcs8::{
    der::{
        AnyRef, Reader, SliceReader, TagNumber,
        asn1::{ContextSpecific, OctetStringRef},
    },
    spki,
};
use array::Array;

#[cfg(feature = "alloc")]
use {
    ::kem::KeyExport,
    ::pkcs8::der::{Encode, TagMode, asn1::BitStringRef},
};

/// Tag number for the seed value.
const SEED_TAG_NUMBER: TagNumber = TagNumber(0);

/// ML-KEM seed serialized as ASN.1.
type SeedString<'a> = ContextSpecific<&'a OctetStringRef>;

impl AssociatedOid for MlKem512 {
    const OID: ::pkcs8::ObjectIdentifier = const_oid::db::fips203::ID_ALG_ML_KEM_512;
}

impl AssociatedOid for MlKem768 {
    const OID: ::pkcs8::ObjectIdentifier = const_oid::db::fips203::ID_ALG_ML_KEM_768;
}

impl AssociatedOid for MlKem1024 {
    const OID: ::pkcs8::ObjectIdentifier = const_oid::db::fips203::ID_ALG_ML_KEM_1024;
}

impl AssociatedAlgorithmIdentifier for MlKem512 {
    type Params = ::pkcs8::der::AnyRef<'static>;

    const ALGORITHM_IDENTIFIER: spki::AlgorithmIdentifier<Self::Params> =
        spki::AlgorithmIdentifier {
            oid: Self::OID,
            parameters: None,
        };
}

impl AssociatedAlgorithmIdentifier for MlKem768 {
    type Params = ::pkcs8::der::AnyRef<'static>;

    const ALGORITHM_IDENTIFIER: spki::AlgorithmIdentifier<Self::Params> =
        spki::AlgorithmIdentifier {
            oid: Self::OID,
            parameters: None,
        };
}

impl AssociatedAlgorithmIdentifier for MlKem1024 {
    type Params = ::pkcs8::der::AnyRef<'static>;

    const ALGORITHM_IDENTIFIER: spki::AlgorithmIdentifier<Self::Params> =
        spki::AlgorithmIdentifier {
            oid: Self::OID,
            parameters: None,
        };
}

impl<P> AssociatedAlgorithmIdentifier for EncapsulationKey<P>
where
    P: KemParams + AssociatedAlgorithmIdentifier<Params = AnyRef<'static>>,
{
    type Params = P::Params;

    const ALGORITHM_IDENTIFIER: spki::AlgorithmIdentifier<Self::Params> = P::ALGORITHM_IDENTIFIER;
}

#[cfg(feature = "alloc")]
impl<P> EncodePublicKey for EncapsulationKey<P>
where
    P: KemParams + AssociatedAlgorithmIdentifier<Params = AnyRef<'static>>,
{
    /// Serialize the given `EncapsulationKey` into DER format.
    /// Returns a `Document` which wraps the DER document in case of success.
    fn to_public_key_der(&self) -> spki::Result<pkcs8::Document> {
        let public_key = self.to_bytes();
        let subject_public_key = BitStringRef::new(0, &public_key)?;

        ::pkcs8::SubjectPublicKeyInfo {
            algorithm: P::ALGORITHM_IDENTIFIER,
            subject_public_key,
        }
        .try_into()
    }
}

impl<P> TryFrom<::pkcs8::SubjectPublicKeyInfoRef<'_>> for EncapsulationKey<P>
where
    P: KemParams + AssociatedAlgorithmIdentifier<Params = AnyRef<'static>>,
{
    type Error = spki::Error;

    /// Deserialize the encapsulation key from DER format found in `spki.subject_public_key`.
    /// Returns an `EncapsulationKey` containing `ek_{pke}` and `h` in case of success.
    fn try_from(spki: ::pkcs8::SubjectPublicKeyInfoRef<'_>) -> Result<Self, spki::Error> {
        if spki.algorithm.oid != P::ALGORITHM_IDENTIFIER.oid {
            return Err(spki::Error::OidUnknown {
                oid: P::ALGORITHM_IDENTIFIER.oid,
            });
        }

        let bitstring_of_encapsulation_key = spki.subject_public_key;
        let enc_key = match bitstring_of_encapsulation_key.as_bytes() {
            Some(bytes) => {
                let arr: Array<u8, EncapsulationKeySize<P>> = match bytes.try_into() {
                    Ok(array) => array,
                    Err(_) => return Err(spki::Error::KeyMalformed),
                };
                EncryptionKey::from_bytes(&arr).map_err(|_| spki::Error::KeyMalformed)?
            }
            None => return Err(spki::Error::KeyMalformed),
        };

        Ok(Self::from_encryption_key(enc_key))
    }
}

impl<P> AssociatedAlgorithmIdentifier for DecapsulationKey<P>
where
    P: KemParams + AssociatedAlgorithmIdentifier<Params = AnyRef<'static>>,
{
    type Params = P::Params;

    const ALGORITHM_IDENTIFIER: spki::AlgorithmIdentifier<Self::Params> = P::ALGORITHM_IDENTIFIER;
}

#[cfg(feature = "alloc")]
impl<P> EncodePrivateKey for DecapsulationKey<P>
where
    P: KemParams + AssociatedAlgorithmIdentifier<Params = AnyRef<'static>>,
{
    /// Serialize the given `DecapsulationKey` into DER format.
    /// Returns a `SecretDocument` which wraps the DER document in case of success.
    fn to_pkcs8_der(&self) -> ::pkcs8::Result<pkcs8::SecretDocument> {
        let seed = self.to_seed().ok_or(pkcs8::KeyError::Invalid)?;

        let seed_der = SeedString {
            tag_mode: TagMode::Implicit,
            tag_number: SEED_TAG_NUMBER,
            value: OctetStringRef::new(&seed)?,
        }
        .to_der()?;

        let private_key = OctetStringRef::new(&seed_der)?;
        let private_key_info = pkcs8::PrivateKeyInfoRef::new(P::ALGORITHM_IDENTIFIER, private_key);
        pkcs8::SecretDocument::encode_msg(&private_key_info).map_err(pkcs8::Error::Asn1)
    }
}

impl<P> TryFrom<::pkcs8::PrivateKeyInfoRef<'_>> for DecapsulationKey<P>
where
    P: KemParams + AssociatedAlgorithmIdentifier<Params = AnyRef<'static>>,
{
    type Error = ::pkcs8::Error;

    /// Deserialize the decapsulation key from DER format found in `spki.private_key`.
    /// Returns a `DecapsulationKey` containing `dk_{pke}`, `ek`, and `z` in case of success.
    fn try_from(private_key_info_ref: ::pkcs8::PrivateKeyInfoRef<'_>) -> Result<Self, Self::Error> {
        private_key_info_ref
            .algorithm
            .assert_algorithm_oid(P::ALGORITHM_IDENTIFIER.oid)?;

        let mut reader = SliceReader::new(private_key_info_ref.private_key.as_bytes())?;
        let seed_string = SeedString::decode_implicit(&mut reader, SEED_TAG_NUMBER)?
            .ok_or(pkcs8::KeyError::Invalid)?;
        let seed = seed_string
            .value
            .as_bytes()
            .try_into()
            .map_err(|_| pkcs8::KeyError::Invalid)?; // TODO(tarcieri): more specific error
        reader.finish()?;

        Ok(Self::from_seed(seed))
    }
}
