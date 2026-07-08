//! Modular arithmetic support.
//!
//! This module provides support for various modular arithmetic operations, implemented in terms of
//! Montgomery form.
//!
//! # Constant moduli
//!
//! The [`ConstMontyForm`] and [`ConstMontyParams`] types implement support for modular arithmetic
//! where the modulus is fixed at compile-time.
//!
//! The [`const_monty_params!`][`crate::const_monty_params`] macro can be used to define Montgomery
//! parameters at compile-time from a modulus, whereas the [`const_monty_form!`][`crate::const_monty_form`]
//! macro can define a [`ConstMontyForm`] constant.
//!
//! # Dynamic moduli chosen at runtime
//!
//! The [`FixedMontyForm`] and [`FixedMontyParams`] types implement support for modular arithmetic where
//! the modulus can vary at runtime.

mod const_monty_form;
mod fixed_monty_form;
mod lincomb;
mod reduction;

mod add;
pub(crate) mod bingcd;
mod div_by_2;
mod monty_params;
mod mul;
mod pow;
mod prime_params;
pub(crate) mod safegcd;
mod sqrt;
mod sub;

#[cfg(feature = "alloc")]
pub(crate) mod boxed_monty_form;

pub use self::{
    const_monty_form::{ConstMontyForm, ConstMontyParams, ConstPrimeMontyParams},
    fixed_monty_form::FixedMontyForm,
    monty_params::{FixedMontyParams, MontyParams},
    prime_params::PrimeParams,
};

pub(crate) use self::safegcd::SafeGcdInverter;

#[cfg(feature = "alloc")]
pub use self::{boxed_monty_form::BoxedMontyForm, monty_params::boxed::BoxedMontyParams};

/// A generalization for numbers kept in optimized representations (e.g. Montgomery)
/// that can be converted back to the original form.
pub trait Retrieve {
    /// The original type.
    type Output;

    /// Convert the number back from the optimized representation.
    fn retrieve(&self) -> Self::Output;
}

#[cfg(test)]
mod tests {
    use crate::{
        NonZero, U64, U128, U256, Uint, const_monty_params,
        modular::{
            const_monty_form::{ConstMontyForm, ConstMontyParams},
            mul::{mul_montgomery_form, square_montgomery_form},
            reduction::montgomery_reduction,
        },
    };

    const_monty_params!(
        Modulus1,
        U256,
        "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001"
    );

    #[test]
    fn test_montgomery_params() {
        assert_eq!(
            Modulus1::PARAMS.one,
            U256::from_be_hex("1824b159acc5056f998c4fefecbc4ff55884b7fa0003480200000001fffffffe")
        );
        assert_eq!(
            Modulus1::PARAMS.r2,
            U256::from_be_hex("0748d9d99f59ff1105d314967254398f2b6cedcb87925c23c999e990f3f29c6d")
        );
        assert_eq!(
            Modulus1::PARAMS.mod_neg_inv(),
            U64::from_be_hex("fffffffeffffffff").limbs[0]
        );
    }

    const_monty_params!(Modulus128, U128, "000000087b57be17f0ecdbf18a227bd9");

    const_monty_params!(
        Modulus256,
        U256,
        "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
    );

