//! [`BoxedUint`] subtraction operations.

use crate::{
    BoxedUint, CheckedSub, Choice, CtOption, Limb, Sub, SubAssign, U64, U128, UintRef, Wrapping,
    WrappingSub,
};
use core::cmp;

impl BoxedUint {
    /// Computes `self - (rhs + borrow)`, returning the result along with the new borrow.
    #[deprecated(since = "0.7.0", note = "please use `borrowing_sub` instead")]
    #[must_use]
    pub fn sbb(&self, rhs: &Self, borrow: Limb) -> (Self, Limb) {
        self.borrowing_sub(rhs, borrow)
    }

    /// Computes `self - (rhs + borrow)`, returning the result along with the new borrow.
    ///
    /// The result is widened to the same width as the widest input.
    #[inline(always)]
    #[must_use]
    pub fn borrowing_sub(&self, rhs: impl AsRef<UintRef>, borrow: Limb) -> (Self, Limb) {
        let rhs = rhs.as_ref();
        let precision = cmp::max(self.bits_precision(), rhs.bits_precision());
        let mut result = Self::zero_with_precision(precision);
        let borrow = result.as_mut_uint_ref().fold_limbs(
            self.as_uint_ref(),
            rhs,
            borrow,
            Limb::borrowing_sub,
        );
        (result, borrow)
    }

    /// Computes `a - (b + borrow)` in-place, returning the new borrow.
    ///
    /// # Panics
    /// - if `rhs` has a larger precision than `self`.
    #[deprecated(since = "0.7.0", note = "please use `borrowing_sub_assign` instead")]
    pub fn sbb_assign(&mut self, rhs: impl AsRef<[Limb]>, borrow: Limb) -> Limb {
        self.borrowing_sub_assign(UintRef::new(rhs.as_ref()), borrow)
    }

    /// Computes `a - (b + borrow)` in-place, returning the new borrow.
    ///
    /// # Panics
    /// - if `rhs` has a larger precision than `self`.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn borrowing_sub_assign(&mut self, rhs: impl AsRef<UintRef>, borrow: Limb) -> Limb {
        let rhs = rhs.as_ref();
        assert!(rhs.nlimbs() <= self.nlimbs());

        self.as_mut_uint_ref()
            .fold_limbs_assign(rhs, borrow, Limb::borrowing_sub)
    }

    /// Computes `self - rhs`, returning a tuple of the difference along with a [`Choice`] which
    /// indicates whether an underflow occurred.
    ///
    /// If an underflow occurred, then the wrapped value is returned.
    #[must_use]
    pub fn underflowing_sub(&self, rhs: impl AsRef<UintRef>) -> (Self, Choice) {
        let rhs = rhs.as_ref();
        let nlimbs = cmp::min(self.nlimbs(), rhs.nlimbs());
        let (rhs, rhs_over) = rhs.split_at(nlimbs);
        let (ret, borrow) = self.borrowing_sub(rhs, Limb::ZERO);
        (ret, borrow.is_nonzero().or(rhs_over.is_nonzero()))
    }

    /// Subtracts `rhs` from self, returning a [`Choice`] which indicates whether an underflow occurred.
    ///
    /// If an underflow occurred, then the wrapped value is returned.
    pub fn underflowing_sub_assign(&mut self, rhs: impl AsRef<UintRef>) -> Choice {
        let rhs = rhs.as_ref();
        let nlimbs = cmp::min(self.nlimbs(), rhs.nlimbs());
        let (rhs, rhs_over) = rhs.split_at(nlimbs);
        let borrow = self.borrowing_sub_assign(rhs, Limb::ZERO);
        borrow.is_nonzero().or(rhs_over.is_nonzero())
    }

    /// Perform wrapping subtraction, discarding underflow.
    #[must_use]
    pub fn wrapping_sub(&self, rhs: impl AsRef<UintRef>) -> Self {
        let rhs = rhs.as_ref();
        let nlimbs = cmp::min(self.nlimbs(), rhs.nlimbs());
        self.borrowing_sub(rhs.leading(nlimbs), Limb::ZERO).0
    }

    /// Perform wrapping subtraction of `rhs` from `self`, discarding underflow.
    pub fn wrapping_sub_assign(&mut self, rhs: impl AsRef<UintRef>) {
        let rhs = rhs.as_ref();
        let nlimbs = cmp::min(self.nlimbs(), rhs.nlimbs());
        self.borrowing_sub_assign(rhs.leading(nlimbs), Limb::ZERO);
    }
}

impl<Rhs: AsRef<UintRef>> CheckedSub<Rhs> for BoxedUint {
    fn checked_sub(&self, rhs: &Rhs) -> CtOption<Self> {
        let (result, underflow) = self.underflowing_sub(rhs);
        CtOption::new(result, underflow.not())
    }
}

impl<Rhs: AsRef<UintRef>> Sub<Rhs> for BoxedUint {
    type Output = Self;

