use crate::{BitOps, Choice, Word};

use super::Limb;

impl Limb {
    /// Get the value of the bit at position `index`, as a truthy or falsy [`Choice`].
    /// Returns the falsy value for indices out of range.
    #[must_use]
    pub const fn bit(self, index: u32) -> Choice {
        let index_in_limb = index & (Limb::BITS - 1);
        self.shr(index_in_limb)
            .lsb_to_choice()
            .and(Choice::from_u32_eq(index, index_in_limb))
    }

    /// Returns `true` if the bit at position `index` is set, `false` for an unset bit
    /// or for indices out of range.
    ///
    /// # Remarks
    /// This operation is variable time with respect to `index` only.
    #[inline(always)]
    #[must_use]
    pub const fn bit_vartime(self, index: u32) -> bool {
        if index >= Limb::BITS {
            false
        } else {
            (self.0 >> index) & 1 == 1
        }
    }

    /// Sets the bit at `index` to 0 or 1 depending on the value of `bit_value`.
    #[inline(always)]
    fn set_bit(self, index: u32, bit_value: Choice) -> Self {
        let mask = Limb::ONE.shl(index);
        Limb::select(self.bitand(mask.not()), self.bitor(mask), bit_value)
    }

    /// Sets the bit at `index` to 0 or 1 depending on the value of `bit_value`, in variable-time
    /// with respect to `index`.
    #[inline(always)]
    fn set_bit_vartime(self, index: u32, bit_value: bool) -> Self {
        if bit_value {
            self.bitor(Limb::ONE.shl(index))
        } else {
            self.bitand(Limb::ONE.shl(index).not())
        }
    }

    /// Calculate the number of bits needed to represent this number.
    #[inline(always)]
    #[must_use]
    pub const fn bits(self) -> u32 {
        Limb::BITS - self.0.leading_zeros()
    }

    /// Calculate the number of leading zeros in the binary representation of this number.
    #[inline(always)]
    #[must_use]
    pub const fn leading_zeros(self) -> u32 {
        self.0.leading_zeros()
    }

    /// Calculate the number of trailing zeros in the binary representation of this number.
    #[inline(always)]
    #[must_use]
    pub const fn trailing_zeros(self) -> u32 {
        self.0.trailing_zeros()
    }

    /// Calculate the number of trailing ones the binary representation of this number.
    #[inline(always)]
    #[must_use]
    pub const fn trailing_ones(self) -> u32 {
        self.0.trailing_ones()
    }

    /// Clear bits at or above the given bit position.
    #[must_use]
    pub const fn restrict_bits(self, len: u32) -> Self {
        #[allow(trivial_numeric_casts)]
        self.bitand(Limb((1 as Word).overflowing_shl(len).0 - 1))
    }
}

impl BitOps for Limb {
    #[inline(always)]
    fn bit(&self, index: u32) -> Choice {
        Limb::bit(*self, index)
    }

    #[inline(always)]
    fn bit_vartime(&self, index: u32) -> bool {
        Limb::bit_vartime(*self, index)
    }

    #[inline(always)]
    fn bits_precision(&self) -> u32 {
        Limb::BITS
    }

    #[inline(always)]
    fn bits(&self) -> u32 {
        Limb::BITS - self.0.leading_zeros()
    }

    #[inline(always)]
    fn bytes_precision(&self) -> usize {
        Limb::BYTES
    }

    #[inline(always)]
    fn leading_zeros(&self) -> u32 {
        self.0.leading_zeros()
    }

    #[inline(always)]
    fn log2_bits(&self) -> u32 {
        Limb::LOG2_BITS
    }

    #[inline(always)]
    fn set_bit(&mut self, index: u32, bit_value: Choice) {
        *self = Limb::set_bit(*self, index, bit_value);
    }

    #[inline(always)]
    fn set_bit_vartime(&mut self, index: u32, bit_value: bool) {
        *self = Limb::set_bit_vartime(*self, index, bit_value);
    }

    #[inline(always)]
    fn trailing_ones(&self) -> u32 {
        self.0.trailing_ones()
    }

    #[inline(always)]
    fn trailing_zeros(&self) -> u32 {
        self.0.trailing_zeros()
    }
}

#[cfg(test)]
mod tests {
    use crate::{BitOps, Choice, Limb};

    fn limb_with_bits_at(positions: &[u32]) -> Limb {
        let mut result = Limb::ZERO;
        for pos in positions {
            result |= Limb::ONE << *pos;
        }
        result
    }

    #[test]
    fn bit() {
        let u = limb_with_bits_at(&[2, 4, 8, 15]);
        assert!(!BitOps::bit(&u, 0).to_bool_vartime());
        assert!(!BitOps::bit(&u, 1).to_bool_vartime());
        assert!(BitOps::bit(&u, 2).to_bool_vartime());
        assert!(BitOps::bit(&u, 4).to_bool_vartime());
        assert!(BitOps::bit(&u, 8).to_bool_vartime());
        assert!(!BitOps::bit(&u, Limb::BITS).to_bool_vartime());
        assert!(!BitOps::bit(&u, 300).to_bool_vartime());
    }

