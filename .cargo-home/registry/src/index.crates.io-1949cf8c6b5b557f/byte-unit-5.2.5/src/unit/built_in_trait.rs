use core::str::FromStr;

use super::Unit;
use crate::UnitParseError;

impl FromStr for Unit {
    type Err = UnitParseError;

    /// `ignore_case` is set to `false`; `prefer_byte` is set to `true`. See [`Unit::parse_str`](#method.parse_str).
    #[inline]
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Unit::parse_str(s, false, true)
    }
}

impl From<Unit> for u128 {
    /// See [`Unit::as_bits_u128`](#method.as_bits_u128).
    #[inline]
    fn from(unit: Unit) -> Self {
        unit.as_bits_u128()
    }
}

impl AsRef<str> for Unit {
    #[inline]
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
