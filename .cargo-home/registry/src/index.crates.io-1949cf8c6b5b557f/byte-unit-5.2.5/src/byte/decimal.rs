use rust_decimal::prelude::*;

use super::Byte;
use crate::{Unit, common::is_zero_remainder_decimal};

const DECIMAL_EIGHT: Decimal = Decimal::from_parts(8, 0, 0, false, 0);

/// Associated functions for building `Byte` instances using `Decimal`.
impl Byte {
    /// Create a new `Byte` instance from a size in bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Byte;
    /// use rust_decimal::Decimal;
    ///
    /// let byte = Byte::from_decimal(Decimal::from(15000000u64)).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the input **size** is too large (the maximum is **10<sup>27</sup> - 1** if the `u128` feature is enabled, or **2<sup>64</sup> - 1** otherwise) or not greater than or equal to **0**, this function will return `None`.
    /// * The fractional part will be rounded up.
    #[inline]
    pub fn from_decimal(size: Decimal) -> Option<Self> {
        if size >= Decimal::ZERO {
            #[cfg(feature = "u128")]
            {
                let size = size.ceil();

                match size.to_u128() {
                    Some(n) => Self::from_u128(n),
                    None => None,
                }
            }

            #[cfg(not(feature = "u128"))]
            {
                let size = size.ceil();

                size.to_u64().map(Self::from_u64)
            }
        } else {
            None
        }
    }
}

/// Associated functions for building `Byte` instances using `Decimal` (with `Unit`).
impl Byte {
    /// Create a new `Byte` instance from a size of bytes with a unit.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    /// use rust_decimal::Decimal;
    ///
    /// let byte = Byte::from_decimal_with_unit(Decimal::from(15u64), Unit::MB).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large or not greater than or equal to **0**, this function will return `None`.
    /// * The calculated byte will be rounded up.
    #[inline]
    pub fn from_decimal_with_unit(size: Decimal, unit: Unit) -> Option<Self> {
        let v = {
            match unit {
                Unit::Bit => (size / DECIMAL_EIGHT).ceil(),
                Unit::B => size,
                _ => size.checked_mul(Decimal::from(unit.as_bytes_u128()))?,
            }
        };

        Self::from_decimal(v)
    }
}

/// Methods for finding an unit using `Decimal`.
impl Byte {
    /// Find the appropriate unit and value that can be used to recover back to this `Byte` precisely.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64(3670016);
    ///
    /// assert_eq!(
    ///     (3.5f64.try_into().unwrap(), Unit::MiB),
    ///     byte.get_recoverable_unit(false, 3)
    /// );
    /// ```
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64(437500);
    ///
    /// assert_eq!(
    ///     (3.5f64.try_into().unwrap(), Unit::Mbit),
    ///     byte.get_recoverable_unit(true, 3)
    /// );
    /// ```
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64(437500);
    ///
    /// assert_eq!(
    ///     (437.5f64.try_into().unwrap(), Unit::KB),
    ///     byte.get_recoverable_unit(false, 3)
    /// );
    /// ```
    ///
    /// # Points to Note
    ///
    /// * `precision` should be smaller or equal to `26` if the `u128` feature is enabled, otherwise `19`. The typical `precision` is `3`.
    #[inline]
    pub fn get_recoverable_unit(
        self,
        allow_in_bits: bool,
        mut precision: usize,
    ) -> (Decimal, Unit) {
        let bytes_v = self.as_u128();
        let bytes_vd = Decimal::from(bytes_v);

        let a = if allow_in_bits { Unit::get_multiples() } else { Unit::get_multiples_bytes() };
        let mut i = a.len() - 1;

        if precision >= 28 {
            precision = 28;
        }

        loop {
            let unit = a[i];

            let unit_v = unit.as_bytes_u128();

            if bytes_v >= unit_v {
                let unit_vd = Decimal::from(unit_v);

                if let Some(quotient) = is_zero_remainder_decimal(bytes_vd, unit_vd, precision) {
                    return (quotient, unit);
                }
            }

            if i == 0 {
                break;
            }

            i -= 1;
        }

        (bytes_vd, Unit::B)
    }
}
