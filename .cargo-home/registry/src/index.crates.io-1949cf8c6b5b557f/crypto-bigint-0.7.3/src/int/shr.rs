//! [`Int`] bitwise right shift operations.

use crate::{Choice, CtOption, Int, ShrVartime, Uint, WrappingShr, primitives::u32_rem};
use core::ops::{Shr, ShrAssign};

impl<const LIMBS: usize> Int<LIMBS> {
    /// Computes `self >> shift`.
    ///
    /// Note, this is _signed_ shift right, i.e., the value shifted in on the left is equal to
    /// the most significant bit.
    ///
    /// # Panics
    /// - if `shift >= Self::BITS`.
    #[inline(always)]
    #[must_use]
    pub const fn shr(&self, shift: u32) -> Self {
        let sign_bits = Self::select(&Self::ZERO, &Self::MINUS_ONE, self.is_negative());
        let res = Uint::shr(&self.0, shift);
        Self::from_bits(res.bitor(&sign_bits.0.unbounded_shl(Self::BITS - shift)))
    }

    /// Computes `self >> shift` in variable time.
    ///
    /// Note, this is _signed_ shift right, i.e., the value shifted in on the left is equal to
    /// the most significant bit.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    ///
    /// # Panics
    /// - if `shift >= Self::BITS`.
    #[inline(always)]
    #[must_use]
    #[track_caller]
    pub const fn shr_vartime(&self, shift: u32) -> Self {
        self.overflowing_shr_vartime(shift)
            .expect("`shift` within the bit size of the integer")
    }

    /// Computes `self >> shift`.
    ///
    /// Note, this is _signed_ shift right, i.e., the value shifted in on the left is equal to
    /// the most significant bit.
    ///
    /// Returns `None` if `shift >= Self::BITS`.
    #[inline(always)]
    #[must_use]
    #[allow(clippy::integer_division_remainder_used, reason = "needs triage")]
    pub const fn overflowing_shr(&self, shift: u32) -> CtOption<Self> {
        let in_range = Choice::from_u32_lt(shift, Self::BITS);
        let adj_shift = in_range.select_u32(0, shift);
        CtOption::new(self.shr(adj_shift), in_range)
    }

    /// Computes `self >> shift`.
    ///
    /// NOTE: this is _signed_ shift right, i.e., the value shifted in on the left is equal to
    /// the most significant bit.
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

    /// Computes `self >> shift` in a panic-free manner.
    ///
    /// If the shift exceeds the precision, returns
    /// - `0` when `self` is non-negative, and
    /// - `-1` when `self` is negative.
    #[inline(always)]
    #[must_use]
    pub const fn unbounded_shr(&self, shift: u32) -> Self {
        let default = Self::select(&Self::ZERO, &Self::MINUS_ONE, self.is_negative());
        ctutils::unwrap_or!(self.overflowing_shr(shift), default, Self::select)
    }

    /// Computes `self >> shift` in variable-time in a panic-free manner.
    ///
    /// If the shift exceeds the precision, returns
    /// - `0` when `self` is non-negative, and
    /// - `-1` when `self` is negative.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[must_use]
    pub const fn unbounded_shr_vartime(&self, shift: u32) -> Self {
        let sign_bits = Self::select(&Self::ZERO, &Self::MINUS_ONE, self.is_negative());
        if let Some(res) = self.0.overflowing_shr_vartime(shift) {
            Self::from_bits(res.bitor(&sign_bits.0.unbounded_shl(Self::BITS - shift)))
        } else {
            sign_bits
        }
    }

    /// Computes `self >> shift` in a panic-free manner.
    ///
    /// If the shift exceeds the precision, returns
    /// - `0` when `self` is non-negative, and
    /// - `-1` when `self` is negative.
    #[inline]
    #[must_use]
    pub const fn wrapping_shr(&self, shift: u32) -> Self {
        self.shr(u32_rem(shift, Self::BITS))
    }

    /// Computes `self >> shift` in variable-time in a panic-free manner.
    ///
    /// If the shift exceeds the precision, returns
    /// - `0` when `self` is non-negative, and
    /// - `-1` when `self` is negative.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline]
    #[must_use]
    #[allow(clippy::integer_division_remainder_used, reason = "needs triage")]
    pub const fn wrapping_shr_vartime(&self, shift: u32) -> Self {
        self.unbounded_shr_vartime(shift % Self::BITS)
    }
}

macro_rules! impl_shr {
    ($($shift:ty),+) => {
        $(
            impl<const LIMBS: usize> Shr<$shift> for Int<LIMBS> {
                type Output = Int<LIMBS>;

                #[inline]
                fn shr(self, shift: $shift) -> Int<LIMBS> {
                    <&Self>::shr(&self, shift)
                }
            }

            impl<const LIMBS: usize> Shr<$shift> for &Int<LIMBS> {
                type Output = Int<LIMBS>;

                #[inline]
                fn shr(self, shift: $shift) -> Int<LIMBS> {
                    Int::<LIMBS>::shr(self, u32::try_from(shift).expect("invalid shift"))
                }
            }

            impl<const LIMBS: usize> ShrAssign<$shift> for Int<LIMBS> {
                fn shr_assign(&mut self, shift: $shift) {
                    *self = self.shr(shift)
                }
            }
        )+
    };
}

