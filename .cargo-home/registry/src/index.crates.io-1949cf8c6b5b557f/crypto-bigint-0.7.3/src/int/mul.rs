//! [`Int`] multiplication operations.

use crate::{
    Checked, CheckedMul, Choice, Concat, CtOption, Int, Mul, MulAssign, Uint, WrappingMul,
};

impl<const LIMBS: usize> Int<LIMBS> {
    /// Compute "wide" multiplication as a 3-tuple `(lo, hi, negate)`.
    /// The `(lo, hi)` components contain the _magnitude of the product_, with sizes
    /// corresponding to the sizes of the operands; `negate` indicates whether the result should be
    /// negated when converted from [`Uint`] to [`Int`].
    ///
    /// Note: even if `negate` is truthy, the magnitude might be zero!
    #[deprecated(since = "0.7.0", note = "please use `widening_mul` instead")]
    #[must_use]
    pub const fn split_mul<const RHS_LIMBS: usize>(
        &self,
        rhs: &Int<RHS_LIMBS>,
    ) -> (Uint<{ LIMBS }>, Uint<{ RHS_LIMBS }>, Choice) {
        self.widening_mul(rhs)
    }

    /// Compute "wide" multiplication as a 3-tuple `(lo, hi, negate)`.
    /// The `(lo, hi)` components contain the _magnitude of the product_, with sizes
    /// corresponding to the sizes of the operands; `negate` indicates whether the result should be
    /// negated when converted from [`Uint`] to [`Int`].
    ///
    /// Note: even if `negate` is truthy, the magnitude might be zero!
    #[inline]
    #[must_use]
    pub const fn widening_mul<const RHS_LIMBS: usize>(
        &self,
        rhs: &Int<RHS_LIMBS>,
    ) -> (Uint<{ LIMBS }>, Uint<{ RHS_LIMBS }>, Choice) {
        // Step 1: split operands into their signs and magnitudes.
        let (lhs_abs, lhs_sgn) = self.abs_sign();
        let (rhs_abs, rhs_sgn) = rhs.abs_sign();

        // Step 2: multiply the magnitudes
        let (lo, hi) = lhs_abs.widening_mul(&rhs_abs);

        // Step 3. Determine if the result should be negated.
        // This should be done if and only if lhs and rhs have opposing signs.
        // Note: if either operand is zero, the resulting magnitude will also be zero. Negating
        // zero, however, still yields zero, so having a truthy `negate` in that scenario is OK.
        let negate = lhs_sgn.xor(rhs_sgn);

        (lo, hi, negate)
    }

    /// Multiply `self` by `rhs`, returning a concatenated "wide" result.
    #[must_use]
    pub const fn concatenating_mul<const RHS_LIMBS: usize, const WIDE_LIMBS: usize>(
        &self,
        rhs: &Int<RHS_LIMBS>,
    ) -> Int<WIDE_LIMBS>
    where
        Uint<LIMBS>: Concat<RHS_LIMBS, Output = Uint<WIDE_LIMBS>>,
    {
        let (lhs_abs, lhs_sign) = self.abs_sign();
        let (rhs_abs, rhs_sign) = rhs.abs_sign();
        let product_abs = lhs_abs.concatenating_mul(&rhs_abs);
        let product_sign = lhs_sign.xor(rhs_sign);

        // always fits
        Int::from_bits(product_abs.wrapping_neg_if(product_sign))
    }

    /// Multiply `self` by `rhs`, returning a `CtOption` which is `is_some` only if
    /// overflow did not occur.
    #[must_use]
    pub const fn checked_mul<const RHS_LIMBS: usize>(
        &self,
        rhs: &Int<RHS_LIMBS>,
    ) -> CtOption<Self> {
        let (abs_lhs, lhs_sgn) = self.abs_sign();
        let (abs_rhs, rhs_sgn) = rhs.abs_sign();
        let maybe_res = abs_lhs.checked_mul(&abs_rhs);
        Self::new_from_abs_opt_sign(maybe_res, lhs_sgn.xor(rhs_sgn))
    }

    /// Multiply `self` by `rhs`, saturating at the numeric bounds instead of overflowing.
    #[must_use]
    pub const fn saturating_mul<const RHS_LIMBS: usize>(&self, rhs: &Int<RHS_LIMBS>) -> Self {
        let (abs_lhs, lhs_sgn) = self.abs_sign();
        let (abs_rhs, rhs_sgn) = rhs.abs_sign();
        let maybe_res = abs_lhs.checked_mul(&abs_rhs);
        let is_neg = lhs_sgn.xor(rhs_sgn);
        let bound = Self::select(&Self::MAX, &Self::MIN, is_neg);
        ctutils::unwrap_or!(
            Self::new_from_abs_opt_sign(maybe_res, is_neg),
            bound,
            Self::select
        )
    }

