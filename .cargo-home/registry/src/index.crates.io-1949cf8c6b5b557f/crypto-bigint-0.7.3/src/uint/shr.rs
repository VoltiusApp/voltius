//! [`Uint`] bitwise right shift operations.

use crate::{CtOption, Limb, Shr, ShrAssign, ShrVartime, Uint, WrappingShr, primitives::u32_rem};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Computes `self >> shift`.
    ///
    /// # Panics
    /// - if `shift >= Self::BITS`.
    #[inline(never)]
    #[must_use]
    #[track_caller]
    pub const fn shr(&self, shift: u32) -> Self {
        let mut res = *self;
        res.as_mut_uint_ref().bounded_shr_assign(shift, Self::BITS);
        res
    }

    /// Computes `self >> shift` in variable time.
    ///
    /// # Panics
    /// - if `shift >= Self::BITS`.
    #[inline(always)]
    #[must_use]
    pub const fn shr_vartime(&self, shift: u32) -> Self {
        self.overflowing_shr_vartime(shift)
            .expect("`shift` exceeds upper bound")
    }

    /// Computes `self >> shift`.
    ///
    /// Returns `None` if `shift >= Self::BITS`.
    #[inline(never)]
    #[must_use]
    pub const fn overflowing_shr(&self, shift: u32) -> CtOption<Self> {
        let mut res = *self;
        let overflow = res.as_mut_uint_ref().overflowing_shr_assign(shift);
        CtOption::new(res, overflow.not())
    }

    /// Computes `self >> shift`.
    ///
    /// Returns `None` if `shift >= Self::BITS`.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[must_use]
    pub const fn overflowing_shr_vartime(&self, shift: u32) -> Option<Self> {
        if shift < Self::BITS {
            Some(self.unbounded_shr_vartime(shift))
        } else {
            None
        }
    }

    /// Computes a right shift on a wide input as `(lo, hi)`.
    ///
    /// Returns `None` if `shift >= Self::BITS`.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect
    /// to `self`.
    #[inline(always)]
    #[must_use]
    pub const fn overflowing_shr_vartime_wide(
        lower_upper: (Self, Self),
        shift: u32,
    ) -> Option<(Self, Self)> {
        let (lower, upper) = lower_upper;
        if shift >= 2 * Self::BITS {
            None
        } else if shift >= Self::BITS {
            let lower = upper.unbounded_shr_vartime(shift - Self::BITS);
            Some((lower, Self::ZERO))
        } else {
            let new_upper = upper.unbounded_shr_vartime(shift);
            let lower_hi = upper.unbounded_shl_vartime(Self::BITS - shift);
            let lower_lo = lower.unbounded_shr_vartime(shift);
            Some((lower_lo.bitor(&lower_hi), new_upper))
        }
    }

    /// Computes `self >> shift` where `shift < shift_upper_bound`.
    ///
    /// The runtime is determined by `shift_upper_bound` which may be larger or smaller than
    /// `Self::BITS`.
    ///
    /// # Panics
    /// - if the shift exceeds the upper bound.
    #[inline(never)]
    #[must_use]
    #[track_caller]
    pub const fn bounded_shr(&self, shift: u32, shift_upper_bound: u32) -> Self {
        let mut res = *self;
        res.as_mut_uint_ref()
            .bounded_shr_assign(shift, shift_upper_bound);
        res
    }

    /// Computes `self >> (shift * Limb::BITS)` where `shift < shift_upper_bound`.
    ///
    /// The runtime is determined by `shift_upper_bound` which may be larger or smaller than
    /// `LIMBS`.
    ///
    /// # Panics
    /// - if the shift exceeds the upper bound.
    #[inline]
    #[must_use]
    #[track_caller]
    pub(crate) const fn bounded_shr_by_limbs(&self, shift: u32, shift_upper_bound: u32) -> Self {
        let mut res = *self;
        res.as_mut_uint_ref()
            .bounded_shr_by_limbs_assign(shift, shift_upper_bound);
        res
    }

    /// Computes `self >> shift` in a panic-free manner, returning zero if the shift exceeds the
    /// precision.
    #[inline(never)]
    #[must_use]
    pub const fn unbounded_shr(&self, shift: u32) -> Self {
        let mut res = *self;
        res.as_mut_uint_ref().unbounded_shr_assign(shift);
        res
    }

    /// Computes `self >> shift` in variable time in a panic-free manner, returning zero if the
    /// shift exceeds the precision.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect
    /// to `self`.
    #[inline(always)]
    #[must_use]
    pub const fn unbounded_shr_vartime(&self, shift: u32) -> Self {
        let mut res = Self::ZERO;
        self.as_uint_ref()
            .unbounded_shr_vartime(shift, res.as_mut_uint_ref());
        res
    }

    /// Computes `self >> (shift * Limb::BITS)` in a panic-free manner, returning zero if the
    /// shift exceeds the precision.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[must_use]
    pub(crate) const fn unbounded_shr_by_limbs_vartime(&self, shift: u32) -> Self {
        let mut res = *self;
        res.as_mut_uint_ref()
            .unbounded_shr_assign_by_limbs_vartime(shift);
        res
    }

    /// Computes `self >> shift` in a panic-free manner, reducing shift modulo the type's width.
    #[inline(always)]
    #[must_use]
    pub const fn wrapping_shr(&self, shift: u32) -> Self {
        self.shr(u32_rem(shift, Self::BITS))
    }

    /// Computes `self >> shift` in variable-time in a panic-free manner, reducing shift modulo
    /// the type's width.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[must_use]
    #[allow(clippy::integer_division_remainder_used, reason = "vartime")]
    pub const fn wrapping_shr_vartime(&self, shift: u32) -> Self {
        self.unbounded_shr_vartime(shift % Self::BITS)
    }

    /// Computes `self >> 1` in constant-time.
    #[inline(always)]
    #[must_use]
    pub(crate) const fn shr1(&self) -> Self {
        let mut res = *self;
        res.as_mut_uint_ref().shr1_assign();
        res
    }

    /// Computes `self >> shift` where `0 <= shift < Limb::BITS`,
    /// returning the result and the carry.
    ///
    /// # Panics
    /// - if `shift >= Limb::BITS`.
    #[inline(always)]
    #[must_use]
    #[track_caller]
    pub(crate) const fn shr_limb_with_carry(&self, shift: u32, carry: Limb) -> (Self, Limb) {
        let mut res = *self;
        let carry = res
            .as_mut_uint_ref()
            .shr_assign_limb_with_carry(shift, carry);
        (res, carry)
    }
}