impl_shr!(i32, u32, usize);

impl<const LIMBS: usize> WrappingShr for Int<LIMBS> {
    fn wrapping_shr(&self, shift: u32) -> Int<LIMBS> {
        self.wrapping_shr(shift)
    }
}

impl<const LIMBS: usize> ShrVartime for Int<LIMBS> {
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
    use core::ops::Div;

    use crate::{I256, ShrVartime};

    const N: I256 =
        I256::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

    const N_2: I256 =
        I256::from_be_hex("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0");

    #[test]
    fn shr0() {
        assert_eq!(I256::MAX >> 0, I256::MAX);
        assert_eq!(I256::MIN >> 0, I256::MIN);
    }

    #[test]
    fn shr1() {
        assert_eq!(N >> 1, N_2);
        assert_eq!(ShrVartime::overflowing_shr_vartime(&N, 1), Some(N_2));
        assert_eq!(ShrVartime::wrapping_shr_vartime(&N, 1), N_2);
    }

    #[test]
    fn shr5() {
        assert_eq!(
            I256::MAX >> 5,
            I256::MAX.div(I256::from(32).to_nz().unwrap()).unwrap()
        );
        assert_eq!(
            I256::MIN >> 5,
            I256::MIN.div(I256::from(32).to_nz().unwrap()).unwrap()
        );
    }

    #[test]
    fn shr7_vartime() {
        assert_eq!(
            I256::MAX.shr_vartime(7),
            I256::MAX.div(I256::from(128).to_nz().unwrap()).unwrap()
        );
        assert_eq!(
            I256::MIN.shr_vartime(7),
            I256::MIN.div(I256::from(128).to_nz().unwrap()).unwrap()
        );
    }

    #[test]
    fn shr256_const() {
        assert!(N.overflowing_shr(256).is_none().to_bool_vartime());
        assert!(ShrVartime::overflowing_shr_vartime(&N, 256).is_none());
    }

    #[test]
    #[should_panic(expected = "`shift` exceeds upper bound")]
    fn shr_bounds_panic() {
        let _ = N >> 256;
    }

    #[test]
    fn unbounded_shr_vartime_zero_shift() {
        assert_eq!(I256::MAX.unbounded_shr_vartime(0), I256::MAX);
        assert_eq!(I256::MIN.unbounded_shr_vartime(0), I256::MIN);
        assert_eq!(I256::ONE.unbounded_shr_vartime(0), I256::ONE);
        assert_eq!(I256::MINUS_ONE.unbounded_shr_vartime(0), I256::MINUS_ONE);
        assert_eq!(I256::ZERO.unbounded_shr_vartime(0), I256::ZERO);
    }

    #[test]
    fn overflowing_shr_vartime_zero_shift() {
        let values = [I256::MAX, I256::MIN, I256::ONE, I256::MINUS_ONE, I256::ZERO];
        for &val in &values {
            assert_eq!(val.overflowing_shr_vartime(0), Some(val));
        }
    }

    #[test]
    fn shr_vartime_zero_shift() {
        let values = [I256::MAX, I256::MIN, I256::ONE, I256::MINUS_ONE, I256::ZERO];
        for &val in &values {
            assert_eq!(val.shr_vartime(0), val);
        }
    }

    #[test]
    fn wrapping_shr_vartime_multiple_of_bits_is_identity() {
        let values = [I256::MAX, I256::MIN, I256::ONE, I256::MINUS_ONE, I256::ZERO];
        for &val in &values {
            // Shift by 0 and multiples of the bit size should be identity.
            for i in 0..4 {
                assert_eq!(val.wrapping_shr_vartime(i * I256::BITS), val);
            }
        }
    }

    #[test]
    fn unbounded_shr() {
        assert_eq!(I256::MAX.unbounded_shr(257), I256::ZERO);
        assert_eq!(I256::MIN.unbounded_shr(257), I256::MINUS_ONE);
        assert_eq!(
            ShrVartime::unbounded_shr_vartime(&I256::MAX, 257),
            I256::ZERO
        );
        assert_eq!(
            ShrVartime::unbounded_shr_vartime(&I256::MIN, 257),
            I256::MINUS_ONE
        );
    }

    #[test]
    fn wrapping_shr() {
        assert_eq!(I256::MAX.wrapping_shr(257), I256::MAX.shr(1));
        assert_eq!(I256::MIN.wrapping_shr(257), I256::MIN.shr(1));
        assert_eq!(
            ShrVartime::wrapping_shr_vartime(&I256::MAX, 257),
            I256::MAX.shr(1)
        );
        assert_eq!(
            ShrVartime::wrapping_shr_vartime(&I256::MIN, 257),
            I256::MIN.shr(1)
        );
    }
}
