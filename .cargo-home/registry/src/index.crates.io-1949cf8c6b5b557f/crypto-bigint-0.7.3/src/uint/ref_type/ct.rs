//! Constant-time support: impls of `Ct*` traits and constant-time `const fn` operations.

use super::UintRef;
use crate::{Choice, CtAssign, CtEq, CtLt};

impl CtAssign for UintRef {
    #[inline]
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        debug_assert_eq!(self.bits_precision(), other.bits_precision());
        self.limbs.ct_assign(&other.limbs, choice);
    }
}

impl<Rhs: AsRef<UintRef> + ?Sized> CtEq<Rhs> for UintRef {
    #[inline]
    fn ct_eq(&self, other: &Rhs) -> Choice {
        let rhs = other.as_ref();
        let overlap = if self.nlimbs() < rhs.nlimbs() {
            self.nlimbs()
        } else {
            rhs.nlimbs()
        };
        let (lhs, lhs_over) = self.split_at(overlap);
        let (rhs, rhs_over) = rhs.split_at(overlap);
        lhs.limbs
            .ct_eq(&rhs.limbs)
            .and(lhs_over.is_zero())
            .and(rhs_over.is_zero())
    }
}

impl CtLt for UintRef {
    #[inline]
    fn ct_lt(&self, other: &Self) -> Choice {
        Self::lt(self, other)
    }
}

#[cfg(test)]
mod tests {
    use ctutils::CtLt;

    use super::UintRef;
    use crate::{CtEq, Limb};

    #[test]
    fn ct_eq() {
        let z_small = UintRef::new(&[Limb::ZERO, Limb::ZERO]);
        let z_big = UintRef::new(&[Limb::ZERO, Limb::ZERO, Limb::ZERO]);
        let a = UintRef::new(&[Limb::ZERO, Limb::ZERO, Limb::ONE]);

        assert!(z_small.ct_eq(z_big).to_bool());
        assert!(z_big.ct_eq(z_small).to_bool());
        assert!(a.ct_eq(a).to_bool());
        assert!(!z_small.ct_eq(a).to_bool());
        assert!(!a.ct_eq(z_small).to_bool());
        assert!(!z_big.ct_eq(a).to_bool());
        assert!(!a.ct_eq(z_big).to_bool());
    }

    #[test]
    fn ct_lt() {
        let lesser = UintRef::new(&[Limb::ZERO, Limb::ZERO, Limb::ZERO]);
        let greater = UintRef::new(&[Limb::ZERO, Limb::ONE, Limb::ZERO]);
        assert!(lesser.ct_lt(greater).to_bool());
        assert!(!greater.ct_lt(lesser).to_bool());

        let smaller = UintRef::new(&[Limb::ZERO, Limb::ZERO]);
        let bigger = UintRef::new(&[Limb::ZERO, Limb::ZERO, Limb::ONE]);
        assert!(smaller.ct_lt(bigger).to_bool());
        assert!(!bigger.ct_lt(smaller).to_bool());
    }
}
