mod adjusted;
mod built_in_traits;
mod constants;
mod decimal;
mod parse;
#[cfg(feature = "rocket")]
mod rocket_traits;
#[cfg(feature = "schemars")]
mod schemars_traits;
#[cfg(feature = "serde")]
mod serde_traits;

use core::fmt::{self, Alignment, Display, Formatter, Write};

pub use adjusted::*;
use rust_decimal::prelude::*;

use crate::{
    Unit,
    common::{ceil_f32, ceil_f64},
};

#[cfg(feature = "u128")]
const RONNABYTE: u128 = 1_000_000_000_000_000_000_000_000_000; // RB

#[cfg(feature = "u128")]
#[derive(Debug, Clone, Copy, PartialOrd, Ord, PartialEq, Eq, Hash, Default)]
/// Representing the size in bytes.
pub struct Byte(u128);

#[cfg(not(feature = "u128"))]
#[derive(Debug, Clone, Copy, PartialOrd, Ord, PartialEq, Eq, Hash, Default)]
/// Representing the size in bytes.
pub struct Byte(u64);

impl Display for Byte {
    /// Formats the value using the given formatter.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64_with_unit(1555, Unit::KB).unwrap();
    ///
    /// assert_eq!("1555000", byte.to_string());
    /// ```
    ///
    /// ```
    /// use byte_unit::{Byte, UnitType};
    ///
    /// let byte_based_2 = Byte::from_u64(10240);
    /// let byte_based_10 = Byte::from_u64(10000);
    ///
    /// assert_eq!("10240", format!("{byte_based_2}"));
    /// assert_eq!("10000", format!("{byte_based_10}"));
    ///
    /// // with an exact unit
    /// assert_eq!("10 KiB", format!("{byte_based_2:#}"));
    /// assert_eq!("10 KB", format!("{byte_based_10:#}"));
    ///
    /// // with an exact unit, no spaces between the value and the unit
    /// assert_eq!("10KiB", format!("{byte_based_2:-#}"));
    /// assert_eq!("10KB", format!("{byte_based_10:-#}"));
    ///
    /// // with a width, left alignment
    /// assert_eq!("10     KiB", format!("{byte_based_2:#10}"));
    /// assert_eq!("10      KB", format!("{byte_based_10:#10}"));
    ///
    /// // with a width, right alignment
    /// assert_eq!("    10 KiB", format!("{byte_based_2:>#10}"));
    /// assert_eq!("     10 KB", format!("{byte_based_10:>#10}"));
    ///
    /// // with a width, right alignment, more spaces between the value and the unit
    /// assert_eq!("    10 KiB", format!("{byte_based_2:>+#10}"));
    /// assert_eq!("    10  KB", format!("{byte_based_10:>+#10}"));
    /// ```
    ///
    /// ```
    /// use byte_unit::{Byte, UnitType};
    ///
    /// let byte = Byte::from_u64(3211776);
    ///
    /// assert_eq!("3211776", format!("{byte}"));
    ///
    /// // with a unit, still precisely
    /// assert_eq!("3136.5 KiB", format!("{byte:#}"));
    ///
    /// // with a unit and a larger precision (default is 3), still precisely
    /// assert_eq!("3.211776 MB", format!("{byte:#.6}"));
    ///
    /// // with a unit and a smaller precision (default is 3), still precisely
    /// assert_eq!("3211776 B", format!("{byte:#.0}"));
    /// ```
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        if f.alternate() {
            let precision = f.precision().unwrap_or(3);

            let (mut value, unit) = self.get_recoverable_unit(false, precision);

            value = value.normalize();

            let space_length = if f.sign_plus() {
                4 - unit.as_str().len()
            } else if f.sign_minus() {
                0
            } else {
                1
            };

            if let Some(mut width) = f.width() {
                let l = unit.as_str().len() + space_length;

                if width > l + 1 {
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
            } else {
                f.write_fmt(format_args!("{value}"))?;
            }

            for _ in 0..space_length {
                f.write_char(' ')?;
            }

            f.write_fmt(format_args!("{unit}"))
        } else {
            Display::fmt(&self.0, f)
        }
    }
}

