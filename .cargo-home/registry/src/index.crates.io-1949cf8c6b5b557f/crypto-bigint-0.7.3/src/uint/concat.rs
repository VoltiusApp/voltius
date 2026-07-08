use crate::{Concat, Uint};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Concatenate the two values, with `self` as least significant and `hi` as the most
    /// significant, with both values having the same size.
    #[must_use]
    pub const fn concat<const WIDE_LIMBS: usize>(&self, hi: &Self) -> Uint<WIDE_LIMBS>
    where
        Self: Concat<LIMBS, Output = Uint<WIDE_LIMBS>>,
    {
        self.concat_resize(hi)
    }

    /// Concatenate the two values, with `self` as least significant and `hi`
    /// as the most significant.
    #[inline]
    #[must_use]
    pub const fn concat_mixed<const HI_LIMBS: usize, const WIDE_LIMBS: usize>(
        &self,
        hi: &Uint<HI_LIMBS>,
    ) -> Uint<WIDE_LIMBS>
    where
        Self: Concat<HI_LIMBS, Output = Uint<WIDE_LIMBS>>,
    {
        self.concat_resize(hi)
    }

    /// Concatenate the two values, with `self` as least significant and `hi`
    /// as the most significant. If `WIDE_LIMBS` is not equal to the sum of
    /// `LIMBS` and `HI_LIMBS`, then `None` is returned.
    #[inline(always)]
    #[must_use]
    pub const fn concat_checked<const HI_LIMBS: usize, const WIDE_LIMBS: usize>(
        &self,
        hi: &Uint<HI_LIMBS>,
    ) -> Option<Uint<WIDE_LIMBS>> {
        if LIMBS + HI_LIMBS == WIDE_LIMBS {
            Some(self.concat_resize(hi))
        } else {
            None
        }
    }

    /// Concatenate the two values, with `self` as least significant and `hi`
    /// as the most significant. The resulting wide integer may be truncated or
    /// extended with zeros depending upon whether its size is less than or greater
    /// than the sum of `LIMBS` and `HI_LIMBS`.
    #[inline(always)]
    #[must_use]
    pub const fn concat_resize<const HI_LIMBS: usize, const WIDE_LIMBS: usize>(
        &self,
        hi: &Uint<HI_LIMBS>,
    ) -> Uint<WIDE_LIMBS> {
        let mut res = Uint::ZERO;
        let len = if LIMBS + HI_LIMBS <= WIDE_LIMBS {
            LIMBS + HI_LIMBS
        } else {
            WIDE_LIMBS
        };
        let lo_len = if LIMBS <= len { LIMBS } else { len };
        let hi_len = len - lo_len;
        let (res_lo, res_hi) = res.as_mut_uint_ref().split_at_mut(lo_len);
        res_lo.copy_from(self.as_uint_ref().leading(lo_len));
        res_hi
            .leading_mut(hi_len)
            .copy_from(hi.as_uint_ref().leading(hi_len));
        res
    }
}

#[cfg(test)]
mod tests {
    use crate::{BitOps, U64, U128, U192, U256, Uint};

    #[test]
    fn concat() {
        let hi = U64::from_u64(0x0011223344556677);
        let lo = U64::from_u64(0x8899aabbccddeeff);
        assert_eq!(
            lo.concat(&hi),
            U128::from_be_hex("00112233445566778899aabbccddeeff")
        );
    }

    #[test]
    fn concat_checked() {
        let hi = U64::from_u64(0x0011223344556677);
        let lo = U64::from_u64(0x8899aabbccddeeff);
        let Some(wide) = lo.concat_checked(&hi) else {
            panic!("invalid concat")
        };
        assert_eq!(wide, U128::from_u128(0x00112233445566778899aabbccddeeff));

        assert!(lo.concat_checked::<{ U64::LIMBS }, 10>(&hi).is_none());
    }

    #[test]
    fn concat_resize_small() {
        let hi = U128::from_u64(0x0011223344556677);
        let lo = U128::MAX;
        assert_eq!(lo.concat_resize(&hi), U64::MAX);
    }

    #[test]
    fn concat_resize_large() {
        let hi = U64::from_u64(0x0011223344556677);
        let lo = U64::from_u64(0x8899aabbccddeeff);
        assert_eq!(
            lo.concat_resize(&hi),
            U256::from_u128(0x00112233445566778899aabbccddeeff)
        );
    }

    #[test]
    fn concat_mixed() {
        let hi = U64::from_u64(0x0011223344556677);
        let lo = U128::from_u128(0x8899aabbccddeeff_8899aabbccddeeff);
        assert_eq!(
            lo.concat_mixed(&hi),
            U192::from_be_hex("00112233445566778899aabbccddeeff8899aabbccddeeff")
        );
        assert_eq!(
            hi.concat_mixed(&lo),
            U192::from_be_hex("8899aabbccddeeff8899aabbccddeeff0011223344556677")
        );
    }

    #[test]
    fn convert() {
        let res: U128 = U64::ONE.widening_mul(&U64::ONE).into();
        assert_eq!(res, U128::ONE);

        let res: U128 = U64::ONE.widening_square().into();
        assert_eq!(res, U128::ONE);
    }

    #[test]
    fn infer_sizes() {
        let wide = U64::ONE.concat(&Uint::ZERO);
        assert_eq!(wide.bits_precision(), 128);
        assert_eq!(wide, Uint::ONE);

        let wide = U64::ONE.concat_mixed(&U128::ZERO);
        assert_eq!(wide.bits_precision(), 192);
        assert_eq!(wide, Uint::ONE);
    }
}
