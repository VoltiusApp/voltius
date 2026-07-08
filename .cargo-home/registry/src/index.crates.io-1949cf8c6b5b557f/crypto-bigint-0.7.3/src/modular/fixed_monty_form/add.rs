//! Additions between integers in Montgomery form with a modulus set at runtime.

use super::FixedMontyForm;
use crate::modular::add::{add_montgomery_form, double_montgomery_form};
use core::ops::{Add, AddAssign};

impl<const LIMBS: usize> FixedMontyForm<LIMBS> {
    /// Adds `rhs`.
    #[must_use]
    pub const fn add(&self, rhs: &Self) -> Self {
        Self {
            montgomery_form: add_montgomery_form(
                &self.montgomery_form,
                &rhs.montgomery_form,
                &self.params.modulus,
            ),
            params: self.params,
        }
    }

    /// Double `self`.
    #[must_use]
    pub const fn double(&self) -> Self {
        Self {
            montgomery_form: double_montgomery_form(&self.montgomery_form, &self.params.modulus),
            params: self.params,
        }
    }
}

impl<const LIMBS: usize> Add<&FixedMontyForm<LIMBS>> for &FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    fn add(self, rhs: &FixedMontyForm<LIMBS>) -> FixedMontyForm<LIMBS> {
        debug_assert_eq!(self.params, rhs.params);
        self.add(rhs)
    }
}

impl<const LIMBS: usize> Add<FixedMontyForm<LIMBS>> for &FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    #[allow(clippy::op_ref)]
    fn add(self, rhs: FixedMontyForm<LIMBS>) -> FixedMontyForm<LIMBS> {
        self + &rhs
    }
}

impl<const LIMBS: usize> Add<&FixedMontyForm<LIMBS>> for FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    #[allow(clippy::op_ref)]
    fn add(self, rhs: &FixedMontyForm<LIMBS>) -> FixedMontyForm<LIMBS> {
        &self + rhs
    }
}

impl<const LIMBS: usize> Add<FixedMontyForm<LIMBS>> for FixedMontyForm<LIMBS> {
    type Output = FixedMontyForm<LIMBS>;
    fn add(self, rhs: FixedMontyForm<LIMBS>) -> FixedMontyForm<LIMBS> {
        &self + &rhs
    }
}

impl<const LIMBS: usize> AddAssign<&FixedMontyForm<LIMBS>> for FixedMontyForm<LIMBS> {
    fn add_assign(&mut self, rhs: &FixedMontyForm<LIMBS>) {
        *self = *self + rhs;
    }
}

impl<const LIMBS: usize> AddAssign<FixedMontyForm<LIMBS>> for FixedMontyForm<LIMBS> {
    fn add_assign(&mut self, rhs: FixedMontyForm<LIMBS>) {
        *self += &rhs;
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        Odd, U256,
        modular::{FixedMontyForm, FixedMontyParams},
    };

    #[test]
    fn add_overflow() {
        let params = FixedMontyParams::new_vartime(Odd::<U256>::from_be_hex(
            "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
        ));

        let x =
            U256::from_be_hex("44acf6b7e36c1342c2c5897204fe09504e1e2efb1a900377dbc4e7a6a133ec56");
        let mut x_mod = FixedMontyForm::new(&x, &params);

        let y =
            U256::from_be_hex("d5777c45019673125ad240f83094d4252d829516fac8601ed01979ec1ec1a251");
        let y_mod = FixedMontyForm::new(&y, &params);

        x_mod += &y_mod;

        let expected =
            U256::from_be_hex("1a2472fde50286541d97ca6a3592dd75beb9c9646e40c511b82496cfc3926956");

        assert_eq!(expected, x_mod.retrieve());
    }
}
