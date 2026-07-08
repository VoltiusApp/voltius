//! Exponentiation of integers in Montgomery form with a modulus set at runtime.

use super::FixedMontyForm;
use crate::{
    MultiExponentiateBoundedExp, PowBoundedExp, Uint,
    modular::pow::{
        multi_exponentiate_montgomery_form_array, pow_montgomery_form, pow_montgomery_form_amm,
    },
};

#[cfg(feature = "alloc")]
use {crate::modular::pow::multi_exponentiate_montgomery_form_slice, alloc::vec::Vec};

impl<const LIMBS: usize> FixedMontyForm<LIMBS> {
    /// Raises to the `exponent` power.
    #[must_use]
    pub const fn pow<const RHS_LIMBS: usize>(&self, exponent: &Uint<RHS_LIMBS>) -> Self {
        self.pow_bounded_exp(exponent, Uint::<RHS_LIMBS>::BITS)
    }

    /// Raises to the `exponent` power,
    /// with `exponent_bits` representing the number of (least significant) bits
    /// to take into account for the exponent.
    ///
    /// NOTE: `exponent_bits` may be leaked in the time pattern.
    #[must_use]
    pub const fn pow_bounded_exp<const RHS_LIMBS: usize>(
        &self,
        exponent: &Uint<RHS_LIMBS>,
        exponent_bits: u32,
    ) -> Self {
        Self {
            montgomery_form: pow_montgomery_form::<LIMBS, RHS_LIMBS, false>(
                &self.montgomery_form,
                exponent,
                exponent_bits,
                &self.params,
            ),
            params: self.params,
        }
    }

    /// Raises to the `exponent` power.
    ///
    /// This method is variable time in `exponent`.
    #[must_use]
    pub const fn pow_vartime<const RHS_LIMBS: usize>(&self, exponent: &Uint<RHS_LIMBS>) -> Self {
        let exponent_bits = exponent.bits_vartime();
        Self {
            montgomery_form: pow_montgomery_form::<LIMBS, RHS_LIMBS, true>(
                &self.montgomery_form,
                exponent,
                exponent_bits,
                &self.params,
            ),
            params: self.params,
        }
    }

    /// Raises to the `exponent` power using Almost Montgomery Multiplication (AMM).
    #[must_use]
    pub fn pow_amm(&self, exponent: &Uint<LIMBS>) -> Self {
        self.pow_amm_bounded_exp(exponent, Uint::<LIMBS>::BITS)
    }

