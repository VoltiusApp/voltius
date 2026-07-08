//! [`BoxedUint`] multiplication helper to reduce allocations.

use alloc::vec::Vec;

use crate::{BoxedUint, Choice, Limb, UintRef};

/// Boxed multiplier with a pre-allocated internal buffer to avoid additional allocations.
#[derive(Debug, Clone)]
pub struct BoxedMultiplier {
    product: Vec<Limb>,
}

impl BoxedMultiplier {
    pub fn new() -> Self {
        Self {
            product: Vec::new(),
        }
    }

    fn get_buffer(&mut self, limbs: usize) -> &mut UintRef {
        self.product.clear();
        self.product.resize(limbs, Limb::ZERO);
        UintRef::new_mut(&mut self.product[..limbs])
    }

    pub fn overflowing_mul(&mut self, lhs: &BoxedUint, rhs: &BoxedUint) -> (&mut UintRef, Choice) {
        let buf = self.get_buffer(lhs.nlimbs());
        let overflow = lhs.as_uint_ref().overflowing_mul(rhs.as_uint_ref(), buf);
        (buf, overflow)
    }

    pub fn overflowing_mul_assign(&mut self, lhs: &mut BoxedUint, rhs: &BoxedUint) -> Choice {
        let (buf, overflow) = self.overflowing_mul(lhs, rhs);
        lhs.as_mut_uint_ref().copy_from(buf);
        overflow
    }

    pub fn overflowing_square(&mut self, lhs: &BoxedUint) -> (&mut UintRef, Choice) {
        let buf = self.get_buffer(lhs.nlimbs());
        let overflow = lhs.as_uint_ref().overflowing_square(buf);
        (buf, overflow)
    }

    pub fn overflowing_square_assign(&mut self, lhs: &mut BoxedUint) -> Choice {
        let (buf, overflow) = self.overflowing_square(lhs);
        lhs.as_mut_uint_ref().copy_from(buf);
        overflow
    }

    pub fn wrapping_mul(&mut self, lhs: &BoxedUint, rhs: &BoxedUint) -> &mut UintRef {
        self.wrapping_mul_with_carry(lhs, rhs).0
    }

    pub fn wrapping_mul_assign(&mut self, lhs: &mut BoxedUint, rhs: &BoxedUint) {
        let (buf, _) = self.wrapping_mul_with_carry(lhs, rhs);
        lhs.as_mut_uint_ref().copy_from(buf);
    }

    fn wrapping_mul_with_carry(
        &mut self,
        lhs: &BoxedUint,
        rhs: &BoxedUint,
    ) -> (&mut UintRef, Limb) {
        let buf = self.get_buffer(lhs.nlimbs());
        let carry = lhs.as_uint_ref().wrapping_mul(rhs.as_uint_ref(), buf);
        (buf, carry)
    }

    pub fn wrapping_square_assign(&mut self, lhs: &mut BoxedUint) {
        let (buf, _) = self.wrapping_square_with_carry(lhs);
        lhs.as_mut_uint_ref().copy_from(buf);
    }

    fn wrapping_square_with_carry(&mut self, lhs: &BoxedUint) -> (&mut UintRef, Limb) {
        let buf = self.get_buffer(lhs.nlimbs());
        let carry = lhs.as_uint_ref().wrapping_square(buf);
        (buf, carry)
    }
}
