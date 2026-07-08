//! Error types

use core::fmt;

#[cfg(feature = "pem")]
use der::pem;

/// Result type
pub type Result<T> = core::result::Result<T, Error>;

/// Error type
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum Error {
    /// ASN.1 DER-related errors.
    Asn1(der::Error),

    /// Errors relating to PKCS#5-encrypted keys.
    #[cfg(feature = "pkcs5")]
    EncryptedPrivateKey(pkcs5::Error),

    /// Malformed cryptographic key contained in a PKCS#8 document.
    ///
    /// This is intended for relaying errors related to the raw data contained
    /// within [`PrivateKeyInfo::private_key`][`crate::PrivateKeyInfo::private_key`]
    /// or [`SubjectPublicKeyInfo::subject_public_key`][`crate::SubjectPublicKeyInfo::subject_public_key`].
    KeyMalformed(KeyError),

    /// [`AlgorithmIdentifier::parameters`][`crate::AlgorithmIdentifierRef::parameters`]
    /// is malformed or otherwise encoded in an unexpected manner.
    ParametersMalformed,

    /// Public key errors propagated from the [`spki::Error`] type.
    PublicKey(spki::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Asn1(err) => write!(f, "PKCS#8 ASN.1 error: {err}"),
            #[cfg(feature = "pkcs5")]
            Error::EncryptedPrivateKey(err) => write!(f, "{err}"),
            Error::KeyMalformed(err) => write!(f, "PKCS#8 key malformed: {err}"),
            Error::ParametersMalformed => write!(f, "PKCS#8 algorithm parameters malformed"),
            Error::PublicKey(err) => write!(f, "public key error: {err}"),
        }
    }
}

impl core::error::Error for Error {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Error::Asn1(err) => Some(err),
            #[cfg(feature = "pkcs5")]
            Error::EncryptedPrivateKey(err) => Some(err),
            Error::KeyMalformed(err) => Some(err),
            Error::PublicKey(err) => Some(err),
            _ => None,
        }
    }
}

impl From<KeyError> for Error {
    fn from(err: KeyError) -> Error {
        Error::KeyMalformed(err)
    }
}

impl From<der::Error> for Error {
    fn from(err: der::Error) -> Error {
        Error::Asn1(err)
    }
}

impl From<der::ErrorKind> for Error {
    fn from(err: der::ErrorKind) -> Error {
        Error::Asn1(err.into())
    }
}

#[cfg(feature = "pem")]
impl From<pem::Error> for Error {
    fn from(err: pem::Error) -> Error {
        der::Error::from(err).into()
    }
}

#[cfg(feature = "pkcs5")]
impl From<pkcs5::Error> for Error {
    fn from(err: pkcs5::Error) -> Error {
        Error::EncryptedPrivateKey(err)
    }
}

impl From<spki::Error> for Error {
    fn from(err: spki::Error) -> Error {
        Error::PublicKey(err)
    }
}

impl From<Error> for spki::Error {
    fn from(err: Error) -> spki::Error {
        match err {
            Error::Asn1(e) => spki::Error::Asn1(e),
            Error::PublicKey(e) => e,
            _ => spki::Error::KeyMalformed,
        }
    }
}

/// Key-related errors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum KeyError {
    /// Key is not valid for this algorithm.
    Invalid,

    /// Key is too short.
    TooShort,

    /// Key is too long.
    TooLong,
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyError::Invalid => f.write_str("key invalid"),
            KeyError::TooShort => f.write_str("key too short"),
            KeyError::TooLong => f.write_str("key too long"),
        }
    }
}

impl core::error::Error for KeyError {}
