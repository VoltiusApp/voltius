//! [`BoxedUint`] division operations.

use crate::{
    BoxedUint, CheckedDiv, CtAssign, CtOption, Div, DivAssign, DivRemLimb, DivVartime, Integer,
    Limb, NonZero, Reciprocal, Rem, RemAssign, RemLimb, RemMixed, ToUnsigned, UintRef, Unsigned,
    Wrapping,
};

impl BoxedUint {
    /// Computes `self / rhs` using a pre-made reciprocal,
    /// returns the quotient (q) and remainder (r).
    #[must_use]
    pub fn div_rem_limb_with_reciprocal(&self, reciprocal: &Reciprocal) -> (Self, Limb) {
        let mut quo = self.clone();
        let rem = quo
            .as_mut_uint_ref()
            .div_rem_limb_with_reciprocal(reciprocal);
        (quo, rem)
    }

    /// Computes `self / rhs`, returns the quotient (q) and remainder (r).
    #[must_use]
    pub fn div_rem_limb(&self, rhs: NonZero<Limb>) -> (Self, Limb) {
        let mut quo = self.clone();
        let rem = quo.as_mut_uint_ref().div_rem_limb(rhs);
        (quo, rem)
    }

    /// Computes `self % rhs` using a pre-made reciprocal.
    #[inline(always)]
    #[must_use]
    pub fn rem_limb_with_reciprocal(&self, reciprocal: &Reciprocal) -> Limb {
        self.as_uint_ref()
            .rem_limb_with_reciprocal(reciprocal, Limb::ZERO)
    }

    /// Computes `self % rhs`.
    #[inline(always)]
    #[must_use]
    pub fn rem_limb(&self, rhs: NonZero<Limb>) -> Limb {
        self.as_uint_ref().rem_limb(rhs)
    }

    /// Computes self / rhs, returns the quotient, remainder.
    #[must_use]
    pub fn div_rem<Rhs: ToUnsigned + ?Sized>(&self, rhs: &NonZero<Rhs>) -> (Self, Rhs::Unsigned) {
        let mut quo = self.clone();
        let rem = quo.div_rem_assign(rhs.to_unsigned());
        (quo, rem)
    }

    /// Computes self % rhs, returns the remainder.
    #[must_use]
    pub fn rem<Rhs: ToUnsigned + ?Sized>(&self, rhs: &NonZero<Rhs>) -> Rhs::Unsigned {
        self.div_rem(rhs).1
    }

    /// Computes self / rhs, assigning the quotient to `self` and returning the remainder.
    #[must_use]
    pub(crate) fn div_rem_assign<Rhs: AsMut<UintRef>>(&mut self, rhs: NonZero<Rhs>) -> Rhs {
        let mut rem = rhs.get();
        self.as_mut_uint_ref().div_rem(rem.as_mut());
        rem
    }

    /// Computes self / rhs, returns the quotient and remainder.
    ///
    /// Variable-time with respect to `rhs`
    #[must_use]
    pub fn div_rem_vartime<Rhs: ToUnsigned + ?Sized>(
        &self,
        rhs: &NonZero<Rhs>,
    ) -> (Self, Rhs::Unsigned) {
        let mut quo = self.clone();
        let rem = quo.div_rem_assign_vartime(rhs.to_unsigned());
        (quo, rem)
    }

    /// Computes self % rhs, returns the remainder.
    ///
    /// Variable-time with respect to `rhs`.
    #[must_use]
    pub fn rem_vartime<Rhs: ToUnsigned + ?Sized>(&self, rhs: &NonZero<Rhs>) -> Rhs::Unsigned {
        let xc = self.limbs.len();
        let yc = rhs.0.as_ref().bits_vartime().div_ceil(Limb::BITS) as usize;

        match yc {
            0 => unreachable!("zero divisor"),
            1 => {
                // Perform limb division
                let rem_limb = self.as_uint_ref().rem_limb(rhs.lower_limb());
                let mut rem = rhs.as_ref().to_unsigned_zero();
                rem.as_mut_limbs()[0] = rem_limb;
                rem
            }
            _ if yc > xc => {
                let mut rem = rhs.as_ref().to_unsigned_zero();
                rem.as_mut_uint_ref()
                    .leading_mut(xc)
                    .copy_from_slice(&self.limbs);
                rem
            }
            _ => {
                let mut quo = self.clone();
                let mut rem = rhs.as_ref().to_unsigned();
                quo.as_mut_uint_ref()
                    .leading_mut(xc)
                    .div_rem_large_vartime(rem.as_mut_uint_ref().leading_mut(yc));
                rem
            }
        }
    }