/// Associated functions for building `Byte` instances.
impl Byte {
    /// Create a new `Byte` instance from a size in bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Byte;
    /// let byte = Byte::from_u128(15000000).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the input **size** is too large (the maximum is **10<sup>27</sup> - 1** if the `u128` feature is enabled, or **2<sup>64</sup> - 1** otherwise), this function will return `None`.
    #[inline]
    pub const fn from_u128(size: u128) -> Option<Self> {
        #[cfg(feature = "u128")]
        {
            if size < RONNABYTE { Some(Byte(size)) } else { None }
        }

        #[cfg(not(feature = "u128"))]
        {
            if size <= u64::MAX as u128 { Some(Byte(size as u64)) } else { None }
        }
    }

    /// Create a new `Byte` instance from a size in bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Byte;
    /// let byte = unsafe { Byte::from_u128_unsafe(15000000) }; // 15 MB
    /// ```
    ///
    /// # Safety
    /// You must ensure the input **size** is not too large (the maximum is **10<sup>27</sup> - 1** if the `u128` feature is enabled, or **2<sup>64</sup> - 1** otherwise) on your own.
    #[inline]
    pub const unsafe fn from_u128_unsafe(size: u128) -> Self {
        #[cfg(feature = "u128")]
        {
            Byte(size)
        }

        #[cfg(not(feature = "u128"))]
        {
            Byte(size as u64)
        }
    }

    /// Create a new `Byte` instance from a size in bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Byte;
    /// let byte = Byte::from_u64(15000000); // 15 MB
    /// ```
    #[inline]
    pub const fn from_u64(size: u64) -> Self {
        #[cfg(feature = "u128")]
        {
            Byte(size as u128)
        }

        #[cfg(not(feature = "u128"))]
        {
            Byte(size)
        }
    }

    /// Create a new `Byte` instance from a size in bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Byte;
    /// let byte = Byte::from_f64(15000000.0).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the input **size** is too large (the maximum is **10<sup>27</sup> - 1** if the `u128` feature is enabled, or **2<sup>64</sup> - 1** otherwise) or not greater than or equal to **0**, this function will return `None`.
    /// * The fractional part will be rounded up.
    #[inline]
    pub fn from_f64(size: f64) -> Option<Self> {
        if size >= 0.0 {
            #[cfg(feature = "u128")]
            {
                let size = ceil_f64(size) as u128;

                if size < RONNABYTE { Some(Byte(size)) } else { None }
            }

            #[cfg(not(feature = "u128"))]
            {
                let size = ceil_f64(size) as u64;

                if size < u64::MAX { Some(Byte(size)) } else { None }
            }
        } else {
            None
        }
    }

    /// Create a new `Byte` instance from a size in bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Byte;
    /// let byte = Byte::from_f32(15000000.0).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the input **size** is too large (the maximum is **10<sup>27</sup> - 1** if the `u128` feature is enabled, or **2<sup>64</sup> - 1** otherwise) or not greater than or equal to **0**, this function will return `None`.
    /// * The fractional part will be rounded up.
    #[inline]
    pub fn from_f32(size: f32) -> Option<Self> {
        if size >= 0.0 {
            #[cfg(feature = "u128")]
            {
                let size = ceil_f32(size) as u128;

                if size < RONNABYTE { Some(Byte(size)) } else { None }
            }

            #[cfg(not(feature = "u128"))]
            {
                let size = ceil_f32(size) as u64;

                if size < u64::MAX { Some(Byte(size)) } else { None }
            }
        } else {
            None
        }
    }

