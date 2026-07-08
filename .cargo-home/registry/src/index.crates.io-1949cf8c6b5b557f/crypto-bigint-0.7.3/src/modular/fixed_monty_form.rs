//! Implements `MontyForm`s, supporting modular arithmetic with a modulus set at runtime.

mod add;
mod ct;
pub(super) mod invert;
mod lincomb;
mod mod_symbol;
mod mul;
mod neg;
mod pow;
mod sub;

use super::{
    FixedMontyParams, Retrieve,
    const_monty_form::{ConstMontyForm, ConstMontyParams},
    div_by_2::div_by_2,
    mul::mul_montgomery_form,
    reduction::montgomery_retrieve,
};
use crate::{MontyForm, Odd, Uint, sealed::Sealed};
use mul::FixedMontyMultiplier;

/// An integer in Montgomery form represented using `LIMBS` limbs.
/// The odd modulus is set at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FixedMontyForm<const LIMBS: usize> {
    montgomery_form: Uint<LIMBS>,
    params: FixedMontyParams<LIMBS>,
}

impl<const LIMBS: usize> FixedMontyForm<LIMBS> {
    /// Instantiates a new `MontyForm` that represents this `integer` mod `MOD`.
    #[must_use]
    pub const fn new(integer: &Uint<LIMBS>, params: &FixedMontyParams<LIMBS>) -> Self {
        let montgomery_form =
            mul_montgomery_form(integer, &params.r2, &params.modulus, params.mod_neg_inv());
        Self {
            montgomery_form,
            params: *params,
        }
    }

    /// Retrieves the integer currently encoded in this `MontyForm`, guaranteed to be reduced.
    #[must_use]
    pub const fn retrieve(&self) -> Uint<LIMBS> {
        montgomery_retrieve(
            &self.montgomery_form,
            &self.params.modulus,
            self.params.mod_neg_inv(),
        )
    }

    /// Instantiates a new `MontyForm` that represents zero.
    #[must_use]
    pub const fn zero(params: &FixedMontyParams<LIMBS>) -> Self {
        Self {
            montgomery_form: Uint::<LIMBS>::ZERO,
            params: *params,
        }
    }

    /// Instantiates a new `MontyForm` that represents 1.
    #[must_use]
    pub const fn one(params: &FixedMontyParams<LIMBS>) -> Self {
        Self {
            montgomery_form: params.one,
            params: *params,
        }
    }

    /// Returns the parameter struct used to initialize this object.
    #[must_use]
    pub const fn params(&self) -> &FixedMontyParams<LIMBS> {
        &self.params
    }

    /// Access the `MontyForm` value in Montgomery form.
    #[must_use]
    pub const fn as_montgomery(&self) -> &Uint<LIMBS> {
        &self.montgomery_form
    }

    /// Mutably access the `MontyForm` value in Montgomery form.
    pub fn as_montgomery_mut(&mut self) -> &mut Uint<LIMBS> {
        &mut self.montgomery_form
    }

    /// Create a `MontyForm` from a value in Montgomery form.
    #[must_use]
    pub const fn from_montgomery(integer: Uint<LIMBS>, params: &FixedMontyParams<LIMBS>) -> Self {
        Self {
            montgomery_form: integer,
            params: *params,
        }
    }

    /// Extract the value from the `MontyForm` in Montgomery form.
    #[must_use]
    pub const fn to_montgomery(&self) -> Uint<LIMBS> {
        self.montgomery_form
    }

    /// Performs division by 2, that is returns `x` such that `x + x = self`.
    #[must_use]
    pub const fn div_by_2(&self) -> Self {
        Self {
            montgomery_form: div_by_2(&self.montgomery_form, &self.params.modulus),
            params: self.params,
        }
    }
}

impl<const LIMBS: usize> Retrieve for FixedMontyForm<LIMBS> {
    type Output = Uint<LIMBS>;
    fn retrieve(&self) -> Self::Output {
        self.retrieve()
    }
}

impl<const LIMBS: usize> MontyForm for FixedMontyForm<LIMBS> {
    type Integer = Uint<LIMBS>;
    type Params = FixedMontyParams<LIMBS>;
    type Multiplier<'a> = FixedMontyMultiplier<'a, LIMBS>;

    fn new_params_vartime(modulus: Odd<Self::Integer>) -> Self::Params {
        FixedMontyParams::new_vartime(modulus)
    }

    fn new(value: Self::Integer, params: &Self::Params) -> Self {
        FixedMontyForm::new(&value, params)
    }

    fn zero(params: &Self::Params) -> Self {
        FixedMontyForm::zero(params)
    }

    fn one(params: &Self::Params) -> Self {
        FixedMontyForm::one(params)
    }

    fn params(&self) -> &Self::Params {
        &self.params
    }

    fn as_montgomery(&self) -> &Self::Integer {
        &self.montgomery_form
    }

    fn into_montgomery(self) -> Self::Integer {
        self.montgomery_form
    }

    fn from_montgomery(integer: Self::Integer, params: &Self::Params) -> Self {
        FixedMontyForm::from_montgomery(integer, params)
    }

    fn copy_montgomery_from(&mut self, other: &Self) {
        debug_assert_eq!(self.params, other.params);
        self.montgomery_form = other.montgomery_form;
    }

    fn double(&self) -> Self {
        FixedMontyForm::double(self)
    }

    fn div_by_2(&self) -> Self {
        FixedMontyForm::div_by_2(self)
    }

    fn lincomb_vartime(products: &[(&Self, &Self)]) -> Self {
        FixedMontyForm::lincomb_vartime(products)
    }
}

impl<const LIMBS: usize> Sealed for FixedMontyForm<LIMBS> {}

impl<const LIMBS: usize, P: ConstMontyParams<LIMBS>> From<&ConstMontyForm<P, LIMBS>>
    for FixedMontyForm<LIMBS>
{
    fn from(const_monty_form: &ConstMontyForm<P, LIMBS>) -> Self {
        Self {
            montgomery_form: const_monty_form.to_montgomery(),
            params: P::PARAMS,
        }
    }
}

#[cfg(feature = "zeroize")]
impl<const LIMBS: usize> zeroize::Zeroize for FixedMontyForm<LIMBS> {
    fn zeroize(&mut self) {
        self.montgomery_form.zeroize();
        self.params.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::FixedMontyParams;
    use crate::{Limb, Odd, Uint};

    #[test]
    fn new_params_with_valid_modulus() {
        let modulus = Odd::new(Uint::from(3u8)).unwrap();
        let params = FixedMontyParams::<1>::new(modulus);

        assert_eq!(params.mod_leading_zeros, Limb::BITS - 2);
    }
}