    /// Computes self / rhs, returns the quotient and remainder.
    ///
    /// Variable-time with respect to `rhs`
    #[must_use]
    pub(crate) fn div_rem_assign_vartime<Rhs: AsMut<UintRef>>(&mut self, rhs: NonZero<Rhs>) -> Rhs {
        let mut rem = rhs.get();
        self.as_mut_uint_ref().div_rem_vartime(rem.as_mut());
        rem
    }

    /// Wrapped division is just normal division i.e. `self` / `rhs`
    /// There’s no way wrapping could ever happen.
    ///
    /// This function exists, so that all operations are accounted for in the wrapping operations.
    ///
    /// # Panics
    /// - if `rhs == 0`.
    #[must_use]
    pub fn wrapping_div<Rhs: ToUnsigned + ?Sized>(&self, rhs: &NonZero<Rhs>) -> Self {
        self.div_rem(rhs).0
    }

    /// Wrapped division is just normal division i.e. `self` / `rhs`
    ///
    /// There’s no way wrapping could ever happen.
    /// This function exists, so that all operations are accounted for in the wrapping operations
    #[must_use]
    pub fn wrapping_div_vartime<Rhs: ToUnsigned + ?Sized>(&self, rhs: &NonZero<Rhs>) -> Self {
        self.div_rem_vartime(rhs).0
    }

    /// Perform checked division, returning a [`CtOption`] which `is_some`
    /// only if the `rhs != 0`.
    #[must_use]
    pub fn checked_div(&self, rhs: impl AsRef<UintRef>) -> CtOption<Self> {
        let mut quo = self.clone();
        let rhs = rhs.as_ref();
        let is_nz = rhs.is_nonzero();
        let mut rem = Self::one_with_precision(rhs.bits_precision());
        rem.as_mut_uint_ref().ct_assign(rhs, is_nz);
        quo.as_mut_uint_ref().div_rem(rem.as_mut_uint_ref());
        CtOption::new(quo, is_nz)
    }
}

impl<Rhs: AsRef<UintRef>> CheckedDiv<Rhs> for BoxedUint {
    fn checked_div(&self, rhs: &Rhs) -> CtOption<Self> {
        self.checked_div(rhs)
    }
}

impl<Rhs: ToUnsigned + ?Sized> Div<&NonZero<Rhs>> for &BoxedUint {
    type Output = BoxedUint;

    fn div(self, rhs: &NonZero<Rhs>) -> Self::Output {
        self.wrapping_div(rhs)
    }
}

impl<Rhs: ToUnsigned + ?Sized> Div<&NonZero<Rhs>> for BoxedUint {
    type Output = BoxedUint;

    fn div(mut self, rhs: &NonZero<Rhs>) -> Self::Output {
        let _rem = self.div_rem_assign(rhs.to_unsigned());
        self
    }
}

impl<Rhs: AsMut<UintRef>> Div<NonZero<Rhs>> for &BoxedUint {
    type Output = BoxedUint;

    fn div(self, rhs: NonZero<Rhs>) -> Self::Output {
        let mut quo = self.clone();
        let _rem = quo.div_rem_assign(rhs);
        quo
    }
}

impl<Rhs: AsMut<UintRef>> Div<NonZero<Rhs>> for BoxedUint {
    type Output = BoxedUint;

    fn div(mut self, rhs: NonZero<Rhs>) -> Self::Output {
        let _rem = self.div_rem_assign(rhs);
        self
    }
}

impl<Rhs: ToUnsigned + ?Sized> DivAssign<&NonZero<Rhs>> for BoxedUint {
    fn div_assign(&mut self, rhs: &NonZero<Rhs>) {
        let _rem = self.div_rem_assign(rhs.to_unsigned());
    }
}

impl<Rhs: AsMut<UintRef>> DivAssign<NonZero<Rhs>> for BoxedUint {
    fn div_assign(&mut self, rhs: NonZero<Rhs>) {
        let _rem = self.div_rem_assign(rhs);
    }
}

impl DivVartime for BoxedUint {
    fn div_vartime(&self, rhs: &NonZero<BoxedUint>) -> Self {
        self.wrapping_div_vartime(rhs)
    }
}

impl<Rhs: AsMut<UintRef>> Div<NonZero<Rhs>> for Wrapping<BoxedUint> {
    type Output = Wrapping<BoxedUint>;

    fn div(self, rhs: NonZero<Rhs>) -> Self::Output {
        Wrapping(self.0 / rhs)
    }
}

impl<Rhs: AsMut<UintRef>> Div<NonZero<Rhs>> for &Wrapping<BoxedUint> {
    type Output = Wrapping<BoxedUint>;

    fn div(self, rhs: NonZero<Rhs>) -> Self::Output {
        Wrapping(&self.0 / rhs)
    }
}

