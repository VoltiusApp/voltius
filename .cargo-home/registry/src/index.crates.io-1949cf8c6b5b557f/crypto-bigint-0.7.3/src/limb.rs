//! Big integers are represented as an array of smaller CPU word-size integers
//! called "limbs".

mod add;
mod bit_and;
mod bit_not;
mod bit_or;
mod bit_xor;
mod bits;
mod cmp;
mod ct;
mod div;
mod encoding;
mod from;
mod gcd;
mod mul;
mod neg;
mod shl;
mod shr;
mod sqrt;
mod sub;

#[cfg(feature = "rand_core")]
mod rand;

use crate::{
    Bounded, Choice, ConstOne, ConstZero, Constants, CtEq, CtOption, Integer, NonZero, One,
    UintRef, Unsigned, WideWord, Word, Zero, primitives::u32_bits, traits::sealed::Sealed, word,
};
use core::{fmt, ptr, slice};

#[cfg(feature = "serde")]
use serdect::serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Calculate the number of limbs required to represent the given number of bits.
// TODO(tarcieri): replace with `generic_const_exprs` (rust-lang/rust#76560) when stable
#[inline(always)]
#[must_use]
pub const fn nlimbs(bits: u32) -> usize {
    match cpubits::CPUBITS {
        32 => ((bits + 31) >> 5) as usize,
        64 => ((bits + 63) >> 6) as usize,
        _ => unreachable!(),
    }
}

/// Big integers are represented as an array/vector of smaller CPU word-size integers called
/// "limbs".
///
/// The [`Limb`] type uses a 32-bit or 64-bit saturated representation, depending on the target.
/// All bits of an inner [`Word`] are used to represent larger big integer types.
// Our PartialEq impl only differs from the default one by being constant-time, so this is safe
#[allow(clippy::derived_hash_with_manual_eq)]
#[derive(Copy, Clone, Default, Hash)]
#[repr(transparent)]
pub struct Limb(pub Word);

impl Limb {
    /// The value `0`.
    pub const ZERO: Self = Limb(0);

    /// The value `1`.
    pub const ONE: Self = Limb(1);

    /// Maximum value this [`Limb`] can express.
    pub const MAX: Self = Limb(Word::MAX);

    /// Highest bit in a [`Limb`].
    pub(crate) const HI_BIT: u32 = Limb::BITS - 1;

    cpubits::cpubits! {
        32 => {
            /// Size of the inner integer in bits.
            pub const BITS: u32 = 32;
            /// Size of the inner integer in bytes.
            pub const BYTES: usize = 4;
        }
        64 => {
            /// Size of the inner integer in bits.
            pub const BITS: u32 = 64;
            /// Size of the inner integer in bytes.
            pub const BYTES: usize = 8;
        }
    }

    /// `floor(log2(Self::BITS))`.
    pub const LOG2_BITS: u32 = u32_bits(Self::BITS - 1);

    /// Is this limb equal to [`Limb::ZERO`]?
    #[must_use]
    pub const fn is_zero(&self) -> Choice {
        word::choice_from_nz(self.0).not()
    }

    /// Convert to a [`NonZero<Limb>`].
    ///
    /// Returns some if the original value is non-zero, and false otherwise.
    #[must_use]
    pub const fn to_nz(self) -> CtOption<NonZero<Self>> {
        let is_nz = self.is_nonzero();

        // Use `1` as a placeholder in the event that `self` is `Limb(0)`
        let nz_word = word::select(1, self.0, is_nz);
        CtOption::new(NonZero(Self(nz_word)), is_nz)
    }

    /// Convert the least significant bit of this [`Limb`] to a [`Choice`].
    #[must_use]
    pub const fn lsb_to_choice(self) -> Choice {
        word::choice_from_lsb(self.0)
    }

    /// Convert a shared reference to an array of [`Limb`]s into a shared reference to their inner
    /// [`Word`]s for each limb.
    #[inline]
    #[must_use]
    pub const fn array_as_words<const N: usize>(array: &[Self; N]) -> &[Word; N] {
        // SAFETY: `Limb` is a `repr(transparent)` newtype for `Word`
        #[allow(unsafe_code)]
        unsafe {
            &*array.as_ptr().cast()
        }
    }