    /// Multiply `self` by `rhs`, wrapping the result in case of overflow.
    /// This is equivalent to `(self * rhs) % (Uint::<LIMBS>::MAX + 1)`.
    #[inline]
    #[must_use]
    pub const fn wrapping_mul<const RHS_LIMBS: usize>(&self, rhs: &Int<RHS_LIMBS>) -> Self {
        if RHS_LIMBS >= LIMBS {
            Self(self.0.wrapping_mul(&rhs.0))
        } else {
            let (abs_rhs, rhs_sgn) = rhs.abs_sign();
            Self(self.0.wrapping_mul(&abs_rhs).wrapping_neg_if(rhs_sgn))
        }
    }
}

/// Squaring operations.
impl<const LIMBS: usize> Int<LIMBS> {
    /// Square self, returning a concatenated "wide" result.
    #[must_use]
    pub fn concatenating_square<const WIDE_LIMBS: usize>(&self) -> Uint<WIDE_LIMBS>
    where
        Uint<LIMBS>: Concat<LIMBS, Output = Uint<WIDE_LIMBS>>,
    {
        self.abs().concatenating_square()
    }

    /// Square self, checking that the result fits in the original [`Uint`] size.
    #[must_use]
    pub fn checked_square(&self) -> CtOption<Uint<LIMBS>> {
        self.abs().checked_square()
    }

    /// Perform wrapping square, discarding overflow.
    #[must_use]
    pub const fn wrapping_square(&self) -> Uint<LIMBS> {
        self.abs().wrapping_square()
    }

