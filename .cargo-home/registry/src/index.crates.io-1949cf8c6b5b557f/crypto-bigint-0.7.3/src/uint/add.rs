//! [`Uint`] addition operations.

use crate::{
    Add, AddAssign, Checked, CheckedAdd, CtOption, Limb, Uint, Wrapping, WrappingAdd, word,
};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Computes `self + rhs + carry`, returning the result along with the new carry.
    #[deprecated(since = "0.7.0", note = "please use `carrying_add` instead")]
    #[must_use]
    pub const fn adc(&self, rhs: &Self, carry: Limb) -> (Self, Limb) {
        self.carrying_add(rhs, carry)
    }

    /// Computes `self + rhs + carry`, returning the result along with the new carry.
    #[inline(always)]
    #[must_use]
    pub const fn carrying_add(&self, rhs: &Self, mut carry: Limb) -> (Self, Limb) {
        let mut limbs = [Limb::ZERO; LIMBS];
        let mut i = 0;

        while i < LIMBS {
            let (w, c) = self.limbs[i].carrying_add(rhs.limbs[i], carry);
            limbs[i] = w;
            carry = c;
            i += 1;
        }

        (Self { limbs }, carry)
    }

    /// Perform saturating addition, returning `MAX` on overflow.
    #[must_use]
    pub const fn saturating_add(&self, rhs: &Self) -> Self {
        let (res, overflow) = self.carrying_add(rhs, Limb::ZERO);
        Self::select(&res, &Self::MAX, word::choice_from_lsb(overflow.0))
    }

    /// Perform wrapping addition, discarding overflow.
    #[inline]
    #[must_use]
    pub const fn wrapping_add(&self, rhs: &Self) -> Self {
        self.carrying_add(rhs, Limb::ZERO).0
    }

    /// Computes `self + rhs + carry`, returning the result along with the new carry.
    #[inline]
    pub(crate) const fn overflowing_add_limb(&self, mut carry: Limb) -> (Self, Limb) {
        let mut limbs = [Limb::ZERO; LIMBS];
        let mut i = 0;

        while i < LIMBS {
            (limbs[i], carry) = self.limbs[i].overflowing_add(carry);
            i += 1;
        }

        (Self { limbs }, carry)
    }

    /// Computes `self + rhs`, discarding overflow.
    #[inline]
    pub(crate) const fn wrapping_add_limb(&self, rhs: Limb) -> Self {
        self.overflowing_add_limb(rhs).0
    }
}

impl<const LIMBS: usize> Add for Uint<LIMBS> {
    type Output = Self;

    fn add(self, rhs: Self) -> Self {
        self.add(&rhs)
    }
}

impl<const LIMBS: usize> Add<&Uint<LIMBS>> for Uint<LIMBS> {
    type Output = Self;

    fn add(self, rhs: &Self) -> Self {
        self.checked_add(rhs)
            .expect("attempted to add with overflow")
    }
}

impl<const LIMBS: usize> AddAssign for Uint<LIMBS> {
    fn add_assign(&mut self, other: Self) {
        *self += &other;
    }
}

impl<const LIMBS: usize> AddAssign<&Uint<LIMBS>> for Uint<LIMBS> {
    fn add_assign(&mut self, other: &Self) {
        *self = *self + other;
    }
}

impl<const LIMBS: usize> AddAssign for Wrapping<Uint<LIMBS>> {
    fn add_assign(&mut self, other: Self) {
        *self = *self + other;
    }
}

impl<const LIMBS: usize> AddAssign<&Wrapping<Uint<LIMBS>>> for Wrapping<Uint<LIMBS>> {
    fn add_assign(&mut self, other: &Self) {
        *self = *self + other;
    }
}

impl<const LIMBS: usize> AddAssign for Checked<Uint<LIMBS>> {
    fn add_assign(&mut self, other: Self) {
        *self = *self + other;
    }
}

impl<const LIMBS: usize> AddAssign<&Checked<Uint<LIMBS>>> for Checked<Uint<LIMBS>> {
    fn add_assign(&mut self, other: &Self) {
        *self = *self + other;
    }
}

impl<const LIMBS: usize> CheckedAdd for Uint<LIMBS> {
    fn checked_add(&self, rhs: &Self) -> CtOption<Self> {
        let (result, carry) = self.carrying_add(rhs, Limb::ZERO);
        CtOption::new(result, carry.is_zero())
    }
}

impl<const LIMBS: usize> WrappingAdd for Uint<LIMBS> {
    fn wrapping_add(&self, v: &Self) -> Self {
        self.wrapping_add(v)
    }
}

#[cfg(test)]
mod tests {
    use crate::{CheckedAdd, Limb, U128};

    #[test]
    fn carrying_add_no_carry() {
        let (res, carry) = U128::ZERO.carrying_add(&U128::ONE, Limb::ZERO);
        assert_eq!(res, U128::ONE);
        assert_eq!(carry, Limb::ZERO);
    }

    #[test]
    fn carrying_add_with_carry() {
        let (res, carry) = U128::MAX.carrying_add(&U128::ONE, Limb::ZERO);
        assert_eq!(res, U128::ZERO);
        assert_eq!(carry, Limb::ONE);
    }

    #[test]
    fn saturating_add_no_carry() {
        assert_eq!(U128::ZERO.saturating_add(&U128::ONE), U128::ONE);
    }

    #[test]
    fn saturating_add_with_carry() {
        assert_eq!(U128::MAX.saturating_add(&U128::ONE), U128::MAX);
    }

    #[test]
    fn wrapping_add_no_carry() {
        assert_eq!(U128::ZERO.wrapping_add(&U128::ONE), U128::ONE);
    }

    #[test]
    fn wrapping_add_with_carry() {
        assert_eq!(U128::MAX.wrapping_add(&U128::ONE), U128::ZERO);
    }

    #[test]
    fn checked_add_ok() {
        let result = U128::ZERO.checked_add(&U128::ONE);
        assert_eq!(result.unwrap(), U128::ONE);
    }

    #[test]
    fn checked_add_overflow() {
        let result = U128::MAX.checked_add(&U128::ONE);
        assert!(!bool::from(result.is_some()));
    }

    #[test]
    fn overflowing_add_limb() {
        let result = U128::ZERO.overflowing_add_limb(Limb::ZERO);
        assert_eq!(result, (U128::ZERO, Limb::ZERO));
        let result = U128::ZERO.overflowing_add_limb(Limb::ONE);
        assert_eq!(result, (U128::ONE, Limb::ZERO));
        let result = U128::MAX.overflowing_add_limb(Limb::ZERO);
        assert_eq!(result, (U128::MAX, Limb::ZERO));
        let result = U128::MAX.overflowing_add_limb(Limb::ONE);
        assert_eq!(result, (U128::ZERO, Limb::ONE));

        assert_eq!(U128::ZERO.wrapping_add_limb(Limb::ZERO), U128::ZERO);
        assert_eq!(U128::ZERO.wrapping_add_limb(Limb::ONE), U128::ONE);
        assert_eq!(U128::MAX.wrapping_add_limb(Limb::ZERO), U128::MAX);
        assert_eq!(U128::MAX.wrapping_add_limb(Limb::ONE), U128::ZERO);
    }
}