    fn sub(self, rhs: Rhs) -> Self {
        Sub::sub(&self, rhs)
    }
}

impl<Rhs: AsRef<UintRef>> Sub<Rhs> for &BoxedUint {
    type Output = BoxedUint;

    fn sub(self, rhs: Rhs) -> BoxedUint {
        let (res, underflow) = self.underflowing_sub(rhs);
        assert!(
            underflow.not().to_bool(),
            "attempted to subtract with underflow"
        );
        res
    }
}

impl<Rhs: AsRef<UintRef>> SubAssign<Rhs> for BoxedUint {
    fn sub_assign(&mut self, rhs: Rhs) {
        let underflow = self.underflowing_sub_assign(rhs);
        assert!(
            underflow.not().to_bool(),
            "attempted to subtract with underflow"
        );
    }
}

impl<Rhs: AsRef<UintRef>> SubAssign<Rhs> for Wrapping<BoxedUint> {
    fn sub_assign(&mut self, other: Rhs) {
        self.0.wrapping_sub_assign(other);
    }
}

impl WrappingSub for BoxedUint {
    fn wrapping_sub(&self, v: &Self) -> Self {
        self.wrapping_sub(v)
    }
}

macro_rules! impl_sub_primitive {
    ($($primitive:ty),+) => {
        $(
            impl Sub<$primitive> for BoxedUint {
                type Output = BoxedUint;

                #[inline]
                fn sub(self, rhs: $primitive) -> BoxedUint {
                     self - U64::from(rhs)
                }
            }

            impl Sub<$primitive> for &BoxedUint {
                type Output = BoxedUint;

                #[inline]
                fn sub(self, rhs: $primitive) -> BoxedUint {
                     self - U64::from(rhs)
                }
            }

            impl SubAssign<$primitive> for BoxedUint {
                fn sub_assign(&mut self, rhs: $primitive) {
                    *self -= U64::from(rhs);
                }
            }
        )+
    };
}

impl_sub_primitive!(u8, u16, u32, u64);

impl Sub<u128> for BoxedUint {
    type Output = BoxedUint;

    #[inline]
    fn sub(self, rhs: u128) -> BoxedUint {
        self - U128::from(rhs)
    }
}

impl Sub<u128> for &BoxedUint {
    type Output = BoxedUint;

    #[inline]
    fn sub(self, rhs: u128) -> BoxedUint {
        self - U128::from(rhs)
    }
}

impl SubAssign<u128> for BoxedUint {
    fn sub_assign(&mut self, rhs: u128) {
        *self -= U128::from(rhs);
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::{BoxedUint, CheckedSub, Limb, UintRef, Wrapping};
    use crate::Resize;

    #[test]
    fn borrowing_sub_no_borrow() {
        let (res, carry) = BoxedUint::one().borrowing_sub(BoxedUint::one(), Limb::ZERO);
        assert_eq!(res, BoxedUint::zero());
        assert_eq!(carry, Limb::ZERO);

        let (res, carry) = BoxedUint::one().borrowing_sub(BoxedUint::zero(), Limb::ZERO);
        assert_eq!(res, BoxedUint::one());
        assert_eq!(carry, Limb::ZERO);
    }

    #[test]
    fn borrowing_sub_with_borrow() {
        let (res, borrow) = BoxedUint::zero().borrowing_sub(BoxedUint::one(), Limb::ZERO);
        assert_eq!(res, BoxedUint::max(Limb::BITS));
        assert_eq!(borrow, Limb::MAX);
    }

    #[test]
    fn sub_with_u32_rhs() {
        let a = BoxedUint::from(0x100000000u64);
        let b = a - u32::MAX;
        assert_eq!(b, BoxedUint::one());
    }

    #[test]
    fn checked_sub_ok() {
        let result = BoxedUint::one().checked_sub(&BoxedUint::one());
        assert_eq!(result.unwrap(), BoxedUint::zero());
    }

    #[test]
    fn checked_sub_overflow() {
        let result = BoxedUint::zero().checked_sub(&BoxedUint::one());
        assert!(!bool::from(result.is_some()));
    }

    #[test]
    fn sub_assign() {
        let mut h = BoxedUint::one().resize(1024);
        h -= BoxedUint::one();
    }

    #[test]
    fn wrapping_sub() {
        let ret = BoxedUint::one().wrapping_sub(Limb::ONE);
        assert!(ret.is_zero_vartime());

        let mut ret = Wrapping(BoxedUint::zero_with_precision(2 * Limb::BITS));
        ret -= Wrapping(Limb::ONE);
        assert_eq!(ret.0, BoxedUint::max(2 * Limb::BITS));
    }

    #[test]
    fn sub_uintref() {
        let a = BoxedUint::from(1234567890u64);
        let b = UintRef::new(&[Limb(456), Limb(0)]);
        assert_eq!(
            a.borrowing_sub(b, Limb::ZERO).0,
            BoxedUint::from(1234567434u64)
        );
    }
}
