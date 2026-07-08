mod built_in_traits;
#[cfg(feature = "rocket")]
mod rocket_traits;
#[cfg(feature = "schemars")]
mod schemars_traits;
#[cfg(feature = "serde")]
mod serde_traits;

use core::{
    cmp::Ordering,
    fmt::{self, Alignment, Display, Formatter, Write},
};

use super::{Bit, Unit};
use crate::{UnitType, common::round_fractional_part_f64};

/// Generated from the [`Bit::get_adjusted_unit`](./struct.Bit.html#method.get_adjusted_unit) method or the the [`Bit::get_appropriate_unit`](./struct.Bit.html#method.get_appropriate_unit) method.
///
/// For accuracy representation, utilize the `Bit` struct.
#[derive(Debug, Clone, Copy)]
pub struct AdjustedBit {
    pub(crate) value: f64,
    pub(crate) unit:  Unit,
}

impl PartialEq for AdjustedBit {
    #[inline]
    fn eq(&self, other: &AdjustedBit) -> bool {
        let s = self.get_bit();
        let o = other.get_bit();

        s.eq(&o)
    }
}

impl Eq for AdjustedBit {}

impl PartialOrd for AdjustedBit {
    #[inline]
    fn partial_cmp(&self, other: &AdjustedBit) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for AdjustedBit {
    #[inline]
    fn cmp(&self, other: &AdjustedBit) -> Ordering {
        let s = self.get_bit();
        let o = other.get_bit();

        s.cmp(&o)
    }
}

impl Display for AdjustedBit {
    /// Formats the value using the given formatter.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Bit, Unit};
    ///
    /// let bit = Bit::from_u64_with_unit(1555, Unit::Kbit).unwrap();
    ///
    /// let adjusted_bit = bit.get_adjusted_unit(Unit::Mbit);
    ///
    /// assert_eq!("1.555 Mb", adjusted_bit.to_string());
    /// ```
    ///
    /// ```
    /// use byte_unit::{Bit, UnitType};
    ///
    /// let bit = Bit::from_u64(10000);
    ///
    /// let adjusted_bit_based_2 = bit.get_appropriate_unit(UnitType::Binary);
    /// let adjusted_bit_based_10 = bit.get_appropriate_unit(UnitType::Decimal);
    ///
    /// assert_eq!("9.765625 Kib", format!("{adjusted_bit_based_2}"));
    /// assert_eq!("10 Kb", format!("{adjusted_bit_based_10}"));
    ///
    /// // with precision
    /// assert_eq!("9.77 Kib", format!("{adjusted_bit_based_2:.2}"));
    /// assert_eq!("10.00 Kb", format!("{adjusted_bit_based_10:.2}"));
    ///
    /// // without any unnecessary fractional part
    /// assert_eq!("9.77 Kib", format!("{adjusted_bit_based_2:#.2}"));
    /// assert_eq!("10 Kb", format!("{adjusted_bit_based_10:#.2}"));
    ///
    /// // with a width, left alignment
    /// assert_eq!("9.77   Kib", format!("{adjusted_bit_based_2:10.2}"));
    /// assert_eq!("10.00   Kb", format!("{adjusted_bit_based_10:10.2}"));
    ///
    /// // with a width, right alignment
    /// assert_eq!("  9.77 Kib", format!("{adjusted_bit_based_2:>10.2}"));
    /// assert_eq!("  10.00 Kb", format!("{adjusted_bit_based_10:>10.2}"));
    ///
    /// // with a width, right alignment, more spaces between the value and the unit
    /// assert_eq!("  9.77 Kib", format!("{adjusted_bit_based_2:>+10.2}"));
    /// assert_eq!(" 10.00  Kb", format!("{adjusted_bit_based_10:>+10.2}"));
    ///
    /// // no spaces between the value and the unit
    /// assert_eq!("9.765625Kib", format!("{adjusted_bit_based_2:-}"));
    /// assert_eq!("10Kb", format!("{adjusted_bit_based_10:-}"));
    /// ```
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let Self {
            value,
            unit,
        } = self;
        let handle_basic_precision = |precision: usize, f: &mut Formatter<'_>| -> fmt::Result {
            if f.alternate() {
                let value = round_fractional_part_f64(*value, precision);

                f.write_fmt(format_args!("{value}"))
            } else if matches!(unit, Unit::Bit | Unit::B) {
                f.write_fmt(format_args!("{value}"))
            } else {
                f.write_fmt(format_args!("{value:.precision$}"))
            }
        };

        let space_length = if f.sign_plus() {
            4 - unit.as_str().len()
        } else if f.sign_minus() {
            0
        } else {
            1
        };

