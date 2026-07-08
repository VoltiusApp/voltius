//! Modulus-specific Montgomery form parameters.

use crate::{Choice, CtAssign, CtEq, Limb, Odd, U64, Uint, Unsigned, Word};
use core::fmt::{self, Debug};
use ctutils::{CtAssignSlice, CtEqSlice, CtSelectUsingCtAssign};

#[cfg(feature = "subtle")]
use crate::CtSelect;
#[cfg(feature = "zeroize")]
use zeroize::Zeroize;

/// Parameters to efficiently go to/from the Montgomery form for an odd modulus provided at runtime.
///
/// This version is generic over the underlying unsigned integer type.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct MontyParams<U: Unsigned> {
    /// The constant modulus.
    pub(super) modulus: Odd<U>,

    /// 1 in Montgomery form (a.k.a. `R`).
    pub(super) one: U,

    /// `R^2 mod modulus`, used to move into Montgomery form.
    pub(super) r2: U,

    /// The lowest limbs of `MODULUS^-1 mod 2**64`.
    ///
    /// This value is used in Montgomery reduction and modular inversion.
    pub(super) mod_inv: U64,

    /// Leading zeros in the modulus, used to choose optimized algorithms.
    pub(super) mod_leading_zeros: u32,
}

impl<U: Unsigned> MontyParams<U> {
    /// Returns the modulus which was used to initialize these parameters.
    pub const fn modulus(&self) -> &Odd<U> {
        &self.modulus
    }

    /// 1 in Montgomery form (a.k.a. `R`).
    pub const fn one(&self) -> &U {
        &self.one
    }

    /// `R^2 mod modulus`, used to move into Montgomery form.
    pub const fn r2(&self) -> &U {
        &self.r2
    }

    /// Returns the lowest limbs of `MODULUS^-1 mod 2**64`.
    ///
    /// This value is used in Montgomery reduction and modular inversion.
    pub const fn mod_inv(&self) -> &U64 {
        &self.mod_inv
    }

    /// Returns wrapping negation of first limb of `mod_inv`.
    #[inline(always)]
    pub const fn mod_neg_inv(&self) -> Limb {
        self.mod_inv.limbs[0].wrapping_neg()
    }

    /// Returns leading zeros in the modulus, used to choose optimized algorithms.
    pub const fn mod_leading_zeros(&self) -> u32 {
        self.mod_leading_zeros
    }

    /// Core implementation of the debug impl which lets us customize it for various types/type
    /// aliases.
    pub(crate) fn debug_struct(&self, mut debug: fmt::DebugStruct<'_, '_>) -> fmt::Result {
        debug
            .field("modulus", &self.modulus)
            .field("one", &self.one)
            .field("r2", &self.r2)
            .field("mod_inv", &self.mod_inv)
            .field("mod_leading_zeros", &self.mod_leading_zeros)
            .finish()
    }
}

impl<U: Unsigned> AsRef<Self> for MontyParams<U> {
    fn as_ref(&self) -> &Self {
        self
    }
}

impl<U: Unsigned> CtAssign for MontyParams<U> {
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.modulus.ct_assign(&other.modulus, choice);
        self.one.ct_assign(&other.one, choice);
        self.r2.ct_assign(&other.r2, choice);
        self.mod_inv.ct_assign(&other.mod_inv, choice);
        self.mod_leading_zeros
            .ct_assign(&other.mod_leading_zeros, choice);
    }
}
impl<U: Unsigned> CtAssignSlice for MontyParams<U> {}
impl<U: Unsigned> CtSelectUsingCtAssign for MontyParams<U> {}

impl<U: Unsigned> CtEq for MontyParams<U> {
    fn ct_eq(&self, other: &Self) -> Choice {
        self.modulus.ct_eq(&other.modulus)
            & self.one.ct_eq(&other.one)
            & self.r2.ct_eq(&other.r2)
            & self.mod_inv.ct_eq(&other.mod_inv)
    }
}
impl<U: Unsigned> CtEqSlice for MontyParams<U> {}

