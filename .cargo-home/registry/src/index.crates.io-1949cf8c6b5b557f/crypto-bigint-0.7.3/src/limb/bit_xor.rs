//! Limb bit xor operations.

use super::Limb;
use core::ops::{BitXor, BitXorAssign};

impl Limb {
    /// Calculates `a ^ b`.
    #[inline(always)]
    #[must_use]
    pub const fn bitxor(self, rhs: Self) -> Self {
        Limb(self.0 ^ rhs.0)
    }
}

impl BitXor for Limb {
    type Output = Limb;

    fn bitxor(self, rhs: Self) -> Self::Output {
        self.bitxor(rhs)
    }
}

impl BitXor<&Self> for Limb {
    type Output = Limb;

    fn bitxor(self, rhs: &Self) -> Self::Output {
        self.bitxor(*rhs)
    }
}

impl BitXorAssign for Limb {
    fn bitxor_assign(&mut self, rhs: Self) {
        *self = self.bitxor(rhs);
    }
}

impl BitXorAssign<&Limb> for Limb {
    fn bitxor_assign(&mut self, rhs: &Self) {
        *self = self.bitxor(*rhs);
    }
}

#[cfg(test)]
mod tests {
    use crate::Limb;

    #[test]
    fn bitxor() {
        assert_eq!(Limb::ZERO ^ Limb::ZERO, Limb::ZERO);
        assert_eq!(Limb::ZERO ^ Limb::ONE, Limb::ONE);
        assert_eq!(Limb::ONE ^ Limb::ZERO, Limb::ONE);
        assert_eq!(Limb::ONE ^ Limb::ONE, Limb::ZERO);
    }

    #[test]
    fn bitxor_assign() {
        let mut n = Limb::ZERO;

        n ^= Limb::ZERO;
        assert_eq!(n, Limb::ZERO);

        n ^= Limb::ONE;
        assert_eq!(n, Limb::ONE);

        n ^= Limb::ZERO;
        assert_eq!(n, Limb::ONE);

        n ^= Limb::ONE;
        assert_eq!(n, Limb::ZERO);
    }
}
