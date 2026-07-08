use crate::{Split, SplitEven, Uint};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Split this number in half into low and high components.
    #[must_use]
    pub const fn split<const HALF_LIMBS: usize>(&self) -> (Uint<HALF_LIMBS>, Uint<HALF_LIMBS>)
    where
        Self: SplitEven<Output = Uint<HALF_LIMBS>>,
    {
        self.split_resize()
    }

    /// Split this number into low and high components respectively.
    #[inline]
    #[must_use]
    pub const fn split_mixed<const LO_LIMBS: usize, const HI_LIMBS: usize>(
        &self,
    ) -> (Uint<LO_LIMBS>, Uint<HI_LIMBS>)
    where
        Self: Split<LO_LIMBS, Output = Uint<HI_LIMBS>>,
    {
        self.split_resize()
    }

    /// Split this integer into low and high components. If `LIMBS` is not equal to
    /// the sum of `LIMBS` and `HI_LIMBS`, then `None` is returned.
    #[inline(always)]
    #[must_use]
    pub const fn split_checked<const LO_LIMBS: usize, const HI_LIMBS: usize>(
        &self,
    ) -> Option<(Uint<LO_LIMBS>, Uint<HI_LIMBS>)> {
        if LO_LIMBS + HI_LIMBS == LIMBS {
            Some(self.split_resize())
        } else {
            None
        }
    }

    /// Split this integer into low and high components. The resulting values may be
    /// truncated or extended with zeros depending upon whether `LIMBS` is greater or
    /// less than the sum of `LO_LIMBS` and `HI_LIMBS`.
    #[inline(always)]
    #[must_use]
    pub const fn split_resize<const LO_LIMBS: usize, const HI_LIMBS: usize>(
        &self,
    ) -> (Uint<LO_LIMBS>, Uint<HI_LIMBS>) {
        let lo_len = if LO_LIMBS <= LIMBS { LO_LIMBS } else { LIMBS };
        let (src_lo, src_hi) = self.as_uint_ref().split_at(lo_len);
        (src_lo.to_uint_resize(), src_hi.to_uint_resize())
    }
}

#[cfg(test)]
mod tests {
    use crate::{BitOps, U64, U128, U192, U256, Uint};

    #[test]
    fn split() {
        let (lo, hi) = U128::from_be_hex("00112233445566778899aabbccddeeff").split();
        assert_eq!(lo, U64::from_u64(0x8899aabbccddeeff));
        assert_eq!(hi, U64::from_u64(0x0011223344556677));
    }

    #[test]
    fn split_checked() {
        let Some((lo, hi)) = U128::from_be_hex("00112233445566778899aabbccddeeff").split_checked()
        else {
            panic!("invalid split")
        };
        assert_eq!(lo, U64::from_u64(0x8899aabbccddeeff));
        assert_eq!(hi, U64::from_u64(0x0011223344556677));

        assert!(
            U128::from_be_hex("00112233445566778899aabbccddeeff")
                .split_checked::<8, 10>()
                .is_none()
        );
    }

    #[test]
    fn split_resize_small() {
        let (lo, hi) = U256::MAX.split_resize();
        assert_eq!(lo, U64::MAX);
        assert_eq!(hi, U64::MAX);
    }

    #[test]
    fn split_resize_large() {
        let (lo, hi) = U128::from_be_hex("00112233445566778899aabbccddeeff").split_resize();
        assert_eq!(lo, U64::from_u64(0x8899aabbccddeeff));
        assert_eq!(hi, U128::from_u64(0x0011223344556677));
    }

    #[test]
    fn infer_sizes() {
        let (lo, hi) = U128::ONE.split();
        assert_eq!(lo.bits_precision(), 64);
        assert_eq!(lo, Uint::ONE);
        assert_eq!(hi.bits_precision(), 64);
        assert_eq!(hi, Uint::ZERO);

        let (lo, hi) = U192::ONE.split_mixed();
        assert_eq!(lo, U64::ONE);
        assert_eq!(hi.bits_precision(), 128);
        assert_eq!(hi, Uint::ZERO);
    }
}
