//! Parameter calculation for prime moduli.

use core::num::NonZeroU32;
use ctutils::{CtAssignSlice, CtEqSlice, CtSelectUsingCtAssign};

use super::{FixedMontyForm, FixedMontyParams};
use crate::{Choice, CtAssign, CtEq, OddUint, Uint};

#[cfg(feature = "subtle")]
use crate::CtSelect;

/// Parameters for supporting efficient computations on integers in Montgomery form
/// with a prime modulus.
#[derive(Debug, Copy, Clone)]
pub struct PrimeParams<const LIMBS: usize> {
    /// The largest power of two that divides `(modulus - 1)`.
    pub(super) s: NonZeroU32,
    /// The result of dividing `modulus - 1` by `2^s`.
    pub(super) t: OddUint<LIMBS>,
    /// The smallest primitive root of the modulus.
    pub(super) generator: NonZeroU32,
    /// The exponent to use in computing a modular square root.
    pub(super) sqrt_exp: Uint<LIMBS>,
    /// An s'th root of unity for the modulus, in Montgomery form.
    pub(super) monty_root_unity: Uint<LIMBS>,
    /// Equal to `monty_root_unity^2 mod p`.
    pub(super) monty_root_unity_p2: Uint<LIMBS>,
}

impl<const LIMBS: usize> PrimeParams<LIMBS> {
    /// Instantiates a new set of [`PrimeParams`] given [`FixedMontyParams`] for a prime modulus.
    ///
    /// The value `generator` must be a multiplicative generator (ie. primitive element) of the
    /// finite field, having order `modulus-1`. Its powers generate all nonzero elements of the
    /// field: `generator^0, generator^1, ..., generator^(modulus-2)` enumerate `[1, modulus-1]`.
    #[must_use]
    #[allow(clippy::unwrap_in_result, clippy::missing_panics_doc)]
    pub const fn new_vartime(params: &FixedMontyParams<LIMBS>, generator: u32) -> Self {
        let p = params.modulus();
        let p_minus_one = p.as_ref().set_bit_vartime(0, false);
        let generator = NonZeroU32::new(generator).expect("invalid generator");
        let s = NonZeroU32::new(p_minus_one.trailing_zeros_vartime()).expect("ensured non-zero");
        let t = p
            .as_ref()
            .shr(s.get())
            .to_odd()
            .expect_copied("ensured odd");

        // if s=1 and p is a power of a prime then -1 is always a root of unity
        let (exp, root) = if s.get() == 1 {
            // (p+1)/4
            let exp = p.as_ref().shr_vartime(2).wrapping_add(&Uint::ONE);
            let root = FixedMontyForm::new(&p_minus_one, params);
            (exp, root)
        } else {
            // t = (p-1)/2^s
            let t = p.as_ref().shr_vartime(s.get());
            // exp = (t-1)/2
            let exp = t.shr_vartime(1);
            // the s'th root of unity is calculated as `generator^t`
            let root =
                FixedMontyForm::new(&Uint::from_u32(generator.get()), params).pow_vartime(&t);
            // root^(2^(s-1)) must be equal to -1
            let check = root.square_repeat_vartime(s.get() - 1);
            assert!(
                Uint::eq(&check.retrieve(), &p_minus_one).to_bool_vartime(),
                "error calculating root of unity: invalid generator"
            );
            (exp, root)
        };

        Self {
            s,
            t,
            generator,
            sqrt_exp: exp,
            monty_root_unity: root.to_montgomery(),
            monty_root_unity_p2: root.square().to_montgomery(),
        }
    }

    /// Get the constant 'generator' used in modular square root calculation.
    #[must_use]
    pub const fn generator(&self) -> NonZeroU32 {
        self.generator
    }

    /// Get the constant 's' used in modular square root calculation.
    #[must_use]
    pub const fn s(&self) -> NonZeroU32 {
        self.s
    }

    /// Get the constant 't' used in modular square root calculation.
    #[must_use]
    pub const fn t(&self) -> OddUint<LIMBS> {
        self.t
    }
}

impl<const LIMBS: usize> CtAssign for PrimeParams<LIMBS> {
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.s.ct_assign(&other.s, choice);
        self.generator.ct_assign(&other.generator, choice);
        self.sqrt_exp.ct_assign(&other.sqrt_exp, choice);
        self.monty_root_unity
            .ct_assign(&other.monty_root_unity, choice);
        self.monty_root_unity_p2
            .ct_assign(&other.monty_root_unity_p2, choice);
    }
}
impl<const LIMBS: usize> CtAssignSlice for PrimeParams<LIMBS> {}
impl<const LIMBS: usize> CtSelectUsingCtAssign for PrimeParams<LIMBS> {}

