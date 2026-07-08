//! [`Uint`] multiplication operations.

use crate::{
    Checked, CheckedMul, Choice, Concat, ConcatenatingMul, ConcatenatingSquare, CtOption, Limb,
    Mul, MulAssign, Uint, Wrapping, WrappingMul,
};

pub(crate) mod karatsuba;
pub(crate) mod schoolbook;

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Multiply `self` by `rhs`, returning a concatenated "wide" result.
    #[must_use]
    pub const fn concatenating_mul<const RHS_LIMBS: usize, const WIDE_LIMBS: usize>(
        &self,
        rhs: &Uint<RHS_LIMBS>,
    ) -> Uint<WIDE_LIMBS>
    where
        Self: Concat<RHS_LIMBS, Output = Uint<WIDE_LIMBS>>,
    {
        let (lo, hi) = self.widening_mul(rhs);
        Uint::concat_mixed(&lo, &hi)
    }

    /// Compute "wide" multiplication as a 2-tuple containing the `(lo, hi)` components of the product, whose sizes
    /// correspond to the sizes of the operands.
    #[deprecated(since = "0.7.0", note = "please use `widening_mul` instead")]
    #[must_use]
    pub const fn split_mul<const RHS_LIMBS: usize>(
        &self,
        rhs: &Uint<RHS_LIMBS>,
    ) -> (Self, Uint<RHS_LIMBS>) {
        self.widening_mul(rhs)
    }

    /// Compute "wide" multiplication as a 2-tuple containing the `(lo, hi)` components of the product, whose sizes
    /// correspond to the sizes of the operands.
    #[inline(always)]
    #[must_use]
    pub const fn widening_mul<const RHS_LIMBS: usize>(
        &self,
        rhs: &Uint<RHS_LIMBS>,
    ) -> (Self, Uint<RHS_LIMBS>) {
        karatsuba::widening_mul_fixed(self.as_uint_ref(), rhs.as_uint_ref())
    }

    /// Perform wrapping multiplication, discarding overflow.
    #[inline]
    #[must_use]
    pub const fn wrapping_mul<const RHS_LIMBS: usize>(&self, rhs: &Uint<RHS_LIMBS>) -> Self {
        karatsuba::wrapping_mul_fixed::<LIMBS>(self.as_uint_ref(), rhs.as_uint_ref()).0
    }

    /// Perform saturating multiplication, returning `MAX` on overflow.
    #[must_use]
    pub const fn saturating_mul<const RHS_LIMBS: usize>(&self, rhs: &Uint<RHS_LIMBS>) -> Self {
        let (lo, overflow) = self.overflowing_mul(rhs);
        Self::select(&lo, &Self::MAX, overflow)
    }

    /// Perform wrapping multiplication, checking that the result fits in the original [`Uint`] size.
    #[must_use]
    pub const fn checked_mul<const RHS_LIMBS: usize>(
        &self,
        rhs: &Uint<RHS_LIMBS>,
    ) -> CtOption<Uint<LIMBS>> {
        let (lo, overflow) = self.overflowing_mul(rhs);
        CtOption::new(lo, overflow.not())
    }

    /// Perform overflowing multiplication, returning the wrapped result and a `Choice`
    /// indicating whether overflow occurred.
    #[inline(always)]
    #[must_use]
    pub(crate) const fn overflowing_mul<const RHS_LIMBS: usize>(
        &self,
        rhs: &Uint<RHS_LIMBS>,
    ) -> (Uint<LIMBS>, Choice) {
        let (lo, carry) = karatsuba::wrapping_mul_fixed(self.as_uint_ref(), rhs.as_uint_ref());
        let overflow = self
            .as_uint_ref()
            .check_mul_overflow(rhs.as_uint_ref(), carry.is_nonzero());
        (lo, overflow)
    }

    /// Perform multiplication by a Limb, returning the wrapped result and a Limb overflow.
    #[inline]
    pub(crate) const fn overflowing_mul_limb(&self, rhs: Limb) -> (Self, Limb) {
        let mut ret = [Limb::ZERO; LIMBS];
        let mut i = 0;
        let mut carry = Limb::ZERO;
        while i < LIMBS {
            (ret[i], carry) = self.limbs[i].carrying_mul_add(rhs, Limb::ZERO, carry);
            i += 1;
        }
        (Uint::new(ret), carry)
    }

    /// Perform wrapping multiplication by a Limb, discarding overflow.
    #[inline]
    pub(crate) const fn wrapping_mul_limb(&self, rhs: Limb) -> Self {
        self.overflowing_mul_limb(rhs).0
    }
}

