use super::UintRef;
use crate::Limb;
use ctutils::Choice;

impl UintRef {
    /// Perform an in-place borrowing subtraction of another [`UintRef`], returning the carried limb
    /// value.
    #[inline]
    pub const fn borrowing_sub_assign(&mut self, rhs: &Self, borrow: Limb) -> Limb {
        self.borrowing_sub_assign_slice(&rhs.limbs, borrow)
    }

    /// Perform an in-place borrowing subtraction of another limb slice, returning the borrowed limb
    /// value.
    ///
    /// # Panics
    /// If `self` and `rhs` have different lengths.
    #[inline]
    pub const fn borrowing_sub_assign_slice(&mut self, rhs: &[Limb], mut borrow: Limb) -> Limb {
        assert!(self.limbs.len() == rhs.len(), "length mismatch");
        let mut i = 0;
        while i < self.limbs.len() {
            (self.limbs[i], borrow) = self.limbs[i].borrowing_sub(rhs[i], borrow);
            i += 1;
        }
        borrow
    }

    /// Perform in-place wrapping subtraction, returning the truthy value as the second element of
    /// the tuple if an underflow has occurred.
    pub(crate) fn conditional_borrowing_sub_assign(
        &mut self,
        rhs: &Self,
        choice: Choice,
    ) -> Choice {
        debug_assert!(self.bits_precision() <= rhs.bits_precision());
        let mask = Limb::select(Limb::ZERO, Limb::MAX, choice);
        let mut borrow = Limb::ZERO;

        for i in 0..self.nlimbs() {
            let masked_rhs = *rhs.limbs.get(i).unwrap_or(&Limb::ZERO) & mask;
            let (limb, b) = self.limbs[i].borrowing_sub(masked_rhs, borrow);
            self.limbs[i] = limb;
            borrow = b;
        }

        borrow.lsb_to_choice()
    }
}
