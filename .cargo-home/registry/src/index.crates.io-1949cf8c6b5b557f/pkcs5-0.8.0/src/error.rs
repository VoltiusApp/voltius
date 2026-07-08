//! Error types

use core::fmt;
use der::asn1::ObjectIdentifier;

/// Result type
pub type Result<T> = core::result::Result<T, Error>;

/// Error type
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum Error {
    /// Given parameters are invalid for this algorithm
    AlgorithmParametersInvalid {
        /// OID for algorithm for which the parameters were invalid
        oid: ObjectIdentifier,
    },

    /// Decryption Failed
    DecryptFailed,

    /// Encryption Failed
    EncryptFailed,

    /// PBES1 support is limited to parsing; encryption/decryption is not supported (won't fix)
    #[cfg(feature = "pbes2")]
    NoPbes1CryptSupport,

    /// Random number generation failure.
    #[cfg(feature = "rand_core")]
    Rng,

    /// Algorithm is not supported
    ///
    /// This may be due to a disabled crate feature
    /// Or the algorithm is not supported at all.
    UnsupportedAlgorithm {
        /// OID of unsupported algorithm
        oid: ObjectIdentifier,
    },
}

impl core::error::Error for Error {}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::AlgorithmParametersInvalid { oid } => {
                write!(f, "PKCS#5 parameters for algorithm {oid} are invalid")
            }
            Error::DecryptFailed => f.write_str("PKCS#5 decryption failed"),
            Error::EncryptFailed => f.write_str("PKCS#5 encryption failed"),
            #[cfg(feature = "pbes2")]
            Error::NoPbes1CryptSupport => {
                f.write_str("PKCS#5 encryption/decryption unsupported for PBES1 (won't fix)")
            }
            #[cfg(feature = "rand_core")]
            Error::Rng => f.write_str("random number generation failure"),
            Error::UnsupportedAlgorithm { oid } => {
                write!(f, "PKCS#5 algorithm {oid} is unsupported")
            }
        }
    }
}
