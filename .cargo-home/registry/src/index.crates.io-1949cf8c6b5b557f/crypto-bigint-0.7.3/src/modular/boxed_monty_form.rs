//! Implements heap-allocated `BoxedMontyForm`s, supporting modular arithmetic with a modulus set at runtime.

mod add;
mod ct;
mod from;
mod invert;
mod lincomb;
mod mul;
mod neg;
mod pow;
mod sub;

use super::{
    BoxedMontyParams, Retrieve, div_by_2, monty_params::MontyParams,
    reduction::montgomery_retrieve_inner,
};
use crate::{BoxedUint, Choice, MontyForm, Odd, sealed::Sealed};
use mul::BoxedMontyMultiplier;

#[cfg(feature = "zeroize")]
use zeroize::Zeroize;

/// An integer in Montgomery form represented using heap-allocated limbs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoxedMontyForm {
    /// Value in the Montgomery form.
    montgomery_form: BoxedUint,

    /// Montgomery form parameters.
    params: BoxedMontyParams,
}

impl BoxedMontyForm {
    /// Instantiates a new [`BoxedMontyForm`] that represents an integer modulo the provided params.
    #[must_use]
    pub fn new(mut integer: BoxedUint, params: &BoxedMontyParams) -> Self {
        debug_assert_eq!(integer.bits_precision(), params.bits_precision());
        convert_to_montgomery(&mut integer, params);

        Self {
            montgomery_form: integer,
            params: params.clone(),
        }
    }

    /// Bits of precision in the modulus.
    #[must_use]
    pub fn bits_precision(&self) -> u32 {
        self.params.bits_precision()
    }

    /// Retrieves the integer currently encoded in this [`BoxedMontyForm`], guaranteed to be reduced.
    #[must_use]
    pub fn retrieve(&self) -> BoxedUint {
        let mut out = BoxedUint::zero_with_precision(self.bits_precision());
        montgomery_retrieve_inner(
            &self.montgomery_form.limbs,
            &mut out.limbs,
            self.params.modulus().as_ref().as_limbs(),
            self.params.mod_neg_inv(),
        );
        out
    }

    /// Instantiates a new `ConstMontyForm` that represents zero.
    #[must_use]
    pub fn zero(params: &BoxedMontyParams) -> Self {
        Self {
            montgomery_form: BoxedUint::zero_with_precision(params.bits_precision()),
            params: params.clone(),
        }
    }

    /// Instantiates a new `ConstMontyForm` that represents 1.
    #[must_use]
    pub fn one(params: &BoxedMontyParams) -> Self {
        Self {
            montgomery_form: params.one().clone(),
            params: params.clone(),
        }
    }

    /// Determine if this value is equal to zero.
    ///
    /// # Returns
    ///
    /// If zero, returns `Choice(1)`. Otherwise, returns `Choice(0)`.
    #[must_use]
    pub fn is_zero(&self) -> Choice {
        self.montgomery_form.is_zero()
    }

    /// Determine if this value is not equal to zero.
    ///
    /// # Returns
    ///
    /// If zero, returns `Choice(0)`. Otherwise, returns `Choice(1)`.
    #[inline]
    #[must_use]
    pub fn is_nonzero(&self) -> Choice {
        !self.is_zero()
    }

    /// Returns the parameter struct used to initialize this object.
    #[must_use]
    pub fn params(&self) -> &BoxedMontyParams {
        &self.params
    }

    /// Access the [`BoxedMontyForm`] value in Montgomery form.
    #[must_use]
    pub fn as_montgomery(&self) -> &BoxedUint {
        debug_assert!(&self.montgomery_form < self.params.modulus());
        &self.montgomery_form
    }

    /// Mutably access the [`BoxedMontyForm`] value in Montgomery form.
    pub fn as_montgomery_mut(&mut self) -> &mut BoxedUint {
        &mut self.montgomery_form
    }

    /// Create a [`BoxedMontyForm`] from a value in Montgomery form.
    #[must_use]
    pub fn from_montgomery(integer: BoxedUint, params: &BoxedMontyParams) -> Self {
        debug_assert_eq!(integer.bits_precision(), params.bits_precision());
        Self {
            montgomery_form: integer,
            params: params.clone(),
        }
    }

    /// Extract the value from the [`BoxedMontyForm`] in Montgomery form.
    #[must_use]
    pub fn to_montgomery(&self) -> BoxedUint {
        debug_assert!(&self.montgomery_form < self.params.modulus());
        self.montgomery_form.clone()
    }

