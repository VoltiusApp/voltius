mod built_in_trait;
pub(crate) mod parse;
#[cfg(feature = "rocket")]
mod rocket_traits;
#[cfg(feature = "serde")]
mod serde_traits;
#[cfg(any(feature = "byte", feature = "bit"))]
mod unit_type;

use core::fmt::{self, Display, Formatter};

#[cfg(any(feature = "byte", feature = "bit"))]
pub use unit_type::*;

/// The unit of bits/bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    /// 8 Bit = 1 byte.
    Bit,
    /// 1 B = 1 byte.
    B,
    /// 1 Kbit = 125 bytes.
    Kbit,
    /// 1 Kibit = 2<sup>7</sup> bytes.
    Kibit,
    /// 1 KB = 10<sup>3</sup> bytes.
    KB,
    /// 1 KiB = 2<sup>10</sup> bytes.
    KiB,
    /// 1 Mbit = 125 * 10<sup>3</sup> bytes.
    Mbit,
    /// 1 Mibit = 2<sup>17</sup> bytes.
    Mibit,
    /// 1 MB = 10<sup>6</sup> bytes.
    MB,
    /// 1 MiB = 2<sup>20</sup> bytes.
    MiB,
    /// 1 Gbit = 125 * 10<sup>6</sup> bytes.
    Gbit,
    /// 1 Gibit = 2<sup>27</sup> bytes.
    Gibit,
    /// 1 GB = 10<sup>9</sup> bytes.
    GB,
    /// 1 GiB = 2<sup>30</sup> bytes.
    GiB,
    /// 1 Tbit = 125 * 10<sup>9</sup> bytes.
    Tbit,
    /// 1 Tibit = 2<sup>37</sup> bytes.
    Tibit,
    /// 1 TB = 10<sup>12</sup> bytes.
    TB,
    /// 1 TiB = 2<sup>40</sup> bytes.
    TiB,
    /// 1 Pbit = 125 * 10<sup>12</sup> bytes.
    Pbit,
    /// 1 Pibit = 2<sup>47</sup> bytes.
    Pibit,
    /// 1 PB = 10<sup>15</sup> bytes.
    PB,
    /// 1 PiB = 2<sup>50</sup> bytes.
    PiB,
    /// 1 Ebit = 125 * 10<sup>15</sup> bytes.
    Ebit,
    /// 1 Eibit = 2<sup>57</sup> bytes.
    Eibit,
    /// 1 EB = 10<sup>18</sup> bytes.
    EB,
    /// 1 EiB = 2<sup>60</sup> bytes.
    EiB,
    #[cfg(feature = "u128")]
    /// 1 Zbit = 125 * 10<sup>18</sup> bytes.
    Zbit,
    #[cfg(feature = "u128")]
    /// 1 Zibit = 2<sup>67</sup> bytes.
    Zibit,
    #[cfg(feature = "u128")]
    /// 1 ZB = 10<sup>21</sup> bytes.
    ZB,
    #[cfg(feature = "u128")]
    /// 1 ZiB = 2<sup>70</sup> bytes.
    ZiB,
    #[cfg(feature = "u128")]
    /// 1 Ybit = 125 * 10<sup>21</sup> bytes.
    Ybit,
    #[cfg(feature = "u128")]
    /// 1 Yibit = 2<sup>77</sup> bytes.
    Yibit,
    #[cfg(feature = "u128")]
    /// 1 YB = 10<sup>24</sup> bytes.
    YB,
    #[cfg(feature = "u128")]
    /// 1 YiB = 2<sup>80</sup> bytes.
    YiB,
}

impl Display for Unit {
    #[inline]
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        Display::fmt(self.as_str(), f)
    }
}

