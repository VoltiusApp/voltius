//! Multiplications between integers in Montgomery form with a constant modulus.

use core::{
    marker::PhantomData,
    ops::{Mul, MulAssign},
};

use crate::{
    modular::mul::{mul_montgomery_form, square_montgomery_form, square_repeat_montgomery_form},
    traits::Square,
};

use super::{ConstMontyForm, ConstMontyParams};

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> ConstMontyForm<MOD, LIMBS> {
    /// Multiplies by `rhs`.
    #[must_use]
    pub const fn mul(&self, rhs: &Self) -> Self {
        Self {
            montgomery_form: mul_montgomery_form(
                &self.montgomery_form,
                &rhs.montgomery_form,
                &MOD::PARAMS.modulus,
                MOD::PARAMS.mod_neg_inv(),
            ),
            phantom: PhantomData,
        }
    }

    /// Computes the (reduced) square.
    #[must_use]
    pub const fn square(&self) -> Self {
        Self {
            montgomery_form: square_montgomery_form(
                &self.montgomery_form,
                &MOD::PARAMS.modulus,
                MOD::PARAMS.mod_neg_inv(),
            ),
            phantom: PhantomData,
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
                &MOD::PARAMS.modulus,
                MOD::PARAMS.mod_neg_inv(),
            ),
            phantom: PhantomData,
        }
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> Mul<&ConstMontyForm<MOD, LIMBS>>
    for &ConstMontyForm<MOD, LIMBS>
{
    type Output = ConstMontyForm<MOD, LIMBS>;
    fn mul(self, rhs: &ConstMontyForm<MOD, LIMBS>) -> ConstMontyForm<MOD, LIMBS> {
        self.mul(rhs)
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> Mul<ConstMontyForm<MOD, LIMBS>>
    for &ConstMontyForm<MOD, LIMBS>
{
    type Output = ConstMontyForm<MOD, LIMBS>;
    #[allow(clippy::op_ref)]
    fn mul(self, rhs: ConstMontyForm<MOD, LIMBS>) -> ConstMontyForm<MOD, LIMBS> {
        self * &rhs
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> Mul<&ConstMontyForm<MOD, LIMBS>>
    for ConstMontyForm<MOD, LIMBS>
{
    type Output = ConstMontyForm<MOD, LIMBS>;
    #[allow(clippy::op_ref)]
    fn mul(self, rhs: &ConstMontyForm<MOD, LIMBS>) -> ConstMontyForm<MOD, LIMBS> {
        &self * rhs
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> Mul<ConstMontyForm<MOD, LIMBS>>
    for ConstMontyForm<MOD, LIMBS>
{
    type Output = ConstMontyForm<MOD, LIMBS>;
    fn mul(self, rhs: ConstMontyForm<MOD, LIMBS>) -> ConstMontyForm<MOD, LIMBS> {
        &self * &rhs
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> MulAssign<&Self>
    for ConstMontyForm<MOD, LIMBS>
{
    fn mul_assign(&mut self, rhs: &ConstMontyForm<MOD, LIMBS>) {
        *self = *self * rhs;
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> MulAssign<Self>
    for ConstMontyForm<MOD, LIMBS>
{
    fn mul_assign(&mut self, rhs: Self) {
        *self *= &rhs;
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> Square for ConstMontyForm<MOD, LIMBS> {
    fn square(&self) -> Self {
        ConstMontyForm::square(self)
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        U256, const_monty_form, const_monty_params,
        modular::const_monty_form::{ConstMontyForm, ConstMontyParams},
    };

    const_monty_params!(
        Modulus,
        U256,
        "15477BCCEFE197328255BFA79A1217899016D927EF460F4FF404029D24FA4409"
    );

    const_monty_form!(Fe, Modulus);

    const N: U256 =
        U256::from_be_hex("14117F1273373C26C700D076B3F780074D03339F56DD0EFB60E7F58441FD3685");
    const N_MOD: ConstMontyForm<Modulus, { U256::LIMBS }> = ConstMontyForm::new(&N);

    #[test]
    fn test_mul_zero() {
        let res = N_MOD.mul(&Fe::ZERO);
        let expected = U256::ZERO;
        assert_eq!(res.retrieve(), expected);
    }

    #[test]
    fn test_mul_one() {
        let res = N_MOD.mul(&Fe::ONE);
        assert_eq!(res.retrieve(), N);
    }

    #[test]
    fn test_mul_eq_add() {
        let res = N_MOD.mul(&Fe::new(&U256::from(2u8)));
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