    /// Create a new `Byte` instance from a size in bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Byte;
    /// let byte = Byte::from_i128(15000000).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the input **size** is too large (the maximum is **10<sup>27</sup> - 1** if the `u128` feature is enabled, or **2<sup>64</sup> - 1** otherwise) or negative, this function will return `None`.
    #[inline]
    pub const fn from_i128(size: i128) -> Option<Self> {
        if size >= 0 { Self::from_u128(size as u128) } else { None }
    }

    /// Create a new `Byte` instance from a size in bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Byte;
    /// let byte = Byte::from_i64(15000000).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the input **size** is negative, this function will return `None`.
    #[inline]
    pub const fn from_i64(size: i64) -> Option<Self> {
        if size >= 0 { Some(Self::from_u64(size as u64)) } else { None }
    }
}

/// Associated functions for building `Byte` instances (with `Unit`).
impl Byte {
    /// Create a new `Byte` instance from a size of bytes with a unit.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u128_with_unit(15, Unit::MB).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large, this function will return `None`.
    /// * If the input **unit** is `Bit`, the calculated byte will be rounded up.
    #[inline]
    pub const fn from_u128_with_unit(size: u128, unit: Unit) -> Option<Self> {
        let v = {
            match unit {
                Unit::Bit => {
                    if size & 7 > 0 {
                        (size >> 3) + 1
                    } else {
                        size >> 3
                    }
                },
                Unit::B => size,
                _ => match size.checked_mul(unit.as_bytes_u128()) {
                    Some(v) => v,
                    None => return None,
                },
            }
        };

        Self::from_u128(v)
    }

    /// Create a new `Byte` instance from a size of bytes with a unit.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64_with_unit(15, Unit::MB).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large, this function will return `None`.
    /// * If the input **unit** is `Bit`, the calculated byte will be rounded up.
    #[inline]
    pub const fn from_u64_with_unit(size: u64, unit: Unit) -> Option<Self> {
        #[cfg(feature = "u128")]
        {
            Self::from_u128_with_unit(size as u128, unit)
        }

        #[cfg(not(feature = "u128"))]
        {
            let v = {
                match unit {
                    Unit::Bit => {
                        if size & 7 > 0 {
                            (size >> 3) + 1
                        } else {
                            size >> 3
                        }
                    },
                    Unit::B => size,
                    _ => match size.checked_mul(unit.as_bytes_u64()) {
                        Some(v) => v,
                        None => return None,
                    },
                }
            };

            Some(Self::from_u64(v))
        }
    }

    /// Create a new `Byte` instance from a size of bytes with a unit.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_f64_with_unit(15.0, Unit::MB).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large or not greater than or equal to **0**, this function will return `None`.
    /// * The calculated byte will be rounded up.
    #[inline]
    pub fn from_f64_with_unit(size: f64, unit: Unit) -> Option<Self> {
        match Decimal::from_f64(size) {
            Some(size) => Self::from_decimal_with_unit(size, unit),
            None => None,
        }
    }

    /// Create a new `Byte` instance from a size of bytes with a unit.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_f32_with_unit(15.0, Unit::MB).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large or not greater than or equal to **0**, this function will return `None`.
    /// * The calculated byte will be rounded up.
    #[inline]
    pub fn from_f32_with_unit(size: f32, unit: Unit) -> Option<Self> {
        match Decimal::from_f32(size) {
            Some(size) => Self::from_decimal_with_unit(size, unit),
            None => None,
        }
    }

    /// Create a new `Byte` instance from a size of bytes with a unit.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_i128_with_unit(15, Unit::MB).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large or negative, this function will return `None`.
    /// * The calculated byte will be rounded up.
    #[inline]
    pub const fn from_i128_with_unit(size: i128, unit: Unit) -> Option<Self> {
        if size >= 0 { Self::from_u128_with_unit(size as u128, unit) } else { None }
    }

    /// Create a new `Byte` instance from a size of bytes with a unit.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_i64_with_unit(15, Unit::MB).unwrap(); // 15 MB
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large or negative, this function will return `None`.
    /// * The calculated byte will be rounded up.
    #[inline]
    pub const fn from_i64_with_unit(size: i64, unit: Unit) -> Option<Self> {
        if size >= 0 { Self::from_u64_with_unit(size as u64, unit) } else { None }
    }
}