macro_rules! impl_shr {
    ($($shift:ty),+) => {
        $(
            impl<const LIMBS: usize> Shr<$shift> for Uint<LIMBS> {
                type Output = Uint<LIMBS>;

                #[inline]
                fn shr(self, shift: $shift) -> Uint<LIMBS> {
                    <&Self>::shr(&self, shift)
                }
            }

            impl<const LIMBS: usize> Shr<$shift> for &Uint<LIMBS> {
                type Output = Uint<LIMBS>;

                #[inline]
                fn shr(self, shift: $shift) -> Uint<LIMBS> {
                    Uint::<LIMBS>::shr(self, u32::try_from(shift).expect("invalid shift"))
                }
            }

            impl<const LIMBS: usize> ShrAssign<$shift> for Uint<LIMBS> {
                fn shr_assign(&mut self, shift: $shift) {
                    *self = self.shr(shift)
                }
            }
        )+
    };
}

impl_shr!(i32, u32, usize);

impl<const LIMBS: usize> WrappingShr for Uint<LIMBS> {
    fn wrapping_shr(&self, shift: u32) -> Uint<LIMBS> {
        self.wrapping_shr(shift)
    }
}

impl<const LIMBS: usize> ShrVartime for Uint<LIMBS> {
    fn overflowing_shr_vartime(&self, shift: u32) -> Option<Self> {
        self.overflowing_shr_vartime(shift)
    }

    fn unbounded_shr_vartime(&self, shift: u32) -> Self {
        self.unbounded_shr_vartime(shift)
    }

    fn wrapping_shr_vartime(&self, shift: u32) -> Self {
        self.wrapping_shr_vartime(shift)
    }
}

#[cfg(test)]
mod tests {
    use crate::{Limb, ShrVartime, U128, U192, Uint, WrappingShr};

