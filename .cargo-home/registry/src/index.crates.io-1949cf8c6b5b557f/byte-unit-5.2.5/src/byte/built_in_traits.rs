use core::{cmp::Ordering, str::FromStr};

use super::Byte;
use crate::{ExceededBoundsError, ParseError, TryFromIntError};

impl TryFrom<u128> for Byte {
    type Error = ExceededBoundsError;

    #[inline]
    fn try_from(value: u128) -> Result<Self, Self::Error> {
        Byte::from_u128(value).ok_or(ExceededBoundsError)
    }
}

impl From<u64> for Byte {
    #[inline]
    fn from(value: u64) -> Self {
        Byte::from_u64(value)
    }
}

impl From<u32> for Byte {
    #[inline]
    fn from(value: u32) -> Self {
        Byte::from_u64(value as u64)
    }
}

impl From<u16> for Byte {
    #[inline]
    fn from(value: u16) -> Self {
        Byte::from_u64(value as u64)
    }
}

impl From<u8> for Byte {
    #[inline]
    fn from(value: u8) -> Self {
        Byte::from_u64(value as u64)
    }
}

impl From<usize> for Byte {
    #[allow(unexpected_cfgs)]
    #[inline]
    fn from(value: usize) -> Self {
        #[cfg(target_pointer_width = "128")]
        {
            Byte::from_u128(value as u128).unwrap_or(Byte::MAX)
        }

        #[cfg(not(target_pointer_width = "128"))]
        {
            Byte::from_u64(value as u64)
        }
    }
}

impl TryFrom<i128> for Byte {
    type Error = ExceededBoundsError;

    #[inline]
    fn try_from(value: i128) -> Result<Self, Self::Error> {
        Byte::from_i128(value).ok_or(ExceededBoundsError)
    }
}

impl TryFrom<i64> for Byte {
    type Error = ExceededBoundsError;

    #[inline]
    fn try_from(value: i64) -> Result<Self, Self::Error> {
        Byte::from_i64(value).ok_or(ExceededBoundsError)
    }
}

impl TryFrom<i32> for Byte {
    type Error = ExceededBoundsError;

    #[inline]
    fn try_from(value: i32) -> Result<Self, Self::Error> {
        Byte::from_i64(value as i64).ok_or(ExceededBoundsError)
    }
}

impl TryFrom<i16> for Byte {
    type Error = ExceededBoundsError;

    #[inline]
    fn try_from(value: i16) -> Result<Self, Self::Error> {
        Byte::from_i64(value as i64).ok_or(ExceededBoundsError)
    }
}

impl TryFrom<i8> for Byte {
    type Error = ExceededBoundsError;

    #[inline]
    fn try_from(value: i8) -> Result<Self, Self::Error> {
        Byte::from_i64(value as i64).ok_or(ExceededBoundsError)
    }
}

impl TryFrom<isize> for Byte {
    type Error = ExceededBoundsError;

    #[allow(unexpected_cfgs)]
    #[inline]
    fn try_from(value: isize) -> Result<Self, Self::Error> {
        #[cfg(target_pointer_width = "128")]
        {
            Byte::from_i128(value as i128).ok_or(ExceededBoundsError)
        }

        #[cfg(not(target_pointer_width = "128"))]
        {
            Byte::from_i64(value as i64).ok_or(ExceededBoundsError)
        }
    }
}

impl TryFrom<f64> for Byte {
    type Error = ExceededBoundsError;

    #[inline]
    fn try_from(value: f64) -> Result<Self, Self::Error> {
        Byte::from_f64(value).ok_or(ExceededBoundsError)
    }
}

impl TryFrom<f32> for Byte {
    type Error = ExceededBoundsError;

    #[inline]
    fn try_from(value: f32) -> Result<Self, Self::Error> {
        Byte::from_f32(value).ok_or(ExceededBoundsError)
    }
}

impl From<Byte> for u128 {
    #[inline]
    fn from(byte: Byte) -> Self {
        byte.as_u128()
    }
}

impl From<Byte> for u64 {
    #[inline]
    fn from(byte: Byte) -> Self {
        byte.as_u64()
    }
}

impl TryFrom<Byte> for u32 {
    type Error = TryFromIntError;

    #[inline]
    fn try_from(byte: Byte) -> Result<Self, Self::Error> {
        u32::try_from(byte.as_u64())
    }
}