    /// Performs division by 2, that is returns `x` such that `x + x = self`.
    #[must_use]
    pub fn div_by_2(&self) -> Self {
        Self {
            montgomery_form: div_by_2::div_by_2_boxed(&self.montgomery_form, self.params.modulus()),
            params: self.params.clone(),
        }
    }

    /// Performs division by 2 inplace, that is finds `x` such that `x + x = self`
    /// and writes it into `self`.
    pub fn div_by_2_assign(&mut self) {
        div_by_2::div_by_2_boxed_assign(&mut self.montgomery_form, self.params.modulus());
    }
}

impl Retrieve for BoxedMontyForm {
    type Output = BoxedUint;
    fn retrieve(&self) -> BoxedUint {
        self.retrieve()
    }
}

impl MontyForm for BoxedMontyForm {
    type Integer = BoxedUint;
    type Params = BoxedMontyParams;
    type Multiplier<'a> = BoxedMontyMultiplier<'a>;

    fn new_params_vartime(modulus: Odd<Self::Integer>) -> Self::Params {
        BoxedMontyParams::new_vartime(modulus)
    }

    fn new(value: Self::Integer, params: &Self::Params) -> Self {
        BoxedMontyForm::new(value, params)
    }

    fn zero(params: &Self::Params) -> Self {
        BoxedMontyForm::zero(params)
    }

    fn one(params: &Self::Params) -> Self {
        BoxedMontyForm::one(params)
    }

    fn params(&self) -> &Self::Params {
        &self.params
    }

    fn as_montgomery(&self) -> &Self::Integer {
        &self.montgomery_form
    }

    fn copy_montgomery_from(&mut self, other: &Self) {
        debug_assert_eq!(
            self.montgomery_form.bits_precision(),
            other.montgomery_form.bits_precision()
        );
        debug_assert_eq!(self.params, other.params);
        self.montgomery_form
            .limbs
            .copy_from_slice(&other.montgomery_form.limbs);
    }

    fn from_montgomery(integer: Self::Integer, params: &Self::Params) -> Self {
        BoxedMontyForm::from_montgomery(integer, params)
    }

    fn into_montgomery(self) -> Self::Integer {
        self.montgomery_form
    }

    fn double(&self) -> Self {
        BoxedMontyForm::double(self)
    }

    fn div_by_2(&self) -> Self {
        BoxedMontyForm::div_by_2(self)
    }

    fn div_by_2_assign(&mut self) {
        BoxedMontyForm::div_by_2_assign(self);
    }

    fn lincomb_vartime(products: &[(&Self, &Self)]) -> Self {
        BoxedMontyForm::lincomb_vartime(products)
    }
}

impl Sealed for BoxedMontyForm {}

/// NOTE: This zeroizes the value, but _not_ the associated parameters!
#[cfg(feature = "zeroize")]
impl Zeroize for BoxedMontyForm {
    fn zeroize(&mut self) {
        self.montgomery_form.zeroize();
    }
}

/// Convert the given integer into the Montgomery domain.
#[inline]
fn convert_to_montgomery(integer: &mut BoxedUint, params: &BoxedMontyParams) {
    let mut mm = BoxedMontyMultiplier::from(params);
    mm.mul_assign(integer, params.r2());
}

#[cfg(test)]
mod tests {
    use super::{BoxedMontyForm, BoxedMontyParams};
    use crate::{BoxedUint, Limb, Odd};

    #[test]
    fn new_params_with_valid_modulus() {
        let modulus = Odd::new(BoxedUint::from(3u8)).unwrap();
        let params = BoxedMontyParams::new(modulus);

        assert_eq!(params.mod_leading_zeros(), Limb::BITS - 2);
    }

    #[test]
    fn div_by_2() {
        let modulus = Odd::new(BoxedUint::from(9u8)).unwrap();
        let params = BoxedMontyParams::new(modulus);
        let zero = BoxedMontyForm::zero(&params);
        let one = BoxedMontyForm::one(&params);
        let two = one.add(&one);

        assert_eq!(zero.div_by_2(), zero);
        assert_eq!(one.div_by_2().mul(&two), one);
    }

    #[test]
    fn as_montgomery_mut() {
        let modulus = Odd::new(BoxedUint::from(9u8)).unwrap();
        let params = BoxedMontyParams::new(modulus);
        let one = BoxedMontyForm::one(&params);
        let two = one.add(&one);
        let four = two.mul(&two);
        let mut x = two.clone();

        *x.as_montgomery_mut() = four.as_montgomery().clone();

        assert_eq!(x, four);
    }
}