    /// Raises to the `exponent` power using Almost Montgomery Multiplication (AMM)
    /// with `exponent_bits` representing the number of (least significant) bits
    /// to take into account for the exponent.
    ///
    /// NOTE: `exponent_bits` may be leaked in the time pattern.
    #[must_use]
    pub fn pow_amm_bounded_exp(&self, exponent: &Uint<LIMBS>, exponent_bits: u32) -> Self {
        Self {
            montgomery_form: pow_montgomery_form_amm(
                &self.montgomery_form,
                exponent,
                exponent_bits,
                &self.params,
            ),
            params: self.params,
        }
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> PowBoundedExp<Uint<RHS_LIMBS>>
    for FixedMontyForm<LIMBS>
{
    fn pow_bounded_exp(&self, exponent: &Uint<RHS_LIMBS>, exponent_bits: u32) -> Self {
        self.pow_bounded_exp(exponent, exponent_bits)
    }
}

impl<const N: usize, const LIMBS: usize, const RHS_LIMBS: usize>
    MultiExponentiateBoundedExp<Uint<RHS_LIMBS>, [(Self, Uint<RHS_LIMBS>); N]>
    for FixedMontyForm<LIMBS>
{
    fn multi_exponentiate_bounded_exp(
        bases_and_exponents: &[(Self, Uint<RHS_LIMBS>); N],
        exponent_bits: u32,
    ) -> Self {
        assert!(N != 0, "bases_and_exponents must not be empty");
        let params = bases_and_exponents[0].0.params;

        let mut bases_and_exponents_montgomery_form =
            [(Uint::<LIMBS>::ZERO, Uint::<RHS_LIMBS>::ZERO); N];

        let mut i = 0;
        while i < N {
            let (base, exponent) = bases_and_exponents[i];
            bases_and_exponents_montgomery_form[i] = (base.montgomery_form, exponent);
            i += 1;
        }

        Self {
            montgomery_form: multi_exponentiate_montgomery_form_array::<LIMBS, RHS_LIMBS, N, false>(
                &bases_and_exponents_montgomery_form,
                exponent_bits,
                &params,
            ),
            params,
        }
    }
}

#[cfg(feature = "alloc")]
impl<const LIMBS: usize, const RHS_LIMBS: usize>
    MultiExponentiateBoundedExp<Uint<RHS_LIMBS>, [(Self, Uint<RHS_LIMBS>)]>
    for FixedMontyForm<LIMBS>
{
    fn multi_exponentiate_bounded_exp(
        bases_and_exponents: &[(Self, Uint<RHS_LIMBS>)],
        exponent_bits: u32,
    ) -> Self {
        assert!(
            !bases_and_exponents.is_empty(),
            "bases_and_exponents must not be empty"
        );
        let params = bases_and_exponents[0].0.params;

        let bases_and_exponents: Vec<(Uint<LIMBS>, Uint<RHS_LIMBS>)> = bases_and_exponents
            .iter()
            .map(|(base, exp)| (base.montgomery_form, *exp))
            .collect();
        Self {
            montgomery_form: multi_exponentiate_montgomery_form_slice::<LIMBS, RHS_LIMBS, false>(
                &bases_and_exponents,
                exponent_bits,
                &params,
            ),
            params,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::traits::MultiExponentiate;
    use crate::{
        U256,
        modular::{FixedMontyForm, FixedMontyParams},
    };

    const PARAMS: FixedMontyParams<{ U256::LIMBS }> = FixedMontyParams::new_vartime(
        U256::from_be_hex("9CC24C5DF431A864188AB905AC751B727C9447A8E99E6366E1AD78A21E8D882B")
            .to_odd()
            .expect_copied("ensured odd"),
    );

    #[test]
    fn test_powmod_zero() {
        let base = U256::from(105u64);
        let base_mod = FixedMontyForm::new(&base, &PARAMS);

        let res = base_mod.pow(&U256::ZERO);
        let res_vartime = base_mod.pow_vartime(&U256::ZERO);

        assert_eq!(res.retrieve(), U256::ONE);
        assert_eq!(res_vartime.retrieve(), U256::ONE);
    }

    #[test]
    fn test_powmod_small_base() {
        let base = U256::from(105u64);
        let base_mod = FixedMontyForm::new(&base, &PARAMS);

        let exponent =
            U256::from_be_hex("77117F1273373C26C700D076B3F780074D03339F56DD0EFB60E7F58441FD3685");

        let res = base_mod.pow(&exponent);
        let res_vartime = base_mod.pow_vartime(&exponent);

        let expected =
            U256::from_be_hex("7B2CD7BDDD96C271E6F232F2F415BB03FE2A90BD6CCCEA5E94F1BFD064993766");
        assert_eq!(res.retrieve(), expected);
        assert_eq!(res_vartime.retrieve(), expected);
    }

    #[test]
    fn test_powmod_small_exponent() {
        let base =
            U256::from_be_hex("3435D18AA8313EBBE4D20002922225B53F75DC4453BB3EEC0378646F79B524A4");
        let base_mod = FixedMontyForm::new(&base, &PARAMS);

        let exponent = U256::from(105u64);

        let res = base_mod.pow(&exponent);
        let res_vartime = base_mod.pow_vartime(&exponent);

        let expected =
            U256::from_be_hex("89E2A4E99F649A5AE2C18068148C355CA927B34A3245C938178ED00D6EF218AA");
        assert_eq!(res.retrieve(), expected);
        assert_eq!(res_vartime.retrieve(), expected);
    }

    #[test]
    fn test_powmod() {
        let base =
            U256::from_be_hex("3435D18AA8313EBBE4D20002922225B53F75DC4453BB3EEC0378646F79B524A4");
        let base_mod = FixedMontyForm::new(&base, &PARAMS);

        let exponent =
            U256::from_be_hex("77117F1273373C26C700D076B3F780074D03339F56DD0EFB60E7F58441FD3685");

        let res = base_mod.pow(&exponent);
        let res_vartime = base_mod.pow_vartime(&exponent);

        let expected =
            U256::from_be_hex("3681BC0FEA2E5D394EB178155A127B0FD2EF405486D354251C385BDD51B9D421");
        assert_eq!(res.retrieve(), expected);
        assert_eq!(res_vartime.retrieve(), expected);
    }

    #[test]
    fn test_multi_exp_array() {
        let base = U256::from(2u8);
        let base_mod = FixedMontyForm::new(&base, &PARAMS);

        let exponent = U256::from(33u8);
        let bases_and_exponents = [(base_mod, exponent)];
        let res = FixedMontyForm::<{ U256::LIMBS }>::multi_exponentiate(&bases_and_exponents);

        let expected =
            U256::from_be_hex("0000000000000000000000000000000000000000000000000000000200000000");

        assert_eq!(res.retrieve(), expected);

        let base2 =
            U256::from_be_hex("3435D18AA8313EBBE4D20002922225B53F75DC4453BB3EEC0378646F79B524A4");
        let base2_mod = FixedMontyForm::new(&base2, &PARAMS);

        let exponent2 =
            U256::from_be_hex("77117F1273373C26C700D076B3F780074D03339F56DD0EFB60E7F58441FD3685");

        let expected = base_mod.pow(&exponent) * base2_mod.pow(&exponent2);
        let bases_and_exponents = [(base_mod, exponent), (base2_mod, exponent2)];
        let res = FixedMontyForm::<{ U256::LIMBS }>::multi_exponentiate(&bases_and_exponents);

        assert_eq!(res, expected);
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn test_multi_exp_slice() {
        let base = U256::from(2u8);
        let base_mod = FixedMontyForm::new(&base, &PARAMS);

        let exponent = U256::from(33u8);
        let bases_and_exponents = vec![(base_mod, exponent)];
        let res =
            FixedMontyForm::<{ U256::LIMBS }>::multi_exponentiate(bases_and_exponents.as_slice());

        let expected =
            U256::from_be_hex("0000000000000000000000000000000000000000000000000000000200000000");

        assert_eq!(res.retrieve(), expected);

        let base2 =
            U256::from_be_hex("3435D18AA8313EBBE4D20002922225B53F75DC4453BB3EEC0378646F79B524A4");
        let base2_mod = FixedMontyForm::new(&base2, &PARAMS);

        let exponent2 =
            U256::from_be_hex("77117F1273373C26C700D076B3F780074D03339F56DD0EFB60E7F58441FD3685");

        let expected = base_mod.pow(&exponent) * base2_mod.pow(&exponent2);
        let bases_and_exponents = vec![(base_mod, exponent), (base2_mod, exponent2)];
        let res =
            FixedMontyForm::<{ U256::LIMBS }>::multi_exponentiate(bases_and_exponents.as_slice());

        assert_eq!(res, expected);
    }
}
