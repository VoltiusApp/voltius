//! [`BoxedUint`] bitwise OR operations.

use crate::{BitOr, BitOrAssign, BoxedUint, CtOption};

impl BoxedUint {
    /// Computes bitwise `a | b`.
    #[inline(always)]
    #[must_use]
    pub fn bitor(&self, rhs: &Self) -> Self {
        Self::map_limbs(self, rhs, crate::limb::Limb::bitor)
    }

    /// Perform wrapping bitwise `OR`.
    ///
    /// There's no way wrapping could ever happen.
    /// This function exists so that all operations are accounted for in the wrapping operations
    #[must_use]
    pub fn wrapping_or(&self, rhs: &Self) -> Self {
        self.bitor(rhs)
    }

    /// Perform checked bitwise `OR`, returning a [`CtOption`] which `is_some` always
    #[must_use]
    pub fn checked_or(&self, rhs: &Self) -> CtOption<Self> {
        CtOption::some(self.bitor(rhs))
    }
}

impl BitOr for BoxedUint {
    type Output = Self;

    fn bitor(self, rhs: Self) -> BoxedUint {
        self.bitor(&rhs)
    }
}

impl BitOr<&BoxedUint> for BoxedUint {
    type Output = BoxedUint;

    #[allow(clippy::needless_borrow)]
    fn bitor(self, rhs: &BoxedUint) -> BoxedUint {
        (&self).bitor(rhs)
    }
}

impl BitOr<BoxedUint> for &BoxedUint {
    type Output = BoxedUint;

    fn bitor(self, rhs: BoxedUint) -> BoxedUint {
        self.bitor(&rhs)
    }
}

impl BitOr<&BoxedUint> for &BoxedUint {
    type Output = BoxedUint;

    fn bitor(self, rhs: &BoxedUint) -> BoxedUint {
        self.bitor(rhs)
    }
}

impl BitOrAssign for BoxedUint {
    fn bitor_assign(&mut self, other: Self) {
        Self::bitor_assign(self, &other);
    }
}

impl BitOrAssign<&BoxedUint> for BoxedUint {
    fn bitor_assign(&mut self, other: &Self) {
        for (a, b) in self.limbs.iter_mut().zip(other.limbs.iter()) {
            *a |= *b;
        }
    }
}