/// Methods for converting a `Byte` instance into a primitive integer.
impl Byte {
    /// Retrieve the byte represented by this `Byte` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Byte;
    ///
    /// let byte = Byte::parse_str("123Kib", true).unwrap();
    ///
    /// let result = byte.as_u128();
    ///
    /// assert_eq!(125952, result);
    /// ```
    ///
    /// ```
    /// use byte_unit::Byte;
    ///
    /// let byte = Byte::parse_str("123Kib", false).unwrap();
    ///
    /// let result = byte.as_u128();
    ///
    /// assert_eq!(15744, result);
    /// ```
    #[inline]
    pub const fn as_u128(self) -> u128 {
        #[cfg(feature = "u128")]
        {
            self.0
        }

        #[cfg(not(feature = "u128"))]
        {
            self.0 as u128
        }
    }

    /// Retrieve the byte represented by this `Byte` instance. When the `u128` feature is enabled, if the byte is actually greater than **2<sup>64</sup> - 1**, it will return **2<sup>64</sup> - 1**.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Byte;
    ///
    /// let byte = Byte::parse_str("1kb", true).unwrap();
    ///
    /// let result = byte.as_u64();
    ///
    /// assert_eq!(1000, result);
    /// ```
    ///
    /// ```
    /// # #[cfg(feature = "u128")]
    /// # {
    /// use byte_unit::Byte;
    ///
    /// let byte = Byte::parse_str("1zb", true).unwrap();
    ///
    /// let result = byte.as_u64();
    ///
    /// assert_eq!(u64::MAX, result);
    /// # }
    /// ```
    #[inline]
    pub const fn as_u64(self) -> u64 {
        #[cfg(feature = "u128")]
        {
            if self.0 <= u64::MAX as u128 { self.0 as u64 } else { u64::MAX }
        }

        #[cfg(not(feature = "u128"))]
        {
            self.0
        }
    }

    /// Retrieve the byte represented by this `Byte` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Byte;
    ///
    /// let byte = Byte::parse_str("1kb", true).unwrap();
    ///
    /// let result = byte.as_u64_checked();
    ///
    /// assert_eq!(Some(1000), result);
    /// ```
    ///
    /// ```
    /// # #[cfg(feature = "u128")]
    /// # {
    /// use byte_unit::Byte;
    ///
    /// let byte = Byte::parse_str("1zb", true).unwrap();
    ///
    /// let result = byte.as_u64_checked();
    ///
    /// assert_eq!(None, result);
    /// # }
    /// ```
    #[inline]
    pub const fn as_u64_checked(self) -> Option<u64> {
        #[cfg(feature = "u128")]
        {
            if self.0 <= u64::MAX as u128 { Some(self.0 as u64) } else { None }
        }

        #[cfg(not(feature = "u128"))]
        {
            Some(self.0)
        }
    }
}

/// Methods for calculation.
impl Byte {
    /// Add another `Byte` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Byte;
    ///
    /// let byte_1 = Byte::from_u64(1024);
    /// let byte_2 = Byte::from_u64(512);
    ///
    /// let byte = byte_1.add(byte_2).unwrap();
    ///
    /// assert_eq!(1536, byte.as_u64());
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large, this function will return `None`.
    #[inline]
    pub const fn add(self, rhs: Byte) -> Option<Byte> {
        match self.0.checked_add(rhs.0) {
            Some(v) => Some(Byte(v)),
            None => None,
        }
    }

    /// Subtract another `Byte` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Byte;
    ///
    /// let byte_1 = Byte::from_u64(1024);
    /// let byte_2 = Byte::from_u64(512);
    ///
    /// let byte = byte_1.subtract(byte_2).unwrap();
    ///
    /// assert_eq!(512, byte.as_u64());
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the right-hand side is bigger then this `Byte` instance, this function will return `None`.
    #[inline]
    pub const fn subtract(self, rhs: Byte) -> Option<Byte> {
        match self.0.checked_sub(rhs.0) {
            Some(v) => Some(Byte(v)),
            None => None,
        }
    }

