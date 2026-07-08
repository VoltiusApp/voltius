//! Operations related to dividing an [`Int`] by a [`Uint`].
use core::ops::{Div, DivAssign, Rem, RemAssign};

use crate::{Choice, Int, NonZero, Uint, Wrapping};

/// Checked division operations.
impl<const LIMBS: usize> Int<LIMBS> {
    #[inline]
    /// Base `div_rem` operation on dividing an [`Int`] by a [`Uint`].
    /// Computes the quotient and remainder of `self / rhs`.
    /// Furthermore, returns the sign of `self`.
    const fn div_rem_base_unsigned<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> (Uint<LIMBS>, Uint<RHS_LIMBS>, Choice) {
        let (lhs_mag, lhs_sgn) = self.abs_sign();
        let (quotient, remainder) = lhs_mag.div_rem(rhs);
        (quotient, remainder, lhs_sgn)
    }

    /// Compute the quotient and remainder of `self / rhs`.
    ///
    /// Example:
    /// ```
    /// use crypto_bigint::{I128, NonZero, U128};
    ///
    /// let (quotient, remainder) = I128::from(8).div_rem_unsigned(&U128::from(3u32).to_nz().unwrap());
    /// assert_eq!(quotient, I128::from(2));
    /// assert_eq!(remainder, I128::from(2));
    ///
    /// let (quotient, remainder) = I128::from(-8).div_rem_unsigned(&U128::from(3u32).to_nz().unwrap());
    /// assert_eq!(quotient, I128::from(-2));
    /// assert_eq!(remainder, I128::from(-2));
    /// ```
    #[must_use]
    pub const fn div_rem_unsigned<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> (Self, Int<RHS_LIMBS>) {
        let (quotient, remainder, lhs_sgn) = self.div_rem_base_unsigned(rhs);
        (
            Self(quotient).wrapping_neg_if(lhs_sgn),
            Int::new_from_abs_sign(remainder, lhs_sgn).expect_copied("no overflow; always fits"),
        )
    }

    /// Perform division.
    /// Note: this operation rounds towards zero, truncating any fractional part of the exact result.
    #[must_use]
    pub const fn div_unsigned<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> Self {
        self.div_rem_unsigned(rhs).0
    }

    /// Compute the remainder.
    /// The remainder will have the same sign as `self` (or be zero).
    #[must_use]
    pub const fn rem_unsigned<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> Int<RHS_LIMBS> {
        self.div_rem_unsigned(rhs).1
    }
}

/// Vartime checked division operations.
impl<const LIMBS: usize> Int<LIMBS> {
    #[inline]
    /// Variable time equivalent of [`Self::div_rem_base_unsigned`].
    ///
    /// This is variable only with respect to `rhs`.
    ///
    /// When used with a fixed `rhs`, this function is constant-time with respect
    /// to `self`.
    const fn div_rem_base_unsigned_vartime<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> (Uint<LIMBS>, Uint<RHS_LIMBS>, Choice) {
        let (lhs_mag, lhs_sgn) = self.abs_sign();
        let (quotient, remainder) = lhs_mag.div_rem_vartime(rhs);
        (quotient, remainder, lhs_sgn)
    }

    /// Variable time equivalent of [`Self::div_rem_unsigned`].
    ///
    /// This is variable only with respect to `rhs`.
    ///
    /// When used with a fixed `rhs`, this function is constant-time with respect
    /// to `self`.
    #[must_use]
    pub const fn div_rem_unsigned_vartime<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> (Self, Int<RHS_LIMBS>) {
        let (quotient, remainder, lhs_sgn) = self.div_rem_base_unsigned_vartime(rhs);
        (
            Self(quotient).wrapping_neg_if(lhs_sgn),
            remainder.as_int().wrapping_neg_if(lhs_sgn),
        )
    }

    /// Variable time equivalent of [`Self::div_unsigned`].
    ///
    /// This is variable only with respect to `rhs`.
    ///
    /// When used with a fixed `rhs`, this function is constant-time with respect
    /// to `self`.
    #[must_use]
    pub const fn div_unsigned_vartime<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> Self {
        self.div_rem_unsigned_vartime(rhs).0
    }

