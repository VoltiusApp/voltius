//! [`Int`] comparisons.
//!
//! By default, these are all constant-time.

use crate::{Choice, CtEq, Int, Uint};
use core::cmp::Ordering;

impl<const LIMBS: usize> Int<LIMBS> {
    /// Swap `a` and `b` if `c` is truthy, otherwise, do nothing.
    #[inline]
    pub(crate) const fn conditional_swap(a: &mut Self, b: &mut Self, c: Choice) {
        Uint::conditional_swap(&mut a.0, &mut b.0, c);
    }

    /// Returns the truthy value if `self`!=0 or the falsy value otherwise.
    #[inline]
    pub(crate) const fn is_nonzero(&self) -> Choice {
        Uint::is_nonzero(&self.0)
    }

    /// Returns the truthy value if `self == rhs` or the falsy value otherwise.
    #[inline]
    pub(crate) const fn eq(lhs: &Self, rhs: &Self) -> Choice {
        Uint::eq(&lhs.0, &rhs.0)
    }

    /// Returns the truthy value if `self < rhs` and the falsy value otherwise.
    #[inline]
    pub(crate) const fn lt(lhs: &Self, rhs: &Self) -> Choice {
        Uint::lt(&lhs.invert_msb().0, &rhs.invert_msb().0)
    }

    /// Returns the truthy value if `self > rhs` and the falsy value otherwise.
    #[inline]
    pub(crate) const fn gt(lhs: &Self, rhs: &Self) -> Choice {
        Uint::gt(&lhs.invert_msb().0, &rhs.invert_msb().0)
    }

    /// Returns the ordering between `self` and `rhs` as an i8.
    /// Values correspond to the Ordering enum:
    ///   -1 is Less
    ///   0 is Equal
    ///   1 is Greater
    #[inline]
    pub(crate) const fn cmp(lhs: &Self, rhs: &Self) -> Ordering {
        Uint::cmp(&lhs.invert_msb().0, &rhs.invert_msb().0)
    }

    /// Returns the Ordering between `self` and `rhs` in variable time.
    #[must_use]
    pub const fn cmp_vartime(&self, rhs: &Self) -> Ordering {
        self.invert_msb().0.cmp_vartime(&rhs.invert_msb().0)
    }
}

impl<const LIMBS: usize> Eq for Int<LIMBS> {}

impl<const LIMBS: usize> Ord for Int<LIMBS> {
    fn cmp(&self, other: &Self) -> Ordering {
        Self::cmp(self, other)
    }
}

impl<const LIMBS: usize> PartialOrd for Int<LIMBS> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl<const LIMBS: usize> PartialEq for Int<LIMBS> {
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).into()
    }
}

#[cfg(test)]
mod tests {
    use crate::I128;

    #[test]
    fn test_is_nonzero() {
        assert_eq!(I128::MAX.is_nonzero().to_u8(), 1u8);
        assert_eq!(I128::ONE.is_nonzero().to_u8(), 1u8);
        assert_eq!(I128::ZERO.is_nonzero().to_u8(), 0u8);
        assert_eq!(I128::MINUS_ONE.is_nonzero().to_u8(), 1u8);
        assert_eq!(I128::MAX.is_nonzero().to_u8(), 1u8);
    }

    #[test]
    fn test_eq() {
        assert_eq!(I128::ZERO, I128::ONE.wrapping_add(&I128::MINUS_ONE));
        assert_eq!(I128::ONE, I128::ZERO.wrapping_add(&I128::ONE));
        assert_ne!(I128::ONE, I128::ZERO);
    }

    #[test]
    #[allow(clippy::bool_assert_comparison)]
    fn test_gt() {
        // x > y
        assert!(I128::MAX > I128::ONE);
        assert!(I128::ONE > I128::ZERO);
        assert!(I128::ZERO > I128::MINUS_ONE);
        assert!(I128::MINUS_ONE > I128::MIN);
        assert!(I128::MAX > I128::MIN);

        // a !> a
        assert_ne!(true, I128::MAX > I128::MAX);
        assert_ne!(true, I128::ONE > I128::ONE);
        assert_ne!(true, I128::ZERO > I128::ZERO);
        assert_ne!(true, I128::MINUS_ONE > I128::MINUS_ONE);
        assert_ne!(true, I128::MIN > I128::MIN);
    }

    #[test]
    #[allow(clippy::bool_assert_comparison)]
    fn test_lt() {
        // x < y
        assert!(I128::ONE < I128::MAX);
        assert!(I128::ZERO < I128::ONE);
        assert!(I128::MINUS_ONE < I128::ZERO);
        assert!(I128::MIN < I128::MINUS_ONE);
        assert!(I128::MIN < I128::MAX);

        // a !< a
        assert_ne!(true, I128::MAX < I128::MAX);
        assert_ne!(true, I128::ONE < I128::ONE);
        assert_ne!(true, I128::ZERO < I128::ZERO);
        assert_ne!(true, I128::MINUS_ONE < I128::MINUS_ONE);
        assert_ne!(true, I128::MIN < I128::MIN);
    }
}
