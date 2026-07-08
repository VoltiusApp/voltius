//! Key derivation functions.

mod salt;

pub use self::salt::Salt;

use crate::{AlgorithmIdentifierRef, Error, Result};
use der::{
    Decode, DecodeValue, Encode, EncodeValue, ErrorKind, Length, Reader, Sequence, Tag, Tagged,
    Writer,
    asn1::{AnyRef, ObjectIdentifier},
};

/// Password-Based Key Derivation Function (PBKDF2) OID.
pub const PBKDF2_OID: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.5.12");

/// HMAC-SHA1 (for use with PBKDF2)
pub const HMAC_WITH_SHA1_OID: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.2.7");

/// HMAC-SHA-224 (for use with PBKDF2)
pub const HMAC_WITH_SHA224_OID: ObjectIdentifier =
    ObjectIdentifier::new_unwrap("1.2.840.113549.2.8");

/// HMAC-SHA-256 (for use with PBKDF2)
pub const HMAC_WITH_SHA256_OID: ObjectIdentifier =
    ObjectIdentifier::new_unwrap("1.2.840.113549.2.9");

/// HMAC-SHA-384 (for use with PBKDF2)
pub const HMAC_WITH_SHA384_OID: ObjectIdentifier =
    ObjectIdentifier::new_unwrap("1.2.840.113549.2.10");

/// HMAC-SHA-512 (for use with PBKDF2)
pub const HMAC_WITH_SHA512_OID: ObjectIdentifier =
    ObjectIdentifier::new_unwrap("1.2.840.113549.2.11");

/// `id-scrypt` ([RFC 7914])
///
/// [RFC 7914]: https://datatracker.ietf.org/doc/html/rfc7914#section-7
pub const SCRYPT_OID: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.4.1.11591.4.11");

/// Type used for expressing scrypt cost
type ScryptCost = u64;

/// Password-based key derivation function.
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum Kdf {
    /// Password-Based Key Derivation Function 2 (PBKDF2).
    Pbkdf2(Pbkdf2Params),

    /// scrypt sequential memory-hard password hashing function.
    Scrypt(ScryptParams),
}

impl Kdf {
    /// Get derived key length in bytes, if defined.
    // TODO(tarcieri): rename to `key_size` to match `EncryptionScheme::key_size`?
    #[must_use]
    pub fn key_length(&self) -> Option<u16> {
        match self {
            Self::Pbkdf2(params) => params.key_length,
            Self::Scrypt(params) => params.key_length,
        }
    }

    /// Get the [`ObjectIdentifier`] (a.k.a OID) for this algorithm.
    #[must_use]
    pub fn oid(&self) -> ObjectIdentifier {
        match self {
            Self::Pbkdf2(_) => PBKDF2_OID,
            Self::Scrypt(_) => SCRYPT_OID,
        }
    }

    /// Get [`Pbkdf2Params`] if it is the selected algorithm.
    #[must_use]
    pub fn pbkdf2(&self) -> Option<&Pbkdf2Params> {
        match self {
            Self::Pbkdf2(params) => Some(params),
            _ => None,
        }
    }

    /// Get [`ScryptParams`] if it is the selected algorithm.
    #[must_use]
    pub fn scrypt(&self) -> Option<&ScryptParams> {
        match self {
            Self::Scrypt(params) => Some(params),
            _ => None,
        }
    }

    /// Is the selected KDF PBKDF2?
    #[must_use]
    pub fn is_pbkdf2(&self) -> bool {
        self.pbkdf2().is_some()
    }

    /// Is the selected KDF scrypt?
    #[must_use]
    pub fn is_scrypt(&self) -> bool {
        self.scrypt().is_some()
    }

    /// Convenience function to turn the OID (see [`oid`](Self::oid))
    /// of this [`Kdf`] into error case [`Error::AlgorithmParametersInvalid`]
    #[must_use]
    pub fn to_alg_params_invalid(&self) -> Error {
        Error::AlgorithmParametersInvalid { oid: self.oid() }
    }
}

impl<'a> DecodeValue<'a> for Kdf {
    type Error = der::Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: der::Header) -> der::Result<Self> {
        AlgorithmIdentifierRef::decode_value(reader, header)?.try_into()
    }
}

impl EncodeValue for Kdf {
    fn value_len(&self) -> der::Result<Length> {
        self.oid().encoded_len()?
            + match self {
                Self::Pbkdf2(params) => params.encoded_len()?,
                Self::Scrypt(params) => params.encoded_len()?,
            }
    }