impl<const LIMBS: usize> Debug for FixedMontyParams<LIMBS> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.debug_struct(f.debug_struct("MontyParams"))
    }
}

#[cfg(feature = "subtle")]
impl<U: Unsigned> subtle::ConstantTimeEq for MontyParams<U> {
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, other).into()
    }
}

#[cfg(feature = "subtle")]
impl<U: Unsigned + Copy> subtle::ConditionallySelectable for MontyParams<U> {
    fn conditional_assign(&mut self, src: &Self, choice: subtle::Choice) {
        self.ct_assign(src, choice.into());
    }

    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        a.ct_select(b, choice.into())
    }
}

#[cfg(feature = "zeroize")]
impl<U: Unsigned + Zeroize> Zeroize for MontyParams<U> {
    fn zeroize(&mut self) {
        self.modulus.zeroize();
        self.one.zeroize();
        self.r2.zeroize();
        self.mod_inv.zeroize();
        self.mod_leading_zeros.zeroize();
    }
}

/// Parameters to efficiently go to/from the Montgomery form for an odd modulus provided at runtime.
pub type FixedMontyParams<const LIMBS: usize> = MontyParams<Uint<LIMBS>>;

impl<const LIMBS: usize> FixedMontyParams<LIMBS> {
    /// Instantiates a new set of `MontyParams` representing the given odd `modulus`.
    #[must_use]
    pub const fn new(modulus: Odd<Uint<LIMBS>>) -> Self {
        // `R mod modulus` where `R = 2^BITS`.
        // Represents 1 in Montgomery form.
        let one = Uint::<LIMBS>::MAX
            .rem(modulus.as_nz_ref())
            .wrapping_add(&Uint::ONE);

        // `R^2 mod modulus`, used to convert integers to Montgomery form.
        let r2 = one.square_mod(modulus.as_nz_ref());

        // The inverse of the modulus modulo 2**64
        let mod_inv = U64::from_u64(modulus.as_uint_ref().invert_mod_u64());

        let mod_leading_zeros = modulus.as_ref().leading_zeros();
        let mod_leading_zeros = Choice::from_u32_lt(mod_leading_zeros, Word::BITS - 1)
            .select_u32(Word::BITS - 1, mod_leading_zeros);

        Self {
            modulus,
            one,
            r2,
            mod_inv,
            mod_leading_zeros,
        }
    }
}

impl<const LIMBS: usize> FixedMontyParams<LIMBS> {
    /// Instantiates a new set of `MontyParams` representing the given odd `modulus`.
    #[must_use]
    pub const fn new_vartime(modulus: Odd<Uint<LIMBS>>) -> Self {
        // `R mod modulus` where `R = 2^BITS`.
        // Represents 1 in Montgomery form.
        let one = Uint::<LIMBS>::MAX
            .rem_vartime(modulus.as_nz_ref())
            .wrapping_add(&Uint::ONE);

        // `R^2 mod modulus`, used to convert integers to Montgomery form.
        let r2 = one.square_mod_vartime(modulus.as_nz_ref());

        // The inverse of the modulus modulo 2**64
        let mod_inv = U64::from_u64(modulus.as_uint_ref().invert_mod_u64());

        let mod_leading_zeros = modulus.as_ref().leading_zeros_vartime();
        let mod_leading_zeros = if mod_leading_zeros < Word::BITS - 1 {
            mod_leading_zeros
        } else {
            Word::BITS - 1
        };

        Self {
            modulus,
            one,
            r2,
            mod_inv,
            mod_leading_zeros,
        }
    }
}

#[cfg(feature = "alloc")]
pub(crate) mod boxed {
    use super::MontyParams;
    use crate::{Limb, Odd, U64, Word};
    use alloc::sync::Arc;
    use core::fmt::{self, Debug};

    /// Parameters to efficiently go to/from the Montgomery form for an odd modulus whose size and value
    /// are both chosen at runtime.
    #[derive(Clone, Eq, PartialEq)]
    pub struct BoxedMontyParams(Arc<MontyParams<crate::uint::boxed::BoxedUint>>);

