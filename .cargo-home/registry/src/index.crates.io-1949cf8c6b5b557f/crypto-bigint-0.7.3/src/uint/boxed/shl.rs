//! [`BoxedUint`] bitwise left shift operations.

use crate::{BoxedUint, Choice, CtOption, Limb, Shl, ShlAssign, ShlVartime, WrappingShl};

impl BoxedUint {
    /// Computes `self << shift`.
    ///
    /// # Panics
    /// - if `shift >= self.bits_precision()`.
    #[must_use]
    #[track_caller]
    pub fn shl(&self, shift: u32) -> BoxedUint {
        let mut result = self.clone();
        result.shl_assign(shift);
        result
    }

    /// Computes `self <<= shift`.
    ///
    /// # Panics
    /// - if `shift >= self.bits_precision()`.
    pub fn shl_assign(&mut self, shift: u32) {
        self.as_mut_uint_ref().shl_assign(shift);
    }

    /// Computes `self << shift`.
    ///
    /// Returns `self` and a truthy `Choice` if `shift >= self.bits_precision()`,
    /// or the result and a falsy `Choice` otherwise.
    #[must_use]
    pub fn overflowing_shl(&self, shift: u32) -> CtOption<Self> {
        let mut result = self.clone();
        let overflow = result.as_mut_uint_ref().overflowing_shl_assign(shift);
        CtOption::new(result, overflow.not())
    }

    /// Computes `self << shift` in variable-time.
    ///
    /// Returns `None` if `shift >= self.bits_precision()`, otherwise the shifted result.
    #[must_use]
    pub fn overflowing_shl_vartime(&self, shift: u32) -> Option<Self> {
        if shift < self.bits_precision() {
            Some(self.unbounded_shl_vartime(shift))
        } else {
            None
        }
    }

    /// Computes `self <<= shift`.
    ///
    /// Returns a truthy `Choice` if `shift >= self.bits_precision()` or a falsy `Choice` otherwise.
    #[must_use]
    pub fn overflowing_shl_assign(&mut self, shift: u32) -> Choice {
        self.as_mut_uint_ref().overflowing_shl_assign(shift)
    }

    /// Computes `self <<= shift` in variable-time.
    ///
    /// If `shift >= self.bits_precision()`, shifts `self` in place and returns `false`.
    /// Otherwise returns `true` and leaves `self` unmodified.
    #[must_use]
    pub fn overflowing_shl_assign_vartime(&mut self, shift: u32) -> bool {
        if shift < self.bits_precision() {
            self.as_mut_uint_ref().unbounded_shl_assign_vartime(shift);
            false
        } else {
            true
        }
    }

    /// Computes `self << shift` in a panic-free manner, producing zero in the case of overflow.
    #[must_use]
    pub fn unbounded_shl(&self, shift: u32) -> Self {
        let mut result = self.clone();
        result.unbounded_shl_assign(shift);
        result
    }

    /// Computes `self <<= shift` in a panic-free manner, producing zero in the case of overflow.
    pub fn unbounded_shl_assign(&mut self, shift: u32) {
        self.as_mut_uint_ref().unbounded_shl_assign(shift);
    }

    /// Computes `self << shift` in variable-time in a panic-free manner, producing zero
    /// in the case of overflow.
    #[must_use]
    pub fn unbounded_shl_vartime(&self, shift: u32) -> Self {
        let mut result = Self::zero_with_precision(self.bits_precision());
        self.as_uint_ref()
            .unbounded_shl_vartime(shift, result.as_mut_uint_ref());
        result
    }

    /// Computes `self <<= shift` in variable-time in a panic-free manner, producing zero
    /// in the case of overflow.
    pub fn unbounded_shl_assign_vartime(&mut self, shift: u32) {
        self.as_mut_uint_ref().unbounded_shl_assign_vartime(shift);
    }

    /// Computes `self << shift` in a panic-free manner, masking off bits of `shift` which would cause the shift to
    /// exceed the type's width.
    #[must_use]
    pub fn wrapping_shl(&self, shift: u32) -> Self {
        let mut result = self.clone();
        result.wrapping_shl_assign(shift);
        result
    }

    /// Computes `self <<= shift` in a panic-free manner, masking off bits of `shift` which would cause the shift to
    /// exceed the type's width.
    pub fn wrapping_shl_assign(&mut self, shift: u32) {
        self.as_mut_uint_ref().wrapping_shl_assign(shift);
    }

    /// Computes `self << shift` in variable-time in a panic-free manner, masking off bits of `shift` which would cause
    /// the shift to exceed the type's width.
    #[must_use]
    #[allow(clippy::integer_division_remainder_used, reason = "vartime")]
    pub fn wrapping_shl_vartime(&self, shift: u32) -> Self {
        self.unbounded_shl_vartime(shift % self.bits_precision())
    }

    /// Computes `self <<= shift` in variable-time in a panic-free manner, masking
    /// off bits of `shift` which would cause the shift to exceed the type's width.
    pub fn wrapping_shl_assign_vartime(&mut self, shift: u32) {
        self.as_mut_uint_ref().wrapping_shl_assign_vartime(shift);
    }

