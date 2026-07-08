//! Multiplication between boxed integers in Montgomery form (i.e. Montgomery multiplication).
//!
//! Some parts adapted from `monty.rs` in `num-bigint`:
//! <https://github.com/rust-num/num-bigint/blob/2cea7f4/src/biguint/monty.rs>
//!
//! Originally (c) 2014 The Rust Project Developers, dual licensed Apache 2.0+MIT.

use super::{BoxedMontyForm, BoxedMontyParams};
use crate::{
    AmmMultiplier, BoxedUint, Limb, MontyMultiplier, Mul, MulAssign, Square, SquareAssign, Zero,
    modular::mul::{almost_montgomery_mul, montgomery_multiply_inner},
};

#[cfg(feature = "zeroize")]
use zeroize::Zeroize;

impl BoxedMontyForm {
    /// Multiplies by `rhs`.
    #[must_use]
    pub fn mul(&self, rhs: &Self) -> Self {
        debug_assert_eq!(&self.params, &rhs.params);
        let mut out = BoxedUint::zero_with_precision(self.bits_precision());
        montgomery_mul(
            &self.montgomery_form,
            &rhs.montgomery_form,
            &mut out,
            self.params.modulus(),
            self.params.mod_neg_inv(),
        );
        Self {
            montgomery_form: out,
            params: self.params.clone(),
        }
    }

    /// Computes the (reduced) square.
    #[must_use]
    pub fn square(&self) -> Self {
        let mut out = BoxedUint::zero_with_precision(self.bits_precision());
        montgomery_mul(
            &self.montgomery_form,
            &self.montgomery_form,
            &mut out,
            self.params.modulus(),
            self.params.mod_neg_inv(),
        );
        Self {
            montgomery_form: out,
            params: self.params.clone(),
        }
    }
}

impl Mul<&BoxedMontyForm> for &BoxedMontyForm {
    type Output = BoxedMontyForm;
    fn mul(self, rhs: &BoxedMontyForm) -> BoxedMontyForm {
        self.mul(rhs)
    }
}

impl Mul<BoxedMontyForm> for &BoxedMontyForm {
    type Output = BoxedMontyForm;
    #[allow(clippy::op_ref)]
    fn mul(self, rhs: BoxedMontyForm) -> BoxedMontyForm {
        self * &rhs
    }
}

impl Mul<&BoxedMontyForm> for BoxedMontyForm {
    type Output = BoxedMontyForm;
    #[allow(clippy::op_ref)]
    fn mul(self, rhs: &BoxedMontyForm) -> BoxedMontyForm {
        &self * rhs
    }
}

impl Mul<BoxedMontyForm> for BoxedMontyForm {
    type Output = BoxedMontyForm;
    fn mul(self, rhs: BoxedMontyForm) -> BoxedMontyForm {
        &self * &rhs
    }
}

impl MulAssign<BoxedMontyForm> for BoxedMontyForm {
    fn mul_assign(&mut self, rhs: BoxedMontyForm) {
        Self::mul_assign(self, &rhs);
    }
}

impl MulAssign<&BoxedMontyForm> for BoxedMontyForm {
    fn mul_assign(&mut self, rhs: &BoxedMontyForm) {
        *self = Self::mul(self, rhs);
    }
}

impl Square for BoxedMontyForm {
    fn square(&self) -> Self {
        BoxedMontyForm::square(self)
    }
}

impl SquareAssign for BoxedMontyForm {
    fn square_assign(&mut self) {
        *self = Self::square(self);
    }
}

/// Montgomery multiplier with a pre-allocated internal buffer to avoid additional allocations.
#[derive(Debug, Clone)]
pub struct BoxedMontyMultiplier<'a> {
    product: BoxedUint,
    modulus: &'a BoxedUint,
    mod_neg_inv: Limb,
}

impl<'a> From<&'a BoxedMontyParams> for BoxedMontyMultiplier<'a> {
    #[inline]
    fn from(params: &'a BoxedMontyParams) -> BoxedMontyMultiplier<'a> {
        BoxedMontyMultiplier::new(params.modulus(), params.mod_neg_inv())
    }
}

impl<'a> MontyMultiplier<'a> for BoxedMontyMultiplier<'a> {
    type Monty = BoxedMontyForm;

    /// Performs a Montgomery multiplication, assigning a fully reduced result to `lhs`.
    #[inline]
    fn mul_assign(&mut self, lhs: &mut BoxedMontyForm, rhs: &BoxedMontyForm) {
        self.mul_assign(&mut lhs.montgomery_form, &rhs.montgomery_form);
    }

    /// Performs a Montgomery squaring, assigning a fully reduced result to `lhs`.
    #[inline]
    fn square_assign(&mut self, lhs: &mut BoxedMontyForm) {
        self.square_assign(&mut lhs.montgomery_form);
    }
}

impl<'a> AmmMultiplier<'a> for BoxedMontyMultiplier<'a> {
    #[inline]
    fn mul_amm_assign(&mut self, a: &mut BoxedUint, b: &BoxedUint) {
        self.mul_amm_assign(a, b);
    }

    #[inline]
    fn square_amm_assign(&mut self, a: &mut BoxedUint) {
        self.square_amm_assign(a);
    }
}

