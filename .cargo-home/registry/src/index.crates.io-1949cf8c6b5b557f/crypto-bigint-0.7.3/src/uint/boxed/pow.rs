//! [`BoxedUint`] exponentiation operations.

use super::{BoxedUint, mul::BoxedMultiplier};
use crate::{Checked, Choice, CtOption, Limb, PowBoundedExp, UintRef, Wrapping};

impl BoxedUint {
    /// Computes `self^exp`, returning a `CtOption` which is none in the case of overflow.
    #[must_use]
    pub fn checked_pow(&self, exp: impl AsRef<UintRef>) -> CtOption<Self> {
        let exp = exp.as_ref();
        self.checked_pow_bounded_exp(exp, exp.bits_precision())
    }

    /// Computes `self^exp`, returning a `CtOption` which is none in the case of overflow.
    ///
    /// NOTE: `exp_bits` may be leaked in the time pattern.
    ///
    /// # Panics
    /// - if `exp_bits` exceeds the capacity of `rhs`
    #[must_use]
    pub fn checked_pow_bounded_exp(
        &self,
        exp: impl AsRef<UintRef>,
        exp_bits: u32,
    ) -> CtOption<Self> {
        let (lo, overflow) = self.overflowing_pow_bounded_exp(exp, exp_bits);
        CtOption::new(lo, overflow.not())
    }

    /// Computes `self^exp`, returning a `CtOption` which is none in the case of overflow.
    ///
    /// This method is variable time in the exponent `exp` only.
    #[must_use]
    pub fn checked_pow_vartime(&self, exp: impl AsRef<UintRef>) -> CtOption<Self> {
        let (lo, overflow) = self.overflowing_pow_vartime(exp);
        CtOption::new(lo, overflow.not())
    }

    /// Computes `self^exp`, returning a `Self::MAX` in the case of overflow.
    #[must_use]
    pub fn saturating_pow(&self, exp: impl AsRef<UintRef>) -> Self {
        let exp = exp.as_ref();
        self.saturating_pow_bounded_exp(exp, exp.bits_precision())
    }

    /// Computes `self^exp`, returning a `Self::MAX` in the case of overflow.
    ///
    /// NOTE: `exp_bits` may be leaked in the time pattern.
    ///
    /// # Panics
    /// - if `exp_bits` exceeds the capacity of `rhs`
    #[must_use]
    pub fn saturating_pow_bounded_exp(&self, exp: impl AsRef<UintRef>, exp_bits: u32) -> Self {
        let (mut lo, overflow) = self.overflowing_pow_bounded_exp(exp, exp_bits);
        lo.as_mut_uint_ref().conditional_set_max(overflow);
        lo
    }

    /// Computes `self^exp`, returning a `Self::MAX` in the case of overflow.
    ///
    /// This method is variable time in the exponent `exp`.
    #[must_use]
    pub fn saturating_pow_vartime(&self, exp: impl AsRef<UintRef>) -> Self {
        let (mut lo, overflow) = self.overflowing_pow_vartime(exp);
        lo.as_mut_uint_ref().conditional_set_max(overflow);
        lo
    }

    /// Computes `self^exp`, discarding overflow.
    #[must_use]
    pub fn wrapping_pow(&self, exp: impl AsRef<UintRef>) -> Self {
        let exp = exp.as_ref();
        self.wrapping_pow_bounded_exp(exp, exp.bits_precision())
    }

    /// Computes `self^exp`, discarding overflow.
    ///
    /// NOTE: `exp_bits` may be leaked in the time pattern.
    ///
    /// # Panics
    /// - if `exp_bits` exceeds the capacity of `rhs`
    #[must_use]
    pub fn wrapping_pow_bounded_exp(&self, exp: impl AsRef<UintRef>, exp_bits: u32) -> Self {
        let exp = exp.as_ref();
        assert!(exp_bits <= exp.bits_precision());
        let mut ret = Self::one_with_precision(self.bits_precision());
        let mut helper = BoxedMultiplier::new();
        let mut limbs = exp_bits.div_ceil(Limb::BITS);
        let mut i = exp_bits - limbs.saturating_sub(1) * Limb::BITS;
        while limbs > 0 {
            limbs -= 1;
            let limb = exp.as_limbs()[limbs as usize];
            while i > 0 {
                i -= 1;
                helper.wrapping_square_assign(&mut ret);
                let apply = limb.shr(i).lsb_to_choice();
                let buf = helper.wrapping_mul(&ret, self);
                ret.as_mut_uint_ref().conditional_copy_from(buf, apply);
            }
            i = Limb::BITS;
        }
        ret
    }