    /// Variable time equivalent of [`Self::rem_unsigned`].
    ///
    /// This is variable only with respect to `rhs`.
    ///
    /// When used with a fixed `rhs`, this function is constant-time with respect
    /// to `self`.
    #[must_use]
    pub const fn rem_unsigned_vartime<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> Int<RHS_LIMBS> {
        self.div_rem_unsigned_vartime(rhs).1
    }
}

/// Checked div-floor operations
impl<const LIMBS: usize> Int<LIMBS> {
    /// Perform floored division and mod:
    /// given `n` and `d`, computes `q` and `r` s.t. `n = qd + r` and `q = ⌊n/d⌋`.
    /// Note: this operation rounds **down**, not towards zero.
    ///
    /// Example:
    /// ```
    /// use crypto_bigint::{I128, U128};
    ///
    /// let three = U128::from(3u32).to_nz().unwrap();
    /// assert_eq!(
    ///     I128::from(8).div_rem_floor_unsigned(&three),
    ///     (I128::from(2), U128::from(2u32))
    /// );
    /// assert_eq!(
    ///     I128::from(-8).div_rem_floor_unsigned(&three),
    ///     (I128::from(-3), U128::ONE)
    /// );
    /// ```
    #[must_use]
    pub fn div_rem_floor_unsigned<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> (Self, Uint<RHS_LIMBS>) {
        let (quotient, remainder, lhs_sgn) = self.div_rem_base_unsigned(rhs);

        // Increase the quotient by one when self is negative and there is a non-zero remainder.
        let modify = remainder.is_nonzero().and(lhs_sgn);
        let quotient = Uint::select(&quotient, &quotient.wrapping_add(&Uint::ONE), modify);

        // Invert the remainder when self is negative and there is a non-zero remainder.
        let remainder = Uint::select(&remainder, &rhs.wrapping_sub(&remainder), modify);

        // Negate if applicable
        let quotient = Self(quotient).wrapping_neg_if(lhs_sgn);

        (quotient, remainder)
    }

    /// Perform checked division.
    /// Note: this operation rounds down.
    ///
    /// Example:
    /// ```
    /// use crypto_bigint::{I128, U128};
    /// assert_eq!(
    ///     I128::from(8).div_floor_unsigned(&U128::from(3u32).to_nz().unwrap()),
    ///     I128::from(2)
    /// );
    /// assert_eq!(
    ///     I128::from(-8).div_floor_unsigned(&U128::from(3u32).to_nz().unwrap()),
    ///     I128::from(-3)
    /// );
    /// ```
    #[must_use]
    pub fn div_floor_unsigned<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> Self {
        let (q, _) = self.div_rem_floor_unsigned(rhs);
        q
    }

    /// Compute `self % rhs` and return the result contained in the interval `[0, rhs)`.
    ///
    /// Example:
    /// ```
    /// use crypto_bigint::{I128, U128};
    /// assert_eq!(
    ///     I128::from(8).normalized_rem(&U128::from(3u32).to_nz().unwrap()),
    ///     U128::from(2u32)
    /// );
    /// assert_eq!(
    ///     I128::from(-8).normalized_rem(&U128::from(3u32).to_nz().unwrap()),
    ///     U128::ONE
    /// );
    /// ```
    #[must_use]
    pub fn normalized_rem<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> Uint<RHS_LIMBS> {
        let (_, r) = self.div_rem_floor_unsigned(rhs);
        r
    }
}