    fn encode_value(&self, writer: &mut impl Writer) -> der::Result<()> {
        self.oid().encode(writer)?;

        match self {
            Self::Pbkdf2(params) => params.encode(writer)?,
            Self::Scrypt(params) => params.encode(writer)?,
        }

        Ok(())
    }
}

impl Sequence<'_> for Kdf {}

impl From<Pbkdf2Params> for Kdf {
    fn from(params: Pbkdf2Params) -> Self {
        Kdf::Pbkdf2(params)
    }
}

impl From<ScryptParams> for Kdf {
    fn from(params: ScryptParams) -> Self {
        Kdf::Scrypt(params)
    }
}

impl TryFrom<AlgorithmIdentifierRef<'_>> for Kdf {
    type Error = der::Error;

    fn try_from(alg: AlgorithmIdentifierRef<'_>) -> der::Result<Self> {
        if let Some(params) = alg.parameters {
            match alg.oid {
                PBKDF2_OID => params.try_into().map(Self::Pbkdf2),
                SCRYPT_OID => params.try_into().map(Self::Scrypt),
                oid => Err(ErrorKind::OidUnknown { oid }.into()),
            }
        } else {
            Err(Tag::OctetString.value_error().into())
        }
    }
}

/// Password-Based Key Derivation Scheme 2 parameters as defined in
/// [RFC 8018 Appendix A.2].
///
/// ```text
/// PBKDF2-params ::= SEQUENCE {
///     salt CHOICE {
///         specified OCTET STRING,
///         otherSource AlgorithmIdentifier {{PBKDF2-SaltSources}}
///     },
///     iterationCount INTEGER (1..MAX),
///     keyLength INTEGER (1..MAX) OPTIONAL,
///     prf AlgorithmIdentifier {{PBKDF2-PRFs}} DEFAULT
///     algid-hmacWithSHA1 }
/// ```
///
/// [RFC 8018 Appendix A.2]: https://tools.ietf.org/html/rfc8018#appendix-A.2
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Pbkdf2Params {
    /// PBKDF2 salt
    // TODO(tarcieri): support `CHOICE` with `otherSource`
    pub salt: Salt,

    /// PBKDF2 iteration count
    pub iteration_count: u32,

    /// PBKDF2 output length
    pub key_length: Option<u16>,

    /// Pseudo-random function to use with PBKDF2
    pub prf: Pbkdf2Prf,
}

impl Pbkdf2Params {
    /// Implementation defined maximum iteration count of 100,000,000.
    ///
    /// > For especially critical keys, or
    /// > for very powerful systems or systems where user-perceived
    /// > performance is not critical, an iteration count of 10,000,000 may
    /// > be appropriate.
    ///
    /// See [RFC 8018, §4.2](https://datatracker.ietf.org/doc/html/rfc8018#section-4.2)
    /// and [RFC 8018, §A.2](https://datatracker.ietf.org/doc/html/rfc8018#appendix-A.2)
    pub const MAX_ITERATION_COUNT: u32 = 100_000_000;

    /// OWASP recommended number of iterations for PBKDF2-HMAC-SHA256.
    #[cfg(all(feature = "pbes2", feature = "rand_core"))]
    pub(super) const DEFAULT_SHA256_ITERATIONS: u32 = 600_000;

    const INVALID_ERR: Error = Error::AlgorithmParametersInvalid { oid: PBKDF2_OID };

    /// Initialize PBKDF2-HMAC-SHA256 with the given iteration count and salt.
    ///
    /// # Errors
    /// Returns [`Error::AlgorithmParametersInvalid`] if `iteration_count` exceeds
    /// [`Pbkdf2Params::MAX_ITERATION_COUNT`] or `salt` exceeds [`Salt::MAX_LEN`].
    pub fn hmac_sha256(iteration_count: u32, salt: &[u8]) -> Result<Self> {
        if iteration_count > Self::MAX_ITERATION_COUNT {
            return Err(Self::INVALID_ERR);
        }

        Ok(Self {
            salt: salt.try_into().map_err(|_| Self::INVALID_ERR)?,
            iteration_count,
            key_length: None,
            prf: Pbkdf2Prf::HmacWithSha256,
        })
    }
}

impl<'a> DecodeValue<'a> for Pbkdf2Params {
    type Error = der::Error;
    fn decode_value<R: Reader<'a>>(reader: &mut R, header: der::Header) -> der::Result<Self> {
        AnyRef::decode_value(reader, header)?.try_into()
    }
}

impl EncodeValue for Pbkdf2Params {
    fn value_len(&self) -> der::Result<Length> {
        let len = self.salt.encoded_len()?
            + self.iteration_count.encoded_len()?
            + self.key_length.encoded_len()?;

        if self.prf == Pbkdf2Prf::default() {
            len
        } else {
            len + self.prf.encoded_len()?
        }
    }

