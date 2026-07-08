//! [`UintRef`] bitwise right shift operations.

use core::num::NonZeroU32;

use super::UintRef;
use crate::{
    Choice, Limb,
    primitives::{u32_bits, u32_rem},
};

impl UintRef {
    /// Right-shifts by `shift` bits.
    ///
    /// # Panics
    /// - if the shift exceeds the type's width.
    #[inline(always)]
    pub const fn shr_assign(&mut self, shift: u32) {
        self.bounded_shr_assign(shift, self.bits_precision());
    }

    /// Right-shifts by `shift` bits in constant-time.
    ///
    /// Returns truthy `Choice` and leaves `self` unmodified if `shift >= self.bits_precision()`,
    /// otherwise returns a falsy `Choice` and shifts `self` in place.
    #[inline(always)]
    pub const fn overflowing_shr_assign(&mut self, shift: u32) -> Choice {
        let bits = self.bits_precision();
        let overflow = Choice::from_u32_le(bits, shift);
        let shift = overflow.select_u32(shift, 0);
        self.bounded_shr_assign(shift, bits);
        overflow
    }

    /// Right-shifts by `shift` bits, producing zero if the shift exceeds the precision.
    #[inline(always)]
    pub const fn unbounded_shr_assign(&mut self, shift: u32) {
        let overflow = self.overflowing_shr_assign(shift);
        self.conditional_set_zero(overflow);
    }

    /// Right-shifts by `shift` bits where `shift < shift_upper_bound`, producing zero if
    /// the shift exceeds the precision.
    ///
    /// The runtime is determined by `shift_upper_bound` which may be smaller than
    /// `self.bits_precision()`.
    ///
    /// # Panics
    /// - if the shift exceeds the upper bound.
    #[inline(always)]
    pub const fn bounded_shr_assign(&mut self, shift: u32, shift_upper_bound: u32) {
        assert!(shift < shift_upper_bound, "`shift` exceeds upper bound");

        let bit_shift = if shift_upper_bound <= Limb::BITS {
            shift
        } else {
            self.bounded_shr_by_limbs_assign(
                shift >> Limb::LOG2_BITS,
                shift_upper_bound.div_ceil(Limb::BITS),
            );
            shift & (Limb::BITS - 1)
        };
        self.shr_assign_limb_with_carry(bit_shift, Limb::ZERO);
    }

    /// Right-shifts by `shift * Limb::BITS` bits where `shift < shift_upper_bound`.
    ///
    /// The runtime is determined by `shift_upper_bound` which may be larger or smaller than
    /// `self.bits_precision()`.
    ///
    /// # Panics
    /// - if the shift exceeds the upper bound.
    #[inline(always)]
    pub(crate) const fn bounded_shr_by_limbs_assign(&mut self, shift: u32, shift_upper_bound: u32) {
        assert!(shift < shift_upper_bound, "`shift` exceeds upper bound");

        let shift_bits = u32_bits(shift_upper_bound - 1);
        let mut i = 0;
        while i < shift_bits {
            let bit = Choice::from_u32_lsb(shift >> i);
            self.conditional_shr_assign_by_limbs_vartime(1 << i, bit);
            i += 1;
        }
    }