/// Vartime checked div-floor operations
impl<const LIMBS: usize> Int<LIMBS> {
    /// Variable time equivalent of [`Self::div_rem_floor_unsigned`].
    ///
    /// This is variable only with respect to `rhs`.
    ///
    /// When used with a fixed `rhs`, this function is constant-time with respect
    /// to `self`.
    #[must_use]
    pub fn div_rem_floor_unsigned_vartime<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> (Self, Uint<RHS_LIMBS>) {
        let (quotient, remainder, lhs_sgn) = self.div_rem_base_unsigned_vartime(rhs);

        // Increase the quotient by one when self is negative and there is a non-zero remainder.
        let modify = remainder.is_nonzero().and(lhs_sgn);
        let quotient = Uint::select(&quotient, &quotient.wrapping_add(&Uint::ONE), modify);

        // Invert the remainder when self is negative and there is a non-zero remainder.
        let remainder = Uint::select(&remainder, &rhs.wrapping_sub(&remainder), modify);

        // Negate if applicable
        let quotient = Self(quotient).wrapping_neg_if(lhs_sgn);

        (quotient, remainder)
    }

    /// Variable time equivalent of [`Self::div_floor_unsigned`].
    ///
    /// This is variable only with respect to `rhs`.
    ///
    /// When used with a fixed `rhs`, this function is constant-time with respect
    /// to `self`.
    #[must_use]
    pub fn div_floor_unsigned_vartime<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> Self {
        let (q, _) = self.div_rem_floor_unsigned_vartime(rhs);
        q
    }

