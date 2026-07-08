//! [`UintRef`] comparison operations.
//!
//! Constant time unless explicitly noted otherwise.

use core::{cmp::Ordering, mem::transmute};

use super::UintRef;
use crate::{Choice, Limb, word};

impl UintRef {
    /// Returns the truthy value if `self` is odd or the falsy value otherwise.
    #[inline]
    #[must_use]
    pub const fn is_odd(&self) -> Choice {
        debug_assert!(self.nlimbs() >= 1, "should have limbs");
        word::choice_from_lsb(self.limbs[0].0 & 1)
    }

    /// Returns [`Choice::TRUE`] if `self` != `0` or [`Choice::FALSE`] otherwise.
    #[inline]
    #[must_use]
    pub const fn is_nonzero(&self) -> Choice {
        let mut b = 0;
        let mut i = 0;
        while i < self.nlimbs() {
            b |= self.limbs[i].0;
            i += 1;
        }
        Limb(b).is_nonzero()
    }

    /// Are all of limbs equal to `0`?
    #[inline]
    #[must_use]
    pub const fn is_zero(&self) -> Choice {
        self.is_nonzero().not()
    }

    /// Determine in variable time whether the `self` is zero.
    #[inline]
    pub(crate) const fn is_zero_vartime(&self) -> bool {
        let mut i = 0;
        while i < self.nlimbs() {
            if self.limbs[i].0 != 0 {
                return false;
            }
            i += 1;
        }
        true
    }

    /// Returns the Ordering between `lhs` and `rhs`.
    #[allow(clippy::cast_possible_wrap)]
    #[inline(always)]
    pub(crate) const fn cmp(lhs: &Self, rhs: &Self) -> Ordering {
        let overlap = if lhs.nlimbs() < rhs.nlimbs() {
            lhs.nlimbs()
        } else {
            rhs.nlimbs()
        };

        let mut borrow = Limb::ZERO;
        let mut diff = Limb::ZERO;
        let mut i = 0;

        while i < overlap {
            let (w, b) = rhs.limbs[i].borrowing_sub(lhs.limbs[i], borrow);
            diff = diff.bitor(w);
            borrow = b;
            i += 1;
        }
        let lesser = rhs.trailing(overlap).is_nonzero();
        let greater = lhs.trailing(overlap).is_nonzero();

        // FIXME cast_signed() is stable in Rust 1.87
        let sgn = borrow
            .lsb_to_choice()
            .and(lesser.not())
            .or(greater)
            .select_u8(255, 1) as i8;
        let ord = (diff.is_nonzero().or(lesser).or(greater).to_u8_vartime() as i8) * sgn;

        #[allow(unsafe_code)]
        // SAFETY: Ordering is repr(i8)
        unsafe {
            transmute(ord)
        }
    }

    /// Returns the Ordering between `self` and `rhs` in variable time.
    #[inline(always)]
    #[must_use]
    pub const fn cmp_vartime(&self, rhs: &Self) -> Ordering {
        if self.nlimbs() < rhs.nlimbs() {
            return rhs.cmp_vartime(self).reverse();
        }

        let mut i = self.nlimbs();
        while i > rhs.nlimbs() {
            i -= 1;
            if self.limbs[i].0 != 0 {
                return Ordering::Greater;
            }
        }
        while i > 0 {
            i -= 1;
            let (val, borrow) = self.limbs[i].borrowing_sub(rhs.limbs[i], Limb::ZERO);
            if val.0 != 0 {
                return if borrow.0 != 0 {
                    Ordering::Less
                } else {
                    Ordering::Greater
                };
            }
        }

        Ordering::Equal
    }

    /// Returns the truthy value if `self < rhs` and the falsy value otherwise.
    #[inline(always)]
    pub(crate) const fn lt(lhs: &Self, rhs: &Self) -> Choice {
        let overlap = if lhs.nlimbs() < rhs.nlimbs() {
            lhs.nlimbs()
        } else {
            rhs.nlimbs()
        };

        // NOTE: this is effectively a `borrowing_sub` that only computes the borrow
        let mut i = 0;
        let mut borrow = Limb::ZERO;

        while i < overlap {
            borrow = lhs.limbs[i].borrowing_sub(rhs.limbs[i], borrow).1;
            i += 1;
        }
        let lesser = rhs.trailing(overlap).is_nonzero();
        let greater = lhs.trailing(overlap).is_nonzero();
        borrow.lsb_to_choice().and(greater.not()).or(lesser)
    }
}

#[cfg(test)]
mod tests {
    use core::cmp::Ordering;

    use super::UintRef;
    use crate::Limb;

    #[test]
    fn cmp() {
        let z_small = UintRef::new(&[Limb::ZERO, Limb::ZERO]);
        let z_big = UintRef::new(&[Limb::ZERO, Limb::ZERO, Limb::ZERO]);
        let a = UintRef::new(&[Limb::ZERO, Limb::ZERO, Limb::ONE]);
        let b = UintRef::new(&[Limb::ONE, Limb::ZERO]);

        assert_eq!(UintRef::cmp(z_small, z_big), Ordering::Equal);
        assert_eq!(UintRef::cmp(z_big, z_small), Ordering::Equal);
        assert_eq!(UintRef::cmp(z_small, a), Ordering::Less);
        assert_eq!(UintRef::cmp(z_big, a), Ordering::Less);
        assert_eq!(UintRef::cmp(a, z_small), Ordering::Greater);
        assert_eq!(UintRef::cmp(a, z_big), Ordering::Greater);
        assert_eq!(UintRef::cmp(a, b), Ordering::Greater);
        assert_eq!(UintRef::cmp(b, a), Ordering::Less);

        assert_eq!(UintRef::cmp_vartime(z_small, z_big), Ordering::Equal);
        assert_eq!(UintRef::cmp_vartime(z_big, z_small), Ordering::Equal);
        assert_eq!(UintRef::cmp_vartime(z_small, a), Ordering::Less);
        assert_eq!(UintRef::cmp_vartime(z_big, a), Ordering::Less);
        assert_eq!(UintRef::cmp_vartime(a, z_small), Ordering::Greater);
        assert_eq!(UintRef::cmp_vartime(a, z_big), Ordering::Greater);
        assert_eq!(UintRef::cmp_vartime(a, b), Ordering::Greater);
        assert_eq!(UintRef::cmp_vartime(b, a), Ordering::Less);
    }

    #[test]
    fn lt() {
        let lesser = UintRef::new(&[Limb::ZERO, Limb::ZERO, Limb::ZERO]);
        let greater = UintRef::new(&[Limb::ZERO, Limb::ONE, Limb::ZERO]);
        assert!(UintRef::lt(lesser, greater).to_bool());
        assert!(!UintRef::lt(greater, lesser).to_bool());

        let smaller = UintRef::new(&[Limb::ZERO, Limb::ZERO]);
        let bigger = UintRef::new(&[Limb::ZERO, Limb::ZERO, Limb::ONE]);
        assert!(UintRef::lt(smaller, bigger).to_bool());
        assert!(!UintRef::lt(bigger, smaller).to_bool());
    }
}
