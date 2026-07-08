//! Limb right bitshift

use crate::{Choice, CtOption, Limb, ShrVartime, WrappingShr};
use core::ops::{Shr, ShrAssign};

impl Limb {
    /// Computes `self >> shift`.
    ///
    /// # Panics
    /// - if `shift` overflows `Limb::BITS`.
    #[inline(always)]
    #[must_use]
    #[track_caller]
    pub const fn shr(self, shift: u32) -> Self {
        Limb(self.0 >> shift)
    }

    /// Computes `self >> 1` and return the result and the carry (0 or `1 << HI_BIT`).
    #[inline(always)]
    pub(crate) const fn shr1(self) -> (Self, Self) {
        (Self(self.0 >> 1), Self(self.0 << Self::HI_BIT))
    }

    /// Computes `self >> shift`, returning `CtOption::none()` if the shift exceeds the capacity.
    #[inline(always)]
    #[must_use]
    pub const fn overflowing_shr(self, shift: u32) -> CtOption<Self> {
        CtOption::new(
            self.wrapping_shr(shift),
            Choice::from_u32_lt(shift, Limb::BITS),
        )
    }

    /// Computes `self >> shift`, returning `None` if the shift exceeds the capacity.
    ///
    /// This method is variable time in `shift` only.
    #[inline(always)]
    #[must_use]
    pub const fn overflowing_shr_vartime(self, shift: u32) -> Option<Self> {
        if shift < Limb::BITS {
            Some(self.shr(shift))
        } else {
            None
        }
    }

    /// Computes `self >> shift`, returning `Limb::ZERO` if the shift exceeds the capacity.
    #[inline(always)]
    #[must_use]
    pub const fn unbounded_shr(self, shift: u32) -> Self {
        Limb::select(
            Limb::ZERO,
            self.wrapping_shr(shift),
            Choice::from_u32_lt(shift, Limb::BITS),
        )
    }

    /// Computes `self >> shift`, returning `Limb::ZERO` if the shift exceeds the capacity.
    ///
    /// This method is variable time in `shift` only.
    #[inline(always)]
    #[must_use]
    pub const fn unbounded_shr_vartime(self, shift: u32) -> Self {
        if shift < Limb::BITS {
            self.shr(shift)
        } else {
            Self::ZERO
        }
    }

    /// Computes `self >> shift` in a panic-free manner, masking off bits of `shift`
    /// which would cause the shift to exceed the type's width.
    #[inline(always)]
    #[must_use]
    pub const fn wrapping_shr(self, shift: u32) -> Self {
        Limb(self.0 >> (shift & (Limb::BITS - 1)))
    }
}

macro_rules! impl_shr {
    ($($shift:ty),+) => {
        $(
            impl Shr<$shift> for Limb {
                type Output = Limb;

                #[inline]
                fn shr(self, shift: $shift) -> Limb {
                     Self::shr(self, u32::try_from(shift).expect("invalid shift"))
                }
            }

            impl Shr<$shift> for &Limb {
                type Output = Limb;

                #[inline]
                fn shr(self, shift: $shift) -> Limb {
                   *self >> shift
                }
            }

            impl ShrAssign<$shift> for Limb {
                #[inline]
                fn shr_assign(&mut self, shift: $shift) {
                    *self = *self >> shift;
                }
            }
        )+
    };
}

impl_shr!(i32, u32, usize);

impl ShrVartime for Limb {
    #[inline]
    fn overflowing_shr_vartime(&self, shift: u32) -> Option<Self> {
        (*self).overflowing_shr_vartime(shift)
    }

    #[inline]
    fn unbounded_shr_vartime(&self, shift: u32) -> Self {
        (*self).unbounded_shr_vartime(shift)
    }

    #[inline]
    fn wrapping_shr_vartime(&self, shift: u32) -> Self {
        (*self).wrapping_shr(shift)
    }
}

impl WrappingShr for Limb {
    #[inline]
    fn wrapping_shr(&self, shift: u32) -> Limb {
        (*self).wrapping_shr(shift)
    }
}

#[cfg(test)]
mod tests {
    use crate::{Limb, ShrVartime, WrappingShr};

    #[test]
    fn shr1() {
        assert_eq!(Limb(2) >> 1, Limb(1));
    }

    #[test]
    fn shr2() {
        assert_eq!(Limb(16) >> 2, Limb(4));
    }

    #[test]
    fn shr_assign1() {
        let mut l = Limb::ONE;
        l >>= 1;
        assert_eq!(l, Limb::ZERO);
    }

    #[test]
    fn shr_assign2() {
        let mut l = Limb(32);
        l >>= 2;
        assert_eq!(l, Limb(8));
    }

    #[test]
    fn overflowing_shr() {
        assert_eq!(
            Limb::from(16u8).overflowing_shr(2).into_option(),
            Some(Limb(4))
        );
        assert_eq!(Limb::ONE.overflowing_shr(Limb::BITS).into_option(), None);
        assert_eq!(
            ShrVartime::overflowing_shr_vartime(&Limb::from(16u8), 2),
            Some(Limb(4))
        );
        assert_eq!(
            ShrVartime::overflowing_shr_vartime(&Limb::ONE, Limb::BITS),
            None
        );
    }

    #[test]
    fn unbounded_shr() {
        assert_eq!(Limb::from(16u8).unbounded_shr(2), Limb(4));
        assert_eq!(Limb::ONE.unbounded_shr(Limb::BITS), Limb::ZERO);
        assert_eq!(
            ShrVartime::unbounded_shr_vartime(&Limb::from(16u8), 2),
            Limb(4)
        );
        assert_eq!(
            ShrVartime::unbounded_shr_vartime(&Limb::ONE, Limb::BITS),
            Limb::ZERO
        );
    }

    #[test]
    fn wrapping_shr() {
        assert_eq!(WrappingShr::wrapping_shr(&Limb::from(16u8), 2), Limb(4));
        assert_eq!(WrappingShr::wrapping_shr(&Limb::ONE, Limb::BITS), Limb::ONE);
        assert_eq!(
            ShrVartime::wrapping_shr_vartime(&Limb::from(16u8), 2),
            Limb(4)
        );
        assert_eq!(
            ShrVartime::wrapping_shr_vartime(&Limb::ONE, Limb::BITS),
            Limb::ONE
        );
    }
}
