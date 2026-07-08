//! Error types.

use crate::LabelError;
use core::fmt;

/// Result type with `ssh-encoding` crate's [`Error`] as the error type.
pub type Result<T> = core::result::Result<T, Error>;

/// Error type.
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum Error {
    /// Base64-related errors.
    #[cfg(feature = "base64")]
    Base64(base64ct::Error),

    /// Character encoding-related errors.
    CharacterEncoding,

    /// Invalid label.
    Label(LabelError),

    /// Invalid length.
    Length,

    /// `mpint` encoding errors.
    #[cfg(feature = "alloc")]
    MpintEncoding,

    /// Overflow errors.
    Overflow,

    /// PEM encoding errors.
    #[cfg(feature = "pem")]
    Pem(pem_rfc7468::Error),

    /// Unexpected trailing data at end of message.
    TrailingData {
        /// Number of bytes of remaining data at end of message.
        remaining: usize,
    },

    /// Invalid discriminant value in message.
    InvalidDiscriminant(u128),
}

impl core::error::Error for Error {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            #[cfg(feature = "base64")]
            Self::Base64(err) => Some(err),
            #[cfg(feature = "pem")]
            Self::Pem(err) => Some(err),
            _ => None,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            #[cfg(feature = "base64")]
            Error::Base64(err) => write!(f, "Base64 encoding error: {err}"),
            Error::CharacterEncoding => write!(f, "character encoding invalid"),
            Error::Label(err) => write!(f, "{}", err),
            Error::Length => write!(f, "length invalid"),
            #[cfg(feature = "alloc")]
            Error::MpintEncoding => write!(f, "`mpint` encoding invalid"),
            Error::Overflow => write!(f, "internal overflow error"),
            #[cfg(feature = "pem")]
            Error::Pem(err) => write!(f, "{err}"),
            Error::TrailingData { remaining } => write!(
                f,
                "unexpected trailing data at end of message ({remaining} bytes)",
            ),
            Error::InvalidDiscriminant(discriminant) => {
                write!(f, "invalid discriminant value: {discriminant}")
            }
        }
    }
}

impl From<LabelError> for Error {
    fn from(err: LabelError) -> Error {
        Error::Label(err)
    }
}

impl From<core::num::TryFromIntError> for Error {
    fn from(_: core::num::TryFromIntError) -> Error {
        Error::Overflow
    }
}

impl From<core::str::Utf8Error> for Error {
    fn from(_: core::str::Utf8Error) -> Error {
        Error::CharacterEncoding
    }
}

#[cfg(feature = "alloc")]
impl From<alloc::string::FromUtf8Error> for Error {
    fn from(_: alloc::string::FromUtf8Error) -> Error {
        Error::CharacterEncoding
    }
}

#[cfg(feature = "base64")]
impl From<base64ct::Error> for Error {
    fn from(err: base64ct::Error) -> Error {
        Error::Base64(err)
    }
}

#[cfg(feature = "base64")]
impl From<base64ct::InvalidLengthError> for Error {
    fn from(_: base64ct::InvalidLengthError) -> Error {
        Error::Length
    }
}

#[cfg(feature = "bigint")]
impl From<bigint::DecodeError> for Error {
    fn from(_: bigint::DecodeError) -> Error {
        Error::MpintEncoding
    }
}

#[cfg(feature = "pem")]
impl From<pem_rfc7468::Error> for Error {
    fn from(err: pem_rfc7468::Error) -> Error {
        Error::Pem(err)
    }
}
