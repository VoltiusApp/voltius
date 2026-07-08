//! [`BoxedUint`] bitwise right shift operations.

use crate::{BoxedUint, Choice, CtOption, Shr, ShrAssign, ShrVartime, WrappingShr};

impl BoxedUint {
    /// Computes `self >> shift`.
    ///
    /// # Panics
    /// - if `shift >= self.bits_precision()`.
    #[must_use]
    pub fn shr(&self, shift: u32) -> BoxedUint {
        let mut result = self.clone();
        result.shr_assign(shift);
        result
    }

    /// Computes `self >>= shift`.
    ///
    /// # Panics
    /// - if `shift >= self.bits_precision()`.
    pub fn shr_assign(&mut self, shift: u32) {
        self.as_mut_uint_ref().shr_assign(shift);
    }

    /// Computes `self >> shift`.
    ///
    /// Returns `self` and a truthy `Choice` if `shift >= self.bits_precision()`,
    /// or the result and a falsy `Choice` otherwise.
    #[must_use]
    pub fn overflowing_shr(&self, shift: u32) -> CtOption<Self> {
        let mut result = self.clone();
        let overflow = result.overflowing_shr_assign(shift);
        CtOption::new(result, overflow.not())
    }

    /// Computes `self >> shift` in variable-time.
    ///
    /// Returns `None` if `shift >= self.bits_precision()`, otherwise the shifted result.
    #[must_use]
    pub fn overflowing_shr_vartime(&self, shift: u32) -> Option<Self> {
        if shift < self.bits_precision() {
            Some(self.unbounded_shr_vartime(shift))
        } else {
            None
        }
    }

    /// Computes `self >>= shift`.
    ///
    /// Returns a truthy `Choice` if `shift >= self.bits_precision()` or a falsy `Choice` otherwise.
    pub fn overflowing_shr_assign(&mut self, shift: u32) -> Choice {
        self.as_mut_uint_ref().overflowing_shr_assign(shift)
    }

    /// Computes `self >>= shift` in variable-time.
    ///
    /// If `shift >= self.bits_precision()`, shifts `self` in place and returns `false`.
    /// Otherwise returns `true` and leaves `self` unmodified.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    pub fn overflowing_shr_assign_vartime(&mut self, shift: u32) -> bool {
        if shift < self.bits_precision() {
            self.as_mut_uint_ref().unbounded_shr_assign_vartime(shift);
            false
        } else {
            true
        }
    }

    /// Computes `self >> shift` in a panic-free manner, producing zero in the case of overflow.
    #[must_use]
    pub fn unbounded_shr(&self, shift: u32) -> Self {
        let mut result = self.clone();
        result.unbounded_shr_assign(shift);
        result
    }

    /// Computes `self >>= shift` in a panic-free manner, producing zero in the case of overflow.
    pub fn unbounded_shr_assign(&mut self, shift: u32) {
        self.as_mut_uint_ref().unbounded_shr_assign(shift);
    }

    /// Computes `self >> shift` in variable-time in a panic-free manner, producing zero in the
    /// case of overflow.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[must_use]
    pub fn unbounded_shr_vartime(&self, shift: u32) -> Self {
        let mut result = Self::zero_with_precision(self.bits_precision());
        self.as_uint_ref()
            .unbounded_shr_vartime(shift, result.as_mut_uint_ref());
        result
    }

    /// Computes `self >>= shift` in variable-time in a panic-free manner, producing zero in the case of overflow.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    pub fn unbounded_shr_assign_vartime(&mut self, shift: u32) {
        self.as_mut_uint_ref().unbounded_shr_assign_vartime(shift);
    }

    /// Computes `self >> shift` in a panic-free manner, reducing shift modulo the type's width.
    #[must_use]
    pub fn wrapping_shr(&self, shift: u32) -> Self {
        let mut result = self.clone();
        result.wrapping_shr_assign(shift);
        result
    }

    /// Computes `self >>= shift` in a panic-free manner, reducing shift modulo the type's width.
    pub fn wrapping_shr_assign(&mut self, shift: u32) {
        self.as_mut_uint_ref().wrapping_shr_assign(shift);
    }

    /// Computes `self >> shift` in variable-time in a panic-free manner, reducing shift modulo
    /// the type's width.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[must_use]
    #[allow(clippy::integer_division_remainder_used, reason = "vartime")]
    pub fn wrapping_shr_vartime(&self, shift: u32) -> Self {
        self.unbounded_shr_vartime(shift % self.bits_precision())
    }

    /// Computes `self >>= shift` in variable-time in a panic-free manner, reducing shift modulo
    /// the type's width.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    pub fn wrapping_shr_assign_vartime(&mut self, shift: u32) {
        self.as_mut_uint_ref().wrapping_shr_assign_vartime(shift);
    }

    /// Computes `self >> shift`.
    /// Returns `None` if `shift >= self.bits_precision()`.
    ///
    /// NOTE: this operation is variable time with respect to `shift` *ONLY*.
    ///
    /// When used with a fixed `shift`, this function is constant-time with respect to `self`.
    #[inline(always)]
    #[must_use]
    pub fn shr_vartime(&self, shift: u32) -> Option<Self> {
        self.overflowing_shr_vartime(shift)
    }

    /// Computes `self >>= 1` in-place in constant-time.
    pub(crate) fn shr1_assign(&mut self) -> Choice {
        self.as_mut_uint_ref().shr1_assign().lsb_to_choice()
    }
}

