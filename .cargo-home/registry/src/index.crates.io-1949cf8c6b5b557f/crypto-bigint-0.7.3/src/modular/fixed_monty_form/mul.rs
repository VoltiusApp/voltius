//! Multiplications between integers in Montgomery form with a modulus set at runtime.

use super::FixedMontyForm;
use crate::modular::mul::almost_montgomery_mul;
use crate::prelude::AmmMultiplier;
use crate::{
    MontyMultiplier, Square, SquareAssign, Uint,
    modular::{
        FixedMontyParams,
        mul::{mul_montgomery_form, square_montgomery_form, square_repeat_montgomery_form},
    },
};
use core::ops::{Mul, MulAssign};

impl<const LIMBS: usize> FixedMontyForm<LIMBS> {
    /// Multiplies by `rhs`.
    #[must_use]
    pub const fn mul(&self, rhs: &Self) -> Self {
        Self {
            montgomery_form: mul_montgomery_form(
                &self.montgomery_form,
                &rhs.montgomery_form,
                &self.params.modulus,
                self.params.mod_neg_inv(),
            ),
            params: self.params,
        }
    }

    /// Computes the (reduced) square.
    #[must_use]
    pub const fn square(&self) -> Self {
        Self {
            montgomery_form: square_montgomery_form(
                &self.montgomery_form,
                &self.params.modulus,
                self.params.mod_neg_inv(),
            ),
            params: self.params,
        }
    }

    /// Computes the reduced product `self^2n`.
    ///
    /// This method is variable time in `n` only.
    #[must_use]
    pub const fn square_repeat_vartime(&self, n: u32) -> Self {
        Self {
            montgomery_form: square_repeat_montgomery_form::<LIMBS>(
                &self.montgomery_form,
                n,
                &self.params.modulus,
                self.params.mod_neg_inv(),
            ),
            params: self.params,
        }
    }
}

impl<const LIMBS: usize> Mul<&FixedMontyForm<LIMBS>> for &FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    fn mul(self, rhs: &FixedMontyForm<LIMBS>) -> FixedMontyForm<LIMBS> {
        debug_assert_eq!(self.params, rhs.params);
        self.mul(rhs)
    }
}

impl<const LIMBS: usize> Mul<FixedMontyForm<LIMBS>> for &FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    #[allow(clippy::op_ref)]
    fn mul(self, rhs: FixedMontyForm<LIMBS>) -> FixedMontyForm<LIMBS> {
        self * &rhs
    }
}

impl<const LIMBS: usize> Mul<&FixedMontyForm<LIMBS>> for FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    #[allow(clippy::op_ref)]
    fn mul(self, rhs: &FixedMontyForm<LIMBS>) -> FixedMontyForm<LIMBS> {
        &self * rhs
    }
}

impl<const LIMBS: usize> Mul<FixedMontyForm<LIMBS>> for FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    fn mul(self, rhs: FixedMontyForm<LIMBS>) -> FixedMontyForm<LIMBS> {
        &self * &rhs
    }
}

impl<const LIMBS: usize> MulAssign<&FixedMontyForm<LIMBS>> for FixedMontyForm<LIMBS> {
    fn mul_assign(&mut self, rhs: &FixedMontyForm<LIMBS>) {
        *self = *self * rhs;
    }
}

impl<const LIMBS: usize> MulAssign<FixedMontyForm<LIMBS>> for FixedMontyForm<LIMBS> {
    fn mul_assign(&mut self, rhs: FixedMontyForm<LIMBS>) {
        *self *= &rhs;
    }
}

impl<const LIMBS: usize> Square for FixedMontyForm<LIMBS> {
    fn square(&self) -> Self {
        FixedMontyForm::square(self)
    }
}

impl<const LIMBS: usize> SquareAssign for FixedMontyForm<LIMBS> {
    fn square_assign(&mut self) {
        *self = self.square();
    }
}

#[derive(Debug, Clone, Copy)]
pub struct FixedMontyMultiplier<'a, const LIMBS: usize>(&'a FixedMontyParams<LIMBS>);

impl<'a, const LIMBS: usize> From<&'a FixedMontyParams<LIMBS>> for FixedMontyMultiplier<'a, LIMBS> {
    fn from(source: &'a FixedMontyParams<LIMBS>) -> Self {
        Self(source)
    }
}

