//! Limb multiplication

use crate::{
    Checked, CheckedMul, CtOption, Limb, Mul, MulAssign, MulMod, NonZero, SquareMod, UintRef,
    Wrapping, WrappingMul,
    primitives::{carrying_mul_add, widening_mul},
};

impl Limb {
    /// Computes `self + (b * c) + carry`, returning the result along with the new carry.
    #[deprecated(
        since = "0.7.0",
        note = "please use `carrying_mul_add` instead (ordering of arguments changes)"
    )]
    #[must_use]
    pub const fn mac(self, b: Limb, c: Limb, carry: Limb) -> (Limb, Limb) {
        b.carrying_mul_add(c, self, carry)
    }

    /// Computes `(self * rhs) + addend + carry`, returning the result along with the new carry.
    #[inline(always)]
    #[must_use]
    pub const fn carrying_mul_add(self, rhs: Limb, addend: Limb, carry: Limb) -> (Limb, Limb) {
        let (res, carry) = carrying_mul_add(self.0, rhs.0, addend.0, carry.0);
        (Limb(res), Limb(carry))
    }

    /// Perform saturating multiplication.
    #[inline(always)]
    #[must_use]
    pub const fn saturating_mul(self, rhs: Self) -> Self {
        Limb(self.0.saturating_mul(rhs.0))
    }

    /// Perform wrapping multiplication, discarding overflow.
    #[inline(always)]
    #[must_use]
    pub const fn wrapping_mul(self, rhs: Self) -> Self {
        Limb(self.0.wrapping_mul(rhs.0))
    }

    /// Compute "wide" multiplication, with a product twice the size of the input.
    #[inline]
    pub(crate) const fn widening_mul(self, rhs: Self) -> (Self, Self) {
        let (lo, hi) = widening_mul(self.0, rhs.0);
        (Limb(lo), Limb(hi))
    }

    /// Compute "wide" squaring, with a product twice the size of the input.
    #[inline]
    pub(crate) const fn widening_square(self) -> (Self, Self) {
        let (lo, hi) = widening_mul(self.0, self.0);
        (Limb(lo), Limb(hi))
    }

    /// Compute "wide" squaring, with a product twice the size of the input.
    pub(crate) const fn rem_wide(lo_hi: (Self, Self), p: NonZero<Self>) -> Self {
        UintRef::new_mut(&mut [lo_hi.0, lo_hi.1]).div_rem_limb(p)
    }
}

impl CheckedMul for Limb {
    #[inline]
    fn checked_mul(&self, rhs: &Self) -> CtOption<Self> {
        let (lo, hi) = self.widening_mul(*rhs);
        CtOption::new(lo, hi.is_zero())
    }
}

impl Mul<Limb> for Limb {
    type Output = Limb;

    #[inline]
    fn mul(self, rhs: Limb) -> Self {
        self.checked_mul(&rhs)
            .expect("attempted to multiply with overflow")
    }
}

impl Mul<&Limb> for Limb {
    type Output = Limb;

    #[inline]
    fn mul(self, rhs: &Limb) -> Self {
        self * *rhs
    }
}

impl Mul<Limb> for &Limb {
    type Output = Limb;

    #[inline]
    fn mul(self, rhs: Limb) -> Self::Output {
        *self * rhs
    }
}

impl Mul<&Limb> for &Limb {
    type Output = Limb;

    #[inline]
    fn mul(self, rhs: &Limb) -> Self::Output {
        *self * *rhs
    }
}

impl MulAssign for Limb {
    #[inline]
    fn mul_assign(&mut self, other: Self) {
        *self = *self * other;
    }
}

impl MulAssign<&Limb> for Limb {
    #[inline]
    fn mul_assign(&mut self, other: &Self) {
        *self = *self * *other;
    }
}

impl MulAssign for Wrapping<Limb> {
    #[inline]
    fn mul_assign(&mut self, other: Self) {
        *self = *self * other;
    }
}

impl MulAssign<&Wrapping<Limb>> for Wrapping<Limb> {
    #[inline]
    fn mul_assign(&mut self, other: &Self) {
        *self = *self * other;
    }
}

impl MulAssign for Checked<Limb> {
    #[inline]
    fn mul_assign(&mut self, other: Self) {
        *self = *self * other;
    }
}

impl MulAssign<&Checked<Limb>> for Checked<Limb> {
    #[inline]
    fn mul_assign(&mut self, other: &Self) {
        *self = *self * other;
    }
}

impl WrappingMul for Limb {
    #[inline]
    fn wrapping_mul(&self, v: &Self) -> Self {
        Self::wrapping_mul(*self, *v)
    }
}

impl MulMod for Limb {
    type Output = Self;

    fn mul_mod(&self, rhs: &Self, p: &NonZero<Self>) -> Self::Output {
        let lo_hi = self.widening_mul(*rhs);
        Self::rem_wide(lo_hi, *p)
    }
}

impl SquareMod for Limb {
    type Output = Self;

    fn square_mod(&self, p: &NonZero<Self>) -> Self::Output {
        let lo_hi = self.widening_square();
        Self::rem_wide(lo_hi, *p)
    }
}

#[cfg(test)]
mod tests {
    use super::{CheckedMul, Limb};

    cpubits::cpubits! {
        32 => {
            #[test]
            fn checked_mul_ok() {
                let n = Limb::from_u16(0xffff);
                assert_eq!(n.checked_mul(&n).unwrap(), Limb::from_u32(0xfffe_0001));
            }
        }
        64 => {
            #[test]
            fn checked_mul_ok() {
                let n = Limb::from_u32(0xffff_ffff);
                assert_eq!(
                    n.checked_mul(&n).unwrap(),
                    Limb::from_u64(0xffff_fffe_0000_0001)
                );
            }
        }
    }

    #[test]
    fn checked_mul_overflow() {
        let n = Limb::MAX;
        assert!(bool::from(n.checked_mul(&n).is_none()));
    }
}
