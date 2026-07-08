//! Limb negation

use crate::{Limb, NegMod, NonZero, WrappingNeg};

impl Limb {
    /// Perform wrapping negation.
    #[inline(always)]
    #[must_use]
    pub const fn wrapping_neg(self) -> Self {
        Limb(self.0.wrapping_neg())
    }
}

impl WrappingNeg for Limb {
    #[inline]
    fn wrapping_neg(&self) -> Self {
        Self(self.0.wrapping_neg())
    }
}

impl NegMod for Limb {
    type Output = Self;

    fn neg_mod(&self, p: &NonZero<Self>) -> Self::Output {
        let nz = self.is_nonzero();
        let res = p.borrowing_sub(*self, Limb::ZERO).0;
        Self::select(Limb::ZERO, res, nz)
    }
}
