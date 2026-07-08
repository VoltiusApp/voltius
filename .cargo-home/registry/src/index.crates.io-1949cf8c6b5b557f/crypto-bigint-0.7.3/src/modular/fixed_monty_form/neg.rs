//! Negations of integers in Montgomery form with a modulus set at runtime.

use super::FixedMontyForm;
use core::ops::Neg;

impl<const LIMBS: usize> FixedMontyForm<LIMBS> {
    /// Negates the number.
    #[must_use]
    pub const fn neg(&self) -> Self {
        Self {
            montgomery_form: self
                .montgomery_form
                .neg_mod(self.params.modulus.as_nz_ref()),
            params: self.params,
        }
    }
}

impl<const LIMBS: usize> Neg for FixedMontyForm<LIMBS> {
    type Output = Self;
    fn neg(self) -> Self {
        FixedMontyForm::neg(&self)
    }
}

impl<const LIMBS: usize> Neg for &FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    fn neg(self) -> FixedMontyForm<LIMBS> {
        FixedMontyForm::neg(self)
    }
}