impl<'a> BoxedMontyMultiplier<'a> {
    /// Create a new Montgomery multiplier.
    pub(super) fn new(modulus: &'a BoxedUint, mod_neg_inv: Limb) -> Self {
        Self {
            product: BoxedUint::zero_with_precision(modulus.bits_precision()),
            modulus,
            mod_neg_inv,
        }
    }

    /// Perform a Montgomery multiplication, assigning a fully reduced result to `a`.
    pub(super) fn mul_assign(&mut self, a: &mut BoxedUint, b: &BoxedUint) {
        debug_assert_eq!(a.bits_precision(), self.modulus.bits_precision());
        debug_assert_eq!(b.bits_precision(), self.modulus.bits_precision());

        self.product.set_zero();
        montgomery_mul(a, b, &mut self.product, self.modulus, self.mod_neg_inv);
        a.limbs.copy_from_slice(&self.product.limbs);
        debug_assert!(*a < self.modulus);
    }

    /// Perform a squaring using Montgomery multiplication, assigning a fully reduced result to `a`.
    pub(super) fn square_assign(&mut self, a: &mut BoxedUint) {
        debug_assert_eq!(a.bits_precision(), self.modulus.bits_precision());

        self.product.set_zero();
        montgomery_mul(a, a, &mut self.product, self.modulus, self.mod_neg_inv);
        a.limbs.copy_from_slice(&self.product.limbs);

        debug_assert!(*a < self.modulus);
    }

    /// Perform an "Almost Montgomery Multiplication", assigning the product to `a`.
    ///
    /// NOTE: the resulting output will be reduced to the *bit length* of the modulus, but not fully reduced and may
    /// exceed the modulus. A final reduction is required to ensure AMM results are fully reduced, and should not be
    /// exposed outside the internals of this crate.
    pub(super) fn mul_amm_assign(&mut self, a: &mut BoxedUint, b: &BoxedUint) {
        debug_assert_eq!(a.bits_precision(), self.modulus.bits_precision());
        debug_assert_eq!(b.bits_precision(), self.modulus.bits_precision());

        self.product.set_zero();
        almost_montgomery_mul(
            a.as_uint_ref(),
            b.as_uint_ref(),
            self.product.as_mut_uint_ref(),
            self.modulus.as_uint_ref(),
            self.mod_neg_inv,
        );
        a.limbs.copy_from_slice(&self.product.limbs);
    }

    /// Perform a squaring using "Almost Montgomery Multiplication", assigning the result to `a`.
    ///
    /// NOTE: the resulting output will be reduced to the *bit length* of the modulus, but not fully reduced and may
    /// exceed the modulus. A final reduction is required to ensure AMM results are fully reduced, and should not be
    /// exposed outside the internals of this crate.
    pub(super) fn square_amm_assign(&mut self, a: &mut BoxedUint) {
        debug_assert_eq!(a.bits_precision(), self.modulus.bits_precision());

        // TODO(tarcieri): optimized implementation
        self.product.set_zero();
        almost_montgomery_mul(
            a.as_uint_ref(),
            a.as_uint_ref(),
            self.product.as_mut_uint_ref(),
            self.modulus.as_uint_ref(),
            self.mod_neg_inv,
        );
        a.limbs.copy_from_slice(&self.product.limbs);
    }
}

#[cfg(feature = "zeroize")]
impl Drop for BoxedMontyMultiplier<'_> {
    fn drop(&mut self) {
        self.product.zeroize();
    }
}

/// Computes Montgomery multiplication of `x` and `y` into `out`, that is
/// `out = x * y * 2^(-n*W) mod m` assuming `k = -1/m mod 2^W`,
/// where `W` is the bit size of the limb, and `n * W` is the full bit size of the integer.
///
/// NOTE: `out` is assumed to be pre-zeroized.
#[inline]
pub(crate) fn montgomery_mul(
    x: &BoxedUint,
    y: &BoxedUint,
    out: &mut BoxedUint,
    modulus: &BoxedUint,
    mod_neg_inv: Limb,
) {
    let carry = montgomery_multiply_inner(
        x.as_limbs(),
        y.as_limbs(),
        out.as_mut_limbs(),
        modulus.as_limbs(),
        mod_neg_inv,
    );
    out.sub_assign_mod_with_carry(carry, modulus, modulus);
}

#[cfg(test)]
mod tests {
    use super::{BoxedMontyForm, BoxedMontyParams, BoxedUint};
    use crate::SquareAssign;

    /// Regression test for RustCrypto/crypto-bigint#441
    #[test]
    fn square() {
        let x = 0x20u128;
        let modulus = 0xB44677037A7DBDE04814256570DCBD8Du128;

        let boxed_modulus = BoxedUint::from(modulus);
        let boxed_params = BoxedMontyParams::new(boxed_modulus.to_odd().unwrap());
        let boxed_monty = BoxedMontyForm::new(BoxedUint::from(x), &boxed_params);
        let boxed_square = boxed_monty.square();

        // TODO(tarcieri): test for correct output
        assert!(boxed_square.as_montgomery() < boxed_square.params().modulus());

        // Check mul_assign
        let mut boxed_mut = boxed_monty.clone();
        boxed_mut *= &boxed_monty;
        assert_eq!(boxed_mut, boxed_square);

        // Check square_assign
        let mut boxed_mut = boxed_monty.clone();
        boxed_mut.square_assign();
        assert_eq!(boxed_mut, boxed_square);
    }
}