    /// Perform saturating squaring, returning `MAX` on overflow.
    #[must_use]
    pub const fn saturating_square(&self) -> Uint<LIMBS> {
        self.abs().saturating_square()
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> CheckedMul<Int<RHS_LIMBS>> for Int<LIMBS> {
    #[inline]
    fn checked_mul(&self, rhs: &Int<RHS_LIMBS>) -> CtOption<Self> {
        self.checked_mul(rhs)
    }
}

impl<const LIMBS: usize> WrappingMul for Int<LIMBS> {
    fn wrapping_mul(&self, v: &Self) -> Self {
        self.wrapping_mul(v)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Mul<Int<RHS_LIMBS>> for Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn mul(self, rhs: Int<RHS_LIMBS>) -> Self {
        self.mul(&rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Mul<&Int<RHS_LIMBS>> for Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn mul(self, rhs: &Int<RHS_LIMBS>) -> Self {
        (&self).mul(rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Mul<Int<RHS_LIMBS>> for &Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn mul(self, rhs: Int<RHS_LIMBS>) -> Self::Output {
        self.mul(&rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Mul<&Int<RHS_LIMBS>> for &Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn mul(self, rhs: &Int<RHS_LIMBS>) -> Self::Output {
        self.checked_mul(rhs)
            .expect("attempted to multiply with overflow")
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> MulAssign<Int<RHS_LIMBS>> for Int<LIMBS> {
    fn mul_assign(&mut self, rhs: Int<RHS_LIMBS>) {
        *self = self.mul(&rhs);
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> MulAssign<&Int<RHS_LIMBS>> for Int<LIMBS> {
    fn mul_assign(&mut self, rhs: &Int<RHS_LIMBS>) {
        *self = self.mul(rhs);
    }
}

impl<const LIMBS: usize> MulAssign<Checked<Int<LIMBS>>> for Checked<Int<LIMBS>> {
    fn mul_assign(&mut self, other: Checked<Int<LIMBS>>) {
        *self = *self * other;
    }
}

impl<const LIMBS: usize> MulAssign<&Checked<Int<LIMBS>>> for Checked<Int<LIMBS>> {
    fn mul_assign(&mut self, other: &Checked<Int<LIMBS>>) {
        *self = *self * other;
    }
}

#[cfg(test)]
#[allow(clippy::cast_possible_wrap)]
mod tests {
    use crate::{I64, I128, I256, Int, U64, U128, U256};

    #[test]
    #[allow(clippy::init_numbered_fields)]
    fn test_checked_mul() {
        let min_plus_one = Int {
            0: I128::MIN.0.wrapping_add(&I128::ONE.0),
        };

        // lhs = min

        let result = I128::MIN.checked_mul(&I128::MIN);
        assert!(bool::from(result.is_none()));

        let result = I128::MIN.checked_mul(&I128::MINUS_ONE);
        assert!(bool::from(result.is_none()));

        let result = I128::MIN.checked_mul(&I128::ZERO);
        assert_eq!(result.unwrap(), I128::ZERO);

        let result = I128::MIN.checked_mul(&I128::ONE);
        assert_eq!(result.unwrap(), I128::MIN);

        let result = I128::MIN.checked_mul(&I128::MAX);
        assert!(bool::from(result.is_none()));

        // lhs = -1

        let result = I128::MINUS_ONE.checked_mul(&I128::MIN);
        assert!(bool::from(result.is_none()));

        let result = I128::MINUS_ONE.checked_mul(&I128::MINUS_ONE);
        assert_eq!(result.unwrap(), I128::ONE);

        let result = I128::MINUS_ONE.checked_mul(&I128::ZERO);
        assert_eq!(result.unwrap(), I128::ZERO);

        let result = I128::MINUS_ONE.checked_mul(&I128::ONE);
        assert_eq!(result.unwrap(), I128::MINUS_ONE);

        let result = I128::MINUS_ONE.checked_mul(&I128::MAX);
        assert_eq!(result.unwrap(), min_plus_one);

        // lhs = 0

        let result = I128::ZERO.checked_mul(&I128::MIN);
        assert_eq!(result.unwrap(), I128::ZERO);

        let result = I128::ZERO.checked_mul(&I128::MINUS_ONE);
        assert_eq!(result.unwrap(), I128::ZERO);

        let result = I128::ZERO.checked_mul(&I128::ZERO);
        assert_eq!(result.unwrap(), I128::ZERO);

        let result = I128::ZERO.checked_mul(&I128::ONE);
        assert_eq!(result.unwrap(), I128::ZERO);

        let result = I128::ZERO.checked_mul(&I128::MAX);
        assert_eq!(result.unwrap(), I128::ZERO);

        // lhs = 1

        let result = I128::ONE.checked_mul(&I128::MIN);
        assert_eq!(result.unwrap(), I128::MIN);

        let result = I128::ONE.checked_mul(&I128::MINUS_ONE);
        assert_eq!(result.unwrap(), I128::MINUS_ONE);

        let result = I128::ONE.checked_mul(&I128::ZERO);
        assert_eq!(result.unwrap(), I128::ZERO);

        let result = I128::ONE.checked_mul(&I128::ONE);
        assert_eq!(result.unwrap(), I128::ONE);

        let result = I128::ONE.checked_mul(&I128::MAX);
        assert_eq!(result.unwrap(), I128::MAX);

        // lhs = max

        let result = I128::MAX.checked_mul(&I128::MIN);
        assert!(bool::from(result.is_none()));

        let result = I128::MAX.checked_mul(&I128::MINUS_ONE);
        assert_eq!(result.unwrap(), min_plus_one);

        let result = I128::MAX.checked_mul(&I128::ZERO);
        assert_eq!(result.unwrap(), I128::ZERO);

        let result = I128::MAX.checked_mul(&I128::ONE);
        assert_eq!(result.unwrap(), I128::MAX);

        let result = I128::MAX.checked_mul(&I128::MAX);
        assert!(bool::from(result.is_none()));
    }

    #[test]
    fn test_wrapping_mul() {
        // wrapping
        let a = 0xFFFFFFFB7B63198EF870DF1F90D9BD9Eu128 as i128;
        let b = 0xF20C29FA87B356AA3B4C05C4F9C24B4Au128 as i128;
        let z = 0xAA700D354D6CF4EE881F8FF8093A19ACu128 as i128;
        assert_eq!(a.wrapping_mul(b), z);
        assert_eq!(
            I128::from_i128(a).wrapping_mul(&I128::from_i128(b)),
            I128::from_i128(z)
        );

        // no wrapping
        let c = -12345i64;
        assert_eq!(
            I128::from_i128(a).wrapping_mul(&I128::from_i64(c)),
            I128::from_i128(a.wrapping_mul(i128::from(c)))
        );

        // overflow into MSB
        let a = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFu128 as i128;
        assert!(!a.is_negative() && a.wrapping_mul(a).is_negative());

        // core case
        assert_eq!(i8::MAX.wrapping_mul(2), -2);
        assert_eq!(i64::MAX.wrapping_mul(2), -2);
        assert_eq!(
            I128::MAX.wrapping_mul(&I128::from_i64(2i64)),
            I128::from_i64(-2i64)
        );

        let x = -197044252290277702i64;
        let y = -2631691865753118366;
        let z = -2988283350644101836;
        assert_eq!(x.wrapping_mul(y), z);
        assert_eq!(
            I64::from_i64(x).wrapping_mul(&I64::from_i64(y)),
            I64::from_i64(z)
        );

        let x = -86027672844719838068326470675019902915i128;
        let y = -21188806580823612823777395451044967239i128;
        let z = 11054120842379932838712398402517374997i128;
        assert_eq!(x.wrapping_mul(y), z);
        assert_eq!(
            I128::from_i128(x).wrapping_mul(&I128::from_i128(y)),
            I128::from_i128(z)
        );
    }

    #[test]
    fn test_wrapping_mul_mixed() {
        let a = U64::from_u64(0x0011223344556677);
        let b = U128::from_u128(0x8899aabbccddeeff_8899aabbccddeeff);
        let expected = a.as_int().concatenating_mul(b.as_int());
        assert_eq!(a.as_int().wrapping_mul(b.as_int()), expected.resize());
        assert_eq!(b.as_int().wrapping_mul(a.as_int()), expected.resize());
        assert_eq!(
            a.as_int().wrapping_neg().wrapping_mul(b.as_int()),
            expected.wrapping_neg().resize()
        );
        assert_eq!(
            a.as_int().wrapping_mul(&b.as_int().wrapping_neg()),
            expected.wrapping_neg().resize()
        );
        assert_eq!(
            b.as_int().wrapping_neg().wrapping_mul(a.as_int()),
            expected.wrapping_neg().resize()
        );
        assert_eq!(
            b.as_int().wrapping_mul(&a.as_int().wrapping_neg()),
            expected.wrapping_neg().resize()
        );
        assert_eq!(
            a.as_int()
                .wrapping_neg()
                .wrapping_mul(&b.as_int().wrapping_neg()),
            expected.resize()
        );
        assert_eq!(
            b.as_int()
                .wrapping_neg()
                .wrapping_mul(&a.as_int().wrapping_neg()),
            expected.resize()
        );
    }

    #[test]
    fn test_saturating_mul() {
        // wrapping
        let a = 0xFFFFFFFB7B63198EF870DF1F90D9BD9Eu128 as i128;
        let b = 0xF20C29FA87B356AA3B4C05C4F9C24B4Au128 as i128;
        assert_eq!(a.saturating_mul(b), i128::MAX);
        assert_eq!(
            I128::from_i128(a).saturating_mul(&I128::from_i128(b)),
            I128::MAX
        );

        // no wrapping
        let c = -12345i64;
        assert_eq!(
            I128::from_i128(a).saturating_mul(&I128::from_i64(c)),
            I128::from_i128(a.saturating_mul(i128::from(c)))
        );

        // core case
        assert_eq!(i8::MAX.saturating_mul(2), i8::MAX);
        assert_eq!(i8::MAX.saturating_mul(-2), i8::MIN);
        assert_eq!(i64::MAX.saturating_mul(2), i64::MAX);
        assert_eq!(i64::MAX.saturating_mul(-2), i64::MIN);
        assert_eq!(I128::MAX.saturating_mul(&I128::from_i64(2i64)), I128::MAX);
        assert_eq!(I128::MAX.saturating_mul(&I128::from_i64(-2i64)), I128::MIN);

        let x = -197044252290277702i64;
        let y = -2631691865753118366;
        assert_eq!(x.saturating_mul(y), i64::MAX);
        assert_eq!(I64::from_i64(x).saturating_mul(&I64::from_i64(y)), I64::MAX);

        let x = -86027672844719838068326470675019902915i128;
        let y = 21188806580823612823777395451044967239i128;
        assert_eq!(x.saturating_mul(y), i128::MIN);
        assert_eq!(x.saturating_mul(-y), i128::MAX);
        assert_eq!(
            I128::from_i128(x).saturating_mul(&I128::from_i128(y)),
            I128::MIN
        );
        assert_eq!(
            I128::from_i128(x).saturating_mul(&I128::from_i128(-y)),
            I128::MAX
        );
    }

    #[test]
    fn test_concatenating_mul() {
        assert_eq!(
            I128::MIN.concatenating_mul(&I128::MIN),
            I256::from_be_hex("4000000000000000000000000000000000000000000000000000000000000000")
        );
        assert_eq!(
            I128::MIN.concatenating_mul(&I128::MINUS_ONE),
            I256::from_be_hex("0000000000000000000000000000000080000000000000000000000000000000")
        );
        assert_eq!(I128::MIN.concatenating_mul(&I128::ZERO), I256::ZERO);
        assert_eq!(
            I128::MIN.concatenating_mul(&I128::ONE),
            I256::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF80000000000000000000000000000000")
        );
        assert_eq!(
            I128::MIN.concatenating_mul(&I128::MAX),
            I256::from_be_hex("C000000000000000000000000000000080000000000000000000000000000000")
        );

        assert_eq!(
            I128::MINUS_ONE.concatenating_mul(&I128::MIN),
            I256::from_be_hex("0000000000000000000000000000000080000000000000000000000000000000")
        );
        assert_eq!(
            I128::MINUS_ONE.concatenating_mul(&I128::MINUS_ONE),
            I256::ONE
        );
        assert_eq!(I128::MINUS_ONE.concatenating_mul(&I128::ZERO), I256::ZERO);
        assert_eq!(
            I128::MINUS_ONE.concatenating_mul(&I128::ONE),
            I256::MINUS_ONE
        );
        assert_eq!(
            I128::MINUS_ONE.concatenating_mul(&I128::MAX),
            I256::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF80000000000000000000000000000001")
        );

        assert_eq!(I128::ZERO.concatenating_mul(&I128::MIN), I256::ZERO);
        assert_eq!(I128::ZERO.concatenating_mul(&I128::MINUS_ONE), I256::ZERO);
        assert_eq!(I128::ZERO.concatenating_mul(&I128::ZERO), I256::ZERO);
        assert_eq!(I128::ZERO.concatenating_mul(&I128::ONE), I256::ZERO);
        assert_eq!(I128::ZERO.concatenating_mul(&I128::MAX), I256::ZERO);

        assert_eq!(
            I128::ONE.concatenating_mul(&I128::MIN),
            I256::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF80000000000000000000000000000000")
        );
        assert_eq!(
            I128::ONE.concatenating_mul(&I128::MINUS_ONE),
            I256::MINUS_ONE
        );
        assert_eq!(I128::ONE.concatenating_mul(&I128::ZERO), I256::ZERO);
        assert_eq!(I128::ONE.concatenating_mul(&I128::ONE), I256::ONE);
        assert_eq!(
            I128::ONE.concatenating_mul(&I128::MAX),
            I256::from_be_hex("000000000000000000000000000000007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")
        );

        assert_eq!(
            I128::MAX.concatenating_mul(&I128::MIN),
            I256::from_be_hex("C000000000000000000000000000000080000000000000000000000000000000")
        );
        assert_eq!(
            I128::MAX.concatenating_mul(&I128::MINUS_ONE),
            I256::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF80000000000000000000000000000001")
        );
        assert_eq!(I128::MAX.concatenating_mul(&I128::ZERO), I256::ZERO);
        assert_eq!(
            I128::MAX.concatenating_mul(&I128::ONE),
            I256::from_be_hex("000000000000000000000000000000007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")
        );
        assert_eq!(
            I128::MAX.concatenating_mul(&I128::MAX),
            I256::from_be_hex("3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000000000000000000000000001")
        );
    }

    #[test]
    fn test_concatenating_square() {
        let res = I128::from_i64(i64::MIN).concatenating_square();
        assert_eq!(
            res,
            U256::from_be_hex("0000000000000000000000000000000040000000000000000000000000000000")
        );

        let x: I128 = I128::MINUS_ONE << 64;
        let res = x.concatenating_square();
        assert_eq!(
            res,
            U256::from_be_hex("0000000000000000000000000000000100000000000000000000000000000000")
        );
    }

    #[test]
    fn test_checked_square() {
        let res = I128::from_i64(i64::MIN).checked_square();
        assert!(res.is_some().to_bool());
        assert_eq!(
            res.unwrap(),
            U128::from_be_hex("40000000000000000000000000000000")
        );

        let x: I128 = I128::MINUS_ONE << 64;
        let res = x.checked_square();
        assert!(res.is_none().to_bool());
    }

    #[test]
    fn test_wrapping_square() {
        let res = I128::from_i64(i64::MIN).wrapping_square();
        assert_eq!(res, U128::from_be_hex("40000000000000000000000000000000"));

        let x: I128 = I128::MINUS_ONE << 64;
        let res = x.wrapping_square();
        assert_eq!(res, U128::ZERO);

        let x: I128 = I128::from_i64(i64::MAX);
        let res = x.wrapping_square();
        assert_eq!(res, U128::from_be_hex("3FFFFFFFFFFFFFFF0000000000000001"));
    }

    #[test]
    fn test_saturating_square() {
        assert_eq!(
            I128::from_i64(i64::MIN).saturating_square(),
            U128::from_be_hex("40000000000000000000000000000000")
        );
        let x: I128 = I128::MINUS_ONE << 64;
        assert_eq!(x.saturating_square(), U128::MAX);
    }
}
