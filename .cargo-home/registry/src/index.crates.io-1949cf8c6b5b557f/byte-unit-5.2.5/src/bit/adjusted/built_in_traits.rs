use core::str::FromStr;

use super::{AdjustedBit, Bit, Unit, UnitType};
use crate::ParseError;

impl From<Bit> for AdjustedBit {
    /// `unit_type` is set to `UnitType::Both`. See [`Bit::get_appropriate_unit`](./struct.Bit.html#method.get_appropriate_unit).
    #[inline]
    fn from(value: Bit) -> Self {
        value.get_appropriate_unit(UnitType::Both)
    }
}

impl From<AdjustedBit> for f64 {
    #[inline]
    fn from(value: AdjustedBit) -> Self {
        value.get_value()
    }
}

impl From<AdjustedBit> for Unit {
    #[inline]
    fn from(value: AdjustedBit) -> Self {
        value.get_unit()
    }
}

impl From<AdjustedBit> for Bit {
    #[inline]
    fn from(value: AdjustedBit) -> Self {
        value.get_bit()
    }
}

impl FromStr for AdjustedBit {
    type Err = ParseError;

    /// * `unit_type` is set to `UnitType::Both`. See [`Bit::get_appropriate_unit`](./struct.Bit.html#method.get_appropriate_unit).
    #[inline]
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Bit::parse_str(s)?.get_appropriate_unit(UnitType::Both))
    }
}