    /// Conditionally right-shifts by `shift` limbs in a panic-free manner, producing zero
    /// if the shift exceeds the precision.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    pub(crate) const fn conditional_shr_assign_by_limbs_vartime(&mut self, shift: u32, c: Choice) {
        let shift = shift as usize;
        let mut i = 0;
        while i < self.nlimbs().saturating_sub(shift) {
            self.limbs[i] = Limb::select(self.limbs[i], self.limbs[i + shift], c);
            i += 1;
        }
        while i < self.nlimbs() {
            self.limbs[i] = Limb::select(self.limbs[i], Limb::ZERO, c);
            i += 1;
        }
    }

    /// Right-shifts by `shift` limbs in a panic-free manner, producing zero if the shift
    /// exceeds the precision.
    #[inline(always)]
    #[allow(clippy::cast_possible_truncation)]
    pub(crate) const fn unbounded_shr_assign_by_limbs(&mut self, shift: u32) {
        let nlimbs = self.nlimbs() as u32;
        let overflow = Choice::from_u32_le(nlimbs, shift);
        let shift = overflow.select_u32(shift, 0);
        self.bounded_shr_by_limbs_assign(shift, nlimbs);
        self.conditional_set_zero(overflow);
    }

    /// Right-shifts by `shift` limbs in a panic-free manner, producing zero if the shift
    /// exceeds the precision.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    pub(crate) const fn unbounded_shr_assign_by_limbs_vartime(&mut self, shift: u32) {
        let shift = shift as usize;
        let mut i = 0;
        while i < self.nlimbs().saturating_sub(shift) {
            self.limbs[i] = self.limbs[i + shift];
            i += 1;
        }
        while i < self.nlimbs() {
            self.limbs[i] = Limb::ZERO;
            i += 1;
        }
    }

    /// Copies `self >> shift` into `out` in a panic-free manner, producing zero if the shift
    /// exceeds the precision.
    ///
    /// `out` is assumed to be initialized with zeros.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[allow(clippy::integer_division_remainder_used, reason = "vartime")]
    pub(crate) const fn unbounded_shr_vartime(&self, shift: u32, out: &mut Self) {
        let count = self.nlimbs().saturating_sub((shift / Limb::BITS) as usize);
        let target = out.leading_mut(count);
        target.copy_from(self.trailing(self.nlimbs() - count));
        target.shr_assign_limb_vartime(shift % Limb::BITS);
    }

    /// Right-shifts by `shift` bits in a panic-free manner, producing zero if the shift
    /// exceeds the precision.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[allow(clippy::integer_division_remainder_used, reason = "vartime")]
    pub const fn unbounded_shr_assign_vartime(&mut self, shift: u32) {
        if shift >= self.bits_precision() {
            self.conditional_set_zero(Choice::TRUE);
            return;
        }

        let shift_limbs = shift / Limb::BITS;
        let rem = shift % Limb::BITS;

        self.unbounded_shr_assign_by_limbs_vartime(shift_limbs);
        let top = self.nlimbs().saturating_sub(shift_limbs as usize);
        self.leading_mut(top).shr_assign_limb_vartime(rem);
    }

    /// Right-shifts by `shift` bits in a panic-free manner, reducing shift modulo the type's width.
    #[inline(always)]
    pub const fn wrapping_shr_assign(&mut self, shift: u32) {
        self.shr_assign(u32_rem(shift, self.bits_precision()));
    }

    /// Right-shifts by `shift` bits in a panic-free manner, reducing shift modulo the type's width.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[allow(clippy::integer_division_remainder_used, reason = "vartime")]
    pub const fn wrapping_shr_assign_vartime(&mut self, shift: u32) {
        self.unbounded_shr_assign_vartime(shift % self.bits_precision());
    }

    /// Right-shifts by a single bit in constant-time, returning `Limb::ONE << Limb::HI_BIT`
    /// if the least significant bit was set, and [`Limb::ZERO`] otherwise.
    #[inline(always)]
    pub const fn shr1_assign(&mut self) -> Limb {
        self.shr1_assign_with_carry(Limb::ZERO)
    }

    /// Right-shifts by a single bit in constant-time, returning `Limb::ONE << Limb::HI_BIT`
    /// if the least significant bit was set, and [`Limb::ZERO`] otherwise.
    #[inline(always)]
    pub(crate) const fn shr1_assign_with_carry(&mut self, carry: Limb) -> Limb {
        // NB: when used with a constant shift value, this method is constant time
        self.shr_assign_limb_with_carry_vartime(1, carry)
    }

    /// Conditionally right-shifts by `shift` bits where `0 < shift < Limb::BITS`, returning
    /// the carry.
    ///
    /// # Panics
    /// - if `shift >= Limb::BITS`.
    #[inline(always)]
    pub(crate) const fn conditional_shr_assign_limb_nonzero(
        &mut self,
        shift: NonZeroU32,
        mut carry: Limb,
        choice: Choice,
    ) -> Limb {
        assert!(shift.get() < Limb::BITS);

        let rshift = shift.get();
        let lshift = Limb::BITS - rshift;

        let mut i = self.nlimbs();
        while i > 0 {
            i -= 1;
            (self.limbs[i], carry) = (
                Limb::select(
                    self.limbs[i],
                    self.limbs[i].shr(rshift).bitor(carry),
                    choice,
                ),
                self.limbs[i].shl(lshift),
            );
        }

        Limb::select(Limb::ZERO, carry, choice)
    }

    /// Right-shifts by `shift` bits where `0 < shift < Limb::BITS`, returning the carry.
    ///
    /// # Panics
    /// - if `shift >= Limb::BITS`.
    #[inline(always)]
    pub const fn shr_assign_limb(&mut self, shift: u32) -> Limb {
        self.shr_assign_limb_with_carry(shift, Limb::ZERO)
    }

    /// Right-shifts by `shift` bits where `0 < shift < Limb::BITS`, returning the carry.
    ///
    /// # Panics
    /// - if `shift >= Limb::BITS`.
    #[inline(always)]
    pub(crate) const fn shr_assign_limb_with_carry(&mut self, shift: u32, carry: Limb) -> Limb {
        let nz = Choice::from_u32_nz(shift);
        self.conditional_shr_assign_limb_nonzero(
            NonZeroU32::new(nz.select_u32(1, shift)).expect("ensured non-zero"),
            carry,
            nz,
        )
    }

    /// Right-shifts by `shift` bits where `0 < shift < Limb::BITS`, returning
    /// the carry.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    ///
    /// # Panics
    /// If the shift size is equal to or larger than the width of the integer.
    #[inline(always)]
    pub(crate) const fn shr_assign_limb_vartime(&mut self, shift: u32) -> Limb {
        self.shr_assign_limb_with_carry_vartime(shift, Limb::ZERO)
    }

    /// Right-shifts by `shift` bits where `0 < shift < Limb::BITS`, returning
    /// the carry.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    ///
    /// # Panics
    /// If the shift size is equal to or larger than the width of the integer.
    #[inline(always)]
    pub(crate) const fn shr_assign_limb_with_carry_vartime(
        &mut self,
        shift: u32,
        mut carry: Limb,
    ) -> Limb {
        assert!(shift < Limb::BITS);

        if shift == 0 {
            return Limb::ZERO;
        }

        let rshift = shift;
        let lshift = Limb::BITS - shift;

        let mut i = self.nlimbs();
        while i > 0 {
            i -= 1;
            (self.limbs[i], carry) = (
                self.limbs[i].shr(rshift).bitor(carry),
                self.limbs[i].shl(lshift),
            );
        }

        carry
    }
}