    /// Convert a mutable reference to an array of [`Limb`]s into a mutable reference to their inner
    /// [`Word`]s for each limb.
    #[inline]
    pub const fn array_as_mut_words<const N: usize>(array: &mut [Self; N]) -> &mut [Word; N] {
        // SAFETY: `Limb` is a `repr(transparent)` newtype for `Word`
        #[allow(unsafe_code)]
        unsafe {
            &mut *array.as_mut_ptr().cast()
        }
    }

    /// Convert a shared reference to an array of [`Limb`]s into a shared reference to their inner
    /// [`Word`]s for each limb.
    #[inline]
    #[must_use]
    pub const fn slice_as_words(slice: &[Self]) -> &[Word] {
        // SAFETY: `Limb` is a `repr(transparent)` newtype for `Word`
        #[allow(unsafe_code)]
        unsafe {
            &*(ptr::from_ref(slice) as *const [Word])
        }
    }

    /// Convert a mutable reference to an array of [`Limb`]s into a mutable reference to their inner
    /// [`Word`]s for each limb.
    #[inline]
    pub const fn slice_as_mut_words(slice: &mut [Self]) -> &mut [Word] {
        // SAFETY: `Limb` is a `repr(transparent)` newtype for `Word`
        #[allow(unsafe_code)]
        unsafe {
            &mut *(ptr::from_mut(slice) as *mut [Word])
        }
    }
}

impl AsRef<[Limb]> for Limb {
    #[inline(always)]
    fn as_ref(&self) -> &[Limb] {
        slice::from_ref(self)
    }
}

impl AsMut<[Limb]> for Limb {
    #[inline(always)]
    fn as_mut(&mut self) -> &mut [Limb] {
        slice::from_mut(self)
    }
}

impl AsRef<UintRef> for Limb {
    #[inline(always)]
    fn as_ref(&self) -> &UintRef {
        UintRef::new(slice::from_ref(self))
    }
}

impl AsMut<UintRef> for Limb {
    #[inline(always)]
    fn as_mut(&mut self) -> &mut UintRef {
        UintRef::new_mut(slice::from_mut(self))
    }
}

impl Bounded for Limb {
    const BITS: u32 = Self::BITS;
    const BYTES: usize = Self::BYTES;
}

impl Constants for Limb {
    const MAX: Self = Self::MAX;
}

impl ConstZero for Limb {
    const ZERO: Self = Self::ZERO;
}

impl ConstOne for Limb {
    const ONE: Self = Self::ONE;
}

impl Zero for Limb {
    #[inline(always)]
    fn zero() -> Self {
        Self::ZERO
    }
}

impl One for Limb {
    #[inline(always)]
    fn one() -> Self {
        Self::ONE
    }
}

impl num_traits::Zero for Limb {
    fn zero() -> Self {
        Self::ZERO
    }

    fn is_zero(&self) -> bool {
        self.ct_eq(&Self::ZERO).into()
    }
}

impl num_traits::One for Limb {
    fn one() -> Self {
        Self::ONE
    }

    fn is_one(&self) -> bool {
        self.ct_eq(&Self::ONE).into()
    }
}

impl Integer for Limb {
    #[inline]
    fn as_limbs(&self) -> &[Limb] {
        self.as_ref()
    }

    #[inline]
    fn as_mut_limbs(&mut self) -> &mut [Limb] {
        self.as_mut()
    }

    #[inline]
    fn nlimbs(&self) -> usize {
        1
    }

    fn is_even(&self) -> Choice {
        (*self).is_odd().not()
    }

    fn is_odd(&self) -> Choice {
        (*self).is_odd()
    }
}

impl Sealed for Limb {}

impl Unsigned for Limb {
    #[inline]
    fn as_uint_ref(&self) -> &UintRef {
        self.as_ref()
    }

    #[inline]
    fn as_mut_uint_ref(&mut self) -> &mut UintRef {
        self.as_mut()
    }

    #[inline]
    fn from_limb_like(limb: Limb, _other: &Self) -> Self {
        limb
    }
}

impl fmt::Debug for Limb {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Limb(0x{self:X})")
    }
}

impl fmt::Display for Limb {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::UpperHex::fmt(self, f)
    }
}

impl fmt::Binary for Limb {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if f.alternate() {
            write!(f, "0b")?;
        }

        write!(f, "{:0width$b}", &self.0, width = Self::BITS as usize)
    }
}

impl fmt::Octal for Limb {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if f.alternate() {
            write!(f, "0o")?;
        }
        write!(
            f,
            "{:0width$o}",
            &self.0,
            width = Self::BITS.div_ceil(3) as usize
        )
    }
}

