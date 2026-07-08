//! Constant-time support: impls of `Ct*` traits.

use super::{BoxedMontyForm, BoxedMontyParams};
use crate::{Choice, CtAssign, CtEq, CtSelect};
use ctutils::{CtAssignSlice, CtEqSlice, CtSelectUsingCtAssign};

impl CtAssign for BoxedMontyForm {
    #[inline]
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.montgomery_form
            .ct_assign(&other.montgomery_form, choice);
        self.params.ct_assign(&other.params, choice);
    }
}
impl CtAssignSlice for BoxedMontyForm {}

impl CtEq for BoxedMontyForm {
    fn ct_eq(&self, other: &Self) -> Choice {
        self.montgomery_form.ct_eq(&other.montgomery_form) & self.params.ct_eq(&other.params)
    }
}
impl CtEqSlice for BoxedMontyForm {}

impl CtSelectUsingCtAssign for BoxedMontyForm {}

impl CtAssign for BoxedMontyParams {
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        *self = self.ct_select(other, choice);
    }
}

impl CtEq for BoxedMontyParams {
    fn ct_eq(&self, other: &Self) -> Choice {
        self.modulus().ct_eq(other.modulus())
            & self.one().ct_eq(other.one())
            & self.r2().ct_eq(other.r2())
            & self.mod_inv().ct_eq(&other.mod_inv())
    }
}
impl CtEqSlice for BoxedMontyParams {}

impl CtSelect for BoxedMontyParams {
    fn ct_select(&self, other: &Self, choice: Choice) -> Self {
        self.as_ref().ct_select(other.as_ref(), choice).into()
    }
}