impl<Rhs: ToUnsigned + ?Sized> Div<&NonZero<Rhs>> for &Wrapping<BoxedUint> {
    type Output = Wrapping<BoxedUint>;

    fn div(self, rhs: &NonZero<Rhs>) -> Self::Output {
        Wrapping(&self.0 / rhs)
    }
}

impl<Rhs: ToUnsigned + ?Sized> Div<&NonZero<Rhs>> for Wrapping<BoxedUint> {
    type Output = Wrapping<BoxedUint>;

    fn div(self, rhs: &NonZero<Rhs>) -> Self::Output {
        Wrapping(self.0 / rhs)
    }
}

impl<Rhs: ToUnsigned + ?Sized> DivAssign<&NonZero<Rhs>> for Wrapping<BoxedUint> {
    fn div_assign(&mut self, rhs: &NonZero<Rhs>) {
        self.0 /= rhs;
    }
}

impl<Rhs: AsMut<UintRef>> DivAssign<NonZero<Rhs>> for Wrapping<BoxedUint> {
    fn div_assign(&mut self, rhs: NonZero<Rhs>) {
        self.0 /= rhs;
    }
}

impl<Rhs: ToUnsigned + ?Sized> Rem<&NonZero<Rhs>> for &BoxedUint {
    type Output = Rhs::Unsigned;

    #[inline]
    fn rem(self, rhs: &NonZero<Rhs>) -> Self::Output {
        self.rem(rhs)
    }
}

impl<Rhs: ToUnsigned + ?Sized> Rem<&NonZero<Rhs>> for BoxedUint {
    type Output = Rhs::Unsigned;

    #[inline]
    fn rem(self, rhs: &NonZero<Rhs>) -> Self::Output {
        Self::rem(&self, rhs)
    }
}

impl<Rhs: AsMut<UintRef>> Rem<NonZero<Rhs>> for &BoxedUint {
    type Output = Rhs;

    #[inline]
    fn rem(self, rhs: NonZero<Rhs>) -> Self::Output {
        self.clone().div_rem_assign(rhs)
    }
}

impl<Rhs: AsMut<UintRef>> Rem<NonZero<Rhs>> for BoxedUint {
    type Output = Rhs;

    #[inline]
    fn rem(mut self, rhs: NonZero<Rhs>) -> Self::Output {
        self.div_rem_assign(rhs)
    }
}

impl<Rhs: AsRef<UintRef> + ?Sized> RemAssign<&NonZero<Rhs>> for BoxedUint {
    fn rem_assign(&mut self, rhs: &NonZero<Rhs>) {
        *self = self.div_rem_assign(rhs.to_boxed());
    }
}

impl<Rhs: AsRef<UintRef>> RemAssign<NonZero<Rhs>> for BoxedUint {
    fn rem_assign(&mut self, rhs: NonZero<Rhs>) {
        *self = self.div_rem_assign(rhs.to_boxed());
    }
}

impl DivRemLimb for BoxedUint {
    fn div_rem_limb_with_reciprocal(&self, reciprocal: &Reciprocal) -> (Self, Limb) {
        Self::div_rem_limb_with_reciprocal(self, reciprocal)
    }
}

impl RemLimb for BoxedUint {
    fn rem_limb_with_reciprocal(&self, reciprocal: &Reciprocal) -> Limb {
        Self::rem_limb_with_reciprocal(self, reciprocal)
    }
}

impl<Rhs: Unsigned> RemMixed<Rhs> for BoxedUint {
    fn rem_mixed(&self, reductor: &NonZero<Rhs>) -> Rhs {
        Self::div_rem(self, reductor).1
    }
}

#[cfg(test)]
mod tests {
    use super::{BoxedUint, Limb, NonZero};
    use crate::{CtAssign, DivVartime, One, Resize, UintRef, Wrapping, Zero};

    #[test]
    fn div_trait() {
        let n = BoxedUint::from(0xFFEECCBBAA99887766u128);
        let p = NonZero::new(BoxedUint::from(997u128)).unwrap();
        let res = BoxedUint::from(0x41b74857375c0f86u64);
        assert_eq!(&n / &p, res);
        assert_eq!(&n / p.clone(), res);
        assert_eq!(n.clone() / &p, res);
        assert_eq!(n / p, res);
    }

    #[test]
    fn rem_trait() {
        let n = BoxedUint::from(0xFFEECCBBAA99887766u128);
        let p = NonZero::new(BoxedUint::from(997u128)).unwrap();
        let res = BoxedUint::from(648u128);
        assert_eq!(&n % &p, res);
        assert_eq!(&n % p.clone(), res);
        assert_eq!(n.clone() % &p, res);
        assert_eq!(n % p, res);
    }

