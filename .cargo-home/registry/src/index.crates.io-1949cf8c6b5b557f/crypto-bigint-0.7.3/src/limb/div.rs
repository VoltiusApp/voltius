//! Limb division

use core::slice;

use crate::{
    CheckedDiv, CtOption, Div, DivAssign, DivRemLimb, Limb, NonZero, Reciprocal, Rem, RemAssign,
    RemLimb, UintRef,
};

impl Limb {
    /// Computes `self / rhs`, returning the quotient and remainder.
    #[inline(always)]
    #[must_use]
    pub const fn div_rem(self, rhs: NonZero<Self>) -> (Limb, Limb) {
        self.div_rem_with_reciprocal(&Reciprocal::new(rhs))
    }

    /// Computes `self / rhs` where `recip` is a [`Reciprocal`] created from a non-zero Limb `rhs`.
    /// Returns the quotient and remainder.
    #[inline(always)]
    #[must_use]
    pub const fn div_rem_with_reciprocal(self, recip: &Reciprocal) -> (Limb, Limb) {
        let mut quo = self;
        let rem = UintRef::new_mut(slice::from_mut(&mut quo)).div_rem_limb_with_reciprocal(recip);
        (quo, rem)
    }

    /// Computes the checked division `self / rhs`, returning the quotient
    /// if the divisor is non-zero, and `CtOption::none()` otherwise.
    #[must_use]
    pub const fn checked_div(self, rhs: Self) -> CtOption<Limb> {
        let is_nz = rhs.is_nonzero();
        let quo = self.div_rem(NonZero(Self::select(Limb::ONE, rhs, is_nz))).0;
        CtOption::new(quo, is_nz)
    }

    /// Computes the checked division `self / rhs`, returning the remainder
    /// if the divisor is non-zero, and `CtOption::none()` otherwise.
    #[must_use]
    pub const fn checked_rem(self, rhs: Self) -> CtOption<Limb> {
        let is_nz = rhs.is_nonzero();
        let rem = self.div_rem(NonZero(Self::select(Limb::ONE, rhs, is_nz))).1;
        CtOption::new(rem, is_nz)
    }
}

impl CheckedDiv for Limb {
    #[inline]
    fn checked_div(&self, rhs: &Self) -> CtOption<Self> {
        (*self).checked_div(*rhs)
    }
}

impl DivRemLimb for Limb {
    #[inline]
    fn div_rem_limb(&self, rhs: NonZero<Limb>) -> (Self, Limb) {
        self.div_rem(rhs)
    }

    #[inline]
    fn div_rem_limb_with_reciprocal(&self, rhs: &Reciprocal) -> (Self, Limb) {
        self.div_rem_with_reciprocal(rhs)
    }
}

impl Div<Limb> for Limb {
    type Output = Limb;

    #[inline]
    fn div(self, rhs: Limb) -> Self {
        self.checked_div(rhs).expect("division by zero")
    }
}

impl Div<&Limb> for Limb {
    type Output = Limb;

    #[inline]
    fn div(self, rhs: &Limb) -> Self {
        self / (*rhs)
    }
}

impl Div<Limb> for &Limb {
    type Output = Limb;

    #[inline]
    fn div(self, rhs: Limb) -> Limb {
        (*self) / rhs
    }
}

impl Div<&Limb> for &Limb {
    type Output = Limb;

    #[inline]
    fn div(self, rhs: &Limb) -> Limb {
        (*self) / (*rhs)
    }
}

impl Div<NonZero<Limb>> for Limb {
    type Output = Limb;

    #[inline]
    fn div(self, rhs: NonZero<Limb>) -> Self {
        self.div_rem(rhs).0
    }
}

impl Div<&NonZero<Limb>> for Limb {
    type Output = Limb;

    #[inline]
    fn div(self, rhs: &NonZero<Limb>) -> Self {
        self / (*rhs)
    }
}

impl Div<NonZero<Limb>> for &Limb {
    type Output = Limb;

    #[inline]
    fn div(self, rhs: NonZero<Limb>) -> Limb {
        (*self) / rhs
    }
}

impl Div<&NonZero<Limb>> for &Limb {
    type Output = Limb;

    #[inline]
    fn div(self, rhs: &NonZero<Limb>) -> Limb {
        (*self) / (*rhs)
    }
}

impl RemLimb for Limb {
    #[inline]
    fn rem_limb(&self, rhs: NonZero<Limb>) -> Limb {
        self.div_rem(rhs).1
    }

    fn rem_limb_with_reciprocal(&self, rhs: &Reciprocal) -> Limb {
        self.div_rem_with_reciprocal(rhs).1
    }
}

impl Rem<Limb> for Limb {
    type Output = Limb;

    #[inline]
    fn rem(self, rhs: Limb) -> Self {
        self.checked_rem(rhs).expect("division by zero")
    }
}

impl Rem<&Limb> for Limb {
    type Output = Limb;

    #[inline]
    fn rem(self, rhs: &Limb) -> Self {
        self % (*rhs)
    }
}

impl Rem<Limb> for &Limb {
    type Output = Limb;

    #[inline]
    fn rem(self, rhs: Limb) -> Limb {
        (*self) % rhs
    }
}

impl Rem<&Limb> for &Limb {
    type Output = Limb;

    #[inline]
    fn rem(self, rhs: &Limb) -> Limb {
        (*self) % (*rhs)
    }
}

impl Rem<NonZero<Limb>> for Limb {
    type Output = Limb;

    #[inline]
    fn rem(self, rhs: NonZero<Limb>) -> Self {
        self.div_rem(rhs).1
    }
}

impl Rem<&NonZero<Limb>> for Limb {
    type Output = Limb;

