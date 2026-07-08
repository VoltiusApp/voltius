//! Constant-time support: impls of `Ct*` traits and constant-time `const fn` operations.

use crate::{Choice, CtAssign, CtEq, modular::FixedMontyForm};
use ctutils::{CtAssignSlice, CtEqSlice, CtSelectUsingCtAssign};

#[cfg(feature = "subtle")]
use crate::CtSelect;

impl<const LIMBS: usize> CtAssign for FixedMontyForm<LIMBS> {
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.montgomery_form
            .ct_assign(&other.montgomery_form, choice);
        self.params.ct_assign(&other.params, choice);
    }
}
impl<const LIMBS: usize> CtAssignSlice for FixedMontyForm<LIMBS> {}
impl<const LIMBS: usize> CtSelectUsingCtAssign for FixedMontyForm<LIMBS> {}

impl<const LIMBS: usize> CtEq for FixedMontyForm<LIMBS> {
    fn ct_eq(&self, other: &Self) -> Choice {
        self.montgomery_form.ct_eq(&other.montgomery_form) & self.params.ct_eq(&other.params)
    }
}
impl<const LIMBS: usize> CtEqSlice for FixedMontyForm<LIMBS> {}

#[cfg(feature = "subtle")]
impl<const LIMBS: usize> subtle::ConstantTimeEq for FixedMontyForm<LIMBS> {
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, other).into()
    }
}

#[cfg(feature = "subtle")]
impl<const LIMBS: usize> subtle::ConditionallySelectable for FixedMontyForm<LIMBS> {
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        a.ct_select(b, choice.into())
    }
}
