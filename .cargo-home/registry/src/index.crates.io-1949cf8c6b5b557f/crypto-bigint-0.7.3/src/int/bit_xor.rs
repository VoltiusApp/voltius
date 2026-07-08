//! [`Int`] bitwise XOR operations.

use core::ops::{BitXor, BitXorAssign};

use crate::{CtOption, Uint};

use super::Int;

impl<const LIMBS: usize> Int<LIMBS> {
    /// Computes bitwise `a ^ b`.
    #[inline(always)]
    #[must_use]
    pub const fn bitxor(&self, rhs: &Self) -> Self {
        Self(Uint::bitxor(&self.0, &rhs.0))
    }

    /// Perform wrapping bitwise `XOR`.
    ///
    /// There's no way wrapping could ever happen.
    /// This function exists so that all operations are accounted for in the wrapping operations
    #[must_use]
    pub const fn wrapping_xor(&self, rhs: &Self) -> Self {
        self.bitxor(rhs)
    }

    /// Perform checked bitwise `XOR`, returning a [`CtOption`] which `is_some` always
    #[must_use]
    pub fn checked_xor(&self, rhs: &Self) -> CtOption<Self> {
        CtOption::some(self.bitxor(rhs))
    }
}

impl<const LIMBS: usize> BitXor for Int<LIMBS> {
    type Output = Self;

    fn bitxor(self, rhs: Self) -> Int<LIMBS> {
        self.bitxor(&rhs)
    }
}

impl<const LIMBS: usize> BitXor<&Int<LIMBS>> for Int<LIMBS> {
    type Output = Int<LIMBS>;

    #[allow(clippy::needless_borrow)]
    fn bitxor(self, rhs: &Int<LIMBS>) -> Int<LIMBS> {
        (&self).bitxor(rhs)
    }
}

impl<const LIMBS: usize> BitXor<Int<LIMBS>> for &Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn bitxor(self, rhs: Int<LIMBS>) -> Int<LIMBS> {
        self.bitxor(&rhs)
    }
}

impl<const LIMBS: usize> BitXor<&Int<LIMBS>> for &Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn bitxor(self, rhs: &Int<LIMBS>) -> Int<LIMBS> {
        self.bitxor(rhs)
    }
}

impl<const LIMBS: usize> BitXorAssign for Int<LIMBS> {
    fn bitxor_assign(&mut self, other: Self) {
        *self = *self ^ other;
    }
}

impl<const LIMBS: usize> BitXorAssign<&Int<LIMBS>> for Int<LIMBS> {
    fn bitxor_assign(&mut self, other: &Self) {
        *self = *self ^ other;
    }
}

#[cfg(test)]
mod tests {
    use crate::I128;

    #[test]
    fn checked_xor_ok() {
        assert_eq!(I128::ZERO.checked_xor(&I128::ONE).unwrap(), I128::ONE);
        assert_eq!(I128::ONE.checked_xor(&I128::ONE).unwrap(), I128::ZERO);
        assert_eq!(
            I128::MAX.checked_xor(&I128::ONE).unwrap(),
            I128::MAX - I128::ONE
        );
    }

    #[test]
    fn wrapping_xor_ok() {
        assert_eq!(I128::ZERO.wrapping_xor(&I128::ONE), I128::ONE);
        assert_eq!(I128::ONE.wrapping_xor(&I128::ONE), I128::ZERO);
        assert_eq!(I128::MAX.wrapping_xor(&I128::ONE), I128::MAX - I128::ONE);
    }
}
