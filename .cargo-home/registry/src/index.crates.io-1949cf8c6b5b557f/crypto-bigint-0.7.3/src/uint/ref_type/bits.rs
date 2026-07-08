use super::UintRef;
use crate::{Choice, Limb, traits::BitOps, word};

impl UintRef {
    /// Get the precision of this number in bits.
    #[allow(clippy::cast_possible_truncation)]
    #[must_use]
    pub const fn bits_precision(&self) -> u32 {
        self.limbs.len() as u32 * Limb::BITS
    }

    /// Get the value of the bit at position `index`, as a truthy or falsy [`Choice`].
    /// Returns the falsy value for indices out of range.
    #[inline(always)]
    #[allow(clippy::cast_possible_truncation)]
    #[must_use]
    pub const fn bit(&self, index: u32) -> Choice {
        let limb_num = index >> Limb::LOG2_BITS;
        let index_in_limb = index & (Limb::BITS - 1);
        let index_mask = 1 << index_in_limb;

        let mut result = 0;
        let mut i = 0;
        while i < self.limbs.len() {
            let is_right_limb = Choice::from_u32_eq(i as u32, limb_num);
            result |= word::select(0, self.limbs[i].0, is_right_limb);
            i += 1;
        }

        word::choice_from_lsb((result & index_mask) >> index_in_limb)
    }

    /// Returns `true` if the bit at position `index` is set, `false` for an unset bit
    /// or for indices out of range.
    ///
    /// # Remarks
    /// This operation is variable time with respect to `index` only.
    #[inline(always)]
    #[must_use]
    #[allow(clippy::integer_division_remainder_used, reason = "vartime")]
    pub const fn bit_vartime(&self, index: u32) -> bool {
        let limb_num = (index / Limb::BITS) as usize;
        let index_in_limb = index % Limb::BITS;
        if limb_num >= self.limbs.len() {
            false
        } else {
            (self.limbs[limb_num].0 >> index_in_limb) & 1 == 1
        }
    }

    /// Calculate the number of bits needed to represent this number, i.e. the index of the highest
    /// set bit.
    ///
    /// Use [`UintRef::bits_precision`] to get the total capacity of this integer.
    #[inline(always)]
    #[must_use]
    pub const fn bits(&self) -> u32 {
        self.bits_precision() - self.leading_zeros()
    }

    /// Calculate the number of bits needed to represent this number in variable-time with respect
    /// to `self`.
    #[inline(always)]
    #[allow(clippy::cast_possible_truncation)]
    #[must_use]
    pub const fn bits_vartime(&self) -> u32 {
        let mut i = self.limbs.len() - 1;
        while i > 0 && self.limbs[i].0 == 0 {
            i -= 1;
        }

        let limb = self.limbs[i];
        Limb::BITS * (i as u32 + 1) - limb.leading_zeros()
    }

    /// Sets the bit at `index` to 0 or 1 depending on the value of `bit_value`.
    #[inline(always)]
    #[allow(clippy::cast_possible_truncation)]
    pub const fn set_bit(&mut self, index: u32, bit_value: Choice) {
        let limb_num = index >> Limb::LOG2_BITS;
        let index_in_limb = index & (Limb::BITS - 1);
        let index_mask = 1 << index_in_limb;

        let mut i = 0;
        while i < self.limbs.len() {
            let is_right_limb = Choice::from_u32_eq(i as u32, limb_num);
            let old_limb = self.limbs[i].0;
            let new_limb = word::select(old_limb & !index_mask, old_limb | index_mask, bit_value);
            self.limbs[i] = Limb(word::select(old_limb, new_limb, is_right_limb));
            i += 1;
        }
    }

    /// Sets the bit at `index` to 0 or 1 depending on the value of `bit_value`, in variable-time
    /// with respect to `index`.
    #[inline(always)]
    #[track_caller]
    #[allow(clippy::integer_division_remainder_used, reason = "vartime")]
    pub const fn set_bit_vartime(&mut self, index: u32, bit_value: bool) {
        let limb_num = (index / Limb::BITS) as usize;
        let index_in_limb = index % Limb::BITS;
        if bit_value {
            self.limbs[limb_num].0 |= 1 << index_in_limb;
        } else {
            self.limbs[limb_num].0 &= !(1 << index_in_limb);
        }
    }