    /// Computes `self^exp`, discarding overflow.
    ///
    /// This method is variable time in the exponent `exp` only.
    #[inline]
    #[must_use]
    pub fn wrapping_pow_vartime(&self, exp: impl AsRef<UintRef>) -> Self {
        let exp = exp.as_ref();
        let mut exp_bits = exp.bits_vartime();
        if exp_bits == 0 {
            return Self::one_with_precision(self.bits_precision());
        }
        exp_bits -= 1;
        let mut ret = self.clone();
        let mut helper = BoxedMultiplier::new();
        let mut limbs = exp_bits.div_ceil(Limb::BITS);
        let mut i = exp_bits - limbs.saturating_sub(1) * Limb::BITS;
        while limbs > 0 {
            limbs -= 1;
            let word = exp.as_limbs()[limbs as usize].0;
            while i > 0 {
                i -= 1;
                helper.wrapping_square_assign(&mut ret);
                if (word >> i) & 1 == 1 {
                    helper.wrapping_mul_assign(&mut ret, self);
                }
            }
            i = Limb::BITS;
        }
        ret
    }

    /// Computes `self^exp`, returning a wrapped result and a `Choice`
    /// indicating whether overflow occurred.
    ///
    /// NOTE: `exp_bits` may be leaked in the time pattern.
    #[inline(always)]
    #[must_use]
    pub(crate) fn overflowing_pow_bounded_exp(
        &self,
        exp: impl AsRef<UintRef>,
        exp_bits: u32,
    ) -> (Self, Choice) {
        let exp = exp.as_ref();
        assert!(exp_bits <= exp.bits_precision());
        let mut ret = Self::one_with_precision(self.bits_precision());
        let mut helper = BoxedMultiplier::new();
        let mut overflow = Choice::FALSE;
        let mut check;
        let mut limbs = exp_bits.div_ceil(Limb::BITS);
        let mut i = exp_bits - limbs.saturating_sub(1) * Limb::BITS;
        while limbs > 0 {
            limbs -= 1;
            let limb = exp.as_limbs()[limbs as usize];
            while i > 0 {
                i -= 1;
                check = helper.overflowing_square_assign(&mut ret);
                overflow = overflow.or(check);
                let (mul, check) = helper.overflowing_mul(&ret, self);
                let apply = limb.shr(i).lsb_to_choice();
                ret.as_mut_uint_ref().conditional_copy_from(mul, apply);
                overflow = overflow.or(check.and(apply));
            }
            i = Limb::BITS;
        }
        (ret, overflow)
    }

    /// Computes `self^exp`, returning a wrapped result and a `Choice`
    /// indicating whether overflow occurred.
    ///
    /// This method is variable time in the exponent `exp` only.
    #[inline(always)]
    #[must_use]
    pub(crate) fn overflowing_pow_vartime(&self, exp: impl AsRef<UintRef>) -> (Self, Choice) {
        let exp = exp.as_ref();
        let mut exp_bits = exp.bits_vartime();
        if exp_bits == 0 {
            return (
                Self::one_with_precision(self.bits_precision()),
                Choice::FALSE,
            );
        }
        exp_bits -= 1;
        let mut ret = self.clone();
        let mut helper = BoxedMultiplier::new();
        let mut overflow = Choice::FALSE;
        let mut check;
        let mut limbs = exp_bits.div_ceil(Limb::BITS);
        let mut i = exp_bits - limbs.saturating_sub(1) * Limb::BITS;
        while limbs > 0 {
            limbs -= 1;
            let word = exp.limbs[limbs as usize].0;
            while i > 0 {
                i -= 1;
                check = helper.overflowing_square_assign(&mut ret);
                overflow = overflow.or(check);
                if (word >> i) & 1 == 1 {
                    check = helper.overflowing_mul_assign(&mut ret, self);
                    overflow = overflow.or(check);
                }
            }
            i = Limb::BITS;
        }
        (ret, overflow)
    }
}

impl<Rhs: AsRef<UintRef>> PowBoundedExp<Rhs> for Checked<BoxedUint> {
    fn pow_bounded_exp(&self, exponent: &Rhs, exponent_bits: u32) -> Self {
        let is_some = self.0.is_some();
        let pow = self
            .0
            .as_inner_unchecked()
            .checked_pow_bounded_exp(exponent, exponent_bits);
        Checked(pow.filter_by(is_some))
    }
}

impl<Rhs: AsRef<UintRef>> PowBoundedExp<Rhs> for Wrapping<BoxedUint> {
    fn pow_bounded_exp(&self, exponent: &Rhs, exponent_bits: u32) -> Self {
        Wrapping(self.0.wrapping_pow_bounded_exp(exponent, exponent_bits))
    }
}

