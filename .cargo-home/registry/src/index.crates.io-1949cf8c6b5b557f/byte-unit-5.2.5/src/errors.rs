#[cfg(any(feature = "byte", feature = "bit"))]
pub use core::num::TryFromIntError;
use core::{
    error::Error,
    fmt::{self, Display, Formatter},
};

#[cfg(any(feature = "byte", feature = "bit"))]
use rust_decimal::Decimal;

#[cfg(any(feature = "byte", feature = "bit"))]
/// The error type returned when it exceeds representation range.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct ExceededBoundsError;

#[cfg(any(feature = "byte", feature = "bit"))]
impl Display for ExceededBoundsError {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        f.write_str("value exceeds the valid range")
    }
}

#[cfg(any(feature = "byte", feature = "bit"))]
impl Error for ExceededBoundsError {}

#[cfg(any(feature = "byte", feature = "bit"))]
/// The error type returned when parsing values.
#[derive(Debug, Clone)]
pub enum ValueParseError {
    ExceededBounds(Decimal),
    NotNumber(char),
    NoValue,
    NumberTooLong,
}

#[cfg(any(feature = "byte", feature = "bit"))]
impl Display for ValueParseError {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::ExceededBounds(value) => {
                f.write_fmt(format_args!("the value {value:?} exceeds the valid range"))
            },
            Self::NotNumber(c) => f.write_fmt(format_args!("the character {c:?} is not a number")),
            Self::NoValue => f.write_str("no value can be found"),
            Self::NumberTooLong => f.write_str("value number is too long"),
        }
    }
}

#[cfg(any(feature = "byte", feature = "bit"))]
impl Error for ValueParseError {}

/// The error type returned when parsing units.
#[derive(Debug, Clone)]
pub struct UnitParseError {
    pub character:                char,
    pub expected_characters:      &'static [char],
    pub also_expect_no_character: bool,
}

impl Display for UnitParseError {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let Self {
            character,
            expected_characters,
            also_expect_no_character,
        } = self;

        let expected_characters_length = expected_characters.len();

        f.write_fmt(format_args!("the character {character:?} is incorrect",))?;

        if expected_characters_length == 0 {
            f.write_str(" (no character is expected)")
        } else {
            f.write_fmt(format_args!(
                " ({expected_character:?}",
                expected_character = expected_characters[0]
            ))?;

            if expected_characters_length > 1 {
                for expected_character in
                    expected_characters[1..].iter().take(expected_characters_length - 2)
                {
                    f.write_fmt(format_args!(", {expected_character:?}"))?;
                }

                f.write_fmt(format_args!(
                    " or {expected_character:?}",
                    expected_character = expected_characters[expected_characters_length - 1]
                ))?;
            }

            if *also_expect_no_character {
                f.write_str(" or no character")?;
            }

            f.write_str(" is expected)")
        }
    }
}

impl Error for UnitParseError {}

#[cfg(any(feature = "byte", feature = "bit"))]
/// The error type returned when parsing values with a unit.
#[derive(Debug, Clone)]
pub enum ParseError {
    Value(ValueParseError),
    Unit(UnitParseError),
}

#[cfg(any(feature = "byte", feature = "bit"))]
impl From<ValueParseError> for ParseError {
    #[inline]
    fn from(error: ValueParseError) -> Self {
        Self::Value(error)
    }
}

#[cfg(any(feature = "byte", feature = "bit"))]
impl From<UnitParseError> for ParseError {
    #[inline]
    fn from(error: UnitParseError) -> Self {
        Self::Unit(error)
    }
}

#[cfg(any(feature = "byte", feature = "bit"))]
impl Display for ParseError {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::Value(error) => Display::fmt(error, f),
            ParseError::Unit(error) => Display::fmt(error, f),
        }
    }
}

#[cfg(any(feature = "byte", feature = "bit"))]
impl Error for ParseError {}