    impl BoxedMontyParams {
        /// Instantiates a new set of [`BoxedMontyParams`] representing the given `modulus`.
        ///
        /// TODO(tarcieri): DRY out with `MontyParams::new`?
        #[must_use]
        pub fn new(modulus: Odd<crate::uint::boxed::BoxedUint>) -> Self {
            let bits_precision = modulus.bits_precision();

            // `R mod modulus` where `R = 2^BITS`.
            // Represents 1 in Montgomery form.
            let one = crate::uint::boxed::BoxedUint::max(bits_precision)
                .rem(modulus.as_nz_ref())
                .wrapping_add(Limb::ONE);

            // `R^2 mod modulus`, used to convert integers to Montgomery form.
            let r2 = one.square_mod(modulus.as_nz_ref());

            // The inverse of the modulus modulo 2**64
            let mod_inv = U64::from_u64(modulus.as_uint_ref().invert_mod_u64());

            let mod_leading_zeros = modulus.as_ref().leading_zeros().min(Word::BITS - 1);

            Self(
                MontyParams {
                    modulus,
                    one,
                    r2,
                    mod_inv,
                    mod_leading_zeros,
                }
                .into(),
            )
        }

        /// Instantiates a new set of [`BoxedMontyParams`] representing the given `modulus`.
        /// This version operates in variable-time with respect to the modulus.
        ///
        /// TODO(tarcieri): DRY out with `MontyParams::new_vartime`?
        #[must_use]
        pub fn new_vartime(modulus: Odd<crate::uint::boxed::BoxedUint>) -> Self {
            let bits_precision = modulus.bits_precision();

            // `R mod modulus` where `R = 2^BITS`.
            // Represents 1 in Montgomery form.
            let one = crate::uint::boxed::BoxedUint::max(bits_precision)
                .rem_vartime(modulus.as_nz_ref())
                .wrapping_add(Limb::ONE);

            // `R^2 mod modulus`, used to convert integers to Montgomery form.
            let r2 = one.square_mod_vartime(modulus.as_nz_ref());

            // The inverse of the modulus modulo 2**64
            let mod_inv = U64::from_u64(modulus.as_uint_ref().invert_mod_u64());

            let mod_leading_zeros = modulus.as_ref().leading_zeros().min(Word::BITS - 1);

            Self(
                MontyParams {
                    modulus,
                    one,
                    r2,
                    mod_inv,
                    mod_leading_zeros,
                }
                .into(),
            )
        }

        /// Modulus value.
        #[must_use]
        pub fn modulus(&self) -> &Odd<crate::uint::boxed::BoxedUint> {
            &self.0.modulus
        }

        /// Bits of precision in the modulus.
        #[must_use]
        pub fn bits_precision(&self) -> u32 {
            self.0.modulus.bits_precision()
        }

        pub(crate) fn r2(&self) -> &crate::uint::boxed::BoxedUint {
            &self.0.r2
        }

        pub(crate) fn one(&self) -> &crate::uint::boxed::BoxedUint {
            &self.0.one
        }

        pub(crate) fn mod_inv(&self) -> U64 {
            self.0.mod_inv
        }

        pub(crate) fn mod_neg_inv(&self) -> Limb {
            self.0.mod_inv.limbs[0].wrapping_neg()
        }

        pub(crate) fn mod_leading_zeros(&self) -> u32 {
            self.0.mod_leading_zeros
        }
    }

    impl AsRef<MontyParams<crate::uint::boxed::BoxedUint>> for BoxedMontyParams {
        fn as_ref(&self) -> &MontyParams<crate::uint::boxed::BoxedUint> {
            &self.0
        }
    }

    impl Debug for BoxedMontyParams {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            self.0.debug_struct(f.debug_struct("BoxedMontyParams"))
        }
    }

    impl From<MontyParams<crate::uint::boxed::BoxedUint>> for BoxedMontyParams {
        fn from(params: MontyParams<crate::uint::boxed::BoxedUint>) -> Self {
            Self(params.into())
        }
    }
}