        if let Some(mut width) = f.width() {
            let l = unit.as_str().len() + space_length;

            if let Some(precision) = f.precision() {
                if width > l + 1 {
                    width -= l;

                    let alignment = f.align().unwrap_or(Alignment::Left);

                    if f.alternate() {
                        let value = round_fractional_part_f64(*value, precision);

                        match alignment {
                            Alignment::Left | Alignment::Center => {
                                f.write_fmt(format_args!("{value:<width$}"))?
                            },
                            Alignment::Right => f.write_fmt(format_args!("{value:>width$}"))?,
                        }
                    } else {
                        match alignment {
                            Alignment::Left | Alignment::Center => {
                                f.write_fmt(format_args!("{value:<width$.precision$}"))?
                            },
                            Alignment::Right => {
                                f.write_fmt(format_args!("{value:>width$.precision$}"))?
                            },
                        }
                    }
                } else {
                    handle_basic_precision(precision, f)?;
                }
            } else if width > l + 1 {
                width -= l;

                let alignment = f.align().unwrap_or(Alignment::Left);

                match alignment {
                    Alignment::Left | Alignment::Center => {
                        f.write_fmt(format_args!("{value:<width$}"))?
                    },
                    Alignment::Right => f.write_fmt(format_args!("{value:>width$}"))?,
                }
            } else {
                f.write_fmt(format_args!("{value}"))?;
            }
        } else if let Some(precision) = f.precision() {
            handle_basic_precision(precision, f)?;
        } else {
            f.write_fmt(format_args!("{value}"))?;
        }

        for _ in 0..space_length {
            f.write_char(' ')?;
        }

        f.write_fmt(format_args!("{unit}"))
    }
}

/// Methods for getting values.
impl AdjustedBit {
    /// Get the value.
    #[inline]
    pub const fn get_value(&self) -> f64 {
        self.value
    }

    /// Get the unit.
    #[inline]
    pub const fn get_unit(&self) -> Unit {
        self.unit
    }

    /// Create a new `Bit` instance from this `AdjustedBit` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Bit, Unit};
    ///
    /// let bit = Bit::from_u64_with_unit(1555, Unit::Kbit).unwrap();
    ///
    /// let adjusted_bit = bit.get_adjusted_unit(Unit::Mbit);
    ///
    /// let bit_back = adjusted_bit.get_bit();
    ///
    /// assert_eq!(bit, bit_back);
    /// ```
    ///
    /// # Points to Note
    ///
    /// * The result may not be logically equal to the original `Bit` instance due to the accuracy of floating-point numbers.
    #[inline]
    pub fn get_bit(&self) -> Bit {
        Bit::from_f64_with_unit(self.value, self.unit).unwrap()
    }
}

/// Associated functions for generating `AdjustedBit`.
impl Bit {
    /// Adjust the unit and value for this `Bit` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{AdjustedBit, Bit, Unit};
    ///
    /// let bit = Bit::parse_str("123Kib").unwrap();
    ///
    /// let adjusted_bit = bit.get_adjusted_unit(Unit::Kbit);
    ///
    /// assert_eq!("125.952 Kb", adjusted_bit.to_string());
    /// ```
    ///
    /// ```
    /// use byte_unit::{AdjustedBit, Bit, Unit};
    ///
    /// let bit = Bit::parse_str("50.84 Mb").unwrap();
    ///
    /// let adjusted_bit = bit.get_adjusted_unit(Unit::Mibit);
    ///
    /// assert_eq!("48.48480224609375 Mib", adjusted_bit.to_string());
    /// ```
    #[inline]
    pub fn get_adjusted_unit(self, unit: Unit) -> AdjustedBit {
        let bit_v = self.as_u128();

        let value = match unit {
            Unit::Bit => bit_v as f64,
            Unit::B => bit_v as f64 / 8.0,
            _ => bit_v as f64 / unit.as_bits_u128() as f64,
        };

        AdjustedBit {
            value,
            unit,
        }
    }

    /// Find the appropriate unit and value for this `Bit` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Bit, UnitType};
    ///
    /// let bit = Bit::parse_str("123Kib").unwrap();
    ///
    /// let adjusted_bit = bit.get_appropriate_unit(UnitType::Decimal);
    ///
    /// assert_eq!("125.952 Kb", adjusted_bit.to_string());
    /// ```
    ///
    /// ```
    /// use byte_unit::{Bit, UnitType};
    ///
    /// let bit = Bit::parse_str("50.84 Mb").unwrap();
    ///
    /// let adjusted_bit = bit.get_appropriate_unit(UnitType::Binary);
    ///
    /// assert_eq!("48.48480224609375 Mib", adjusted_bit.to_string());
    /// ```
    pub fn get_appropriate_unit(&self, unit_type: UnitType) -> AdjustedBit {
        let a = Unit::get_multiples_bits();

        let (skip, step) = match unit_type {
            UnitType::Binary => (0, 2),
            UnitType::Decimal => (1, 2),
            UnitType::Both => (0, 1),
        };

        let bits_v = self.as_u128();

        for unit in a.iter().rev().skip(skip).step_by(step) {
            if bits_v >= unit.as_bits_u128() {
                return self.get_adjusted_unit(*unit);
            }
        }

        self.get_adjusted_unit(Unit::Bit)
    }
}