/// Methods for converting a `Unit` instance into a primitive integer.
impl Unit {
    /// Retrieve the bit represented by this `Unit` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Unit;
    ///
    /// assert_eq!(1, Unit::Bit.as_bits_u128());
    /// assert_eq!(8, Unit::B.as_bits_u128());
    /// assert_eq!(8000, Unit::KB.as_bits_u128());
    /// assert_eq!(1024, Unit::Kibit.as_bits_u128());
    /// ```
    #[inline]
    pub const fn as_bits_u128(self) -> u128 {
        match self {
            Unit::Bit => 1,
            Unit::B => 1 << 3,
            Unit::Kbit => 1_000,
            Unit::Kibit => 1 << 10,
            Unit::KB => Unit::Kbit.as_bits_u128() << 3,
            Unit::KiB => Unit::Kibit.as_bits_u128() << 3,
            Unit::Mbit => 1_000_000,
            Unit::Mibit => 1 << 20,
            Unit::MB => Unit::Mbit.as_bits_u128() << 3,
            Unit::MiB => Unit::Mibit.as_bits_u128() << 3,
            Unit::Gbit => 1_000_000_000,
            Unit::Gibit => 1 << 30,
            Unit::GB => Unit::Gbit.as_bits_u128() << 3,
            Unit::GiB => Unit::Gibit.as_bits_u128() << 3,
            Unit::Tbit => 1_000_000_000_000,
            Unit::Tibit => 1 << 40,
            Unit::TB => Unit::Tbit.as_bits_u128() << 3,
            Unit::TiB => Unit::Tibit.as_bits_u128() << 3,
            Unit::Pbit => 1_000_000_000_000_000,
            Unit::Pibit => 1 << 50,
            Unit::PB => Unit::Pbit.as_bits_u128() << 3,
            Unit::PiB => Unit::Pibit.as_bits_u128() << 3,
            Unit::Ebit => 1_000_000_000_000_000_000,
            Unit::Eibit => 1 << 60,
            Unit::EB => Unit::Ebit.as_bits_u128() << 3,
            Unit::EiB => Unit::Eibit.as_bits_u128() << 3,
            #[cfg(feature = "u128")]
            Unit::Zbit => 1_000_000_000_000_000_000_000,
            #[cfg(feature = "u128")]
            Unit::Zibit => 1 << 70,
            #[cfg(feature = "u128")]
            Unit::ZB => Unit::Zbit.as_bits_u128() << 3,
            #[cfg(feature = "u128")]
            Unit::ZiB => Unit::Zibit.as_bits_u128() << 3,
            #[cfg(feature = "u128")]
            Unit::Ybit => 1_000_000_000_000_000_000_000_000,
            #[cfg(feature = "u128")]
            Unit::Yibit => 1 << 80,
            #[cfg(feature = "u128")]
            Unit::YB => Unit::Ybit.as_bits_u128() << 3,
            #[cfg(feature = "u128")]
            Unit::YiB => Unit::Yibit.as_bits_u128() << 3,
        }
    }

    #[cfg(any(feature = "byte", feature = "bit"))]
    #[cfg(not(feature = "u128"))]
    #[inline]
    pub(crate) const fn as_bits_u64(self) -> u64 {
        self.as_bits_u128() as u64
    }

    #[cfg(feature = "byte")]
    #[inline]
    pub(crate) const fn as_bytes_u128(self) -> u128 {
        debug_assert!(!matches!(self, Unit::Bit));

        self.as_bits_u128() >> 3
    }

    #[cfg(feature = "byte")]
    #[cfg(not(feature = "u128"))]
    #[inline]
    pub(crate) const fn as_bytes_u64(self) -> u64 {
        debug_assert!(!matches!(self, Unit::Bit));

        self.as_bits_u64() >> 3
    }
}

/// Methods for converting a `Unit` instance into a string.
impl Unit {
    /// Retrieve the string represented by this `Unit` instance.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Unit;
    ///
    /// assert_eq!("B", Unit::B.as_str());
    /// assert_eq!("KB", Unit::KB.as_str());
    /// assert_eq!("MiB", Unit::MiB.as_str());
    /// assert_eq!("Gb", Unit::Gbit.as_str());
    /// assert_eq!("Tib", Unit::Tibit.as_str());
    /// ```
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bit => "b",
            Self::B => "B",
            Self::Kbit => "Kb",
            Self::Kibit => "Kib",
            Self::KB => "KB",
            Self::KiB => "KiB",
            Self::Mbit => "Mb",
            Self::Mibit => "Mib",
            Self::MB => "MB",
            Self::MiB => "MiB",
            Self::Gbit => "Gb",
            Self::Gibit => "Gib",
            Self::GB => "GB",
            Self::GiB => "GiB",
            Self::Tbit => "Tb",
            Self::Tibit => "Tib",
            Self::TB => "TB",
            Self::TiB => "TiB",
            Self::Pbit => "Pb",
            Self::Pibit => "Pib",
            Self::PB => "PB",
            Self::PiB => "PiB",
            Self::Ebit => "Eb",
            Self::Eibit => "Eib",
            Self::EB => "EB",
            Self::EiB => "EiB",
            #[cfg(feature = "u128")]
            Self::Zbit => "Zb",
            #[cfg(feature = "u128")]
            Self::Zibit => "Zib",
            #[cfg(feature = "u128")]
            Self::ZB => "ZB",
            #[cfg(feature = "u128")]
            Self::ZiB => "ZiB",
            #[cfg(feature = "u128")]
            Self::Ybit => "Yb",
            #[cfg(feature = "u128")]
            Self::Yibit => "Yib",
            #[cfg(feature = "u128")]
            Self::YB => "YB",
            #[cfg(feature = "u128")]
            Self::YiB => "YiB",
        }
    }
}