    const N: U192 = U192::from_be_hex("FFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

    const N_2: U192 = U192::from_be_hex("7FFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0");

    #[test]
    fn shr1() {
        assert_eq!(N.shr1(), N_2);
        assert_eq!(N >> 1, N_2);
        assert_eq!(N.bounded_shr(1, 2), N_2);
        assert_eq!(ShrVartime::overflowing_shr_vartime(&N, 1), Some(N_2));
        assert_eq!(ShrVartime::wrapping_shr_vartime(&N, 1), N_2);
    }

    #[test]
    fn shr_bounds() {
        assert!(N.overflowing_shr(192).is_none().to_bool_vartime());
        assert!(N.overflowing_shr_vartime(192).is_none());
        assert_eq!(N.unbounded_shr(192), Uint::ZERO);
        assert_eq!(N.unbounded_shr_vartime(192), Uint::ZERO);
        assert_eq!(N.wrapping_shr(192), N);
        assert_eq!(N.wrapping_shr_vartime(192), N);
    }

    #[test]
    #[should_panic(expected = "`shift` exceeds upper bound")]
    fn shr_bounds_panic() {
        let _ = N >> 192;
    }

    #[test]
    fn shr_wide_1_1_128() {
        assert_eq!(
            Uint::overflowing_shr_vartime_wide((U128::ONE, U128::ONE), 128).unwrap(),
            (U128::ONE, U128::ZERO)
        );
    }

    #[test]
    fn shr_wide_0_max_1() {
        assert_eq!(
            Uint::overflowing_shr_vartime_wide((U128::ZERO, U128::MAX), 1).unwrap(),
            (U128::ONE << 127, U128::MAX >> 1)
        );
    }

    #[test]
    fn shr_wide_max_max_256() {
        assert!(Uint::overflowing_shr_vartime_wide((U128::MAX, U128::MAX), 256).is_none());
    }

    #[test]
    #[should_panic]
    fn shr_limb_with_carry_shift_too_large() {
        let _ = U128::ONE.shr_limb_with_carry(Limb::BITS, Limb::ZERO);
    }

    #[test]
    fn shr_limb_with_carry() {
        let val = U128::from_be_hex("876543210FEDCBA90123456FEDCBA987");

        // Shift by zero
        let (res, carry) = val.shr_limb_with_carry(0, Limb::ZERO);
        assert_eq!(res, val);
        assert_eq!(carry, Limb::ZERO);

        // Shift by one
        let (res, carry) = val.shr_limb_with_carry(1, Limb::ZERO);
        assert_eq!(res, val.shr_vartime(1));
        assert_eq!(carry, val.limbs[0].shl(Limb::BITS - 1));

        // Shift by any
        let (res, carry) = val.shr_limb_with_carry(13, Limb::ZERO);
        assert_eq!(res, val.shr_vartime(13));
        assert_eq!(carry, val.limbs[0].shl(Limb::BITS - 13));

        // Shift by max
        let (res, carry) = val.shr_limb_with_carry(Limb::BITS - 1, Limb::ZERO);
        assert_eq!(res, val.shr_vartime(Limb::BITS - 1));
        assert_eq!(carry, val.limbs[0].shl(1));
    }

    #[test]
    fn shr_by_limbs() {
        let val = Uint::<2>::from_words([1, 99]);
        assert_eq!(val.bounded_shr_by_limbs(0, 3).as_words(), &[1, 99]);
        assert_eq!(val.bounded_shr_by_limbs(1, 3).as_words(), &[99, 0]);
        assert_eq!(val.bounded_shr_by_limbs(2, 3).as_words(), &[0, 0]);
        assert_eq!(val.unbounded_shr_by_limbs_vartime(0).as_words(), &[1, 99]);
        assert_eq!(val.unbounded_shr_by_limbs_vartime(1).as_words(), &[99, 0]);
        assert_eq!(val.unbounded_shr_by_limbs_vartime(2).as_words(), &[0, 0]);
    }

    #[test]
    fn overflowing_shr() {
        assert_eq!(
            U192::from_u8(16).overflowing_shr(2).into_option(),
            Some(U192::from_u8(4))
        );
        assert_eq!(U192::ONE.overflowing_shr(U192::BITS).into_option(), None);
        assert_eq!(
            ShrVartime::overflowing_shr_vartime(&U192::from_u8(16), 2),
            Some(U192::from_u8(4))
        );
        assert_eq!(
            ShrVartime::overflowing_shr_vartime(&U192::ONE, U192::BITS),
            None
        );
    }

    #[test]
    fn unbounded_shr() {
        assert_eq!(U192::from_u8(16).unbounded_shr(2), U192::from_u8(4));
        assert_eq!(U192::MAX.unbounded_shr(U192::BITS), U192::ZERO);
        assert_eq!(
            ShrVartime::unbounded_shr_vartime(&U192::from_u8(16), 2),
            U192::from_u8(4)
        );
        assert_eq!(
            ShrVartime::unbounded_shr_vartime(&U192::MAX, U192::BITS),
            U192::ZERO
        );
    }

    #[test]
    fn wrapping_shr() {
        assert_eq!(
            WrappingShr::wrapping_shr(&U192::from_u8(16), 2),
            U192::from_u8(4)
        );
        assert_eq!(WrappingShr::wrapping_shr(&U192::ONE, U192::BITS), U192::ONE);
        assert_eq!(
            ShrVartime::wrapping_shr_vartime(&U192::from_u8(16), 2),
            U192::from_u8(4)
        );
        assert_eq!(
            ShrVartime::wrapping_shr_vartime(&U192::ONE, U192::BITS),
            U192::ONE
        );
    }
}