    /// Calculate the number of leading zeros in the binary representation of this number.
    #[must_use]
    pub const fn leading_zeros(&self) -> u32 {
        let mut count = 0;
        let mut i = self.limbs.len();
        let mut nonzero_limb_not_encountered = Choice::TRUE;
        while i > 0 {
            i -= 1;
            let l = self.limbs[i];
            let z = l.leading_zeros();
            count += nonzero_limb_not_encountered.select_u32(0, z);
            nonzero_limb_not_encountered =
                nonzero_limb_not_encountered.and(word::choice_from_nz(l.0).not());
        }

        count
    }

    /// Calculate the number of trailing zeros in the binary representation of this number.
    #[inline(always)]
    #[must_use]
    pub const fn trailing_zeros(&self) -> u32 {
        let mut count = 0;
        let mut i = 0;
        let mut nonzero_limb_not_encountered = Choice::TRUE;
        while i < self.limbs.len() {
            let l = self.limbs[i];
            let z = l.trailing_zeros();
            count += nonzero_limb_not_encountered.select_u32(0, z);
            nonzero_limb_not_encountered =
                nonzero_limb_not_encountered.and(word::choice_from_nz(l.0).not());
            i += 1;
        }

        count
    }

    /// Calculate the number of trailing zeros in the binary representation of this number, in
    /// variable-time with respect to `self`.
    #[inline(always)]
    #[must_use]
    pub const fn trailing_zeros_vartime(&self) -> u32 {
        let mut count = 0;
        let mut i = 0;
        while i < self.limbs.len() {
            let l = self.limbs[i];
            let z = l.trailing_zeros();
            count += z;
            if z != Limb::BITS {
                break;
            }
            i += 1;
        }

        count
    }

    /// Calculate the number of trailing ones in the binary representation of this number.
    #[inline(always)]
    #[must_use]
    pub const fn trailing_ones(&self) -> u32 {
        let mut count = 0;
        let mut i = 0;
        let mut nonmax_limb_not_encountered = Choice::TRUE;
        while i < self.limbs.len() {
            let l = self.limbs[i];
            let z = l.trailing_ones();
            count += nonmax_limb_not_encountered.select_u32(0, z);
            nonmax_limb_not_encountered =
                nonmax_limb_not_encountered.and(word::choice_from_eq(l.0, Limb::MAX.0));
            i += 1;
        }

        count
    }

    /// Calculate the number of trailing ones in the binary representation of this number, in
    /// variable-time with respect to `self`.
    #[inline(always)]
    #[must_use]
    pub const fn trailing_ones_vartime(&self) -> u32 {
        let mut count = 0;
        let mut i = 0;
        while i < self.limbs.len() {
            let l = self.limbs[i];
            let z = l.trailing_ones();
            count += z;
            if z != Limb::BITS {
                break;
            }
            i += 1;
        }

        count
    }

    /// Clear all bits at or above a given bit position.
    #[allow(clippy::cast_possible_truncation)]
    pub const fn restrict_bits(&mut self, len: u32) {
        let limb = len >> Limb::LOG2_BITS;
        let limb_mask = Limb((1 << (len & (Limb::BITS - 1))) - 1);
        let mut i = 0;
        let mut clear = Choice::FALSE;
        while i < self.nlimbs() {
            let apply = Choice::from_u32_eq(i as u32, limb);
            self.limbs[i] = self.limbs[i].bitand(Limb::select(
                Limb(word::choice_to_mask(clear.not())),
                limb_mask,
                apply,
            ));
            clear = clear.or(apply);
            i += 1;
        }
    }
}

impl BitOps for UintRef {
    #[inline(always)]
    fn bits_precision(&self) -> u32 {
        self.bits_precision()
    }

    #[inline(always)]
    fn bytes_precision(&self) -> usize {
        self.limbs.len()
    }

    fn leading_zeros(&self) -> u32 {
        self.leading_zeros()
    }

    fn bit(&self, index: u32) -> Choice {
        self.bit(index)
    }

    fn set_bit(&mut self, index: u32, bit_value: Choice) {
        self.set_bit(index, bit_value);
    }

    fn trailing_zeros(&self) -> u32 {
        self.trailing_zeros()
    }

    fn trailing_ones(&self) -> u32 {
        self.trailing_ones()
    }

    fn bit_vartime(&self, index: u32) -> bool {
        self.bit_vartime(index)
    }

    fn bits_vartime(&self) -> u32 {
        self.bits_vartime()
    }

    fn set_bit_vartime(&mut self, index: u32, bit_value: bool) {
        self.set_bit_vartime(index, bit_value);
    }

    fn trailing_zeros_vartime(&self) -> u32 {
        self.trailing_zeros_vartime()
    }

    fn trailing_ones_vartime(&self) -> u32 {
        self.trailing_ones_vartime()
    }
}