/// Squaring operations
impl<const LIMBS: usize> Uint<LIMBS> {
    /// Square self, returning a "wide" result in two parts as (lo, hi).
    #[inline(always)]
    #[must_use]
    #[deprecated(since = "0.7.0", note = "please use `widening_square` instead")]
    pub const fn square_wide(&self) -> (Self, Self) {
        self.widening_square()
    }

    /// Square self, returning a "wide" result in two parts as `(lo, hi)`.
    #[inline(always)]
    #[must_use]
    pub const fn widening_square(&self) -> (Self, Self) {
        karatsuba::widening_square_fixed(self.as_uint_ref())
    }

    /// Square self, returning a concatenated "wide" result.
    #[must_use]
    pub const fn concatenating_square<const WIDE_LIMBS: usize>(&self) -> Uint<WIDE_LIMBS>
    where
        Self: Concat<LIMBS, Output = Uint<WIDE_LIMBS>>,
    {
        let (lo, hi) = self.widening_square();
        Uint::concat_mixed(&lo, &hi)
    }

    /// Square self, checking that the result fits in the original [`Uint`] size.
    #[must_use]
    pub const fn checked_square(&self) -> CtOption<Uint<LIMBS>> {
        let (lo, overflow) = self.overflowing_square();
        CtOption::new(lo, overflow.not())
    }

    /// Perform wrapping square, discarding overflow.
    #[inline]
    #[must_use]
    pub const fn wrapping_square(&self) -> Uint<LIMBS> {
        karatsuba::wrapping_square_fixed(self.as_uint_ref()).0
    }

    /// Perform saturating squaring, returning `MAX` on overflow.
    #[must_use]
    pub const fn saturating_square(&self) -> Self {
        let (lo, overflow) = self.overflowing_square();
        Self::select(&lo, &Self::MAX, overflow)
    }

    /// Perform overflowing squaring, returning the wrapped result and a `Choice`
    /// indicating whether overflow occurred.
    #[inline(always)]
    #[must_use]
    pub(crate) const fn overflowing_square(&self) -> (Uint<LIMBS>, Choice) {
        let (lo, carry) = karatsuba::wrapping_square_fixed(self.as_uint_ref());
        let overflow = self.as_uint_ref().check_square_overflow(carry.is_nonzero());
        (lo, overflow)
    }
}

