//! Error types.

use crate::Cipher;
use core::fmt;

/// Result type with `ssh-cipher` crate's [`Error`] as the error type.
pub type Result<T> = core::result::Result<T, Error>;

/// Error type.
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum Error {
    /// Cryptographic errors.
    Crypto,

    /// Invalid key size.
    KeySize,

    /// Invalid length (i.e. of an input buffer).
    Length,

    /// Invalid initialization vector / nonce size.
    IvSize,

    /// Invalid AEAD tag size.
    TagSize,

    /// Unsupported cipher.
    UnsupportedCipher(Cipher),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Crypto => write!(f, "cryptographic error"),
            Error::KeySize => write!(f, "invalid key size"),
            Error::Length => write!(f, "invalid input length"),
            Error::IvSize => write!(f, "invalid initialization vector size"),
            Error::TagSize => write!(f, "invalid AEAD tag size"),
            Error::UnsupportedCipher(cipher) => write!(f, "unsupported cipher: {}", cipher),
        }
    }
}

impl core::error::Error for Error {}
