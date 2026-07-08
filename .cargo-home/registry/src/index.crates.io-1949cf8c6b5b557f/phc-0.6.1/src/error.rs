//! Error types.

use crate::Salt;
use base64ct::Error as B64Error;
use core::{cmp::Ordering, fmt};

/// Result type.
pub type Result<T> = core::result::Result<T, Error>;

/// Password hashing errors.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum Error {
    /// "B64" encoding error.
    Base64(B64Error),

    /// Password hash string invalid.
    MissingField,

    /// Output size unexpected.
    OutputSize {
        /// Indicates why the output size is unexpected.
        ///
        /// - [`Ordering::Less`]: Size is too small.
        /// - [`Ordering::Equal`]: Size is not exactly as `expected`.
        /// - [`Ordering::Greater`]: Size is too long.
        provided: Ordering,

        /// Expected output size in relation to `provided`.
        ///
        /// - [`Ordering::Less`]: Minimum size.
        /// - [`Ordering::Equal`]: Expected size.
        /// - [`Ordering::Greater`]: Maximum size.
        expected: usize,
    },

    /// Duplicate parameter name encountered.
    ParamNameDuplicated,

    /// Invalid parameter name.
    ParamNameInvalid,

    /// Parameter value is invalid.
    ParamValueInvalid,

    /// Parameter value is too long.
    ParamValueTooLong,

    /// Maximum number of parameters exceeded.
    ParamsMaxExceeded,

    /// Salt too short.
    SaltTooShort,

    /// Salt too long.
    SaltTooLong,

    /// Password hash string contains trailing data.
    TrailingData,

    /// Value exceeds the maximum allowed length.
    ValueTooLong,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> core::result::Result<(), fmt::Error> {
        match self {
            Self::Base64(err) => write!(f, "{err}"),
            Self::MissingField => write!(f, "password hash string missing field"),
            Self::OutputSize { provided, expected } => match provided {
                Ordering::Less => write!(
                    f,
                    "output size too short, expected at least {expected} bytes",
                ),
                Ordering::Equal => write!(f, "output size unexpected, expected {expected} bytes"),
                Ordering::Greater => {
                    write!(f, "output size too long, expected at most {expected} bytes")
                }
            },
            Self::ParamNameDuplicated => write!(f, "duplicate parameter"),
            Self::ParamNameInvalid => write!(f, "invalid parameter name"),
            Self::ParamValueInvalid => write!(f, "invalid parameter value"),
            Self::ParamValueTooLong => write!(f, "parameter value too long"),
            Self::ParamsMaxExceeded => write!(f, "maximum number of parameters reached"),
            Self::SaltTooShort => write!(f, "salt too short (minimum {} bytes)", Salt::MIN_LENGTH),
            Self::SaltTooLong => write!(f, "salt too long (maximum {} bytes)", Salt::MAX_LENGTH),
            Self::TrailingData => write!(f, "password hash has unexpected trailing characters"),
            Self::ValueTooLong => f.write_str("value too long"),
        }
    }
}

impl core::error::Error for Error {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Base64(err) => Some(err),
            _ => None,
        }
    }
}

impl From<B64Error> for Error {
    fn from(err: B64Error) -> Error {
        Error::Base64(err)
    }
}

impl From<base64ct::InvalidLengthError> for Error {
    fn from(_: base64ct::InvalidLengthError) -> Error {
        Error::Base64(B64Error::InvalidLength)
    }
}
