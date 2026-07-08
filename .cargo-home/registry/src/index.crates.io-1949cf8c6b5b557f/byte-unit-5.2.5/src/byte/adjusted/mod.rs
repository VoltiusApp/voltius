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

use super::{Byte, Unit};
use crate::{UnitType, common::round_fractional_part_f64};

/// Generated from the [`Byte::get_adjusted_unit`](./struct.Byte.html#method.get_adjusted_unit) method or the the [`Byte::get_appropriate_unit`](./struct.Byte.html#method.get_appropriate_unit) method.
///
/// For accuracy representation, utilize the `Byte` struct.
#[derive(Debug, Clone, Copy)]
pub struct AdjustedByte {
    pub(crate) value: f64,
    pub(crate) unit:  Unit,
}

impl PartialEq for AdjustedByte {
    #[inline]
    fn eq(&self, other: &AdjustedByte) -> bool {
        let s = self.get_byte();
        let o = other.get_byte();

        s.eq(&o)
    }
}

impl Eq for AdjustedByte {}

impl PartialOrd for AdjustedByte {
    #[inline]
    fn partial_cmp(&self, other: &AdjustedByte) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for AdjustedByte {
    #[inline]
    fn cmp(&self, other: &AdjustedByte) -> Ordering {
        let s = self.get_byte();
        let o = other.get_byte();

        s.cmp(&o)
    }
}

impl Display for AdjustedByte {
    /// Formats the value using the given formatter.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64_with_unit(1555, Unit::KB).unwrap();
    ///
    /// let adjusted_byte = byte.get_adjusted_unit(Unit::MB);
    ///
    /// assert_eq!("1.555 MB", adjusted_byte.to_string());
    /// ```
    ///
    /// ```
    /// use byte_unit::{Byte, UnitType};
    ///
    /// let byte = Byte::from_u64(10000);
    ///
    /// let adjusted_byte_based_2 = byte.get_appropriate_unit(UnitType::Binary);
    /// let adjusted_byte_based_10 = byte.get_appropriate_unit(UnitType::Decimal);
    ///
    /// assert_eq!("9.765625 KiB", format!("{adjusted_byte_based_2}"));
    /// assert_eq!("10 KB", format!("{adjusted_byte_based_10}"));
    ///
    /// // with precision
    /// assert_eq!("9.77 KiB", format!("{adjusted_byte_based_2:.2}"));
    /// assert_eq!("10.00 KB", format!("{adjusted_byte_based_10:.2}"));
    ///
    /// // without any unnecessary fractional part
    /// assert_eq!("9.77 KiB", format!("{adjusted_byte_based_2:#.2}"));
    /// assert_eq!("10 KB", format!("{adjusted_byte_based_10:#.2}"));
    ///
    /// // with a width, left alignment
    /// assert_eq!("9.77   KiB", format!("{adjusted_byte_based_2:10.2}"));
    /// assert_eq!("10.00   KB", format!("{adjusted_byte_based_10:10.2}"));
    ///
    /// // with a width, right alignment
    /// assert_eq!("  9.77 KiB", format!("{adjusted_byte_based_2:>10.2}"));
    /// assert_eq!("  10.00 KB", format!("{adjusted_byte_based_10:>10.2}"));
    ///
    /// // with a width, right alignment, more spaces between the value and the unit
    /// assert_eq!("  9.77 KiB", format!("{adjusted_byte_based_2:>+10.2}"));
    /// assert_eq!(" 10.00  KB", format!("{adjusted_byte_based_10:>+10.2}"));
    ///
    /// // no spaces between the value and the unit
    /// assert_eq!("9.765625KiB", format!("{adjusted_byte_based_2:-}"));
    /// assert_eq!("10KB", format!("{adjusted_byte_based_10:-}"));
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
impl AdjustedByte {
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

    /// Create a new `Byte` instance from this `AdjustedByte` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64_with_unit(1555, Unit::KB).unwrap();
    ///
    /// let adjusted_byte = byte.get_adjusted_unit(Unit::MB);
    ///
    /// let byte_back = adjusted_byte.get_byte();
    ///
    /// assert_eq!(byte, byte_back);
    /// ```
    ///
    /// # Points to Note
    ///
    /// * The result may not be logically equal to the original `Byte` instance due to the accuracy of floating-point numbers.
    #[inline]
    pub fn get_byte(&self) -> Byte {
        Byte::from_f64_with_unit(self.value, self.unit).unwrap()
    }
}

/// Associated functions for generating `AdjustedByte`.
impl Byte {
    /// Adjust the unit and value for this `Byte` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{AdjustedByte, Byte, Unit};
    ///
    /// let byte = Byte::parse_str("123KiB", true).unwrap();
    ///
    /// let adjusted_byte = byte.get_adjusted_unit(Unit::KB);
    ///
    /// assert_eq!("125.952 KB", adjusted_byte.to_string());
    /// ```
    ///
    /// ```
    /// use byte_unit::{AdjustedByte, Byte, Unit};
    ///
    /// let byte = Byte::parse_str("50.84 MB", true).unwrap();
    ///
    /// let adjusted_byte = byte.get_adjusted_unit(Unit::MiB);
    ///
    /// assert_eq!("48.48480224609375 MiB", adjusted_byte.to_string());
    /// ```
    #[inline]
    pub fn get_adjusted_unit(self, unit: Unit) -> AdjustedByte {
        let byte_v = self.as_u128();

        let value = match unit {
            Unit::Bit => (byte_v << 3) as f64,
            Unit::B => byte_v as f64,
            _ => byte_v as f64 / unit.as_bytes_u128() as f64,
        };

        AdjustedByte {
            value,
            unit,
        }
    }

    /// Find the appropriate unit and value for this `Byte` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, UnitType};
    ///
    /// let byte = Byte::parse_str("123KiB", true).unwrap();
    ///
    /// let adjusted_byte = byte.get_appropriate_unit(UnitType::Decimal);
    ///
    /// assert_eq!("125.952 KB", adjusted_byte.to_string());
    /// ```
    ///
    /// ```
    /// use byte_unit::{Byte, UnitType};
    ///
    /// let byte = Byte::parse_str("50.84 MB", true).unwrap();
    ///
    /// let adjusted_byte = byte.get_appropriate_unit(UnitType::Binary);
    ///
    /// assert_eq!("48.48480224609375 MiB", adjusted_byte.to_string());
    /// ```
    pub fn get_appropriate_unit(&self, unit_type: UnitType) -> AdjustedByte {
        let a = Unit::get_multiples_bytes();

        let (skip, step) = match unit_type {
            UnitType::Binary => (0, 2),
            UnitType::Decimal => (1, 2),
            UnitType::Both => (0, 1),
        };

        let bytes_v = self.as_u128();

        for unit in a.iter().rev().skip(skip).step_by(step) {
            if bytes_v >= unit.as_bytes_u128() {
                return self.get_adjusted_unit(*unit);
            }
        }

        self.get_adjusted_unit(Unit::B)
    }
}