impl<'a, const LIMBS: usize> MontyMultiplier<'a> for FixedMontyMultiplier<'a, LIMBS> {
    type Monty = FixedMontyForm<LIMBS>;

    /// Performs a Montgomery multiplication, assigning a fully reduced result to `lhs`.
    fn mul_assign(&mut self, lhs: &mut Self::Monty, rhs: &Self::Monty) {
        let product = mul_montgomery_form(
            &lhs.montgomery_form,
            &rhs.montgomery_form,
            &self.0.modulus,
            self.0.mod_neg_inv(),
        );
        lhs.montgomery_form = product;
    }

    /// Performs a Montgomery squaring, assigning a fully reduced result to `lhs`.
    fn square_assign(&mut self, lhs: &mut Self::Monty) {
        let product =
            square_montgomery_form(&lhs.montgomery_form, &self.0.modulus, self.0.mod_neg_inv());
        lhs.montgomery_form = product;
    }
}

impl<'a, const LIMBS: usize> AmmMultiplier<'a> for FixedMontyMultiplier<'a, LIMBS> {
    /// Perform an "Almost Montgomery Multiplication", assigning the product to `a`.
    ///
    /// NOTE: the resulting output will be reduced to the *bit length* of the modulus, but not fully reduced and may
    /// exceed the modulus. A final reduction is required to ensure AMM results are fully reduced, and should not be
    /// exposed outside the internals of this crate.
    fn mul_amm_assign(&mut self, a: &mut Uint<LIMBS>, b: &Uint<LIMBS>) {
        let mut product = Uint::<LIMBS>::ZERO;
        almost_montgomery_mul(
            a.as_uint_ref(),
            b.as_uint_ref(),
            product.as_mut_uint_ref(),
            self.0.modulus().as_uint_ref(),
            self.0.mod_neg_inv(),
        );
        a.limbs.copy_from_slice(&product.limbs);
    }

    /// Perform a squaring using "Almost Montgomery Multiplication", assigning the result to `a`.
    ///
    /// NOTE: the resulting output will be reduced to the *bit length* of the modulus, but not fully reduced and may
    /// exceed the modulus. A final reduction is required to ensure AMM results are fully reduced, and should not be
    /// exposed outside the internals of this crate.
    fn square_amm_assign(&mut self, a: &mut Uint<LIMBS>) {
        let mut product = Uint::<LIMBS>::ZERO;
        almost_montgomery_mul(
            a.as_uint_ref(),
            a.as_uint_ref(),
            product.as_mut_uint_ref(),
            self.0.modulus().as_uint_ref(),
            self.0.mod_neg_inv(),
        );
        a.limbs.copy_from_slice(&product.limbs);
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        Odd, U256,
        modular::{FixedMontyForm, FixedMontyParams},
    };

    const PARAMS: FixedMontyParams<{ U256::LIMBS }> =
        FixedMontyParams::new_vartime(Odd::<U256>::from_be_hex(
            "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
        ));
    const N: U256 =
        U256::from_be_hex("14117F1273373C26C700D076B3F780074D03339F56DD0EFB60E7F58441FD3685");
    const N_MOD: FixedMontyForm<{ U256::LIMBS }> = FixedMontyForm::new(&N, &PARAMS);

    #[test]
    fn test_mul_zero() {
        let res = N_MOD.mul(&FixedMontyForm::zero(&PARAMS));
        let expected = U256::ZERO;
        assert_eq!(res.retrieve(), expected);
    }

    #[test]
    fn test_mul_one() {
        let res = N_MOD.mul(&FixedMontyForm::one(&PARAMS));
        assert_eq!(res.retrieve(), N);
    }

    #[test]
    fn test_mul_eq_add() {
        let res = N_MOD.mul(&FixedMontyForm::new(&U256::from(2u8), &PARAMS));
        assert_eq!(res, N_MOD.add(&N_MOD));
    }

    #[test]
    fn test_square_eq_mul() {
        let res = N_MOD.square();
        let expected = N_MOD.mul(&N_MOD);
        assert_eq!(res, expected);
    }

    #[test]
    fn test_square_repeat() {
        let res = N_MOD.square_repeat_vartime(0);
        assert_eq!(res, N_MOD);

        let res = N_MOD.square_repeat_vartime(1);
        assert_eq!(res, N_MOD.square());

        let res = N_MOD.square_repeat_vartime(5);
        let expected = N_MOD.square().square().square().square().square();
        assert_eq!(res, expected);
    }
}
