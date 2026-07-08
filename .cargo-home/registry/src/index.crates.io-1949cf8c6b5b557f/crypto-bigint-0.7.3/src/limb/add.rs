//! Limb addition

use crate::{
    Add, AddAssign, AddMod, Checked, CheckedAdd, CtOption, Limb, Wrapping, WrappingAdd,
    primitives::{carrying_add, overflowing_add},
};

impl Limb {
    /// Computes `self + rhs + carry`, returning the result along with the new carry.
    #[deprecated(since = "0.7.0", note = "please use `carrying_add` instead")]
    #[must_use]
    pub const fn adc(self, rhs: Limb, carry: Limb) -> (Limb, Limb) {
        self.carrying_add(rhs, carry)
    }

    /// Computes `self + rhs + carry`, returning the result along with the new carry.
    #[inline(always)]
    #[must_use]
    pub const fn carrying_add(self, rhs: Limb, carry: Limb) -> (Limb, Limb) {
        let (res, carry) = carrying_add(self.0, rhs.0, carry.0);
        (Limb(res), Limb(carry))
    }

    /// Computes `self + rhs`, returning the result along with the carry.
    #[inline(always)]
    #[must_use]
    pub const fn overflowing_add(self, rhs: Limb) -> (Limb, Limb) {
        let (res, carry) = overflowing_add(self.0, rhs.0);
        (Limb(res), Limb(carry))
    }

    /// Perform saturating addition.
    #[inline]
    #[must_use]
    pub const fn saturating_add(&self, rhs: Self) -> Self {
        Limb(self.0.saturating_add(rhs.0))
    }

    /// Perform wrapping addition, discarding overflow.
    #[inline(always)]
    #[must_use]
    pub const fn wrapping_add(&self, rhs: Self) -> Self {
        Limb(self.0.wrapping_add(rhs.0))
    }
}

impl Add for Limb {
    type Output = Self;

    #[inline]
    fn add(self, rhs: Self) -> Self {
        self.checked_add(&rhs)
            .expect("attempted to add with overflow")
    }
}

impl Add<&Self> for Limb {
    type Output = Self;

    #[inline]
    fn add(self, rhs: &Self) -> Self {
        self + *rhs
    }
}

impl AddAssign for Limb {
    #[inline]
    fn add_assign(&mut self, other: Self) {
        *self = *self + other;
    }
}

impl AddAssign<&Limb> for Limb {
    #[inline]
    fn add_assign(&mut self, other: &Self) {
        *self = *self + *other;
    }
}

impl AddAssign for Wrapping<Limb> {
    #[inline]
    fn add_assign(&mut self, other: Self) {
        *self = *self + other;
    }
}

impl AddAssign<&Wrapping<Limb>> for Wrapping<Limb> {
    #[inline]
    fn add_assign(&mut self, other: &Self) {
        *self = *self + other;
    }
}

impl AddAssign for Checked<Limb> {
    #[inline]
    fn add_assign(&mut self, other: Self) {
        *self = *self + other;
    }
}

impl AddAssign<&Checked<Limb>> for Checked<Limb> {
    #[inline]
    fn add_assign(&mut self, other: &Self) {
        *self = *self + other;
    }
}

impl CheckedAdd for Limb {
    #[inline]
    fn checked_add(&self, rhs: &Self) -> CtOption<Self> {
        let (result, carry) = self.overflowing_add(*rhs);
        CtOption::new(result, carry.is_zero())
    }
}

impl WrappingAdd for Limb {
    #[inline]
    fn wrapping_add(&self, v: &Self) -> Self {
        self.wrapping_add(*v)
    }
}

impl AddMod for Limb {
    type Output = Self;

    fn add_mod(&self, rhs: &Self, p: &crate::NonZero<Self>) -> Self::Output {
        let (res, carry) = self.carrying_add(*rhs, Limb::ZERO);
        let (out, borrow) = res.borrowing_sub(p.get(), Limb::ZERO);
        let revert = borrow.lsb_to_choice().and(carry.is_zero());
        Self::select(out, res, revert)
    }
}

#[cfg(test)]
mod tests {
    use crate::{CheckedAdd, Limb};

    #[test]
    fn add_no_overflow() {
        assert_eq!(Limb::ZERO + Limb::ONE, Limb::ONE);
    }

    #[test]
    #[should_panic]
    fn add_with_overflow() {
        let _ = Limb::MAX + Limb::ONE;
    }

    #[test]
    fn carrying_add_no_carry() {
        let (res, carry) = Limb::ZERO.carrying_add(Limb::ONE, Limb::ZERO);
        assert_eq!(res, Limb::ONE);
        assert_eq!(carry, Limb::ZERO);

        // TODO(tarcieri): `adc` is deprecated: remove these when the method is removed
        #[allow(deprecated)]
        {
            let (res, carry) = Limb::ZERO.adc(Limb::ONE, Limb::ZERO);
            assert_eq!(res, Limb::ONE);
            assert_eq!(carry, Limb::ZERO);
        }
    }

    #[test]
    fn carrying_add_with_carry() {
        let (res, carry) = Limb::MAX.carrying_add(Limb::ZERO, Limb::ONE);
        assert_eq!(res, Limb::ZERO);
        assert_eq!(carry, Limb::ONE);

        // TODO(tarcieri): `adc` is deprecated: remove these when the method is removed
        #[allow(deprecated)]
        {
            let (res, carry) = Limb::MAX.adc(Limb::ZERO, Limb::ONE);
            assert_eq!(res, Limb::ZERO);
            assert_eq!(carry, Limb::ONE);
        }
    }

    #[test]
    fn checked_add() {
        assert_eq!(Limb::ZERO.checked_add(&Limb::ONE).unwrap(), Limb::ONE);
        assert_eq!(Limb::MAX.checked_add(&Limb::ONE).into_option(), None);
    }

    #[test]
    fn overflowing_add_no_carry() {
        let (res, carry) = Limb::ZERO.overflowing_add(Limb::ONE);
        assert_eq!(res, Limb::ONE);
        assert_eq!(carry, Limb::ZERO);
    }

    #[test]
    fn overflowing_add_with_carry() {
        let (res, carry) = Limb::MAX.overflowing_add(Limb::ONE);
        assert_eq!(res, Limb::ZERO);
        assert_eq!(carry, Limb::ONE);
    }

    #[test]
    fn saturating_add() {
        assert_eq!(Limb::ZERO.saturating_add(Limb::ONE), Limb::ONE);
        assert_eq!(Limb::MAX.saturating_add(Limb::ONE), Limb::MAX);
    }

    #[test]
    fn wrapping_add_no_carry() {
        assert_eq!(Limb::ZERO.wrapping_add(Limb::ONE), Limb::ONE);
    }

    #[test]
    fn wrapping_add_with_carry() {
        assert_eq!(Limb::MAX.wrapping_add(Limb::ONE), Limb::ZERO);
    }

    #[test]
    fn checked_add_ok() {
        let result = Limb::ZERO.checked_add(&Limb::ONE);
        assert_eq!(result.unwrap(), Limb::ONE);
    }

    #[test]
    fn checked_add_overflow() {
        let result = Limb::MAX.checked_add(&Limb::ONE);
        assert!(!bool::from(result.is_some()));
    }
}