    #[inline]
    fn rem(self, rhs: &NonZero<Limb>) -> Self {
        self % (*rhs)
    }
}

impl Rem<NonZero<Limb>> for &Limb {
    type Output = Limb;

    #[inline]
    fn rem(self, rhs: NonZero<Limb>) -> Limb {
        (*self) % rhs
    }
}

impl Rem<&NonZero<Limb>> for &Limb {
    type Output = Limb;

    #[inline]
    fn rem(self, rhs: &NonZero<Limb>) -> Limb {
        (*self) % (*rhs)
    }
}

impl DivAssign<Limb> for Limb {
    #[inline]
    fn div_assign(&mut self, rhs: Limb) {
        *self = (*self) / rhs;
    }
}

impl DivAssign<&Limb> for Limb {
    #[inline]
    fn div_assign(&mut self, rhs: &Limb) {
        *self = (*self) / (*rhs);
    }
}

impl DivAssign<NonZero<Limb>> for Limb {
    #[inline]
    fn div_assign(&mut self, rhs: NonZero<Limb>) {
        *self = (*self) / rhs;
    }
}

impl DivAssign<&NonZero<Limb>> for Limb {
    #[inline]
    fn div_assign(&mut self, rhs: &NonZero<Limb>) {
        *self = (*self) / (*rhs);
    }
}

impl RemAssign<Limb> for Limb {
    #[inline]
    fn rem_assign(&mut self, rhs: Limb) {
        *self = (*self) % rhs;
    }
}

impl RemAssign<&Limb> for Limb {
    #[inline]
    fn rem_assign(&mut self, rhs: &Limb) {
        *self = (*self) % (*rhs);
    }
}

impl RemAssign<NonZero<Limb>> for Limb {
    #[inline]
    fn rem_assign(&mut self, rhs: NonZero<Limb>) {
        *self = (*self) % rhs;
    }
}

impl RemAssign<&NonZero<Limb>> for Limb {
    #[inline]
    fn rem_assign(&mut self, rhs: &NonZero<Limb>) {
        *self = (*self) % (*rhs);
    }
}

#[cfg(test)]
#[allow(clippy::op_ref)]
mod tests {
    use super::{CheckedDiv, Limb};
    use crate::NonZero;

    #[test]
    fn div_rem_ok() {
        let n = Limb::from_u32(0xffff_ffff);
        let d = NonZero::new(Limb::from_u32(0xfffe)).expect("ensured non-zero");
        assert_eq!(n.div_rem(d), (Limb::from_u32(0x10002), Limb::from_u32(0x3)));
    }

    #[test]
    fn checked_div() {
        assert_eq!(
            CheckedDiv::checked_div(&Limb::ONE, &Limb::ONE).into_option(),
            Some(Limb::ONE)
        );
        assert_eq!(
            CheckedDiv::checked_div(&Limb::MAX, &Limb::ZERO).into_option(),
            None
        );
    }

    #[test]
    fn checked_rem() {
        assert_eq!(
            Limb::ONE.checked_rem(Limb::ONE).into_option(),
            Some(Limb::ZERO)
        );
        assert_eq!(Limb::MAX.checked_rem(Limb::ZERO).into_option(), None);
    }

    #[test]
    fn div_trait() {
        let a = Limb::from(10u64);
        let b = NonZero::new(Limb::from(2u64)).unwrap();
        let c = Limb::from(5u64);

        assert_eq!(a / b, c);
        assert_eq!(a / &b, c);
        assert_eq!(&a / b, c);
        assert_eq!(&a / &b, c);
        assert_eq!(a / &b.0, c);
        assert_eq!(&a / b.0, c);
    }

    #[test]
    fn div_assign_trait() {
        let a = Limb::from(10u64);
        let b = NonZero::new(Limb::from(2u64)).unwrap();
        let c = Limb::from(5u64);

        let mut res = a;
        res /= b;
        assert_eq!(res, c);
        let mut res = a;
        res /= &b;
        assert_eq!(res, c);
        let mut res = a;
        res /= b.0;
        assert_eq!(res, c);
        let mut res = a;
        res /= &b.0;
        assert_eq!(res, c);
    }

    #[should_panic]
    #[test]
    fn div_zero() {
        let _ = Limb::ONE / Limb::ZERO;
    }

    #[should_panic]
    #[test]
    fn div_ref_zero() {
        let _ = &Limb::ONE / Limb::ZERO;
    }

    #[test]
    fn rem_trait() {
        let a = Limb::from(10u64);
        let b = NonZero::new(Limb::from(3u64)).unwrap();
        let c = Limb::from(1u64);

        assert_eq!(a % b, c);
        assert_eq!(a % &b, c);
        assert_eq!(&a % b, c);
        assert_eq!(&a % &b, c);
        assert_eq!(a % &b.0, c);
        assert_eq!(&a % b.0, c);
    }

    #[test]
    fn rem_assign_trait() {
        let a = Limb::from(10u64);
        let b = NonZero::new(Limb::from(3u64)).unwrap();
        let c = Limb::from(1u64);

        let mut res = a;
        res %= b;
        assert_eq!(res, c);
        let mut res = a;
        res %= &b;
        assert_eq!(res, c);
        let mut res = a;
        res %= b.0;
        assert_eq!(res, c);
        let mut res = a;
        res %= &b.0;
        assert_eq!(res, c);
    }

    #[should_panic]
    #[test]
    fn rem_zero() {
        let _ = Limb::ONE % Limb::ZERO;
    }

    #[should_panic]
    #[test]
    fn rem_ref_zero() {
        let _ = &Limb::ONE % Limb::ZERO;
    }
}