impl<const LIMBS: usize, const WIDE_LIMBS: usize> Uint<LIMBS>
where
    Self: Concat<LIMBS, Output = Uint<WIDE_LIMBS>>,
{
    /// Square self, returning a concatenated "wide" result.
    #[must_use]
    #[deprecated(since = "0.7.0", note = "please use `concatenating_square` instead")]
    pub const fn square(&self) -> Uint<WIDE_LIMBS> {
        let (lo, hi) = self.widening_square();
        lo.concat(&hi)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> CheckedMul<Uint<RHS_LIMBS>> for Uint<LIMBS> {
    fn checked_mul(&self, rhs: &Uint<RHS_LIMBS>) -> CtOption<Self> {
        self.checked_mul(rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Mul<Uint<RHS_LIMBS>> for Uint<LIMBS> {
    type Output = Uint<LIMBS>;

    fn mul(self, rhs: Uint<RHS_LIMBS>) -> Self {
        self.mul(&rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Mul<&Uint<RHS_LIMBS>> for Uint<LIMBS> {
    type Output = Uint<LIMBS>;

    fn mul(self, rhs: &Uint<RHS_LIMBS>) -> Self {
        (&self).mul(rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Mul<Uint<RHS_LIMBS>> for &Uint<LIMBS> {
    type Output = Uint<LIMBS>;

    fn mul(self, rhs: Uint<RHS_LIMBS>) -> Self::Output {
        self.mul(&rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Mul<&Uint<RHS_LIMBS>> for &Uint<LIMBS> {
    type Output = Uint<LIMBS>;

    fn mul(self, rhs: &Uint<RHS_LIMBS>) -> Self::Output {
        self.checked_mul(rhs)
            .expect("attempted to multiply with overflow")
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> MulAssign<Uint<RHS_LIMBS>> for Uint<LIMBS> {
    fn mul_assign(&mut self, rhs: Uint<RHS_LIMBS>) {
        *self = self.mul(&rhs);
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> MulAssign<&Uint<RHS_LIMBS>> for Uint<LIMBS> {
    fn mul_assign(&mut self, rhs: &Uint<RHS_LIMBS>) {
        *self = self.mul(rhs);
    }
}

impl<const LIMBS: usize> MulAssign<Wrapping<Uint<LIMBS>>> for Wrapping<Uint<LIMBS>> {
    fn mul_assign(&mut self, other: Wrapping<Uint<LIMBS>>) {
        *self = *self * other;
    }
}

impl<const LIMBS: usize> MulAssign<&Wrapping<Uint<LIMBS>>> for Wrapping<Uint<LIMBS>> {
    fn mul_assign(&mut self, other: &Wrapping<Uint<LIMBS>>) {
        *self = *self * other;
    }
}

impl<const LIMBS: usize> MulAssign<Checked<Uint<LIMBS>>> for Checked<Uint<LIMBS>> {
    fn mul_assign(&mut self, other: Checked<Uint<LIMBS>>) {
        *self = *self * other;
    }
}

impl<const LIMBS: usize> MulAssign<&Checked<Uint<LIMBS>>> for Checked<Uint<LIMBS>> {
    fn mul_assign(&mut self, other: &Checked<Uint<LIMBS>>) {
        *self = *self * other;
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize, const WIDE_LIMBS: usize>
    ConcatenatingMul<Uint<RHS_LIMBS>> for Uint<LIMBS>
where
    Self: Concat<RHS_LIMBS, Output = Uint<WIDE_LIMBS>>,
{
    type Output = Uint<WIDE_LIMBS>;

    #[inline]
    fn concatenating_mul(&self, rhs: Uint<RHS_LIMBS>) -> Self::Output {
        self.concatenating_mul(&rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize, const WIDE_LIMBS: usize>
    ConcatenatingMul<&Uint<RHS_LIMBS>> for Uint<LIMBS>
where
    Self: Concat<RHS_LIMBS, Output = Uint<WIDE_LIMBS>>,
{
    type Output = Uint<WIDE_LIMBS>;

    #[inline]
    fn concatenating_mul(&self, rhs: &Uint<RHS_LIMBS>) -> Self::Output {
        self.concatenating_mul(rhs)
    }
}

impl<const LIMBS: usize, const WIDE_LIMBS: usize> ConcatenatingSquare for Uint<LIMBS>
where
    Self: Concat<LIMBS, Output = Uint<WIDE_LIMBS>>,
{
    type Output = Uint<WIDE_LIMBS>;

    #[inline]
    fn concatenating_square(&self) -> Self::Output {
        self.concatenating_square()
    }
}

impl<const LIMBS: usize> WrappingMul for Uint<LIMBS> {
    fn wrapping_mul(&self, v: &Self) -> Self {
        self.wrapping_mul(v)
    }
}

#[cfg(test)]
mod tests {
    use crate::{ConcatenatingMul, ConcatenatingSquare, Limb, U64, U128, U192, U256, Uint};

    #[test]
    fn widening_mul_zero_and_one() {
        assert_eq!(U64::ZERO.widening_mul(&U64::ZERO), (U64::ZERO, U64::ZERO));
        assert_eq!(U64::ZERO.widening_mul(&U64::ONE), (U64::ZERO, U64::ZERO));
        assert_eq!(U64::ONE.widening_mul(&U64::ZERO), (U64::ZERO, U64::ZERO));
        assert_eq!(U64::ONE.widening_mul(&U64::ONE), (U64::ONE, U64::ZERO));
    }

    #[test]
    fn widening_mul_lo_only() {
        let primes: &[u32] = &[3, 5, 17, 257, 65537];

        for &a_int in primes {
            for &b_int in primes {
                let (lo, hi) = U64::from_u32(a_int).widening_mul(&U64::from_u32(b_int));
                let expected = U64::from_u64(u64::from(a_int) * u64::from(b_int));
                assert_eq!(lo, expected);
                assert!(bool::from(hi.is_zero()));
                assert_eq!(lo, U64::from_u32(a_int).wrapping_mul(&U64::from_u32(b_int)));
            }
        }
    }

    #[test]
    fn mul_concat_even() {
        assert_eq!(U64::ZERO.concatenating_mul(&U64::MAX), U128::ZERO);
        assert_eq!(U64::MAX.concatenating_mul(&U64::ZERO), U128::ZERO);
        assert_eq!(
            U64::MAX.concatenating_mul(&U64::MAX),
            U128::from_u128(0xfffffffffffffffe_0000000000000001)
        );
        assert_eq!(
            U64::ONE.concatenating_mul(&U64::MAX),
            U128::from_u128(0x0000000000000000_ffffffffffffffff)
        );
    }

    #[test]
    fn mul_concat_mixed() {
        let a = U64::from_u64(0x0011223344556677);
        let b = U128::from_u128(0x8899aabbccddeeff_8899aabbccddeeff);
        let expected = U192::from(&b).saturating_mul(&a);
        assert_eq!(a.concatenating_mul(&b), expected);
        assert_eq!(ConcatenatingMul::concatenating_mul(&a, &b), expected);
        assert_eq!(b.concatenating_mul(&a), expected);
        assert_eq!(ConcatenatingMul::concatenating_mul(&b, &a), expected);
    }

    #[test]
    fn wrapping_mul_even() {
        assert_eq!(U64::ZERO.wrapping_mul(&U64::MAX), U64::ZERO);
        assert_eq!(U64::MAX.wrapping_mul(&U64::ZERO), U64::ZERO);
        assert_eq!(U64::MAX.wrapping_mul(&U64::MAX), U64::ONE);
        assert_eq!(U64::ONE.wrapping_mul(&U64::MAX), U64::MAX);
    }

    #[test]
    fn wrapping_mul_mixed() {
        let a = U64::from_u64(0x0011223344556677);
        let b = U128::from_u128(0x8899aabbccddeeff_8899aabbccddeeff);
        let expected = U192::from(&b).saturating_mul(&a);
        assert_eq!(b.wrapping_mul(&a), expected.resize());
        assert_eq!(a.wrapping_mul(&b), expected.resize());
    }

    #[test]
    fn checked_mul_ok() {
        let n = U64::from_u32(0xffff_ffff);
        assert_eq!(
            n.checked_mul(&n).unwrap(),
            U64::from_u64(0xffff_fffe_0000_0001)
        );
        assert_eq!(U64::ZERO.checked_mul(&U64::ZERO).unwrap(), U64::ZERO);
    }

    #[test]
    fn checked_mul_overflow() {
        let n = U64::MAX;
        assert!(bool::from(n.checked_mul(&n).is_none()));
    }

    #[test]
    fn saturating_mul_no_overflow() {
        let n = U64::from_u8(8);
        assert_eq!(n.saturating_mul(&n), U64::from_u8(64));
    }

    #[test]
    fn saturating_mul_overflow() {
        let a = U64::from(0xffff_ffff_ffff_ffffu64);
        let b = U64::from(2u8);
        assert_eq!(a.saturating_mul(&b), U64::MAX);
    }

    #[test]
    fn concatenating_square() {
        let n = U64::from_u64(0xffff_ffff_ffff_ffff);
        let (lo, hi) = n.concatenating_square().split();
        assert_eq!(lo, U64::from_u64(1));
        assert_eq!(hi, U64::from_u64(0xffff_ffff_ffff_fffe));
        let check = ConcatenatingSquare::concatenating_square(&n).split();
        assert_eq!(check, (lo, hi));
    }

    #[test]
    fn concatenating_square_larger() {
        let n = U256::MAX;
        let (lo, hi) = n.concatenating_square().split();
        assert_eq!(lo, U256::ONE);
        assert_eq!(hi, U256::MAX.wrapping_sub(&U256::ONE));
    }

    #[test]
    fn checked_square() {
        let n = U256::from_u64(u64::MAX).wrapping_add(&U256::ONE);
        let n2 = n.checked_square();
        assert!(n2.is_some().to_bool());
        let n4 = n2.unwrap().checked_square();
        assert!(n4.is_none().to_bool());
        let z = U256::ZERO.checked_square();
        assert!(z.is_some().to_bool());
        let m = U256::MAX.checked_square();
        assert!(m.is_none().to_bool());
    }

    #[test]
    fn wrapping_square() {
        let n = U256::from_u64(u64::MAX).wrapping_add(&U256::ONE);
        let n2 = n.wrapping_square();
        assert_eq!(n2, U256::from_u128(u128::MAX).wrapping_add(&U256::ONE));
        let n4 = n2.wrapping_square();
        assert_eq!(n4, U256::ZERO);
    }

    #[test]
    fn saturating_square() {
        let n = U256::from_u64(u64::MAX).wrapping_add(&U256::ONE);
        let n2 = n.saturating_square();
        assert_eq!(n2, U256::from_u128(u128::MAX).wrapping_add(&U256::ONE));
        let n4 = n2.saturating_square();
        assert_eq!(n4, U256::MAX);
    }

    #[cfg(feature = "rand_core")]
    #[test]
    fn mul_cmp() {
        use crate::{Random, U4096};
        use rand_core::SeedableRng;
        let mut rng = chacha20::ChaCha8Rng::seed_from_u64(1);

        let rounds = if cfg!(miri) { 10 } else { 50 };
        for _ in 0..rounds {
            let a = U4096::random_from_rng(&mut rng);
            assert_eq!(a.concatenating_mul(&a), a.concatenating_square(), "a = {a}");
            assert_eq!(a.widening_mul(&a), a.widening_square(), "a = {a}");
            assert_eq!(a.wrapping_mul(&a), a.wrapping_square(), "a = {a}");
            assert_eq!(a.saturating_mul(&a), a.saturating_square(), "a = {a}");
        }
    }

    #[test]
    fn checked_mul_sizes() {
        const SIZE_A: usize = 4;
        const SIZE_B: usize = 8;

        for n in 0..Uint::<SIZE_A>::BITS {
            let mut a = Uint::<SIZE_A>::ZERO;
            a = a.set_bit_vartime(n, true);

            for m in (0..Uint::<SIZE_B>::BITS).step_by(16) {
                let mut b = Uint::<SIZE_B>::ZERO;
                b = b.set_bit_vartime(m, true);
                let res = a.widening_mul(&b);
                let res_overflow = res.1.is_nonzero();
                let checked = a.checked_mul(&b);
                assert_eq!(checked.is_some().to_bool(), res_overflow.not().to_bool());
                assert_eq!(
                    checked.as_inner_unchecked(),
                    &res.0,
                    "a = 2**{n}, b = 2**{m}"
                );
            }
        }
    }

    #[test]
    fn checked_square_sizes() {
        const SIZE: usize = 4;

        for n in 0..Uint::<SIZE>::BITS {
            let mut a = Uint::<SIZE>::ZERO;
            a = a.set_bit_vartime(n, true);

            let res = a.widening_square();
            let res_overflow = res.1.is_nonzero();
            let checked = a.checked_square();
            assert_eq!(checked.is_some().to_bool(), res_overflow.not().to_bool());
            assert_eq!(checked.as_inner_unchecked(), &res.0, "a = 2**{n}");
        }
    }

    #[test]
    fn overflowing_mul_limb() {
        let (max_lo, max_hi) = U128::MAX.widening_mul(&U128::from(Limb::MAX));

        let result = U128::ZERO.overflowing_mul_limb(Limb::ZERO);
        assert_eq!(result, (U128::ZERO, Limb::ZERO));
        let result = U128::ZERO.overflowing_mul_limb(Limb::ONE);
        assert_eq!(result, (U128::ZERO, Limb::ZERO));
        let result = U128::MAX.overflowing_mul_limb(Limb::ZERO);
        assert_eq!(result, (U128::ZERO, Limb::ZERO));
        let result = U128::MAX.overflowing_mul_limb(Limb::ONE);
        assert_eq!(result, (U128::MAX, Limb::ZERO));
        let result = U128::MAX.overflowing_mul_limb(Limb::MAX);
        assert_eq!(result, (max_lo, max_hi.limbs[0]));

        assert_eq!(U128::ZERO.wrapping_mul_limb(Limb::ZERO), U128::ZERO);
        assert_eq!(U128::ZERO.wrapping_mul_limb(Limb::ONE), U128::ZERO);
        assert_eq!(U128::MAX.wrapping_mul_limb(Limb::ZERO), U128::ZERO);
        assert_eq!(U128::MAX.wrapping_mul_limb(Limb::ONE), U128::MAX);
        assert_eq!(U128::MAX.wrapping_mul_limb(Limb::MAX), max_lo);
    }
}