#[cfg(test)]
mod tests {
    use crate::{BoxedUint, Checked, CtOption, Limb, Pow, Resize, U128, UintRef, Wrapping};

    #[test]
    fn checked_pow_expected() {
        let checks = [
            (U128::ZERO, U128::ZERO, Some(U128::ONE)),
            (U128::ZERO, U128::MAX, Some(U128::ZERO)),
            (U128::ONE, U128::ZERO, Some(U128::ONE)),
            (U128::ONE, U128::MAX, Some(U128::ONE)),
            (U128::MAX, U128::ZERO, Some(U128::ONE)),
            (U128::MAX, U128::ONE, Some(U128::MAX)),
            (U128::MAX, U128::from_u8(2), None),
            (U128::MAX, U128::MAX, None),
        ];
        for (base, pow, expect) in checks {
            let (base, pow, expect) = (
                BoxedUint::from(base),
                BoxedUint::from(pow),
                expect.map(BoxedUint::from),
            );
            assert_eq!(base.checked_pow(&pow).into_option(), expect);
            assert_eq!(base.checked_pow_vartime(&pow).into_option(), expect);
            assert_eq!(
                Checked(CtOption::some(base)).pow(&pow).0.into_option(),
                expect
            );
        }

        assert!(
            Checked(CtOption::<U128>::none())
                .pow(&U128::ONE)
                .0
                .is_none()
                .to_bool_vartime()
        );
    }

    #[test]
    fn saturating_pow_expected() {
        let checks = [
            (U128::ZERO, U128::ZERO, U128::ONE),
            (U128::ZERO, U128::MAX, U128::ZERO),
            (U128::ONE, U128::ZERO, U128::ONE),
            (U128::ONE, U128::MAX, U128::ONE),
            (U128::MAX, U128::ZERO, U128::ONE),
            (U128::MAX, U128::ONE, U128::MAX),
            (U128::MAX, U128::from_u8(2), U128::MAX),
            (U128::MAX, U128::MAX, U128::MAX),
        ];
        for (base, pow, expect) in checks {
            let (base, pow, expect) = (
                BoxedUint::from(base),
                BoxedUint::from(pow),
                BoxedUint::from(expect),
            );
            assert_eq!(base.saturating_pow(&pow), expect);
            assert_eq!(base.saturating_pow_vartime(&pow), expect);
        }
    }

    #[test]
    fn wrapping_pow_expected() {
        let checks = [
            (U128::ZERO, U128::ZERO, U128::ONE),
            (U128::ZERO, U128::MAX, U128::ZERO),
            (U128::ONE, U128::ZERO, U128::ONE),
            (U128::ONE, U128::MAX, U128::ONE),
            (U128::MAX, U128::ZERO, U128::ONE),
            (U128::MAX, U128::ONE, U128::MAX),
            (U128::MAX, U128::from_u8(2), U128::ONE),
            (U128::MAX, U128::from_u8(3), U128::MAX),
            (U128::MAX, U128::MAX, U128::MAX),
        ];
        for (base, pow, expect) in checks {
            let (base, pow, expect) = (
                BoxedUint::from(base),
                BoxedUint::from(pow),
                BoxedUint::from(expect),
            );
            assert_eq!(base.wrapping_pow(&pow), expect);
            assert_eq!(base.wrapping_pow_vartime(&pow), expect);
            assert_eq!(Wrapping(base).pow(&pow), Wrapping(expect));
        }

        let two = BoxedUint::from(U128::from_u8(2));
        assert_eq!(two.wrapping_pow_vartime(U128::ZERO), U128::ONE);
        for i in 0..10 {
            let pow = 1u32 << i;
            assert_eq!(
                two.wrapping_pow_vartime(U128::from_u32(pow)),
                U128::from_u128(2u128.wrapping_pow(pow)),
                "i={i}"
            );
        }

        assert_eq!(
            BoxedUint::from(U128::from_u8(3))
                .wrapping_pow_vartime(U128::from_u128((1 << 64) + (1 << 63))),
            BoxedUint::from_be_hex("002b3854b3dc5d6e0000000000000001", 128).unwrap()
        );
    }

    #[test]
    fn pow_uintref() {
        let a = BoxedUint::from(1234567890u64).resize_unchecked(128);
        let b = UintRef::new(&[Limb(4), Limb(0)]);
        assert_eq!(
            a.wrapping_pow(b),
            BoxedUint::from(2323057227982592441500937982514410000u128)
        );
    }
}
