use super::UintRef;
use crate::{Choice, Limb};

impl UintRef {
    /// Perform an in-place carrying add of a limb, returning the carried limb value.
    #[inline]
    #[track_caller]
    pub const fn add_assign_limb(&mut self, mut rhs: Limb) -> Limb {
        let mut i = 0;
        while i < self.limbs.len() {
            (self.limbs[i], rhs) = self.limbs[i].overflowing_add(rhs);
            i += 1;
        }
        rhs
    }

    /// Perform an in-place carrying add of another [`UintRef`], returning the carried limb value.
    #[inline]
    #[track_caller]
    pub const fn carrying_add_assign(&mut self, rhs: &Self, carry: Limb) -> Limb {
        self.carrying_add_assign_slice(&rhs.limbs, carry)
    }

    /// Perform an in-place carrying add of another limb slice, returning the carried limb value.
    ///
    /// # Panics
    /// If `self` and `rhs` have different lengths.
    #[inline]
    #[track_caller]
    pub const fn carrying_add_assign_slice(&mut self, rhs: &[Limb], mut carry: Limb) -> Limb {
        assert!(
            self.limbs.len() == rhs.len(),
            "length mismatch in carrying_add_assign_slice"
        );
        let mut i = 0;
        while i < self.limbs.len() {
            (self.limbs[i], carry) = self.limbs[i].carrying_add(rhs[i], carry);
            i += 1;
        }
        carry
    }

    /// Perform an in-place carrying add of another limb slice, returning the carried limb value.
    #[inline]
    #[track_caller]
    pub const fn conditional_add_assign(
        &mut self,
        rhs: &Self,
        carry: Limb,
        choice: Choice,
    ) -> Limb {
        self.conditional_add_assign_slice(rhs.as_limbs(), carry, choice)
    }

    /// Perform an in-place carrying add of another limb slice, returning the carried limb value.
    ///
    /// # Panics
    /// If `self` and `rhs` have different lengths.
    #[inline]
    #[track_caller]
    pub const fn conditional_add_assign_slice(
        &mut self,
        rhs: &[Limb],
        mut carry: Limb,
        choice: Choice,
    ) -> Limb {
        assert!(
            self.limbs.len() == rhs.len(),
            "length mismatch in conditional_add_assign_slice"
        );
        let mut i = 0;
        while i < self.limbs.len() {
            (self.limbs[i], carry) =
                self.limbs[i].carrying_add(Limb::select(Limb::ZERO, rhs[i], choice), carry);
            i += 1;
        }
        carry
    }
}