impl TryFrom<Byte> for u16 {
    type Error = TryFromIntError;

    #[inline]
    fn try_from(byte: Byte) -> Result<Self, Self::Error> {
        u16::try_from(byte.as_u64())
    }
}

impl TryFrom<Byte> for u8 {
    type Error = TryFromIntError;

    #[inline]
    fn try_from(byte: Byte) -> Result<Self, Self::Error> {
        u8::try_from(byte.as_u64())
    }
}

impl TryFrom<Byte> for usize {
    type Error = TryFromIntError;

    #[allow(unexpected_cfgs)]
    #[inline]
    fn try_from(byte: Byte) -> Result<Self, Self::Error> {
        #[cfg(target_pointer_width = "128")]
        {
            usize::try_from(byte.as_u128())
        }

        #[cfg(not(target_pointer_width = "128"))]
        {
            usize::try_from(byte.as_u64())
        }
    }
}

impl FromStr for Byte {
    type Err = ParseError;

    /// `ignore_case` is set to `false`. See [`Byte::parse_str`](#method.parse_str).
    #[inline]
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Byte::parse_str(s, false)
    }
}

impl PartialEq<u64> for Byte {
    #[cfg(feature = "u128")]
    #[inline]
    fn eq(&self, other: &u64) -> bool {
        self.0 == *other as u128
    }

    #[cfg(not(feature = "u128"))]
    #[inline]
    fn eq(&self, other: &u64) -> bool {
        self.0 == *other
    }
}

impl PartialEq<u128> for Byte {
    #[cfg(feature = "u128")]
    #[inline]
    fn eq(&self, other: &u128) -> bool {
        self.0 == *other
    }

    #[cfg(not(feature = "u128"))]
    #[inline]
    fn eq(&self, other: &u128) -> bool {
        self.0 as u128 == *other
    }
}

impl PartialEq<Byte> for u64 {
    #[cfg(feature = "u128")]
    #[inline]
    fn eq(&self, other: &Byte) -> bool {
        *self as u128 == other.0
    }

    #[cfg(not(feature = "u128"))]
    #[inline]
    fn eq(&self, other: &Byte) -> bool {
        *self == other.0
    }
}

impl PartialEq<Byte> for u128 {
    #[cfg(feature = "u128")]
    #[inline]
    fn eq(&self, other: &Byte) -> bool {
        *self == other.0
    }

    #[cfg(not(feature = "u128"))]
    #[inline]
    fn eq(&self, other: &Byte) -> bool {
        *self == other.0 as u128
    }
}

impl PartialOrd<u64> for Byte {
    #[cfg(feature = "u128")]
    #[inline]
    fn partial_cmp(&self, other: &u64) -> Option<Ordering> {
        self.0.partial_cmp(&(*other as u128))
    }

    #[cfg(not(feature = "u128"))]
    #[inline]
    fn partial_cmp(&self, other: &u64) -> Option<Ordering> {
        self.0.partial_cmp(other)
    }
}

impl PartialOrd<u128> for Byte {
    #[cfg(feature = "u128")]
    #[inline]
    fn partial_cmp(&self, other: &u128) -> Option<Ordering> {
        self.0.partial_cmp(other)
    }

    #[cfg(not(feature = "u128"))]
    #[inline]
    fn partial_cmp(&self, other: &u128) -> Option<Ordering> {
        (self.0 as u128).partial_cmp(other)
    }
}

impl PartialOrd<Byte> for u64 {
    #[cfg(feature = "u128")]
    #[inline]
    fn partial_cmp(&self, other: &Byte) -> Option<Ordering> {
        (*self as u128).partial_cmp(&other.0)
    }

    #[cfg(not(feature = "u128"))]
    #[inline]
    fn partial_cmp(&self, other: &Byte) -> Option<Ordering> {
        self.partial_cmp(&other.0)
    }
}

impl PartialOrd<Byte> for u128 {
    #[cfg(feature = "u128")]
    #[inline]
    fn partial_cmp(&self, other: &Byte) -> Option<Ordering> {
        self.partial_cmp(&other.0)
    }

    #[cfg(not(feature = "u128"))]
    #[inline]
    fn partial_cmp(&self, other: &Byte) -> Option<Ordering> {
        self.partial_cmp(&(other.0 as u128))
    }
}