macro_rules! impl_shr {
    ($($shift:ty),+) => {
        $(
            impl Shr<$shift> for BoxedUint {
                type Output = BoxedUint;

                #[inline]
                fn shr(self, shift: $shift) -> BoxedUint {
                    <&Self>::shr(&self, shift)
                }
            }

            impl Shr<$shift> for &BoxedUint {
                type Output = BoxedUint;

                #[inline]
                fn shr(self, shift: $shift) -> BoxedUint {
                    BoxedUint::shr(self, u32::try_from(shift).expect("invalid shift"))
                }
            }

            impl ShrAssign<$shift> for BoxedUint {
                fn shr_assign(&mut self, shift: $shift) {
                    BoxedUint::shr_assign(self, u32::try_from(shift).expect("invalid shift"))
                }
            }
        )+
    };
}

impl_shr!(i32, u32, usize);

impl WrappingShr for BoxedUint {
    fn wrapping_shr(&self, shift: u32) -> BoxedUint {
        self.wrapping_shr(shift)
    }
}

impl ShrVartime for BoxedUint {
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
    use super::BoxedUint;
    use crate::{ShrVartime, WrappingShr};

    #[test]
    fn shr1_assign() {
        let mut n = BoxedUint::from(0x3c442b21f19185fe433f0a65af902b8fu128);
        let n_shr1 = BoxedUint::from(0x1e221590f8c8c2ff219f8532d7c815c7u128);
        n.shr1_assign();
        assert_eq!(n, n_shr1);
    }

    #[test]
    fn shr() {
        let n = BoxedUint::from(0x80000000000000000u128);
        assert_eq!(BoxedUint::zero(), &n >> 68);
        assert_eq!(BoxedUint::one(), &n >> 67);
        assert_eq!(BoxedUint::from(2u8), &n >> 66);
        assert_eq!(BoxedUint::from(4u8), &n >> 65);
    }

    #[test]
    fn shr_vartime() {
        let n = BoxedUint::from(0x80000000000000000u128);
        assert_eq!(BoxedUint::zero(), n.shr_vartime(68).unwrap());
        assert_eq!(BoxedUint::one(), n.shr_vartime(67).unwrap());
        assert_eq!(BoxedUint::from(2u8), n.shr_vartime(66).unwrap());
        assert_eq!(BoxedUint::from(4u8), n.shr_vartime(65).unwrap());
    }

    #[test]
    fn overflowing_shr() {
        assert_eq!(
            BoxedUint::from(16u8).overflowing_shr(2).into_option(),
            Some(BoxedUint::from(4u8))
        );
        assert_eq!(
            BoxedUint::one_with_precision(192)
                .overflowing_shr(192)
                .into_option(),
            None
        );
        assert_eq!(
            ShrVartime::overflowing_shr_vartime(&BoxedUint::from(16u8), 2),
            Some(BoxedUint::from(4u8))
        );
        assert_eq!(
            ShrVartime::overflowing_shr_vartime(&BoxedUint::one_with_precision(192), 192),
            None
        );
        let mut boxed = BoxedUint::from(16u8);
        assert!(!boxed.overflowing_shr_assign_vartime(2));
        assert_eq!(boxed, BoxedUint::from(4u8));
        let mut boxed = BoxedUint::one_with_precision(192);
        assert!(boxed.overflowing_shr_assign_vartime(192));
    }

    #[test]
    fn unbounded_shr() {
        assert_eq!(BoxedUint::from(16u8).unbounded_shr(2), BoxedUint::from(4u8));
        assert_eq!(BoxedUint::max(192).unbounded_shr(192), BoxedUint::zero());
        assert_eq!(
            ShrVartime::unbounded_shr_vartime(&BoxedUint::from(16u8), 2),
            BoxedUint::from(4u8)
        );
        assert_eq!(
            ShrVartime::unbounded_shr_vartime(&BoxedUint::max(192), 192),
            BoxedUint::zero()
        );
    }

    #[test]
    fn wrapping_shr() {
        assert_eq!(
            WrappingShr::wrapping_shr(&BoxedUint::from(16u8), 2),
            BoxedUint::from(4u8)
        );
        assert_eq!(
            WrappingShr::wrapping_shr(&BoxedUint::one_with_precision(192), 192),
            BoxedUint::one()
        );
        assert_eq!(
            ShrVartime::wrapping_shr_vartime(&BoxedUint::from(16u8), 2),
            BoxedUint::from(4u8)
        );
        assert_eq!(
            ShrVartime::wrapping_shr_vartime(&BoxedUint::one_with_precision(192), 192),
            BoxedUint::one()
        );
    }
}