impl fmt::LowerHex for Limb {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if f.alternate() {
            write!(f, "0x")?;
        }
        write!(f, "{:0width$x}", &self.0, width = Self::BYTES * 2)
    }
}

impl fmt::UpperHex for Limb {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if f.alternate() {
            write!(f, "0x")?;
        }
        write!(f, "{:0width$X}", &self.0, width = Self::BYTES * 2)
    }
}

#[cfg(feature = "serde")]
impl<'de> Deserialize<'de> for Limb {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(Self(Word::deserialize(deserializer)?))
    }
}

#[cfg(feature = "serde")]
impl Serialize for Limb {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.serialize(serializer)
    }
}

#[cfg(feature = "zeroize")]
impl zeroize::DefaultIsZeroes for Limb {}

#[cfg(test)]
mod tests {
    use super::Limb;
    #[cfg(feature = "alloc")]
    use alloc::format;

    cpubits::cpubits! {
        32 => {
            #[test]
            fn nlimbs_for_bits_macro() {
                assert_eq!(super::nlimbs(64), 2);
                assert_eq!(super::nlimbs(65), 3);
                assert_eq!(super::nlimbs(128), 4);
                assert_eq!(super::nlimbs(129), 5);
                assert_eq!(super::nlimbs(192), 6);
                assert_eq!(super::nlimbs(193), 7);
                assert_eq!(super::nlimbs(256), 8);
                assert_eq!(super::nlimbs(257), 9);
            }
        }
        64 => {
            #[test]
            fn nlimbs_for_bits_macro() {
                assert_eq!(super::nlimbs(64), 1);
                assert_eq!(super::nlimbs(65), 2);
                assert_eq!(super::nlimbs(128), 2);
                assert_eq!(super::nlimbs(129), 3);
                assert_eq!(super::nlimbs(192), 3);
                assert_eq!(super::nlimbs(193), 4);
                assert_eq!(super::nlimbs(256), 4);
            }
        }
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn debug() {
        cpubits::cpubits! {
            32 => { assert_eq!(format!("{:?}", Limb(42)), "Limb(0x0000002A)"); }
            64 => { assert_eq!(format!("{:?}", Limb(42)), "Limb(0x000000000000002A)"); }
        }
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn binary() {
        cpubits::cpubits! {
            32 => {
                assert_eq!(
                    format!("{:b}", Limb(42)),
                    "00000000000000000000000000101010"
                );
                assert_eq!(
                    format!("{:#b}", Limb(42)),
                    "0b00000000000000000000000000101010"
                );
            }
            64 => {
                assert_eq!(
                    format!("{:b}", Limb(42)),
                    "0000000000000000000000000000000000000000000000000000000000101010"
                );
                assert_eq!(
                    format!("{:#b}", Limb(42)),
                    "0b0000000000000000000000000000000000000000000000000000000000101010"
                );
            }
        }
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn octal() {
        cpubits::cpubits! {
            32 => {
                assert_eq!(format!("{:o}", Limb(42)), "00000000052");
                assert_eq!(format!("{:#o}", Limb(42)), "0o00000000052");
            }
            64 => {
                assert_eq!(format!("{:o}", Limb(42)), "0000000000000000000052");
                assert_eq!(format!("{:#o}", Limb(42)), "0o0000000000000000000052");
            }
        }
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn lower_hex() {
        cpubits::cpubits! {
            32 => {
                assert_eq!(format!("{:x}", Limb(42)), "0000002a");
                assert_eq!(format!("{:#x}", Limb(42)), "0x0000002a");
            }
            64 => {
                assert_eq!(format!("{:x}", Limb(42)), "000000000000002a");
                assert_eq!(format!("{:#x}", Limb(42)), "0x000000000000002a");
            }
        }
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn upper_hex() {
        cpubits::cpubits! {
            32 => {
                assert_eq!(format!("{:X}", Limb(42)), "0000002A");
                assert_eq!(format!("{:#X}", Limb(42)), "0x0000002A");
            }
            64 => {
                assert_eq!(format!("{:X}", Limb(42)), "000000000000002A");
                assert_eq!(format!("{:#X}", Limb(42)), "0x000000000000002A");
            }
        }
    }

    #[test]
    fn test_unsigned() {
        crate::traits::tests::test_unsigned(Limb::ZERO, Limb::MAX);
    }
}
