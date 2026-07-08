use crate::{Choice, Concat, CtOption, Int, Uint};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Compute "wide" multiplication between an [`Uint`] and [`Int`] as 3-tuple `(lo, hi, negate)`.
    /// The `(lo, hi)` components contain the _magnitude of the product_, with sizes
    /// corresponding to the sizes of the operands; `negate` indicates whether the result should be
    /// negated when converted from [`Uint`] to [`Int`].
    ///
    /// Note: even if `negate` is truthy, the magnitude might be zero!
    #[must_use]
    pub const fn widening_mul_signed<const RHS_LIMBS: usize>(
        &self,
        rhs: &Int<RHS_LIMBS>,
    ) -> (Uint<LIMBS>, Uint<RHS_LIMBS>, Choice) {
        let (rhs_abs, rhs_sgn) = rhs.abs_sign();
        let (lo, hi) = self.widening_mul(&rhs_abs);
        (lo, hi, rhs_sgn)
    }

    /// Multiply `self` by [`Int`] `rhs`, returning a concatenated "wide" result.
    #[must_use]
    pub const fn concatenating_mul_signed<const RHS_LIMBS: usize, const WIDE_LIMBS: usize>(
        &self,
        rhs: &Int<RHS_LIMBS>,
    ) -> Int<WIDE_LIMBS>
    where
        Uint<LIMBS>: Concat<RHS_LIMBS, Output = Uint<WIDE_LIMBS>>,
    {
        let (rhs_abs, rhs_sign) = rhs.abs_sign();
        let product_abs = self.concatenating_mul(&rhs_abs);

        // always fits
        *product_abs.wrapping_neg_if(rhs_sign).as_int()
    }

    /// Checked multiplication of `self` with [`Int`] `rhs`.
    #[must_use]
    pub fn checked_mul_signed<const RHS_LIMBS: usize>(
        &self,
        rhs: &Int<RHS_LIMBS>,
    ) -> CtOption<Int<LIMBS>> {
        let (abs_rhs, rhs_sgn) = rhs.abs_sign();
        let maybe_res = self.checked_mul(&abs_rhs);
        Int::new_from_abs_opt_sign(maybe_res, rhs_sgn)
    }
}

#[cfg(test)]
mod tests {
    use crate::{I64, I128, I256, U64, U128};

    #[test]
    fn widening_mul_signed() {
        let (lo, hi, rhs_sgn) = U128::MAX.widening_mul_signed(&I64::from_i64(-55));
        assert_eq!(lo, U128::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC9"));
        assert_eq!(hi, U64::from_u64(54));
        assert!(rhs_sgn.to_bool());
    }

    #[test]
    fn concatenating_mul_signed() {
        assert_eq!(
            U128::MAX.concatenating_mul_signed(&I128::from_i64(-55)),
            I256::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC900000000000000000000000000000037")
        );
        assert_eq!(
            U128::MAX.concatenating_mul_signed(&I128::MAX),
            I256::from_be_hex("7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE80000000000000000000000000000001")
        );
        assert_eq!(
            U128::MAX.concatenating_mul_signed(&I128::MIN),
            I256::from_be_hex("8000000000000000000000000000000080000000000000000000000000000000")
        );
    }

    #[test]
    fn checked_mul_signed() {
        assert_eq!(
            U64::from_be_hex("00000000FFFFFFFF")
                .checked_mul_signed(&I64::from_be_hex("FFFFFFFF80000000"))
                .unwrap(),
            I64::from_be_hex("8000000080000000")
        );
        assert!(bool::from(
            U64::MAX.checked_mul_signed(&I128::ONE).is_none()
        ));
    }
}
