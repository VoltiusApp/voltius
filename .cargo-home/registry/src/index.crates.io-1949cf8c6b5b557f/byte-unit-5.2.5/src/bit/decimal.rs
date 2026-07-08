use rust_decimal::prelude::*;

use super::Bit;
use crate::{Unit, common::is_zero_remainder_decimal};

/// Associated functions for building `Bit` instances using `Decimal`.
impl Bit {
    /// Create a new `Bit` instance from a size in bits.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Bit;
    /// use rust_decimal::Decimal;
    ///
    /// let bit = Bit::from_decimal(Decimal::from(15000000u64)).unwrap(); // 15 Mb
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

/// Associated functions for building `Bit` instances using `Decimal` (with `Unit`).
impl Bit {
    /// Create a new `Bit` instance from a size of bits with a unit.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Bit, Unit};
    /// use rust_decimal::Decimal;
    ///
    /// let bit = Bit::from_decimal_with_unit(Decimal::from(15u64), Unit::Mbit).unwrap(); // 15 Mb
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated bit is too large or not greater than or equal to **0**, this function will return `None`.
    /// * The calculated bit will be rounded up.
    #[inline]
    pub fn from_decimal_with_unit(size: Decimal, unit: Unit) -> Option<Self> {
        let v = {
            match unit {
                Unit::Bit => size,
                _ => size.checked_mul(Decimal::from(unit.as_bits_u128()))?,
            }
        };

        Self::from_decimal(v)
    }
}

/// Methods for finding an unit using `Decimal`.
impl Bit {
    /// Find the appropriate unit and value that can be used to recover back to this `Bit` precisely.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Bit, Unit};
    ///
    /// let bit = Bit::from_u64(3670016);
    ///
    /// assert_eq!(
    ///     (3.5f64.try_into().unwrap(), Unit::Mibit),
    ///     bit.get_recoverable_unit(false, 3)
    /// );
    /// ```
    ///
    /// ```
    /// use byte_unit::{Bit, Unit};
    ///
    /// let bit = Bit::from_u64(28000000);
    ///
    /// assert_eq!(
    ///     (3.5f64.try_into().unwrap(), Unit::MB),
    ///     bit.get_recoverable_unit(true, 3)
    /// );
    /// ```
    ///
    /// ```
    /// use byte_unit::{Bit, Unit};
    ///
    /// let bit = Bit::from_u64(437500);
    ///
    /// assert_eq!(
    ///     (437.5f64.try_into().unwrap(), Unit::Kbit),
    ///     bit.get_recoverable_unit(false, 3)
    /// );
    /// ```
    ///
    /// # Points to Note
    ///
    /// * `precision` should be smaller or equal to `26` if the `u128` feature is enabled, otherwise `19`. The typical `precision` is `3`.
    #[inline]
    pub fn get_recoverable_unit(
        self,
        allow_in_bytes: bool,
        mut precision: usize,
    ) -> (Decimal, Unit) {
        let bits_v = self.as_u128();
        let bits_vd = Decimal::from(bits_v);

        let a = if allow_in_bytes { Unit::get_multiples() } else { Unit::get_multiples_bits() };
        let mut i = a.len() - 1;

        if precision >= 28 {
            precision = 28;
        }

        loop {
            let unit = a[i];

            let unit_v = unit.as_bits_u128();

            if bits_v >= unit_v {
                let unit_vd = Decimal::from(unit_v);

                if let Some(quotient) = is_zero_remainder_decimal(bits_vd, unit_vd, precision) {
                    return (quotient, unit);
                }
            }

            if i == 0 {
                break;
            }

            i -= 1;
        }

        (bits_vd, Unit::Bit)
    }
}
