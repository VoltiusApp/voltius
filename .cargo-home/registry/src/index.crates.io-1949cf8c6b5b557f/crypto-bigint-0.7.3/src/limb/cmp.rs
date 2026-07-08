//! Limb comparisons

use crate::{Choice, CtAssign, CtEq, CtGt, CtLt, Limb, word};
use core::cmp::Ordering;

impl Limb {
    /// Is this limb an odd number?
    #[inline]
    #[must_use]
    pub fn is_odd(self) -> Choice {
        word::choice_from_lsb(self.0 & 1)
    }

    /// Perform a comparison of the inner value in variable-time.
    ///
    /// Note that the [`PartialOrd`] and [`Ord`] impls wrap constant-time
    /// comparisons using the `subtle` crate.
    #[must_use]
    pub fn cmp_vartime(self, other: Self) -> Ordering {
        self.0.cmp(&other.0)
    }

    /// Performs an equality check in variable-time.
    #[must_use]
    pub const fn eq_vartime(self, other: Self) -> bool {
        self.0 == other.0
    }

    /// Returns the truthy value if `self != 0` and the falsy value otherwise.
    #[inline]
    pub(crate) const fn is_nonzero(self) -> Choice {
        word::choice_from_nz(self.0)
    }
}

impl Eq for Limb {}

impl Ord for Limb {
    fn cmp(&self, other: &Self) -> Ordering {
        let mut ret = Ordering::Less;
        ret.ct_assign(&Ordering::Equal, self.ct_eq(other));
        ret.ct_assign(&Ordering::Greater, self.ct_gt(other));
        debug_assert_eq!(ret == Ordering::Less, bool::from(self.ct_lt(other)));
        ret
    }
}

impl PartialOrd for Limb {
    #[inline]
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Limb {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).into()
    }
}

#[cfg(test)]
mod tests {
    use crate::{Choice, Limb};
    use core::cmp::Ordering;

    #[test]
    fn is_zero() {
        assert!(bool::from(Limb::ZERO.is_zero()));
        assert!(!bool::from(Limb::ONE.is_zero()));
        assert!(!bool::from(Limb::MAX.is_zero()));
    }

    #[test]
    fn is_odd() {
        assert!(!bool::from(Limb::ZERO.is_odd()));
        assert!(bool::from(Limb::ONE.is_odd()));
        assert!(bool::from(Limb::MAX.is_odd()));
    }

    #[test]
    fn cmp() {
        assert_eq!(Limb::ZERO.cmp(&Limb::ONE), Ordering::Less);
        assert_eq!(Limb::ONE.cmp(&Limb::ONE), Ordering::Equal);
        assert_eq!(Limb::MAX.cmp(&Limb::ONE), Ordering::Greater);
    }

    #[test]
    fn ct_conditional_swap() {
        let mut a = Limb::MAX;
        let mut b = Limb::ZERO;

        Limb::ct_conditional_swap(&mut a, &mut b, Choice::FALSE);
        assert_eq!(a, Limb::MAX);
        assert_eq!(b, Limb::ZERO);

        Limb::ct_conditional_swap(&mut a, &mut b, Choice::TRUE);
        assert_eq!(a, Limb::ZERO);
        assert_eq!(b, Limb::MAX);
    }
}
