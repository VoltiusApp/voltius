//! Modular exponentiation support for [`BoxedMontyForm`].

use super::BoxedMontyForm;
use crate::{BoxedUint, PowBoundedExp, modular::pow::pow_montgomery_form_amm};

impl BoxedMontyForm {
    /// Raises to the `exponent` power.
    #[must_use]
    pub fn pow(&self, exponent: &BoxedUint) -> Self {
        self.pow_bounded_exp(exponent, exponent.bits_precision())
    }

    /// Raises to the `exponent` power,
    /// with `exponent_bits` representing the number of (least significant) bits
    /// to take into account for the exponent.
    ///
    /// NOTE: `exponent_bits` may be leaked in the time pattern.
    #[must_use]
    pub fn pow_bounded_exp(&self, exponent: &BoxedUint, exponent_bits: u32) -> Self {
        Self {
            montgomery_form: pow_montgomery_form_amm(
                &self.montgomery_form,
                exponent,
                exponent_bits,
                &self.params,
            ),
            params: self.params.clone(),
        }
    }
}

impl PowBoundedExp<BoxedUint> for BoxedMontyForm {
    fn pow_bounded_exp(&self, exponent: &BoxedUint, exponent_bits: u32) -> Self {
        self.pow_bounded_exp(exponent, exponent_bits)
    }
}
