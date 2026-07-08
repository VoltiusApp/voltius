use super::UintRef;
use crate::{Choice, Limb};

impl UintRef {
    /// Copy the contents from a [`UintRef`].
    ///
    /// # Panics
    /// If `self.nlimbs() != rhs.nlimbs()`
    #[inline(always)]
    #[track_caller]
    pub const fn copy_from(&mut self, rhs: &UintRef) {
        self.copy_from_slice(&rhs.limbs);
    }

    /// Conditionally copy the contents from a [`UintRef`].
    ///
    /// # Panics
    /// If `self.nlimbs() != rhs.nlimbs()`
    #[inline(always)]
    #[track_caller]
    pub const fn conditional_copy_from(&mut self, rhs: &UintRef, copy: Choice) {
        self.conditional_copy_from_slice(&rhs.limbs, copy);
    }

    /// Copy the contents from a limb slice.
    ///
    /// # Panics
    /// If `self.nlimbs() != limbs.len()`
    #[inline(always)]
    #[track_caller]
    pub const fn copy_from_slice(&mut self, limbs: &[Limb]) {
        // TODO core::slice::copy_from_slice should eventually be const
        debug_assert!(self.limbs.len() == limbs.len(), "length mismatch");
        let mut i = 0;
        while i < self.limbs.len() {
            self.limbs[i] = limbs[i];
            i += 1;
        }
    }

    /// Conditionally copy the contents from a limb slice.
    ///
    /// # Panics
    /// If `self.nlimbs() != rhs.nlimbs()`
    #[inline(always)]
    #[track_caller]
    pub const fn conditional_copy_from_slice(&mut self, limbs: &[Limb], copy: Choice) {
        debug_assert!(self.limbs.len() == limbs.len(), "length mismatch");
        let mut i = 0;
        while i < self.limbs.len() {
            self.limbs[i] = Limb::select(self.limbs[i], limbs[i], copy);
            i += 1;
        }
    }

    /// Fill the limb slice with a repeated limb value.
    #[inline(always)]
    pub const fn fill(&mut self, limb: Limb) {
        let mut i = 0;
        while i < self.limbs.len() {
            self.limbs[i] = limb;
            i += 1;
        }
    }

    /// Split the limb slice at a fixed position, producing head and tail slices.
    #[inline]
    #[track_caller]
    #[must_use]
    pub const fn split_at(&self, mid: usize) -> (&Self, &Self) {
        let (a, b) = self.limbs.split_at(mid);
        (UintRef::new(a), UintRef::new(b))
    }

    /// Split the mutable limb slice at index `mid`, producing head and tail slices.
    #[inline]
    #[track_caller]
    #[must_use]
    pub const fn split_at_mut(&mut self, mid: usize) -> (&mut Self, &mut Self) {
        let (a, b) = self.limbs.split_at_mut(mid);
        (UintRef::new_mut(a), UintRef::new_mut(b))
    }

    /// Access a limb slice up to a number of elements `len`.
    #[inline]
    #[track_caller]
    #[must_use]
    pub const fn leading(&self, len: usize) -> &Self {
        Self::new(self.limbs.split_at(len).0)
    }

    /// Access a mutable limb slice up to a number of elements `len`.
    #[inline]
    #[track_caller]
    #[must_use]
    pub const fn leading_mut(&mut self, len: usize) -> &mut Self {
        Self::new_mut(self.limbs.split_at_mut(len).0)
    }

    /// Access a limb slice starting from the index `start`.
    #[inline]
    #[track_caller]
    #[must_use]
    pub const fn trailing(&self, start: usize) -> &Self {
        Self::new(self.limbs.split_at(start).1)
    }

    /// Access a mutable limb slice starting from the index `start`.
    #[inline]
    #[track_caller]
    #[must_use]
    pub const fn trailing_mut(&mut self, start: usize) -> &mut Self {
        Self::new_mut(self.limbs.split_at_mut(start).1)
    }

    /// Determine if the slice has zero limbs.
    #[inline]
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.limbs.is_empty()
    }
}
