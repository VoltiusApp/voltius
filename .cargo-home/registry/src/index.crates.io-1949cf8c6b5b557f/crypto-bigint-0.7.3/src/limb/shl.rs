//! Limb left bitshift

use crate::{Choice, CtOption, Limb, Shl, ShlAssign, ShlVartime, WrappingShl};

impl Limb {
    /// Computes `self << shift`.
    ///
    /// # Panics
    /// - if `shift` overflows `Limb::BITS`.
    #[inline(always)]
    #[must_use]
    #[track_caller]
    pub const fn shl(self, shift: u32) -> Self {
        Limb(self.0 << shift)
    }

    /// Computes `self << shift`, returning `CtOption::none()` if the shift exceeds the capacity.
    #[inline(always)]
    #[must_use]
    pub const fn overflowing_shl(self, shift: u32) -> CtOption<Self> {
        CtOption::new(
            self.wrapping_shl(shift),
            Choice::from_u32_lt(shift, Limb::BITS),
        )
    }

    /// Computes `self << shift`, returning `None` if the shift exceeds the capacity.
    ///
    /// This method is variable time in `shift` only.
    #[inline(always)]
    #[must_use]
    pub const fn overflowing_shl_vartime(self, shift: u32) -> Option<Self> {
        if shift < Limb::BITS {
            Some(self.shl(shift))
        } else {
            None
        }
    }

    /// Computes `self << shift`, returning `Limb::ZERO` if the shift exceeds the capacity.
    #[inline(always)]
    #[must_use]
    pub const fn unbounded_shl(self, shift: u32) -> Self {
        Limb::select(
            Limb::ZERO,
            self.wrapping_shl(shift),
            Choice::from_u32_lt(shift, Limb::BITS),
        )
    }

    /// Computes `self << shift`, returning `Limb::ZERO` if the shift exceeds the capacity.
    ///
    /// This method is variable time in `shift` only.
    #[inline(always)]
    #[must_use]
    pub const fn unbounded_shl_vartime(self, shift: u32) -> Self {
        if shift < Limb::BITS {
            self.shl(shift)
        } else {
            Self::ZERO
        }
    }

    /// Computes `self << shift` in a panic-free manner, masking off bits of `shift`
    /// which would cause the shift to exceed the type's width.
    #[inline(always)]
    #[must_use]
    pub const fn wrapping_shl(self, shift: u32) -> Self {
        Limb(self.0 << (shift & (Limb::BITS - 1)))
    }
}

macro_rules! impl_shl {
    ($($shift:ty),+) => {
        $(
            impl Shl<$shift> for Limb {
                type Output = Limb;

                #[inline]
                fn shl(self, shift: $shift) -> Limb {
                     Self::shl(self, u32::try_from(shift).expect("invalid shift"))
                }
            }

            impl Shl<$shift> for &Limb {
                type Output = Limb;

                #[inline]
                fn shl(self, shift: $shift) -> Limb {
                   *self << shift
                }
            }

            impl ShlAssign<$shift> for Limb {
                #[inline]
                fn shl_assign(&mut self, shift: $shift) {
                    *self = *self << shift;
                }
            }
        )+
    };
}

impl_shl!(i32, u32, usize);

impl ShlVartime for Limb {
    #[inline]
    fn overflowing_shl_vartime(&self, shift: u32) -> Option<Self> {
        (*self).overflowing_shl_vartime(shift)
    }

    #[inline]
    fn unbounded_shl_vartime(&self, shift: u32) -> Self {
        (*self).unbounded_shl_vartime(shift)
    }

    #[inline]
    fn wrapping_shl_vartime(&self, shift: u32) -> Self {
        (*self).wrapping_shl(shift)
    }
}

impl WrappingShl for Limb {
    #[inline]
    fn wrapping_shl(&self, shift: u32) -> Limb {
        (*self).wrapping_shl(shift)
    }
}

#[cfg(test)]
mod tests {
    use crate::{Limb, ShlVartime, WrappingShl};

    #[test]
    fn shl1() {
        assert_eq!(Limb(1) << 1, Limb(2));
    }

    #[test]
    fn shl2() {
        assert_eq!(Limb(1) << 2, Limb(4));
    }

    #[test]
    fn shl_assign1() {
        let mut l = Limb(1);
        l <<= 1;
        assert_eq!(l, Limb(2));
    }

    #[test]
    fn shl_assign2() {
        let mut l = Limb(1);
        l <<= 2;
        assert_eq!(l, Limb(4));
    }

    #[test]
    fn overflowing_shl() {
        assert_eq!(Limb::ONE.overflowing_shl(2).into_option(), Some(Limb(4)));
        assert_eq!(Limb::ONE.overflowing_shl(Limb::BITS).into_option(), None);
        assert_eq!(
            ShlVartime::overflowing_shl_vartime(&Limb::ONE, 2),
            Some(Limb(4))
        );
        assert_eq!(
            ShlVartime::overflowing_shl_vartime(&Limb::ONE, Limb::BITS),
            None
        );
    }

    #[test]
    fn unbounded_shl() {
        assert_eq!(Limb::ONE.unbounded_shl(2), Limb(4));
        assert_eq!(Limb::ONE.unbounded_shl(Limb::BITS), Limb::ZERO);
        assert_eq!(ShlVartime::unbounded_shl_vartime(&Limb::ONE, 2), Limb(4));
        assert_eq!(
            ShlVartime::unbounded_shl_vartime(&Limb::ONE, Limb::BITS),
            Limb::ZERO
        );
    }

    #[test]
    fn wrapping_shl() {
        assert_eq!(WrappingShl::wrapping_shl(&Limb::ONE, 2), Limb(4));
        assert_eq!(WrappingShl::wrapping_shl(&Limb::ONE, Limb::BITS), Limb::ONE);
        assert_eq!(ShlVartime::wrapping_shl_vartime(&Limb::ONE, 2), Limb(4));
        assert_eq!(
            ShlVartime::wrapping_shl_vartime(&Limb::ONE, Limb::BITS),
            Limb::ONE
        );
    }
}