    fn encode_value(&self, writer: &mut impl Writer) -> der::Result<()> {
        self.salt.encode(writer)?;
        self.iteration_count.encode(writer)?;
        self.key_length.encode(writer)?;

        if self.prf == Pbkdf2Prf::default() {
            Ok(())
        } else {
            self.prf.encode(writer)
        }
    }
}

impl Sequence<'_> for Pbkdf2Params {}

impl TryFrom<AnyRef<'_>> for Pbkdf2Params {
    type Error = der::Error;

    fn try_from(any: AnyRef<'_>) -> der::Result<Self> {
        any.sequence(|reader| {
            // TODO(tarcieri): support salt `CHOICE` w\ `AlgorithmIdentifier`
            Ok(Self {
                salt: reader.decode()?,
                iteration_count: reader.decode()?,
                key_length: reader.decode()?,
                prf: Option::<AlgorithmIdentifierRef<'_>>::decode(reader)?
                    .map(TryInto::try_into)
                    .transpose()?
                    .unwrap_or_default(),
            })
        })
    }
}

/// Pseudo-random function used by PBKDF2.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum Pbkdf2Prf {
    /// HMAC with SHA1
    HmacWithSha1,

    /// HMAC with SHA-224
    HmacWithSha224,

    /// HMAC with SHA-256
    HmacWithSha256,

    /// HMAC with SHA-384
    HmacWithSha384,

    /// HMAC with SHA-512
    HmacWithSha512,
}

impl Pbkdf2Prf {
    /// Get the [`ObjectIdentifier`] (a.k.a OID) for this algorithm.
    #[must_use]
    pub fn oid(self) -> ObjectIdentifier {
        match self {
            Self::HmacWithSha1 => HMAC_WITH_SHA1_OID,
            Self::HmacWithSha224 => HMAC_WITH_SHA224_OID,
            Self::HmacWithSha256 => HMAC_WITH_SHA256_OID,
            Self::HmacWithSha384 => HMAC_WITH_SHA384_OID,
            Self::HmacWithSha512 => HMAC_WITH_SHA512_OID,
        }
    }
}

/// Default PRF as specified in RFC 8018 Appendix A.2:
///
/// ```text
/// prf AlgorithmIdentifier {{PBKDF2-PRFs}} DEFAULT algid-hmacWithSHA1
/// ```
///
/// Note that modern usage should avoid the use of SHA-1, despite it being
/// the "default" here.
impl Default for Pbkdf2Prf {
    fn default() -> Self {
        Self::HmacWithSha1
    }
}

impl TryFrom<AlgorithmIdentifierRef<'_>> for Pbkdf2Prf {
    type Error = der::Error;

    fn try_from(alg: AlgorithmIdentifierRef<'_>) -> der::Result<Self> {
        if let Some(params) = alg.parameters {
            // TODO(tarcieri): support non-NULL parameters?
            if !params.is_null() {
                return Err(params.tag().value_error().into());
            }
        }

        match alg.oid {
            HMAC_WITH_SHA1_OID => Ok(Self::HmacWithSha1),
            HMAC_WITH_SHA224_OID => Ok(Self::HmacWithSha224),
            HMAC_WITH_SHA256_OID => Ok(Self::HmacWithSha256),
            HMAC_WITH_SHA384_OID => Ok(Self::HmacWithSha384),
            HMAC_WITH_SHA512_OID => Ok(Self::HmacWithSha512),
            oid => Err(ErrorKind::OidUnknown { oid }.into()),
        }
    }
}

impl From<Pbkdf2Prf> for AlgorithmIdentifierRef<'_> {
    fn from(prf: Pbkdf2Prf) -> Self {
        // TODO(tarcieri): support non-NULL parameters?
        let parameters = der::asn1::Null;

        AlgorithmIdentifierRef {
            oid: prf.oid(),
            parameters: Some(parameters.into()),
        }
    }
}

impl Encode for Pbkdf2Prf {
    fn encoded_len(&self) -> der::Result<Length> {
        AlgorithmIdentifierRef::from(*self).encoded_len()
    }

    fn encode(&self, writer: &mut impl Writer) -> der::Result<()> {
        AlgorithmIdentifierRef::from(*self).encode(writer)
    }
}