    /// Computes `self << shift`.
    /// Returns `None` if `shift >= self.bits_precision()`.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[must_use]
    pub fn shl_vartime(&self, shift: u32) -> Option<Self> {
        self.overflowing_shl_vartime(shift)
    }

    /// Computes `self << 1` in constant-time.
    pub(crate) fn shl1(&self) -> (Self, Limb) {
        let mut ret = self.clone();
        let carry = ret.as_mut_uint_ref().shl1_assign();
        (ret, carry)
    }
}

macro_rules! impl_shl {
    ($($shift:ty),+) => {
        $(
            impl Shl<$shift> for BoxedUint {
                type Output = BoxedUint;

                #[inline]
                fn shl(self, shift: $shift) -> BoxedUint {
                    <&Self>::shl(&self, shift)
                }
            }

            impl Shl<$shift> for &BoxedUint {
                type Output = BoxedUint;

                #[inline]
                fn shl(self, shift: $shift) -> BoxedUint {
                    BoxedUint::shl(self, u32::try_from(shift).expect("invalid shift"))
                }
            }

            impl ShlAssign<$shift> for BoxedUint {
                fn shl_assign(&mut self, shift: $shift) {
                    BoxedUint::shl_assign(self, u32::try_from(shift).expect("invalid shift"))
                }
            }
        )+
    };
}

impl_shl!(i32, u32, usize);

impl WrappingShl for BoxedUint {
    fn wrapping_shl(&self, shift: u32) -> BoxedUint {
        self.wrapping_shl(shift)
    }
}

impl ShlVartime for BoxedUint {
    fn overflowing_shl_vartime(&self, shift: u32) -> Option<Self> {
        self.overflowing_shl_vartime(shift)
    }

    fn unbounded_shl_vartime(&self, shift: u32) -> Self {
        self.unbounded_shl_vartime(shift)
    }

    fn wrapping_shl_vartime(&self, shift: u32) -> Self {
        self.wrapping_shl_vartime(shift)
    }
}

#[cfg(test)]
mod tests {
    use super::BoxedUint;
    use crate::{ShlVartime, WrappingShl};

    #[test]
    fn shl() {
        let one = BoxedUint::one_with_precision(128);

        assert_eq!(BoxedUint::from(2u8), &one << 1);
        assert_eq!(BoxedUint::from(4u8), &one << 2);
        assert_eq!(
            BoxedUint::from(0x80000000000000000u128),
            one.shl_vartime(67).unwrap()
        );
    }

    #[test]
    fn shl1_assign() {
        let n = BoxedUint::from(0x3c442b21f19185fe433f0a65af902b8fu128);
        let n_shl1 = BoxedUint::from(0x78885643e3230bfc867e14cb5f20571eu128);
        assert_eq!(n.shl1().0, n_shl1);
    }

    #[test]
    fn shl_vartime() {
        let one = BoxedUint::one_with_precision(128);

        assert_eq!(BoxedUint::from(2u8), one.shl_vartime(1).unwrap());
        assert_eq!(BoxedUint::from(4u8), one.shl_vartime(2).unwrap());
        assert_eq!(
            BoxedUint::from(0x80000000000000000u128),
            one.shl_vartime(67).unwrap()
        );
    }

    #[test]
    fn overflowing_shl() {
        assert_eq!(
            BoxedUint::one().overflowing_shl(2).into_option(),
            Some(BoxedUint::from(4u8))
        );
        assert_eq!(BoxedUint::max(192).overflowing_shl(192).into_option(), None);
        assert_eq!(
            ShlVartime::overflowing_shl_vartime(&BoxedUint::one(), 2),
            Some(BoxedUint::from(4u8))
        );
        assert_eq!(
            ShlVartime::overflowing_shl_vartime(&BoxedUint::max(192), 192),
            None
        );
        let mut boxed = BoxedUint::one();
        assert!(!boxed.overflowing_shl_assign_vartime(2));
        assert_eq!(boxed, BoxedUint::from(4u8));
        let mut boxed = BoxedUint::max(192);
        assert!(boxed.overflowing_shl_assign_vartime(192));
    }

    #[test]
    fn unbounded_shl() {
        assert_eq!(BoxedUint::one().unbounded_shl(2), BoxedUint::from(4u8));
        assert_eq!(BoxedUint::max(192).unbounded_shl(192), BoxedUint::zero());
        assert_eq!(
            ShlVartime::unbounded_shl_vartime(&BoxedUint::one(), 2),
            BoxedUint::from(4u8)
        );
        assert_eq!(
            ShlVartime::unbounded_shl_vartime(&BoxedUint::max(192), 192),
            BoxedUint::zero()
        );
    }

    #[test]
    fn wrapping_shl() {
        assert_eq!(
            WrappingShl::wrapping_shl(&BoxedUint::one(), 2),
            BoxedUint::from(4u8)
        );
        assert_eq!(
            WrappingShl::wrapping_shl(&BoxedUint::one_with_precision(192), 192),
            BoxedUint::one()
        );
        assert_eq!(
            ShlVartime::wrapping_shl_vartime(&BoxedUint::one(), 2),
            BoxedUint::from(4u8)
        );
        assert_eq!(
            ShlVartime::wrapping_shl_vartime(&BoxedUint::one_with_precision(192), 192),
            BoxedUint::one()
        );
    }
}
