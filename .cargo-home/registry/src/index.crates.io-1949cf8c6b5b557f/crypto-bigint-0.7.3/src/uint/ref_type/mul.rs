//! Multiplication support for [`UintRef`].

use crate::{Choice, Limb, UintRef, uint::mul::karatsuba};

impl UintRef {
    /// Compute the wrapping product of `self` and `rhs`, placing the result into `out`
    /// and returning a `Choice` indicating whether overflow occurred.
    #[inline(always)]
    pub fn overflowing_mul(&self, rhs: &UintRef, out: &mut UintRef) -> Choice {
        let carry = self.wrapping_mul(rhs, out);
        self.check_mul_overflow(rhs, carry.is_nonzero())
    }

    /// Compute the wrapping squaring of `self`, placing the result into `out`
    /// and returning a `Choice` indicating whether overflow occurred.
    #[inline(always)]
    pub fn overflowing_square(&self, out: &mut UintRef) -> Choice {
        let carry = self.wrapping_square(out);
        self.check_square_overflow(carry.is_nonzero())
    }

    /// Compute the wrapping product of `self` and `rhs`, placing the result into `out`
    /// and returning a carry Limb.
    #[inline(always)]
    pub fn wrapping_mul(&self, rhs: &UintRef, out: &mut UintRef) -> Limb {
        karatsuba::wrapping_mul(self, rhs, out, false)
    }

    /// Compute the wrapping squaring of `self`, placing the result into `out` and returning
    /// a carry Limb.
    #[inline(always)]
    pub fn wrapping_square(&self, out: &mut UintRef) -> Limb {
        karatsuba::wrapping_square(self, out)
    }

    /// Determine whether overflow occurs during wrapped multiplication.
    ///
    /// We determine this by comparing limbs in `self[i=0..n]` and `rhs[j=0..m]`.
    /// Any combination where the sum of indexes `i + j >= n`, having `self[i] != 0`
    /// and `rhs[j] != 0` would cause an overflow. For efficiency, we OR all limbs in
    /// `rhs` that would apply to each limb in `self` in turn.
    #[inline(always)]
    pub(crate) const fn check_mul_overflow(&self, rhs: &UintRef, mut carry: Choice) -> Choice {
        let mut rhs_tail = Limb::ZERO;
        let mut i = 0;
        let mut j = self.nlimbs();
        let mut k = rhs.nlimbs().saturating_sub(1);
        while k > j {
            rhs_tail = rhs_tail.bitor(rhs.limbs[k]);
            k -= 1;
        }
        while i < self.nlimbs() {
            j = self.nlimbs() - i;
            if j < rhs.nlimbs() {
                rhs_tail = rhs_tail.bitor(rhs.limbs[j]);
                carry = carry.or(self.limbs[i].is_nonzero().and(rhs_tail.is_nonzero()));
            }
            i += 1;
        }
        carry
    }

    /// Determine whether overflow occurs during wrapped squaring.
    #[inline(always)]
    pub(crate) const fn check_square_overflow(&self, carry: Choice) -> Choice {
        self.check_mul_overflow(self, carry)
    }
}
