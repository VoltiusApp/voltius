//! `From`-like conversions for [`Int`].

use crate::{CtOption, I64, I128, Int, Limb, Uint, Word};

macro_rules! check_limbs {
    ($limbs:expr) => {
        const {
            assert!($limbs >= 1, "number of limbs must be greater than zero");
        }
    };
}

#[allow(clippy::cast_sign_loss)]
impl<const LIMBS: usize> Int<LIMBS> {
    /// Create a [`Int`] from an `i8` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<i8>` when stable
    #[inline]
    #[must_use]
    pub const fn from_i8(n: i8) -> Self {
        check_limbs!(LIMBS);
        Uint::new([Limb(n as Word)]).as_int().resize()
    }

    /// Create a [`Int`] from an `i16` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<i16>` when stable
    #[inline]
    #[must_use]
    pub const fn from_i16(n: i16) -> Self {
        check_limbs!(LIMBS);
        Uint::new([Limb(n as Word)]).as_int().resize()
    }

    /// Create a [`Int`] from an `i32` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<i32>` when stable
    #[inline]
    #[must_use]
    pub const fn from_i32(n: i32) -> Self {
        check_limbs!(LIMBS);
        Uint::new([Limb(n as Word)]).as_int().resize()
    }

    cpubits::cpubits! {
        32 => {
            /// Create a [`Int`] from an `i64` (const-friendly)
            // TODO(tarcieri): replace with `const impl From<i64>` when stable
            #[inline]
            pub const fn from_i64(n: i64) -> Self {
                check_limbs!(LIMBS);
                Uint::<{ I64::LIMBS }>::from_u64(n as u64).as_int().resize()
            }
        }
        64 => {
            /// Create a [`Int`] from an `i64` (const-friendly)
            // TODO(tarcieri): replace with `const impl From<i64>` when stable
            #[inline]
            #[must_use]
            pub const fn from_i64(n: i64) -> Self {
                check_limbs!(LIMBS);
                Uint::new([Limb(n as Word)]).as_int().resize()
            }
        }
    }

    /// Create a [`Int`] from an `i128` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<i128>` when stable
    #[inline]
    #[must_use]
    pub const fn from_i128(n: i128) -> Self {
        Uint::<{ I128::LIMBS }>::from_u128(n as u128)
            .as_int()
            .resize()
    }

    /// Convert a `CtOption<Uint<LIMBS>>` to a `CtOption<Int<LIMBS>>`
    // TODO(tarcieri): replace with `const impl From<CtOption<Uint>>` when stable
    #[inline]
    pub(super) const fn from_uint_opt(opt: CtOption<Uint<LIMBS>>) -> CtOption<Self> {
        CtOption::new(*opt.as_inner_unchecked().as_int(), opt.is_some())
    }
}

impl<const LIMBS: usize> From<i8> for Int<LIMBS> {
    #[inline]
    fn from(n: i8) -> Self {
        const {
            debug_assert!(LIMBS > 0, "limbs must be non-zero");
        }
        Self::from_i8(n)
    }
}

impl<const LIMBS: usize> From<i16> for Int<LIMBS> {
    #[inline]
    fn from(n: i16) -> Self {
        const {
            debug_assert!(LIMBS > 0, "limbs must be non-zero");
        }
        Self::from_i16(n)
    }
}

impl<const LIMBS: usize> From<i32> for Int<LIMBS> {
    #[inline]
    fn from(n: i32) -> Self {
        const {
            debug_assert!(LIMBS > 0, "limbs must be non-zero");
        }
        Self::from_i32(n)
    }
}

impl<const LIMBS: usize> From<i64> for Int<LIMBS> {
    #[inline]
    fn from(n: i64) -> Self {
        #[allow(clippy::integer_division_remainder_used, reason = "const/debug")]
        const {
            debug_assert!(LIMBS >= 8 / Limb::BYTES, "not enough limbs");
        }
        Self::from_i64(n)
    }
}

impl<const LIMBS: usize> From<i128> for Int<LIMBS> {
    #[inline]
    fn from(n: i128) -> Self {
        #[allow(clippy::integer_division_remainder_used, reason = "const/debug")]
        const {
            debug_assert!(LIMBS >= 16 / Limb::BYTES, "not enough limbs");
        }
        Self::from_i128(n)
    }
}

impl From<I64> for i64 {
    #[inline]
    #[allow(clippy::cast_possible_wrap)]
    fn from(n: I64) -> i64 {
        u64::from(n.0) as i64
    }
}

impl From<I128> for i128 {
    #[inline]
    #[allow(clippy::cast_possible_wrap)]
    fn from(n: I128) -> i128 {
        u128::from(n.0) as i128
    }
}

impl<const LIMBS: usize, const LIMBS2: usize> From<&Int<LIMBS>> for Int<LIMBS2> {
    #[inline]
    fn from(num: &Int<LIMBS>) -> Int<LIMBS2> {
        num.resize()
    }
}

#[cfg(test)]
mod tests {
    use crate::{I128, Limb};

    cpubits::cpubits! {
        32 => { use crate::I64 as IntEx; }
        64 => { use crate::I128 as IntEx; }
    }

    #[test]
    fn from_i8() {
        let n = IntEx::from(42i8);
        assert_eq!(n.as_limbs(), &[Limb(42), Limb(0)]);
        let n = IntEx::from(-42i8);
        assert_eq!(n.as_limbs(), &[Limb::MAX - Limb::from(41u32), Limb::MAX]);
    }

    #[test]
    fn from_i16() {
        let n = IntEx::from(42i16);
        assert_eq!(n.as_limbs(), &[Limb(42), Limb(0)]);
        let n = IntEx::from(-42i16);
        assert_eq!(n.as_limbs(), &[Limb::MAX - Limb::from(41u32), Limb::MAX]);
    }

    #[test]
    fn from_i32() {
        let n = IntEx::from(42i32);
        assert_eq!(n.as_limbs(), &[Limb(42), Limb(0)]);
        let n = IntEx::from(-42i32);
        assert_eq!(n.as_limbs(), &[Limb::MAX - Limb::from(41u32), Limb::MAX]);
    }

    #[test]
    fn from_i64() {
        let n = IntEx::from(42i64);
        assert_eq!(n.as_limbs(), &[Limb(42), Limb(0)]);
        let n = IntEx::from(-42i64);
        assert_eq!(n.as_limbs(), &[Limb::MAX - Limb::from(41u32), Limb::MAX]);
    }

    #[test]
    fn from_i128() {
        let n = I128::from(42i128);
        assert_eq!(&n.as_limbs()[..2], &[Limb(42), Limb(0)]);
        assert_eq!(i128::from(n), 42i128);
        let n = I128::from(-42i128);
        assert_eq!(&n.as_limbs()[..2], &[Limb::MAX - Limb(41), Limb::MAX]);
        assert_eq!(i128::from(n), -42i128);
    }
}