    #[test]
    fn bit_vartime() {
        let u = limb_with_bits_at(&[2, 4, 8, 15]);
        assert!(!BitOps::bit_vartime(&u, 0));
        assert!(!BitOps::bit_vartime(&u, 1));
        assert!(BitOps::bit_vartime(&u, 2));
        assert!(BitOps::bit_vartime(&u, 4));
        assert!(BitOps::bit_vartime(&u, 8));
        assert!(!BitOps::bit_vartime(&u, Limb::BITS));
        assert!(!BitOps::bit_vartime(&u, 300));
    }

    #[test]
    fn leading_zeros() {
        let u = limb_with_bits_at(&[Limb::BITS - 16]);
        assert_eq!(BitOps::leading_zeros(&u), 15);

        let u = limb_with_bits_at(&[Limb::BITS - 12, Limb::BITS - 13]);
        assert_eq!(BitOps::leading_zeros(&u), 11);

        assert_eq!(BitOps::leading_zeros(&Limb::MAX), 0);
        assert_eq!(BitOps::leading_zeros(&Limb::ZERO), Limb::BITS);
    }

    #[test]
    fn leading_zeros_vartime() {
        let u = limb_with_bits_at(&[Limb::BITS - 16]);
        assert_eq!(BitOps::leading_zeros_vartime(&u), 15);

        let u = limb_with_bits_at(&[Limb::BITS - 12, Limb::BITS - 13]);
        assert_eq!(BitOps::leading_zeros_vartime(&u), 11);

        assert_eq!(BitOps::leading_zeros_vartime(&Limb::MAX), 0);
        assert_eq!(BitOps::leading_zeros_vartime(&Limb::ZERO), Limb::BITS);
    }

    #[test]
    fn trailing_zeros() {
        let u = limb_with_bits_at(&[16]);
        assert_eq!(BitOps::trailing_zeros(&u), 16);

        let u = limb_with_bits_at(&[12, 13]);
        assert_eq!(BitOps::trailing_zeros(&u), 12);

        assert_eq!(BitOps::trailing_zeros(&Limb::MAX), 0);
        assert_eq!(BitOps::trailing_zeros(&Limb::ZERO), Limb::BITS);
    }

    #[test]
    fn trailing_zeros_vartime() {
        let u = limb_with_bits_at(&[16]);
        assert_eq!(BitOps::trailing_zeros_vartime(&u), 16);

        let u = limb_with_bits_at(&[12, 13]);
        assert_eq!(BitOps::trailing_zeros_vartime(&u), 12);

        assert_eq!(BitOps::trailing_zeros_vartime(&Limb::MAX), 0);
        assert_eq!(BitOps::trailing_zeros_vartime(&Limb::ZERO), Limb::BITS);
    }

    #[test]
    fn trailing_ones() {
        let u = !limb_with_bits_at(&[16]);
        assert_eq!(BitOps::trailing_ones(&u), 16);

        let u = !limb_with_bits_at(&[12, 13]);
        assert_eq!(BitOps::trailing_ones(&u), 12);

        assert_eq!(BitOps::trailing_ones(&Limb::MAX), Limb::BITS);
        assert_eq!(BitOps::trailing_ones(&Limb::ZERO), 0);
    }

    #[test]
    fn trailing_ones_vartime() {
        let u = !limb_with_bits_at(&[16]);
        assert_eq!(BitOps::trailing_ones_vartime(&u), 16);

        let u = !limb_with_bits_at(&[12, 13]);
        assert_eq!(BitOps::trailing_ones_vartime(&u), 12);

        assert_eq!(BitOps::trailing_ones_vartime(&Limb::MAX), Limb::BITS);
        assert_eq!(BitOps::trailing_ones_vartime(&Limb::ZERO), 0);
    }

    #[test]
    fn set_bit() {
        let mut u = limb_with_bits_at(&[2, 8]);
        BitOps::set_bit(&mut u, 5, Choice::TRUE);
        assert_eq!(u, limb_with_bits_at(&[2, 5, 8]));

        let mut u = limb_with_bits_at(&[2, 8]);
        BitOps::set_bit(&mut u, 8, Choice::TRUE);
        assert_eq!(u, limb_with_bits_at(&[2, 8]));

        let mut u = limb_with_bits_at(&[2, 8]);
        BitOps::set_bit(&mut u, 2, Choice::FALSE);
        assert_eq!(u, limb_with_bits_at(&[8]));

        let mut u = limb_with_bits_at(&[2, 8, 9]);
        BitOps::set_bit(&mut u, 9, Choice::FALSE);
        assert_eq!(u, limb_with_bits_at(&[2, 8]));
    }

    #[test]
    fn set_bit_vartime() {
        let mut u = limb_with_bits_at(&[2, 8]);
        BitOps::set_bit_vartime(&mut u, 5, true);
        assert_eq!(u, limb_with_bits_at(&[2, 5, 8]));

        let mut u = limb_with_bits_at(&[2, 8]);
        BitOps::set_bit_vartime(&mut u, 8, true);
        assert_eq!(u, limb_with_bits_at(&[2, 8]));

        let mut u = limb_with_bits_at(&[2, 8]);
        BitOps::set_bit_vartime(&mut u, 2, false);
        assert_eq!(u, limb_with_bits_at(&[8]));

        let mut u = limb_with_bits_at(&[2, 8, 9]);
        BitOps::set_bit_vartime(&mut u, 9, false);
        assert_eq!(u, limb_with_bits_at(&[2, 8]));
    }
}
