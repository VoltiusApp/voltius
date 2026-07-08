use core::str::FromStr;

use super::{AdjustedByte, Byte, Unit, UnitType};
use crate::ParseError;

impl From<Byte> for AdjustedByte {
    /// `unit_type` is set to `UnitType::Both`. See [`Byte::get_appropriate_unit`](./struct.Byte.html#method.get_appropriate_unit).
    #[inline]
    fn from(value: Byte) -> Self {
        value.get_appropriate_unit(UnitType::Both)
    }
}

impl From<AdjustedByte> for f64 {
    #[inline]
    fn from(value: AdjustedByte) -> Self {
        value.get_value()
    }
}

impl From<AdjustedByte> for Unit {
    #[inline]
    fn from(value: AdjustedByte) -> Self {
        value.get_unit()
    }
}

impl From<AdjustedByte> for Byte {
    #[inline]
    fn from(value: AdjustedByte) -> Self {
        value.get_byte()
    }
}

impl FromStr for AdjustedByte {
    type Err = ParseError;

    /// * `ignore_case` is set to `false`. See [`Byte::parse_str`](./struct.Byte.html#method.parse_str).
    /// * `unit_type` is set to `UnitType::Both`. See [`Byte::get_appropriate_unit`](./struct.Byte.html#method.get_appropriate_unit).
    #[inline]
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Byte::parse_str(s, false)?.get_appropriate_unit(UnitType::Both))
    }
}