impl<const LIMBS: usize> CtEq for PrimeParams<LIMBS> {
    fn ct_eq(&self, other: &Self) -> Choice {
        self.s.ct_eq(&other.s)
            & self.generator.ct_eq(&other.generator)
            & self.sqrt_exp.ct_eq(&other.sqrt_exp)
            & self.monty_root_unity.ct_eq(&other.monty_root_unity)
            & self.monty_root_unity_p2.ct_eq(&other.monty_root_unity_p2)
    }
}
impl<const LIMBS: usize> CtEqSlice for PrimeParams<LIMBS> {}

#[cfg(feature = "subtle")]
impl<const LIMBS: usize> subtle::ConstantTimeEq for PrimeParams<LIMBS> {
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, other).into()
    }
}

#[cfg(feature = "subtle")]
impl<const LIMBS: usize> subtle::ConditionallySelectable for PrimeParams<LIMBS> {
    fn conditional_assign(&mut self, src: &Self, choice: subtle::Choice) {
        self.ct_assign(src, choice.into());
    }

    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        a.ct_select(b, choice.into())
    }
}

#[cfg(test)]
mod tests {
    use super::PrimeParams;
    use crate::{Choice, CtEq, CtSelect, Odd, U128, modular::MontyParams};

    #[test]
    fn check_expected() {
        let monty_params =
            MontyParams::new_vartime(Odd::<U128>::from_be_hex("e38af050d74b8567f73c8713cbc7bc47"));
        let prime_params = PrimeParams::new_vartime(&monty_params, 5);
        assert_eq!(prime_params.s.get(), 1);
        assert_eq!(prime_params.generator.get(), 5);
    }

    #[should_panic]
    #[test]
    fn check_invalid_generator() {
        let monty_params =
            MontyParams::new_vartime(Odd::<U128>::from_be_hex("e38af050d74b8567f73c8713cbc7bc47"));
        let _ = PrimeParams::new_vartime(&monty_params, 0);
    }

    #[should_panic]
    #[test]
    fn check_non_prime() {
        let monty_params =
            MontyParams::new_vartime(Odd::<U128>::from_be_hex("e38af050d74b8567f73c8713cbc7bc01"));
        let _ = PrimeParams::new_vartime(&monty_params, 5);
    }

    #[test]
    fn check_equality() {
        let monty_params_1 =
            MontyParams::new_vartime(Odd::<U128>::from_be_hex("e38af050d74b8567f73c8713cbc7bc47"));
        let prime_params_1 = PrimeParams::new_vartime(&monty_params_1, 5);

        let monty_params_2 =
            MontyParams::new_vartime(Odd::<U128>::from_be_hex("f2799d643ab7ff983437c3a86cdb1beb"));
        let prime_params_2 = PrimeParams::new_vartime(&monty_params_2, 5);

        assert!(CtEq::ct_eq(&prime_params_1, &prime_params_1).to_bool_vartime());
        #[cfg(feature = "subtle")]
        assert!(bool::from(subtle::ConstantTimeEq::ct_eq(
            &prime_params_1,
            &prime_params_1
        )));

        assert!(CtEq::ct_ne(&prime_params_1, &prime_params_2).to_bool_vartime());
        #[cfg(feature = "subtle")]
        assert!(bool::from(subtle::ConstantTimeEq::ct_ne(
            &prime_params_1,
            &prime_params_2
        )));

        assert!(
            CtEq::ct_eq(
                &CtSelect::ct_select(&prime_params_1, &prime_params_2, Choice::FALSE),
                &prime_params_1,
            )
            .to_bool_vartime()
        );
        #[cfg(feature = "subtle")]
        assert!(
            CtEq::ct_eq(
                &subtle::ConditionallySelectable::conditional_select(
                    &prime_params_1,
                    &prime_params_2,
                    subtle::Choice::from(0u8)
                ),
                &prime_params_1,
            )
            .to_bool_vartime()
        );

        assert!(
            CtEq::ct_eq(
                &CtSelect::ct_select(&prime_params_1, &prime_params_2, Choice::TRUE),
                &prime_params_2,
            )
            .to_bool_vartime()
        );
        #[cfg(feature = "subtle")]
        assert!(
            CtEq::ct_eq(
                &subtle::ConditionallySelectable::conditional_select(
                    &prime_params_1,
                    &prime_params_2,
                    subtle::Choice::from(1u8)
                ),
                &prime_params_2,
            )
            .to_bool_vartime()
        );
    }
}