/// scrypt parameters as defined in [RFC 7914 Section 7.1].
///
/// ```text
/// scrypt-params ::= SEQUENCE {
///     salt OCTET STRING,
///     costParameter INTEGER (1..MAX),
///     blockSize INTEGER (1..MAX),
///     parallelizationParameter INTEGER (1..MAX),
///     keyLength INTEGER (1..MAX) OPTIONAL
/// }
/// ```
///
/// [RFC 7914 Section 7.1]: https://datatracker.ietf.org/doc/html/rfc7914#section-7.1
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ScryptParams {
    /// scrypt salt
    pub salt: Salt,

    /// CPU/Memory cost parameter `N`.
    pub cost_parameter: ScryptCost,

    /// Block size parameter `r`.
    pub block_size: u16,

    /// Parallelization parameter `p`.
    pub parallelization: u16,

    /// PBKDF2 output length
    pub key_length: Option<u16>,
}

impl ScryptParams {
    // NOTE: scrypt parameters are deliberately chosen to retain compatibility with OpenSSL v3.
    // See RustCrypto/formats#1205 for more information.
    #[cfg(all(feature = "pbes2", feature = "rand_core"))]
    pub(super) const DEFAULT_LOG_N: u8 = 14;
    #[cfg(all(feature = "pbes2", feature = "rand_core"))]
    pub(super) const DEFAULT_R: u32 = 8;
    #[cfg(all(feature = "pbes2", feature = "rand_core"))]
    pub(super) const DEFAULT_P: u32 = 1;

    #[cfg(feature = "pbes2")]
    const INVALID_ERR: Error = Error::AlgorithmParametersInvalid { oid: SCRYPT_OID };

    /// Get the [`ScryptParams`] for the provided upstream [`scrypt::Params`]
    /// and a provided salt string.
    ///
    /// # Errors
    /// Returns [`Error::AlgorithmParametersInvalid`] if the parameters are invalid.
    // TODO(tarcieri): encapsulate `scrypt::Params`?
    #[cfg(feature = "pbes2")]
    pub fn from_params_and_salt(params: scrypt::Params, salt: &[u8]) -> Result<Self> {
        Ok(Self {
            salt: salt.try_into().map_err(|_| Self::INVALID_ERR)?,
            cost_parameter: 1 << params.log_n(),
            block_size: params.r().try_into().map_err(|_| Self::INVALID_ERR)?,
            parallelization: params.p().try_into().map_err(|_| Self::INVALID_ERR)?,
            key_length: None,
        })
    }
}

impl<'a> DecodeValue<'a> for ScryptParams {
    type Error = der::Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: der::Header) -> der::Result<Self> {
        AnyRef::decode_value(reader, header)?.try_into()
    }
}

impl EncodeValue for ScryptParams {
    fn value_len(&self) -> der::Result<Length> {
        self.salt.encoded_len()?
            + self.cost_parameter.encoded_len()?
            + self.block_size.encoded_len()?
            + self.parallelization.encoded_len()?
            + self.key_length.encoded_len()?
    }

    fn encode_value(&self, writer: &mut impl Writer) -> der::Result<()> {
        self.salt.encode(writer)?;
        self.cost_parameter.encode(writer)?;
        self.block_size.encode(writer)?;
        self.parallelization.encode(writer)?;
        self.key_length.encode(writer)?;
        Ok(())
    }
}

impl Sequence<'_> for ScryptParams {}

impl TryFrom<AnyRef<'_>> for ScryptParams {
    type Error = der::Error;

    fn try_from(any: AnyRef<'_>) -> der::Result<Self> {
        any.sequence(|reader| {
            Ok(Self {
                salt: reader.decode()?,
                cost_parameter: reader.decode()?,
                block_size: reader.decode()?,
                parallelization: reader.decode()?,
                key_length: reader.decode()?,
            })
        })
    }
}

#[cfg(feature = "pbes2")]
impl TryFrom<ScryptParams> for scrypt::Params {
    type Error = Error;

    fn try_from(params: ScryptParams) -> Result<scrypt::Params> {
        scrypt::Params::try_from(&params)
    }
}

#[cfg(feature = "pbes2")]
impl TryFrom<&ScryptParams> for scrypt::Params {
    type Error = Error;

    #[allow(clippy::unwrap_in_result, reason = "invariant should hold")]
    fn try_from(params: &ScryptParams) -> Result<scrypt::Params> {
        // Compute log2 and verify its correctness
        let n = params.cost_parameter;
        let log_n =
            u8::try_from(ScryptCost::BITS - n.leading_zeros() - 1).expect("should always fit");

        if 1 << log_n != n {
            return Err(ScryptParams::INVALID_ERR);
        }

        scrypt::Params::new(
            log_n,
            params.block_size.into(),
            params.parallelization.into(),
        )
        .map_err(|_| ScryptParams::INVALID_ERR)
    }
}
