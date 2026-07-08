//! Constant-time support: impls of `Ct*` traits and constant-time `const fn` operations.

use crate::{Choice, CtAssign, CtEq, CtGt, CtLt, CtSelect, Limb, Uint, UintRef};
use ctutils::{CtAssignSlice, CtEqSlice};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Return `b` if `c` is truthy, otherwise return `a`.
    #[inline]
    pub(crate) const fn select(a: &Self, b: &Self, c: Choice) -> Self {
        let mut limbs = [Limb::ZERO; LIMBS];

        let mut i = 0;
        while i < LIMBS {
            limbs[i] = Limb::select(a.limbs[i], b.limbs[i], c);
            i += 1;
        }

        Uint { limbs }
    }

    /// Swap `a` and `b` if `c` is truthy, otherwise, do nothing.
    #[inline]
    pub(crate) const fn conditional_swap(a: &mut Self, b: &mut Self, c: Choice) {
        let mut i = 0;
        let a = a.as_mut_limbs();
        let b = b.as_mut_limbs();
        while i < LIMBS {
            Limb::ct_conditional_swap(&mut a[i], &mut b[i], c);
            i += 1;
        }
    }

    /// Swap `a` and `b`
    #[inline]
    pub(crate) const fn swap(a: &mut Self, b: &mut Self) {
        Self::conditional_swap(a, b, Choice::TRUE);
    }
}

impl<const LIMBS: usize> CtAssign for Uint<LIMBS> {
    #[inline]
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.limbs.ct_assign(&other.limbs, choice);
    }
}
impl<const LIMBS: usize> CtAssignSlice for Uint<LIMBS> {}

impl<const LIMBS: usize, Rhs: AsRef<UintRef> + ?Sized> CtEq<Rhs> for Uint<LIMBS> {
    #[inline]
    fn ct_eq(&self, other: &Rhs) -> Choice {
        self.as_uint_ref().ct_eq(other)
    }
}
impl<const LIMBS: usize> CtEqSlice for Uint<LIMBS> {}

impl<const LIMBS: usize> CtGt for Uint<LIMBS> {
    #[inline]
    fn ct_gt(&self, other: &Self) -> Choice {
        Self::gt(self, other)
    }
}

impl<const LIMBS: usize> CtLt for Uint<LIMBS> {
    #[inline]
    fn ct_lt(&self, other: &Self) -> Choice {
        Self::lt(self, other)
    }
}

impl<const LIMBS: usize> CtSelect for Uint<LIMBS> {
    #[inline]
    fn ct_select(&self, other: &Self, choice: Choice) -> Self {
        Self::from_words(self.as_words().ct_select(other.as_words(), choice))
    }
}

#[cfg(feature = "subtle")]
impl<const LIMBS: usize> subtle::ConditionallySelectable for Uint<LIMBS> {
    #[inline]
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        a.ct_select(b, choice.into())
    }
}

#[cfg(feature = "subtle")]
impl<const LIMBS: usize> subtle::ConstantTimeEq for Uint<LIMBS> {
    #[inline]
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, other).into()
    }

    #[inline]
    fn ct_ne(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_ne(self, other).into()
    }
}

#[cfg(feature = "subtle")]
impl<const LIMBS: usize> subtle::ConstantTimeGreater for Uint<LIMBS> {
    #[inline]
    fn ct_gt(&self, other: &Self) -> subtle::Choice {
        CtGt::ct_gt(self, other).into()
    }
}

#[cfg(feature = "subtle")]
impl<const LIMBS: usize> subtle::ConstantTimeLess for Uint<LIMBS> {
    #[inline]
    fn ct_lt(&self, other: &Self) -> subtle::Choice {
        Uint::lt(self, other).into()
    }
}

#[cfg(test)]
mod tests {
    use crate::{Choice, CtEq, CtGt, CtLt, CtSelect, U128};

    #[test]
    fn ct_eq() {
        let a = U128::ZERO;
        let b = U128::MAX;

        assert!(a.ct_eq(&a).to_bool());
        assert!(!a.ct_eq(&b).to_bool());
        assert!(!b.ct_eq(&a).to_bool());
        assert!(b.ct_eq(&b).to_bool());
    }

    #[test]
    fn ct_gt() {
        let a = U128::ZERO;
        let b = U128::ONE;
        let c = U128::MAX;

        assert!(b.ct_gt(&a).to_bool());
        assert!(c.ct_gt(&a).to_bool());
        assert!(c.ct_gt(&b).to_bool());

        assert!(!a.ct_gt(&a).to_bool());
        assert!(!b.ct_gt(&b).to_bool());
        assert!(!c.ct_gt(&c).to_bool());

        assert!(!a.ct_gt(&b).to_bool());
        assert!(!a.ct_gt(&c).to_bool());
        assert!(!b.ct_gt(&c).to_bool());
    }

    #[test]
    fn ct_lt() {
        let a = U128::ZERO;
        let b = U128::ONE;
        let c = U128::MAX;

        assert!(a.ct_lt(&b).to_bool());
        assert!(a.ct_lt(&c).to_bool());
        assert!(b.ct_lt(&c).to_bool());

        assert!(!a.ct_lt(&a).to_bool());
        assert!(!b.ct_lt(&b).to_bool());
        assert!(!c.ct_lt(&c).to_bool());

        assert!(!b.ct_lt(&a).to_bool());
        assert!(!c.ct_lt(&a).to_bool());
        assert!(!c.ct_lt(&b).to_bool());
    }

    #[test]
    fn ct_select() {
        let a = U128::from_be_hex("00002222444466668888AAAACCCCEEEE");
        let b = U128::from_be_hex("11113333555577779999BBBBDDDDFFFF");

        let select_0 = U128::ct_select(&a, &b, Choice::FALSE);
        assert_eq!(a, select_0);

        let select_1 = U128::ct_select(&a, &b, Choice::TRUE);
        assert_eq!(b, select_1);
    }
}
