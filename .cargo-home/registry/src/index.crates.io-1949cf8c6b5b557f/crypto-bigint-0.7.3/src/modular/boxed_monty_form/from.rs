//! `From`-like conversions for [`BoxedMontyForm`] and [`BoxedMontyParams`].

use super::{BoxedMontyForm, BoxedMontyParams, MontyParams};
use crate::{
    BoxedUint,
    modular::{ConstMontyForm, ConstMontyParams, FixedMontyForm, FixedMontyParams},
};

impl<const LIMBS: usize, Params> From<ConstMontyForm<Params, LIMBS>> for BoxedMontyForm
where
    Params: ConstMontyParams<LIMBS>,
{
    fn from(input: ConstMontyForm<Params, LIMBS>) -> Self {
        Self::from(&input)
    }
}

impl<const LIMBS: usize, Params> From<&ConstMontyForm<Params, LIMBS>> for BoxedMontyForm
where
    Params: ConstMontyParams<LIMBS>,
{
    fn from(input: &ConstMontyForm<Params, LIMBS>) -> Self {
        BoxedMontyForm {
            montgomery_form: input.as_montgomery().into(),
            params: Params::PARAMS.into(),
        }
    }
}

impl<const LIMBS: usize> From<FixedMontyForm<LIMBS>> for BoxedMontyForm {
    fn from(input: FixedMontyForm<LIMBS>) -> Self {
        Self::from(&input)
    }
}

impl<const LIMBS: usize> From<&FixedMontyForm<LIMBS>> for BoxedMontyForm {
    fn from(input: &FixedMontyForm<LIMBS>) -> Self {
        BoxedMontyForm {
            montgomery_form: input.as_montgomery().into(),
            params: input.params().into(),
        }
    }
}

impl<const LIMBS: usize> From<&FixedMontyParams<LIMBS>> for BoxedMontyParams {
    fn from(params: &FixedMontyParams<LIMBS>) -> Self {
        MontyParams::<BoxedUint> {
            modulus: params.modulus.into(),
            one: params.one.into(),
            r2: params.r2.into(),
            mod_inv: params.mod_inv,
            mod_leading_zeros: params.mod_leading_zeros,
        }
        .into()
    }
}

impl<const LIMBS: usize> From<FixedMontyParams<LIMBS>> for BoxedMontyParams {
    fn from(params: FixedMontyParams<LIMBS>) -> Self {
        BoxedMontyParams::from(&params)
    }
}
