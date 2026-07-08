//! Constant-time support: impls of `Ct*` traits and constant-time `const fn` operations.

use super::{ConstMontyForm, ConstMontyParams};
use crate::{Choice, CtAssign, CtEq};
use ctutils::{CtAssignSlice, CtEqSlice, CtSelectUsingCtAssign};

#[cfg(feature = "subtle")]
use crate::CtSelect;

impl<MOD, const LIMBS: usize> CtAssign for ConstMontyForm<MOD, LIMBS>
where
    MOD: ConstMontyParams<LIMBS>,
{
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.montgomery_form
            .ct_assign(&other.montgomery_form, choice);
    }
}
impl<MOD, const LIMBS: usize> CtAssignSlice for ConstMontyForm<MOD, LIMBS> where
    MOD: ConstMontyParams<LIMBS>
{
}

impl<MOD, const LIMBS: usize> CtEq for ConstMontyForm<MOD, LIMBS>
where
    MOD: ConstMontyParams<LIMBS>,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        CtEq::ct_eq(&self.montgomery_form, &other.montgomery_form)
    }
}
impl<MOD, const LIMBS: usize> CtEqSlice for ConstMontyForm<MOD, LIMBS> where
    MOD: ConstMontyParams<LIMBS>
{
}

impl<MOD, const LIMBS: usize> CtSelectUsingCtAssign for ConstMontyForm<MOD, LIMBS> where
    MOD: ConstMontyParams<LIMBS>
{
}

#[cfg(feature = "subtle")]
impl<MOD, const LIMBS: usize> subtle::ConstantTimeEq for ConstMontyForm<MOD, LIMBS>
where
    MOD: ConstMontyParams<LIMBS>,
{
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(&self.montgomery_form, &other.montgomery_form).into()
    }
}

#[cfg(feature = "subtle")]
impl<MOD, const LIMBS: usize> subtle::ConditionallySelectable for ConstMontyForm<MOD, LIMBS>
where
    MOD: ConstMontyParams<LIMBS> + Copy,
{
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        CtSelect::ct_select(a, b, choice.into())
    }
}
