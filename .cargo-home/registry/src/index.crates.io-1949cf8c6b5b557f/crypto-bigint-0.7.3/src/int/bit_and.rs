//! [`Int`] bitwise AND operations.

use core::ops::{BitAnd, BitAndAssign};

use crate::{CtOption, Int, Limb, Uint};

impl<const LIMBS: usize> Int<LIMBS> {
    /// Computes bitwise `a & b`.
    #[inline(always)]
    #[must_use]
    pub const fn bitand(&self, rhs: &Self) -> Self {
        Self(Uint::bitand(&self.0, &rhs.0))
    }

    /// Perform bitwise `AND` between `self` and the given [`Limb`], performing the `AND` operation
    /// on every limb of `self`.
    #[must_use]
    pub const fn bitand_limb(&self, rhs: Limb) -> Self {
        Self(Uint::bitand_limb(&self.0, rhs))
    }

    /// Perform wrapping bitwise `AND`.
    ///
    /// There's no way wrapping could ever happen.
    /// This function exists so that all operations are accounted for in the wrapping operations
    #[must_use]
    pub const fn wrapping_and(&self, rhs: &Self) -> Self {
        self.bitand(rhs)
    }

    /// Perform checked bitwise `AND`, returning a [`CtOption`] which `is_some` always
    #[must_use]
    pub const fn checked_and(&self, rhs: &Self) -> CtOption<Self> {
        CtOption::some(self.bitand(rhs))
    }
}

impl<const LIMBS: usize> BitAnd for Int<LIMBS> {
    type Output = Self;

    fn bitand(self, rhs: Self) -> Int<LIMBS> {
        self.bitand(&rhs)
    }
}

impl<const LIMBS: usize> BitAnd<&Int<LIMBS>> for Int<LIMBS> {
    type Output = Int<LIMBS>;

    #[allow(clippy::needless_borrow)]
    fn bitand(self, rhs: &Int<LIMBS>) -> Int<LIMBS> {
        (&self).bitand(rhs)
    }
}

impl<const LIMBS: usize> BitAnd<Int<LIMBS>> for &Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn bitand(self, rhs: Int<LIMBS>) -> Int<LIMBS> {
        self.bitand(&rhs)
    }
}

impl<const LIMBS: usize> BitAnd<&Int<LIMBS>> for &Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn bitand(self, rhs: &Int<LIMBS>) -> Int<LIMBS> {
        self.bitand(rhs)
    }
}

impl<const LIMBS: usize> BitAndAssign for Int<LIMBS> {
    #[allow(clippy::assign_op_pattern)]
    fn bitand_assign(&mut self, other: Self) {
        *self = *self & other;
    }
}

impl<const LIMBS: usize> BitAndAssign<&Int<LIMBS>> for Int<LIMBS> {
    #[allow(clippy::assign_op_pattern)]
    fn bitand_assign(&mut self, other: &Self) {
        *self = *self & other;
    }
}

#[cfg(test)]
mod tests {
    use crate::I128;

    #[test]
    fn checked_and_ok() {
        assert_eq!(I128::ZERO.checked_and(&I128::ONE).unwrap(), I128::ZERO);
        assert_eq!(I128::ONE.checked_and(&I128::ONE).unwrap(), I128::ONE);
        assert_eq!(I128::MAX.checked_and(&I128::ONE).unwrap(), I128::ONE);
    }

    #[test]
    fn wrapping_and_ok() {
        assert_eq!(I128::ZERO.wrapping_and(&I128::ONE), I128::ZERO);
        assert_eq!(I128::ONE.wrapping_and(&I128::ONE), I128::ONE);
        assert_eq!(I128::MAX.wrapping_and(&I128::ONE), I128::ONE);
    }
}
