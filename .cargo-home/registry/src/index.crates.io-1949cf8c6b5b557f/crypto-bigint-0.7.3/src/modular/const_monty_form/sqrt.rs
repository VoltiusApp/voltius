use core::marker::PhantomData;

use super::ConstPrimeMontyParams;
use crate::{
    CtOption,
    modular::{ConstMontyForm, sqrt::sqrt_montgomery_form},
};

impl<const LIMBS: usize, MOD> ConstMontyForm<MOD, LIMBS>
where
    MOD: ConstPrimeMontyParams<LIMBS>,
{
    /// Compute the modular square root for `self`, if it exists.
    #[must_use]
    pub const fn sqrt(&self) -> CtOption<Self> {
        let res = sqrt_montgomery_form(self.as_montgomery(), &MOD::PARAMS, &MOD::PRIME_PARAMS);
        let is_some = res.is_some();
        CtOption::new(
            Self {
                montgomery_form: *res.as_inner_unchecked(),
                phantom: PhantomData,
            },
            is_some,
        )
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        U256, const_prime_monty_params,
        modular::{ConstMontyForm, ConstPrimeMontyParams},
    };

    #[test]
    fn check_sqrt() {
        // P-256 field modulus
        // p = 3 mod 4, s = 1, uses Shanks algorithm
        const_prime_monty_params!(
            P256Field,
            U256,
            "ffffffff00000001000000000000000000000000ffffffffffffffffffffffff",
            6
        );
        assert_eq!(P256Field::PRIME_PARAMS.s().get(), 1);
        type ConstForm = ConstMontyForm<P256Field, { U256::LIMBS }>;

        // four is square
        let four_monty = ConstForm::new(&U256::from(4u32));
        assert_eq!(
            four_monty.sqrt().expect("ensured square"),
            ConstForm::new(&U256::from(2u32))
        );

        // generator must be non-residue
        let generator = U256::from_u32(P256Field::PRIME_PARAMS.generator().get());
        let gen_monty = ConstForm::new(&generator);
        assert!(gen_monty.sqrt().is_none().to_bool_vartime());
    }
}