    #[test]
    fn test_reducing_one() {
        // Divide the value R by R, which should equal 1
        assert_eq!(
            montgomery_reduction::<{ Modulus256::LIMBS }>(
                &(Modulus256::PARAMS.one, Uint::ZERO),
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            Uint::ONE
        );
    }

    #[test]
    fn test_reducing_r2() {
        // Divide the value R^2 by R, which should equal R
        assert_eq!(
            montgomery_reduction::<{ Modulus256::LIMBS }>(
                &(Modulus256::PARAMS.r2, Uint::ZERO),
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            Modulus256::PARAMS.one
        );
    }

    #[test]
    fn test_reducing_r2_wide() {
        // Divide the value ONE^2 by R, which should equal ONE
        let (lo, hi) = Modulus256::PARAMS.one.widening_square();
        assert_eq!(
            montgomery_reduction::<{ Modulus256::LIMBS }>(
                &(lo, hi),
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            Modulus256::PARAMS.one
        );
    }

    #[test]
    fn test_reducing_xr_wide() {
        // Reducing xR should return x
        let x =
            U256::from_be_hex("44acf6b7e36c1342c2c5897204fe09504e1e2efb1a900377dbc4e7a6a133ec56");
        let product = x.widening_mul(&Modulus256::PARAMS.one);
        assert_eq!(
            montgomery_reduction::<{ Modulus256::LIMBS }>(
                &product,
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            x
        );
    }

    #[test]
    fn test_reducing_xr2_wide() {
        // Reducing xR^2 should return xR
        let x =
            U256::from_be_hex("44acf6b7e36c1342c2c5897204fe09504e1e2efb1a900377dbc4e7a6a133ec56");
        let product = x.widening_mul(&Modulus256::PARAMS.r2);

        // Computing xR mod modulus without Montgomery reduction
        let (lo, hi) = x.widening_mul(&Modulus256::PARAMS.one);
        let c = lo.concat(&hi);
        let red =
            c.rem_vartime(&NonZero::new(Modulus256::PARAMS.modulus.0.concat(&U256::ZERO)).unwrap());
        let (lo, hi) = red.split();
        assert_eq!(hi, Uint::ZERO);

        assert_eq!(
            montgomery_reduction::<{ Modulus256::LIMBS }>(
                &product,
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            lo
        );
    }

    #[test]
    fn monty_mul_one_r() {
        // Multiply 1 by R and divide by R, which should equal 1
        assert_eq!(
            mul_montgomery_form::<{ Modulus128::LIMBS }>(
                &Uint::ONE,
                &Modulus128::PARAMS.one,
                &Modulus128::PARAMS.modulus,
                Modulus128::PARAMS.mod_neg_inv()
            ),
            Uint::ONE
        );
        assert_eq!(
            mul_montgomery_form::<{ Modulus256::LIMBS }>(
                &Uint::ONE,
                &Modulus256::PARAMS.one,
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            Uint::ONE
        );
    }

    #[test]
    fn monty_mul_r_r() {
        // Multiply R by R and divide by R, which should equal R
        assert_eq!(
            mul_montgomery_form::<{ Modulus128::LIMBS }>(
                &Modulus128::PARAMS.one,
                &Modulus128::PARAMS.one,
                &Modulus128::PARAMS.modulus,
                Modulus128::PARAMS.mod_neg_inv()
            ),
            Modulus128::PARAMS.one
        );
        assert_eq!(
            mul_montgomery_form::<{ Modulus256::LIMBS }>(
                &Modulus256::PARAMS.one,
                &Modulus256::PARAMS.one,
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            Modulus256::PARAMS.one
        );
    }

    #[test]
    fn monty_square_r() {
        // Square R and divide by R, which should equal R
        assert_eq!(
            square_montgomery_form::<{ Modulus128::LIMBS }>(
                &Modulus128::PARAMS.one,
                &Modulus128::PARAMS.modulus,
                Modulus128::PARAMS.mod_neg_inv()
            ),
            Modulus128::PARAMS.one
        );
        assert_eq!(
            square_montgomery_form::<{ Modulus256::LIMBS }>(
                &Modulus256::PARAMS.one,
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            Modulus256::PARAMS.one
        );
    }

    #[test]
    fn monty_mul_r2() {
        // Multiply 1 by R2 and divide by R, which should equal R
        assert_eq!(
            mul_montgomery_form::<{ Modulus128::LIMBS }>(
                &Uint::ONE,
                &Modulus128::PARAMS.r2,
                &Modulus128::PARAMS.modulus,
                Modulus128::PARAMS.mod_neg_inv()
            ),
            Modulus128::PARAMS.one
        );
        assert_eq!(
            mul_montgomery_form::<{ Modulus256::LIMBS }>(
                &Uint::ONE,
                &Modulus256::PARAMS.r2,
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            Modulus256::PARAMS.one
        );
    }

    #[test]
    fn monty_mul_xr() {
        // Reducing xR should return x
        let x =
            U256::from_be_hex("44acf6b7e36c1342c2c5897204fe09504e1e2efb1a900377dbc4e7a6a133ec56");
        assert_eq!(
            mul_montgomery_form::<{ Modulus256::LIMBS }>(
                &x,
                &Modulus256::PARAMS.one,
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            x
        );
    }

    #[test]
    fn monty_mul_xr2() {
        let x =
            U256::from_be_hex("44acf6b7e36c1342c2c5897204fe09504e1e2efb1a900377dbc4e7a6a133ec56");

        // Computing xR mod modulus without Montgomery reduction
        let (lo, hi) = x.widening_mul(&Modulus256::PARAMS.one);
        let c = lo.concat(&hi);
        let red =
            c.rem_vartime(&NonZero::new(Modulus256::PARAMS.modulus.0.concat(&U256::ZERO)).unwrap());
        let (lo, hi) = red.split();
        assert_eq!(hi, Uint::ZERO);

        // Reducing xR^2 should return xR
        assert_eq!(
            mul_montgomery_form::<{ Modulus256::LIMBS }>(
                &x,
                &Modulus256::PARAMS.r2,
                &Modulus256::PARAMS.modulus,
                Modulus256::PARAMS.mod_neg_inv()
            ),
            lo
        );
    }

    #[test]
    fn test_new_retrieve() {
        let x =
            U256::from_be_hex("44acf6b7e36c1342c2c5897204fe09504e1e2efb1a900377dbc4e7a6a133ec56");
        let x_mod = ConstMontyForm::<Modulus256, { Modulus256::LIMBS }>::new(&x);

        // Confirm that when creating a Modular and retrieving the value, that it equals the original
        assert_eq!(x, x_mod.retrieve());
    }
}
