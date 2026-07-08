//! [`Uint`] exponentiation operations.

use super::Uint;
use crate::{Checked, Choice, CtOption, Limb, PowBoundedExp, Wrapping};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Computes `self^exp`, returning a `CtOption` which is none in the case of overflow.
    #[must_use]
    pub const fn checked_pow<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
    ) -> CtOption<Self> {
        self.checked_pow_bounded_exp(exp, Uint::<RHS_LIMBS>::BITS)
    }

    /// Computes `self^exp`, returning a `CtOption` which is none in the case of overflow.
    ///
    /// NOTE: `exp_bits` may be leaked in the time pattern.
    ///
    /// # Panics
    /// - if `exp_bits` exceeds the capacity of `rhs`
    #[must_use]
    pub const fn checked_pow_bounded_exp<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
        exp_bits: u32,
    ) -> CtOption<Self> {
        let (lo, overflow) = self.overflowing_pow_bounded_exp(exp, exp_bits);
        CtOption::new(lo, overflow.not())
    }

    /// Computes `self^exp`, returning a `CtOption` which is none in the case of overflow.
    ///
    /// This method is variable time in the exponent `exp` only.
    #[must_use]
    pub const fn checked_pow_vartime<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
    ) -> CtOption<Self> {
        let (lo, overflow) = self.overflowing_pow_vartime(exp);
        CtOption::new(lo, overflow.not())
    }

    /// Computes `self^exp`, returning a `Self::MAX` in the case of overflow.
    #[must_use]
    pub const fn saturating_pow<const RHS_LIMBS: usize>(&self, exp: &Uint<RHS_LIMBS>) -> Self {
        self.saturating_pow_bounded_exp(exp, Uint::<RHS_LIMBS>::BITS)
    }

    /// Computes `self^exp`, returning a `Self::MAX` in the case of overflow.
    ///
    /// NOTE: `exp_bits` may be leaked in the time pattern.
    ///
    /// # Panics
    /// - if `exp_bits` exceeds the capacity of `rhs`
    #[must_use]
    pub const fn saturating_pow_bounded_exp<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
        exp_bits: u32,
    ) -> Self {
        let (lo, overflow) = self.overflowing_pow_bounded_exp(exp, exp_bits);
        Self::select(&lo, &Self::MAX, overflow)
    }

    /// Computes `self^exp`, returning a `Self::MAX` in the case of overflow.
    ///
    /// This method is variable time in the exponent `exp`.
    #[must_use]
    pub const fn saturating_pow_vartime<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
    ) -> Self {
        let (lo, overflow) = self.overflowing_pow_vartime(exp);
        Self::select(&lo, &Self::MAX, overflow)
    }

    /// Computes `self^exp`, discarding overflow.
    #[must_use]
    pub const fn wrapping_pow<const RHS_LIMBS: usize>(&self, exp: &Uint<RHS_LIMBS>) -> Self {
        self.wrapping_pow_bounded_exp(exp, Uint::<RHS_LIMBS>::BITS)
    }

    /// Computes `self^exp`, discarding overflow.
    ///
    /// NOTE: `exp_bits` may be leaked in the time pattern.
    ///
    /// # Panics
    /// - if `exp_bits` exceeds the capacity of `rhs`
    #[must_use]
    pub const fn wrapping_pow_bounded_exp<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
        exp_bits: u32,
    ) -> Self {
        assert!(exp_bits <= Uint::<RHS_LIMBS>::BITS);
        let mut ret = Self::ONE;
        let mut limbs = exp_bits.div_ceil(Limb::BITS);
        let mut i = exp_bits - limbs.saturating_sub(1) * Limb::BITS;
        while limbs > 0 {
            limbs -= 1;
            let limb = exp.limbs[limbs as usize];
            while i > 0 {
                i -= 1;
                ret = ret.wrapping_square();
                let apply = limb.shr(i).lsb_to_choice();
                ret = Uint::select(&ret, &ret.wrapping_mul(self), apply);
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
    pub const fn wrapping_pow_vartime<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
    ) -> Self {
        let mut exp_bits = exp.bits_vartime();
        if exp_bits == 0 {
            return Self::ONE;
        }
        exp_bits -= 1;
        let mut ret = *self;
        let mut limbs = exp_bits.div_ceil(Limb::BITS);
        let mut i = exp_bits - limbs.saturating_sub(1) * Limb::BITS;
        while limbs > 0 {
            limbs -= 1;
            let word = exp.limbs[limbs as usize].0;
            while i > 0 {
                i -= 1;
                ret = ret.wrapping_square();
                if (word >> i) & 1 == 1 {
                    ret = ret.wrapping_mul(self);
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
    pub(crate) const fn overflowing_pow_bounded_exp<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
        exp_bits: u32,
    ) -> (Self, Choice) {
        assert!(exp_bits <= Uint::<RHS_LIMBS>::BITS);
        let mut ret = Self::ONE;
        let mut overflow = Choice::FALSE;
        let mut check;
        let mut limbs = exp_bits.div_ceil(Limb::BITS);
        let mut i = exp_bits - limbs.saturating_sub(1) * Limb::BITS;
        while limbs > 0 {
            limbs -= 1;
            let limb = exp.limbs[limbs as usize];
            while i > 0 {
                i -= 1;
                (ret, check) = ret.overflowing_square();
                overflow = overflow.or(check);
                let (mul, check) = ret.overflowing_mul(self);
                let apply = limb.shr(i).lsb_to_choice();
                ret = Uint::select(&ret, &mul, apply);
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
    pub(crate) const fn overflowing_pow_vartime<const RHS_LIMBS: usize>(
        &self,
        exp: &Uint<RHS_LIMBS>,
    ) -> (Self, Choice) {
        let mut exp_bits = exp.bits_vartime();
        if exp_bits == 0 {
            return (Self::ONE, Choice::FALSE);
        }
        exp_bits -= 1;
        let mut ret = *self;
        let mut overflow = Choice::FALSE;
        let mut check;
        let mut limbs = exp_bits.div_ceil(Limb::BITS);
        let mut i = exp_bits - limbs.saturating_sub(1) * Limb::BITS;
        while limbs > 0 {
            limbs -= 1;
            let word = exp.limbs[limbs as usize].0;
            while i > 0 {
                i -= 1;
                (ret, check) = ret.overflowing_square();
                overflow = overflow.or(check);
                if (word >> i) & 1 == 1 {
                    (ret, check) = ret.overflowing_mul(self);
                    overflow = overflow.or(check);
                }
            }
            i = Limb::BITS;
        }
        (ret, overflow)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> PowBoundedExp<Uint<RHS_LIMBS>>
    for Checked<Uint<LIMBS>>
{
    fn pow_bounded_exp(&self, exponent: &Uint<RHS_LIMBS>, exponent_bits: u32) -> Self {
        Checked(
            self.0
                .and_then(|base| base.checked_pow_bounded_exp(exponent, exponent_bits)),
        )
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> PowBoundedExp<Uint<RHS_LIMBS>>
    for Wrapping<Uint<LIMBS>>
{
    fn pow_bounded_exp(&self, exponent: &Uint<RHS_LIMBS>, exponent_bits: u32) -> Self {
        Wrapping(self.0.wrapping_pow_bounded_exp(exponent, exponent_bits))
    }
}

#[cfg(test)]
mod tests {
    use crate::{Checked, CtOption, Pow, U128, Wrapping};

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
            assert_eq!(base.wrapping_pow(&pow), expect);
            assert_eq!(base.wrapping_pow_vartime(&pow), expect);
            assert_eq!(Wrapping(base).pow(&pow), Wrapping(expect));
        }

        let two = U128::from_u8(2);
        assert_eq!(two.wrapping_pow_vartime(&U128::ZERO), U128::ONE);
        for i in 0..10 {
            let pow = 1u32 << i;
            assert_eq!(
                two.wrapping_pow_vartime(&U128::from_u32(pow)),
                U128::from_u128(2u128.wrapping_pow(pow)),
                "i={i}"
            );
        }

        assert_eq!(
            U128::from_u8(3).wrapping_pow_vartime(&U128::from_u128((1 << 64) + (1 << 63))),
            U128::from_be_hex("002b3854b3dc5d6e0000000000000001")
        );
    }
}