    /// Variable time equivalent of [`Self::normalized_rem`].
    ///
    /// This is variable only with respect to `rhs`.
    ///
    /// When used with a fixed `rhs`, this function is constant-time with respect
    /// to `self`.
    #[must_use]
    pub fn normalized_rem_vartime<const RHS_LIMBS: usize>(
        &self,
        rhs: &NonZero<Uint<RHS_LIMBS>>,
    ) -> Uint<RHS_LIMBS> {
        let (_, r) = self.div_rem_floor_unsigned_vartime(rhs);
        r
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Div<&NonZero<Uint<RHS_LIMBS>>> for &Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn div(self, rhs: &NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        *self / *rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Div<&NonZero<Uint<RHS_LIMBS>>> for Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn div(self, rhs: &NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        self / *rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Div<NonZero<Uint<RHS_LIMBS>>> for &Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn div(self, rhs: NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        *self / rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Div<NonZero<Uint<RHS_LIMBS>>> for Int<LIMBS> {
    type Output = Int<LIMBS>;

    fn div(self, rhs: NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        self.div_unsigned(&rhs)
    }
}

impl<const LIMBS: usize> DivAssign<&NonZero<Uint<LIMBS>>> for Int<LIMBS> {
    fn div_assign(&mut self, rhs: &NonZero<Uint<LIMBS>>) {
        *self /= *rhs;
    }
}

impl<const LIMBS: usize> DivAssign<NonZero<Uint<LIMBS>>> for Int<LIMBS> {
    fn div_assign(&mut self, rhs: NonZero<Uint<LIMBS>>) {
        *self = *self / rhs;
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Div<NonZero<Uint<RHS_LIMBS>>>
    for Wrapping<Int<LIMBS>>
{
    type Output = Wrapping<Int<LIMBS>>;

    fn div(self, rhs: NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        Wrapping(self.0 / rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Div<NonZero<Uint<RHS_LIMBS>>>
    for &Wrapping<Int<LIMBS>>
{
    type Output = Wrapping<Int<LIMBS>>;

    fn div(self, rhs: NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        *self / rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Div<&NonZero<Uint<RHS_LIMBS>>>
    for &Wrapping<Int<LIMBS>>
{
    type Output = Wrapping<Int<LIMBS>>;

    fn div(self, rhs: &NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        *self / *rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Div<&NonZero<Uint<RHS_LIMBS>>>
    for Wrapping<Int<LIMBS>>
{
    type Output = Wrapping<Int<LIMBS>>;

    fn div(self, rhs: &NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        self / *rhs
    }
}

impl<const LIMBS: usize> DivAssign<&NonZero<Uint<LIMBS>>> for Wrapping<Int<LIMBS>> {
    fn div_assign(&mut self, rhs: &NonZero<Uint<LIMBS>>) {
        *self = Wrapping(self.0 / rhs);
    }
}

impl<const LIMBS: usize> DivAssign<NonZero<Uint<LIMBS>>> for Wrapping<Int<LIMBS>> {
    fn div_assign(&mut self, rhs: NonZero<Uint<LIMBS>>) {
        *self /= &rhs;
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Rem<&NonZero<Uint<RHS_LIMBS>>> for &Int<LIMBS> {
    type Output = Int<RHS_LIMBS>;

    fn rem(self, rhs: &NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        *self % *rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Rem<&NonZero<Uint<RHS_LIMBS>>> for Int<LIMBS> {
    type Output = Int<RHS_LIMBS>;

    fn rem(self, rhs: &NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        self % *rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Rem<NonZero<Uint<RHS_LIMBS>>> for &Int<LIMBS> {
    type Output = Int<RHS_LIMBS>;

    fn rem(self, rhs: NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        *self % rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Rem<NonZero<Uint<RHS_LIMBS>>> for Int<LIMBS> {
    type Output = Int<RHS_LIMBS>;

    fn rem(self, rhs: NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        Self::rem_unsigned(&self, &rhs)
    }
}

impl<const LIMBS: usize> RemAssign<&NonZero<Uint<LIMBS>>> for Int<LIMBS> {
    fn rem_assign(&mut self, rhs: &NonZero<Uint<LIMBS>>) {
        *self %= *rhs;
    }
}

impl<const LIMBS: usize> RemAssign<NonZero<Uint<LIMBS>>> for Int<LIMBS> {
    fn rem_assign(&mut self, rhs: NonZero<Uint<LIMBS>>) {
        *self = *self % rhs;
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Rem<NonZero<Uint<RHS_LIMBS>>>
    for Wrapping<Int<LIMBS>>
{
    type Output = Wrapping<Int<RHS_LIMBS>>;

    fn rem(self, rhs: NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        Wrapping(self.0 % rhs)
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Rem<NonZero<Uint<RHS_LIMBS>>>
    for &Wrapping<Int<LIMBS>>
{
    type Output = Wrapping<Int<RHS_LIMBS>>;

    fn rem(self, rhs: NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        *self % rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Rem<&NonZero<Uint<RHS_LIMBS>>>
    for &Wrapping<Int<LIMBS>>
{
    type Output = Wrapping<Int<RHS_LIMBS>>;

    fn rem(self, rhs: &NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        *self % *rhs
    }
}

impl<const LIMBS: usize, const RHS_LIMBS: usize> Rem<&NonZero<Uint<RHS_LIMBS>>>
    for Wrapping<Int<LIMBS>>
{
    type Output = Wrapping<Int<RHS_LIMBS>>;

    fn rem(self, rhs: &NonZero<Uint<RHS_LIMBS>>) -> Self::Output {
        self % *rhs
    }
}

impl<const LIMBS: usize> RemAssign<NonZero<Uint<LIMBS>>> for Wrapping<Int<LIMBS>> {
    fn rem_assign(&mut self, rhs: NonZero<Uint<LIMBS>>) {
        *self %= &rhs;
    }
}

impl<const LIMBS: usize> RemAssign<&NonZero<Uint<LIMBS>>> for Wrapping<Int<LIMBS>> {
    fn rem_assign(&mut self, rhs: &NonZero<Uint<LIMBS>>) {
        *self = Wrapping(self.0 % rhs);
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "rand_core")]
    use {
        crate::{I1024, Random, U512, U1024},
        chacha20::ChaCha8Rng,
        rand_core::SeedableRng,
    };

    use crate::{I128, U128};

    #[test]
    fn test_div_unsigned() {
        // lhs = min
        assert_eq!(I128::MIN / U128::ONE.to_nz().unwrap(), I128::MIN);
        assert_eq!(I128::MIN / U128::MAX.to_nz().unwrap(), I128::ZERO);

        // lhs = -1
        assert_eq!(
            I128::MINUS_ONE / U128::ONE.to_nz().unwrap(),
            I128::MINUS_ONE
        );
        assert_eq!(I128::MINUS_ONE / U128::MAX.to_nz().unwrap(), I128::ZERO);

        // lhs = 0
        assert_eq!(I128::ZERO / U128::ONE.to_nz().unwrap(), I128::ZERO);
        assert_eq!(I128::ZERO / U128::MAX.to_nz().unwrap(), I128::ZERO);

        // lhs = 1
        assert_eq!(I128::ONE / U128::ONE.to_nz().unwrap(), I128::ONE);
        assert_eq!(I128::ONE / U128::MAX.to_nz().unwrap(), I128::ZERO);

        // lhs = max
        assert_eq!(I128::MAX / U128::ONE.to_nz().unwrap(), I128::MAX);
        assert_eq!(I128::MAX / U128::MAX.to_nz().unwrap(), I128::ZERO);
    }

    // TODO(tarcieri): use proptest
    #[cfg(feature = "rand_core")]
    #[test]
    fn test_div_ct_vs_vt() {
        let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
        for _ in 0..50 {
            let num = I1024::random_from_rng(&mut rng);
            let denom = U1024::from(&U512::random_from_rng(&mut rng))
                .to_nz()
                .unwrap();

            assert_eq!(num.div_unsigned(&denom), num.div_unsigned_vartime(&denom));
        }
    }

    #[test]
    fn test_div_rem_floor_unsigned() {
        // lhs = min
        assert_eq!(
            I128::MIN.div_rem_floor_unsigned(&U128::ONE.to_nz().unwrap()),
            (I128::MIN, U128::ZERO)
        );
        assert_eq!(
            I128::MIN.div_rem_floor_unsigned(&U128::MAX.to_nz().unwrap()),
            (
                I128::MINUS_ONE,
                I128::MIN.as_uint().wrapping_sub(&U128::ONE)
            )
        );

        // lhs = -1
        assert_eq!(
            I128::MINUS_ONE.div_rem_floor_unsigned(&U128::ONE.to_nz().unwrap()),
            (I128::MINUS_ONE, U128::ZERO)
        );
        assert_eq!(
            I128::MINUS_ONE.div_rem_floor_unsigned(&U128::MAX.to_nz().unwrap()),
            (I128::MINUS_ONE, U128::MAX.wrapping_sub(&U128::ONE))
        );

        // lhs = 0
        assert_eq!(
            I128::ZERO.div_rem_floor_unsigned(&U128::ONE.to_nz().unwrap()),
            (I128::ZERO, U128::ZERO)
        );
        assert_eq!(
            I128::ZERO.div_rem_floor_unsigned(&U128::MAX.to_nz().unwrap()),
            (I128::ZERO, U128::ZERO)
        );

        // lhs = 1
        assert_eq!(
            I128::ONE.div_rem_floor_unsigned(&U128::ONE.to_nz().unwrap()),
            (I128::ONE, U128::ZERO)
        );
        assert_eq!(
            I128::ONE.div_rem_floor_unsigned(&U128::MAX.to_nz().unwrap()),
            (I128::ZERO, U128::ONE)
        );

        // lhs = max
        assert_eq!(
            I128::MAX.div_rem_floor_unsigned(&U128::ONE.to_nz().unwrap()),
            (I128::MAX, U128::ZERO)
        );
        assert_eq!(
            I128::MAX.div_rem_floor_unsigned(&U128::MAX.to_nz().unwrap()),
            (I128::ZERO, *I128::MAX.as_uint())
        );
    }

    // TODO(tarcieri): use proptest
    #[cfg(feature = "rand_core")]
    #[test]
    fn test_div_floor_ct_vs_vt() {
        let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
        for _ in 0..50 {
            let num = I1024::random_from_rng(&mut rng);
            let denom = U1024::from(&U512::random_from_rng(&mut rng))
                .to_nz()
                .unwrap();

            assert_eq!(
                num.div_floor_unsigned(&denom),
                num.div_floor_unsigned_vartime(&denom)
            );
        }
    }
}