/// Methods for categorizing variants.
impl Unit {
    /// Check whether the unit is based on bits.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Unit;
    ///
    /// assert_eq!(false, Unit::KB.is_bit());
    /// assert_eq!(true, Unit::Kbit.is_bit());
    /// ```
    #[inline]
    pub const fn is_bit(self) -> bool {
        #[cfg(feature = "u128")]
        {
            matches!(
                self,
                Self::Bit
                    | Self::Kbit
                    | Self::Kibit
                    | Self::Mbit
                    | Self::Mibit
                    | Self::Gbit
                    | Self::Gibit
                    | Self::Tbit
                    | Self::Tibit
                    | Self::Pbit
                    | Self::Pibit
                    | Self::Ebit
                    | Self::Eibit
                    | Self::Zbit
                    | Self::Zibit
                    | Self::Ybit
                    | Self::Yibit
            )
        }
        #[cfg(not(feature = "u128"))]
        {
            matches!(
                self,
                Self::Bit
                    | Self::Kbit
                    | Self::Kibit
                    | Self::Mbit
                    | Self::Mibit
                    | Self::Gbit
                    | Self::Gibit
                    | Self::Tbit
                    | Self::Tibit
                    | Self::Pbit
                    | Self::Pibit
                    | Self::Ebit
                    | Self::Eibit
            )
        }
    }

    /// Check whether the unit is based on powers of  **2**.
    ///
    /// # Examples
    ///
    /// ```
    /// use byte_unit::Unit;
    ///
    /// assert_eq!(false, Unit::KB.is_binary_multiples());
    /// assert_eq!(true, Unit::KiB.is_binary_multiples());
    /// ```
    #[inline]
    pub const fn is_binary_multiples(self) -> bool {
        #[cfg(feature = "u128")]
        {
            matches!(
                self,
                Self::B
                    | Self::Kibit
                    | Self::KiB
                    | Self::Mibit
                    | Self::MiB
                    | Self::Gibit
                    | Self::GiB
                    | Self::Tibit
                    | Self::TiB
                    | Self::Pibit
                    | Self::PiB
                    | Self::Eibit
                    | Self::EiB
                    | Self::Zibit
                    | Self::ZiB
                    | Self::Yibit
                    | Self::YiB
            )
        }
        #[cfg(not(feature = "u128"))]
        {
            matches!(
                self,
                Self::B
                    | Self::Kibit
                    | Self::KiB
                    | Self::Mibit
                    | Self::MiB
                    | Self::Gibit
                    | Self::GiB
                    | Self::Tibit
                    | Self::TiB
                    | Self::Pibit
                    | Self::PiB
                    | Self::Eibit
                    | Self::EiB
            )
        }
    }
}

impl Unit {
    #[cfg(any(feature = "byte", feature = "bit"))]
    #[allow(dead_code)]
    #[inline]
    pub(crate) const fn get_multiples() -> &'static [Self] {
        &[
            Self::Kbit,
            Self::Kibit,
            Self::KB,
            Self::KiB,
            Self::Mbit,
            Self::Mibit,
            Self::MB,
            Self::MiB,
            Self::Gbit,
            Self::Gibit,
            Self::GB,
            Self::GiB,
            Self::Tbit,
            Self::Tibit,
            Self::TB,
            Self::TiB,
            Self::Pbit,
            Self::Pibit,
            Self::PB,
            Self::PiB,
            Self::Ebit,
            Self::Eibit,
            Self::EB,
            Self::EiB,
            #[cfg(feature = "u128")]
            Self::Zbit,
            #[cfg(feature = "u128")]
            Self::Zibit,
            #[cfg(feature = "u128")]
            Self::ZB,
            #[cfg(feature = "u128")]
            Self::ZiB,
            #[cfg(feature = "u128")]
            Self::Ybit,
            #[cfg(feature = "u128")]
            Self::Yibit,
            #[cfg(feature = "u128")]
            Self::YB,
            #[cfg(feature = "u128")]
            Self::YiB,
        ]
    }

    #[cfg(feature = "byte")]
    #[inline]
    pub(crate) const fn get_multiples_bytes() -> &'static [Self] {
        &[
            Self::KB,
            Self::KiB,
            Self::MB,
            Self::MiB,
            Self::GB,
            Self::GiB,
            Self::TB,
            Self::TiB,
            Self::PB,
            Self::PiB,
            Self::EB,
            Self::EiB,
            #[cfg(feature = "u128")]
            Self::ZB,
            #[cfg(feature = "u128")]
            Self::ZiB,
            #[cfg(feature = "u128")]
            Self::YB,
            #[cfg(feature = "u128")]
            Self::YiB,
        ]
    }

    #[cfg(feature = "bit")]
    #[allow(dead_code)]
    #[inline]
    pub(crate) const fn get_multiples_bits() -> &'static [Self] {
        &[
            Self::Kbit,
            Self::Kibit,
            Self::Mbit,
            Self::Mibit,
            Self::Gbit,
            Self::Gibit,
            Self::Tbit,
            Self::Tibit,
            Self::Pbit,
            Self::Pibit,
            Self::Ebit,
            Self::Eibit,
            #[cfg(feature = "u128")]
            Self::Zbit,
            #[cfg(feature = "u128")]
            Self::Zibit,
            #[cfg(feature = "u128")]
            Self::Ybit,
            #[cfg(feature = "u128")]
            Self::Yibit,
        ]
    }
}
