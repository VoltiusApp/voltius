//! Constant-time support: impls of `Ct*` traits and constant-time `const fn` operations.

use crate::{Choice, CtAssign, CtEq, CtGt, CtLt, CtSelect, Limb, word};
use ctutils::{CtAssignSlice, CtEqSlice};

impl Limb {
    /// Return `b` if `c` is truthy, otherwise return `a`.
    #[inline]
    pub(crate) const fn select(a: Self, b: Self, c: Choice) -> Self {
        Self(word::select(a.0, b.0, c))
    }

    /// Swap the values of `a` and `b` if `c` is truthy, otherwise do nothing.
    #[inline]
    pub(crate) const fn ct_conditional_swap(a: &mut Self, b: &mut Self, c: Choice) {
        (*a, *b) = (
            Self(word::select(a.0, b.0, c)),
            Self(word::select(b.0, a.0, c)),
        );
    }
}

impl CtAssign for Limb {
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.0.ct_assign(&other.0, choice);
    }
}

impl CtAssignSlice for Limb {
    fn ct_assign_slice(dst: &mut [Self], src: &[Self], choice: Choice) {
        Self::slice_as_mut_words(dst).ct_assign(Self::slice_as_words(src), choice);
    }
}

impl CtEq for Limb {
    #[inline]
    fn ct_eq(&self, other: &Self) -> Choice {
        CtEq::ct_eq(&self.0, &other.0)
    }

    #[inline]
    fn ct_ne(&self, other: &Self) -> Choice {
        CtEq::ct_ne(&self.0, &other.0)
    }
}

impl CtEqSlice for Limb {
    fn ct_eq_slice(a: &[Self], b: &[Self]) -> Choice {
        Self::slice_as_words(a).ct_eq(Self::slice_as_words(b))
    }
}

impl CtGt for Limb {
    #[inline]
    fn ct_gt(&self, other: &Self) -> Choice {
        word::choice_from_gt(self.0, other.0)
    }
}

impl CtLt for Limb {
    #[inline]
    fn ct_lt(&self, other: &Self) -> Choice {
        word::choice_from_lt(self.0, other.0)
    }
}

impl CtSelect for Limb {
    #[inline]
    fn ct_select(&self, other: &Self, choice: Choice) -> Self {
        Self(self.0.ct_select(&other.0, choice))
    }
}

#[cfg(feature = "subtle")]
impl subtle::ConditionallySelectable for Limb {
    #[inline]
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        a.ct_select(b, choice.into())
    }
}

#[cfg(feature = "subtle")]
impl subtle::ConstantTimeEq for Limb {
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
impl subtle::ConstantTimeGreater for Limb {
    #[inline]
    fn ct_gt(&self, other: &Self) -> subtle::Choice {
        CtGt::ct_gt(self, other).into()
    }
}

#[cfg(feature = "subtle")]
impl subtle::ConstantTimeLess for Limb {
    #[inline]
    fn ct_lt(&self, other: &Self) -> subtle::Choice {
        CtLt::ct_lt(self, other).into()
    }
}

#[cfg(test)]
mod tests {
    use crate::{CtEq, CtGt, CtLt, Limb};

    #[test]
    fn ct_eq() {
        let a = Limb::ZERO;
        let b = Limb::MAX;

        assert!(a.ct_eq(&a).to_bool());
        assert!(!a.ct_eq(&b).to_bool());
        assert!(!b.ct_eq(&a).to_bool());
        assert!(b.ct_eq(&b).to_bool());
    }

    #[test]
    fn ct_gt() {
        let a = Limb::ZERO;
        let b = Limb::ONE;
        let c = Limb::MAX;

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
        let a = Limb::ZERO;
        let b = Limb::ONE;
        let c = Limb::MAX;

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
}
