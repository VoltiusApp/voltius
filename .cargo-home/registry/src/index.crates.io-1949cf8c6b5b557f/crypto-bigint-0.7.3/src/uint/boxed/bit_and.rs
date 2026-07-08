//! [`BoxedUint`] bitwise AND operations.

use super::BoxedUint;
use crate::{BitAnd, BitAndAssign, CtOption, Limb};

impl BoxedUint {
    /// Computes bitwise `a & b`.
    #[inline(always)]
    #[must_use]
    pub fn bitand(&self, rhs: &Self) -> Self {
        Self::map_limbs(self, rhs, Limb::bitand)
    }

    /// Perform bitwise `AND` between `self` and the given [`Limb`], performing the `AND` operation
    /// on every limb of `self`.
    #[must_use]
    pub fn bitand_limb(&self, rhs: Limb) -> Self {
        Self {
            limbs: self.limbs.iter().map(|limb| limb.bitand(rhs)).collect(),
        }
    }

    /// Perform wrapping bitwise `AND`.
    ///
    /// There's no way wrapping could ever happen.
    /// This function exists so that all operations are accounted for in the wrapping operations
    #[must_use]
    pub fn wrapping_and(&self, rhs: &Self) -> Self {
        self.bitand(rhs)
    }

    /// Perform checked bitwise `AND`, returning a [`CtOption`] which `is_some` always
    #[must_use]
    pub fn checked_and(&self, rhs: &Self) -> CtOption<Self> {
        CtOption::some(self.bitand(rhs))
    }
}

impl BitAnd for BoxedUint {
    type Output = Self;

    fn bitand(self, rhs: Self) -> BoxedUint {
        self.bitand(&rhs)
    }
}

impl BitAnd<&BoxedUint> for BoxedUint {
    type Output = BoxedUint;

    #[allow(clippy::needless_borrow)]
    fn bitand(self, rhs: &BoxedUint) -> BoxedUint {
        (&self).bitand(rhs)
    }
}

impl BitAnd<BoxedUint> for &BoxedUint {
    type Output = BoxedUint;

    fn bitand(self, rhs: BoxedUint) -> BoxedUint {
        self.bitand(&rhs)
    }
}

impl BitAnd<&BoxedUint> for &BoxedUint {
    type Output = BoxedUint;

    fn bitand(self, rhs: &BoxedUint) -> BoxedUint {
        self.bitand(rhs)
    }
}

impl BitAndAssign for BoxedUint {
    #[allow(clippy::assign_op_pattern)]
    fn bitand_assign(&mut self, other: Self) {
        *self = BoxedUint::bitand(self, &other);
    }
}

impl BitAndAssign<&BoxedUint> for BoxedUint {
    #[allow(clippy::assign_op_pattern)]
    fn bitand_assign(&mut self, other: &Self) {
        *self = BoxedUint::bitand(self, other);
    }
}

#[cfg(test)]
mod tests {
    use crate::BoxedUint;

    #[test]
    fn checked_and_ok() {
        let result = BoxedUint::zero().checked_and(&BoxedUint::one());
        assert_eq!(result.unwrap(), BoxedUint::zero());
    }

    #[test]
    fn overlapping_and_ok() {
        let result = BoxedUint::max(128).wrapping_and(&BoxedUint::one());
        assert_eq!(result, BoxedUint::one());
    }
}