    /// Multiplied by an unsigned integer.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Byte;
    ///
    /// let count = 100;
    /// let byte = Byte::from_u64(1024);
    ///
    /// let total_byte = byte.multiply(100).unwrap();
    ///
    /// assert_eq!(102400, total_byte.as_u64());
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the calculated byte is too large, this function will return `None`.
    #[allow(unexpected_cfgs)]
    #[inline]
    pub const fn multiply(self, rhs: usize) -> Option<Byte> {
        #[cfg(feature = "u128")]
        {
            match self.0.checked_mul(rhs as u128) {
                Some(v) => Some(Byte(v)),
                None => None,
            }
        }

        #[cfg(not(feature = "u128"))]
        {
            #[cfg(target_pointer_width = "128")]
            {
                if rhs > u64::MAX as usize {
                    return None;
                }
            }

            match self.0.checked_mul(rhs as u64) {
                Some(v) => Some(Byte(v)),
                None => None,
            }
        }
    }

    /// Divided by an unsigned integer.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Byte;
    ///
    /// let count = 100;
    /// let byte = Byte::from_u64(1024);
    ///
    /// let total_byte = byte.divide(100).unwrap();
    ///
    /// assert_eq!(10, total_byte.as_u64());
    /// ```
    ///
    /// # Points to Note
    ///
    /// * If the input right-hand side is zero, this function will return `None`.
    /// * The result will be rounded down.
    #[allow(unexpected_cfgs)]
    #[inline]
    pub const fn divide(self, rhs: usize) -> Option<Byte> {
        #[cfg(feature = "u128")]
        {
            match self.0.checked_div(rhs as u128) {
                Some(v) => Some(Byte(v)),
                None => None,
            }
        }

        #[cfg(not(feature = "u128"))]
        {
            #[cfg(target_pointer_width = "128")]
            {
                if rhs > u64::MAX as usize {
                    return None;
                }
            }

            match self.0.checked_div(rhs as u64) {
                Some(v) => Some(Byte(v)),
                None => None,
            }
        }
    }

    #[inline]
    pub(crate) const fn div_8(self) -> Byte {
        Byte(self.0 / 8)
    }
}

/// Methods for finding an unit.
impl Byte {
    /// Obtain the largest unit which is the greatest factor of this `Byte` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64(3145728);
    ///
    /// let (n, unit) = byte.get_exact_unit(true);
    ///
    /// assert_eq!(3, n);
    /// assert_eq!(Unit::MiB, unit);
    /// ```
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64(375000);
    ///
    /// let (n, unit) = byte.get_exact_unit(true);
    ///
    /// assert_eq!(3, n);
    /// assert_eq!(Unit::Mbit, unit);
    /// ```
    ///
    /// ```
    /// use byte_unit::{Byte, Unit};
    ///
    /// let byte = Byte::from_u64(375000);
    ///
    /// let (n, unit) = byte.get_exact_unit(false);
    ///
    /// assert_eq!(375, n);
    /// assert_eq!(Unit::KB, unit);
    /// ```
    #[inline]
    pub const fn get_exact_unit(self, allow_in_bits: bool) -> (u128, Unit) {
        let bytes_v = self.as_u128();

        let a = if allow_in_bits { Unit::get_multiples() } else { Unit::get_multiples_bytes() };
        let mut i = a.len() - 1;

        loop {
            let unit = a[i];

            let unit_v = unit.as_bytes_u128();

            if bytes_v >= unit_v && bytes_v % unit_v == 0 {
                return (bytes_v / unit_v, unit);
            }

            if i == 0 {
                break;
            }

            i -= 1;
        }

        (bytes_v, Unit::B)
    }
}