#[cfg(test)]
mod tests {
    use crate::{Limb, U256, Uint};

    const N: U256 =
        U256::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

    const N_2: U256 =
        U256::from_be_hex("7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0");

    #[test]
    fn shr1_assign() {
        let mut n = N;
        let carry = n.as_mut_uint_ref().shr1_assign();
        assert_eq!(n, N_2);
        assert!(carry.is_nonzero().to_bool());

        let mut m = U256::MAX;
        let carry = m.as_mut_uint_ref().shr1_assign();
        assert_eq!(m, U256::MAX.shr_vartime(1));
        assert!(carry.is_nonzero().to_bool());

        let mut z = U256::ZERO;
        let carry = z.as_mut_uint_ref().shr1_assign();
        assert_eq!(z, U256::ZERO);
        assert!(carry.is_zero().to_bool());
    }

    #[test]
    fn shr256() {
        let mut n = N;
        assert!(bool::from(n.as_mut_uint_ref().overflowing_shr_assign(256)));
    }

    #[test]
    fn shr_assign_limb() {
        // Shift by zero
        let mut val = N;
        let carry = val.as_mut_uint_ref().shr_assign_limb(0);
        assert_eq!(val, N);
        assert_eq!(carry, Limb::ZERO);

        // Shift by one
        let mut val = N;
        let carry = val.as_mut_uint_ref().shr_assign_limb(1);
        assert_eq!(val, N.shr_vartime(1));
        assert_eq!(carry, N.limbs[0].shl(Limb::BITS - 1));

        // Shift by any
        let mut val = N;
        let carry = val.as_mut_uint_ref().shr_assign_limb(13);
        assert_eq!(val, N.shr_vartime(13));
        assert_eq!(carry, N.limbs[0].shl(Limb::BITS - 13));

        // Shift by max
        let mut val = N;
        let carry = val.as_mut_uint_ref().shr_assign_limb(Limb::BITS - 1);
        assert_eq!(val, N.shr_vartime(Limb::BITS - 1));
        assert_eq!(carry, N.limbs[0].shl(1));
    }

    #[test]
    fn unbounded_shr_by_limbs_vartime() {
        let refval = Uint::<2>::from_words([1, 99]);

        let mut val = refval;
        val.as_mut_uint_ref()
            .unbounded_shr_assign_by_limbs_vartime(0);
        assert_eq!(val.as_words(), &[1, 99]);

        let mut val = refval;
        val.as_mut_uint_ref()
            .unbounded_shr_assign_by_limbs_vartime(1);
        assert_eq!(val.as_words(), &[99, 0]);

        let mut val = refval;
        val.as_mut_uint_ref()
            .unbounded_shr_assign_by_limbs_vartime(2);
        assert_eq!(val.as_words(), &[0, 0]);
    }

    #[test]
    fn compare_shr_assign() {
        for i in 0..256 {
            let (mut a, mut b) = (N, N);
            a.as_mut_uint_ref().bounded_shr_assign(i, 256);
            b.as_mut_uint_ref().unbounded_shr_assign_vartime(i);
            assert_eq!(a, b);
        }
    }
}