    #[test]
    fn div_rem_larger_denominator() {
        // 1 = len(x) < len(y) and x < y
        let x = BoxedUint::from_be_hex("8000000000000000", 64).unwrap();
        let y = BoxedUint::from_be_hex("00000000000000010000000000000000", 128)
            .unwrap()
            .to_nz()
            .unwrap();
        let (quo, rem) = x.div_rem(&y);
        assert_eq!(quo, BoxedUint::zero_with_precision(64));
        assert_eq!(rem, x.resize_unchecked(128));

        // 1 = len(x) < len(y) and x > y
        let x = BoxedUint::from_be_hex("8000000000000000", 64).unwrap();
        let y = BoxedUint::from_be_hex("00000000000000000000000000001000", 128)
            .unwrap()
            .to_nz()
            .unwrap();
        let (quo, rem) = x.div_rem(&y);
        assert_eq!(quo, BoxedUint::from_be_hex("0008000000000000", 64).unwrap());
        assert_eq!(rem, BoxedUint::zero_with_precision(128));

        // 2 = len(x) < len(y) and x < y
        let x = BoxedUint::from_be_hex("80000000000000008000000000000000", 128).unwrap();
        let y = BoxedUint::from_be_hex(
            "0000000000000001000000000000000000000000000000010000000000000000",
            256,
        )
        .unwrap()
        .to_nz()
        .unwrap();
        let (quo, rem) = x.div_rem(&y);
        assert_eq!(quo, BoxedUint::zero_with_precision(128));
        assert_eq!(rem, x.resize_unchecked(256));

        // 2 = len(x) < len(y) and x > y
        let x = BoxedUint::from_be_hex("80000000000000008000000000000000", 128).unwrap();
        let y = BoxedUint::from_be_hex(
            "0000000000000000000000000000000000000000000000000000000000110000",
            256,
        )
        .unwrap()
        .to_nz()
        .unwrap();
        let (quo, rem) = x.div_rem(&y);
        assert_eq!(
            quo,
            BoxedUint::from_be_hex("000007878787878787878f0f0f0f0f0f", 128).unwrap()
        );
        assert_eq!(
            rem,
            BoxedUint::from_be_hex(
                "0000000000000000000000000000000000000000000000000000000000010000",
                256
            )
            .unwrap()
        );
    }

    #[test]
    fn rem_vartime() {
        let n = BoxedUint::from(0xFFEECCBBAA99887766u128);
        let p = NonZero::new(BoxedUint::from(997u128)).unwrap();
        assert_eq!(BoxedUint::from(648u128), n.rem_vartime(&p));
    }

    #[test]
    fn rem_limb() {
        let n = BoxedUint::from(0xFFEECCBBAA99887766u128);
        let pl = NonZero::new(Limb(997)).unwrap();
        let p = NonZero::new(BoxedUint::from(997u128)).unwrap();
        assert_eq!(n.rem(&p).limbs[0], n.rem_limb(pl));
    }

    #[test]
    fn div_vartime_through_trait() {
        struct A<T> {
            x: T,
            y: T,
        }
        impl<T: DivVartime + Clone + Zero + One + CtAssign> A<T> {
            fn divide_x_by_y(&self) -> T {
                let rhs = &NonZero::new(self.y.clone()).unwrap();
                self.x.div_vartime(rhs)
            }
        }

        let a = A {
            x: BoxedUint::from(1234567890u64),
            y: BoxedUint::from(456u64),
        };
        assert_eq!(a.divide_x_by_y(), BoxedUint::from(2707385u64));
    }

    #[test]
    fn div_uintref() {
        let a = BoxedUint::from(1234567890u64);
        let b = UintRef::new(&[Limb(456), Limb(0)])
            .as_nz_vartime()
            .expect("ensured non-zero");
        assert_eq!(&a / b, BoxedUint::from(2707385u64));
        assert_eq!(
            a.checked_div(b.as_ref()).into_option(),
            Some(BoxedUint::from(2707385u64))
        );
    }

    #[test]
    fn wrapping_div() {
        let a = Wrapping(BoxedUint::from(1234567890u64));
        let b = NonZero::new(BoxedUint::from(456u64)).expect("ensured non-zero");
        let res = Wrapping(BoxedUint::from(2707385u64));
        assert_eq!(&a / &b, res);
        assert_eq!(&a / b.clone(), res);
        assert_eq!(a.clone() / &b, res);
        assert_eq!(a.clone() / b.clone(), res);

        let mut c = a.clone();
        c /= &b;
        assert_eq!(c, res);
        let mut c = a.clone();
        c /= b;
        assert_eq!(c, res);
    }
}
