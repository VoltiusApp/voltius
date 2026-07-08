//! Traits provided by this crate

pub use core::ops::{
    Add, AddAssign, BitAnd, BitAndAssign, BitOr, BitOrAssign, BitXor, BitXorAssign, Div, DivAssign,
    Mul, MulAssign, Neg, Not, Rem, RemAssign, Shl, ShlAssign, Shr, ShrAssign, Sub, SubAssign,
};
pub use ctutils::{CtAssign, CtEq, CtGt, CtLt, CtNeg, CtSelect};
pub use num_traits::{
    ConstOne, ConstZero, WrappingAdd, WrappingMul, WrappingNeg, WrappingShl, WrappingShr,
    WrappingSub,
};

use crate::{
    Choice, CtOption, Limb, NonZero, Odd, Reciprocal, UintRef,
    modular::{MontyParams, Retrieve},
    primitives::u32_bits,
};
use core::fmt::{self, Debug};

#[cfg(feature = "rand_core")]
use rand_core::{Rng, TryRng};

/// Integers whose representation takes a bounded amount of space.
pub trait Bounded {
    /// Size of this integer in bits.
    const BITS: u32;

    /// Size of this integer in bytes.
    const BYTES: usize;
}

/// Integer trait: represents common functionality of integer types provided by this crate.
pub trait Integer:
    'static
    + sealed::Sealed
    + Add<Output = Self>
    + for<'a> Add<&'a Self, Output = Self>
    + AddAssign<Self>
    + for<'a> AddAssign<&'a Self>
    + AsRef<[Limb]>
    + AsMut<[Limb]>
    + BitAnd<Output = Self>
    + for<'a> BitAnd<&'a Self, Output = Self>
    + BitAndAssign
    + for<'a> BitAndAssign<&'a Self>
    + BitOr<Output = Self>
    + for<'a> BitOr<&'a Self, Output = Self>
    + BitOrAssign
    + for<'a> BitOrAssign<&'a Self>
    + BitXor<Output = Self>
    + for<'a> BitXor<&'a Self, Output = Self>
    + BitXorAssign
    + for<'a> BitXorAssign<&'a Self>
    + CheckedAdd
    + CheckedSub
    + CheckedMul
    + CheckedDiv
    + CheckedSquareRoot<Output = Self>
    + Clone
    + CtAssign
    + CtEq
    + CtGt
    + CtLt
    + CtSelect
    + Debug
    + Default
    + DivAssign<NonZero<Self>>
    + for<'a> DivAssign<&'a NonZero<Self>>
    + Eq
    + fmt::LowerHex
    + fmt::UpperHex
    + fmt::Binary
    + Mul<Output = Self>
    + for<'a> Mul<&'a Self, Output = Self>
    + MulAssign<Self>
    + for<'a> MulAssign<&'a Self>
    + Not<Output = Self>
    + One
    + Ord
    + Rem<NonZero<Self>, Output = Self>
    + for<'a> Rem<&'a NonZero<Self>, Output = Self>
    + RemAssign<NonZero<Self>>
    + for<'a> RemAssign<&'a NonZero<Self>>
    + Send
    + Sized
    + Shl<u32, Output = Self>
    + ShlAssign<u32>
    + ShlVartime
    + Shr<u32, Output = Self>
    + ShrAssign<u32>
    + ShrVartime
    + Sub<Output = Self>
    + for<'a> Sub<&'a Self, Output = Self>
    + SubAssign<Self>
    + for<'a> SubAssign<&'a Self>
    + Sync
    + WrappingAdd
    + WrappingSub
    + WrappingMul
    + WrappingNeg
    + WrappingShl
    + WrappingShr
    + Zero
{
    /// Borrow the raw limbs used to represent this integer.
    #[must_use]
    fn as_limbs(&self) -> &[Limb];

    /// Mutably borrow the raw limbs used to represent this integer.
    #[must_use]
    fn as_mut_limbs(&mut self) -> &mut [Limb];

    /// Number of limbs in this integer.
    #[must_use]
    fn nlimbs(&self) -> usize;

    /// Is this integer value an odd number?
    ///
    /// # Returns
    ///
    /// If odd, returns `Choice::FALSE`. Otherwise, returns `Choice::TRUE`.
    #[must_use]
    fn is_odd(&self) -> Choice {
        self.as_ref()
            .first()
            .copied()
            .map_or(Choice::FALSE, Limb::is_odd)
    }

    /// Is this integer value an even number?
    ///
    /// # Returns
    ///
    /// If even, returns `Choice(1)`. Otherwise, returns `Choice(0)`.
    #[must_use]
    fn is_even(&self) -> Choice {
        !self.is_odd()
    }
}

/// Signed [`Integer`]s.
pub trait Signed:
    Div<NonZero<Self>, Output = CtOption<Self>>
    + for<'a> Div<&'a NonZero<Self>, Output = CtOption<Self>>
    + From<i8>
    + From<i16>
    + From<i32>
    + From<i64>
    + Gcd<Output = Self::Unsigned>
    + Integer // + CtNeg TODO(tarcieri)
{
    /// Corresponding unsigned integer type.
    type Unsigned: Unsigned;

    /// The sign and magnitude of this [`Signed`].
    #[must_use]
    fn abs_sign(&self) -> (Self::Unsigned, Choice);

    /// The magnitude of this [`Signed`].
    #[must_use]
    fn abs(&self) -> Self::Unsigned {
        self.abs_sign().0
    }

    /// Whether this [`Signed`] is negative (and non-zero), as a [`Choice`].
    #[must_use]
    fn is_negative(&self) -> Choice;

    /// Whether this [`Signed`] is positive (and non-zero), as a [`Choice`].
    #[must_use]
    fn is_positive(&self) -> Choice;
}

/// Unsigned [`Integer`]s.
pub trait Unsigned:
    AsRef<UintRef>
    + AsMut<UintRef>
    + AddMod<Output = Self>
    + BitOps
    + Div<NonZero<Self>, Output = Self>
    + for<'a> Div<&'a NonZero<Self>, Output = Self>
    + DivRemLimb
    + FloorSquareRoot<Output = Self>
    + From<u8>
    + From<u16>
    + From<u32>
    + From<u64>
    + From<Limb>
    + Gcd<Output = Self>
    + Integer
    + MulMod<Output = Self>
    + NegMod<Output = Self>
    + RemLimb
    + SquareMod<Output = Self>
    + SubMod<Output = Self>
{
    /// Borrow the limbs of this unsigned integer as a [`UintRef`].
    #[must_use]
    fn as_uint_ref(&self) -> &UintRef;

    /// Mutably borrow the limbs of this unsigned integer as a [`UintRef`].
    fn as_mut_uint_ref(&mut self) -> &mut UintRef;

    /// Returns an integer with the first limb set to `limb`, and the same precision as `other`.
    #[must_use]
    fn from_limb_like(limb: Limb, other: &Self) -> Self;
}

/// [`Unsigned`] integers with an associated [`MontyForm`].
pub trait UnsignedWithMontyForm: Unsigned {
    /// The corresponding Montgomery representation,
    /// optimized for the performance of modular operations at the price of a conversion overhead.
    type MontyForm: MontyForm<Integer = Self>;
}

/// Support for upgrading `UintRef`-compatible references into `Unsigned`.
pub trait ToUnsigned: AsRef<UintRef> + AsMut<UintRef> {
    /// The corresponding owned `Unsigned` type.
    type Unsigned: Unsigned;

    /// Convert from a reference into an owned instance.
    fn to_unsigned(&self) -> Self::Unsigned;

    /// Convert from a reference into an owned instance representing zero.
    fn to_unsigned_zero(&self) -> Self::Unsigned {
        let mut res = self.to_unsigned();
        res.set_zero();
        res
    }
}

impl<T: Unsigned> ToUnsigned for T {
    type Unsigned = T;

    fn to_unsigned(&self) -> Self::Unsigned {
        self.clone()
    }

    fn to_unsigned_zero(&self) -> Self::Unsigned {
        T::zero_like(self)
    }
}

/// Zero values: additive identity element for `Self`.
pub trait Zero: CtEq + Sized {
    /// Returns the additive identity element of `Self`, `0`.
    #[must_use]
    fn zero() -> Self;

    /// Determine if this value is equal to `0`.
    ///
    /// # Returns
    ///
    /// If zero, returns `Choice(1)`. Otherwise, returns `Choice(0)`.
    #[inline]
    #[must_use]
    fn is_zero(&self) -> Choice {
        self.ct_eq(&Self::zero())
    }

    /// Set `self` to its additive identity, i.e. `Self::zero`.
    #[inline]
    fn set_zero(&mut self) {
        *self = Zero::zero();
    }

    /// Return the value `0` with the same precision as `other`.
    #[must_use]
    fn zero_like(other: &Self) -> Self
    where
        Self: Clone,
    {
        let mut ret = other.clone();
        ret.set_zero();
        ret
    }
}

/// One values: multiplicative identity element for `Self`.
pub trait One: CtEq + Sized {
    /// Returns the multiplicative identity element of `Self`, `1`.
    #[must_use]
    fn one() -> Self;

    /// Determine if this value is equal to `1`.
    ///
    /// # Returns
    ///
    /// If one, returns `Choice(1)`. Otherwise, returns `Choice(0)`.
    #[inline]
    #[must_use]
    fn is_one(&self) -> Choice {
        self.ct_eq(&Self::one())
    }

    /// Set `self` to its multiplicative identity, i.e. `Self::one`.
    #[inline]
    fn set_one(&mut self) {
        *self = One::one();
    }

    /// Return the value `0` with the same precision as `other`.
    #[must_use]
    fn one_like(_other: &Self) -> Self {
        One::one()
    }
}

/// Trait for associating constant values with a type.
pub trait Constants: ConstZero + ConstOne {
    /// Maximum value this integer can express.
    const MAX: Self;
}

/// Fixed-width [`Integer`]s.
pub trait FixedInteger: Bounded + Constants + Copy + Integer {
    /// The number of limbs used on this platform.
    const LIMBS: usize;
}

/// Compute the greatest common divisor of two integers.
pub trait Gcd<Rhs = Self>: Sized {
    /// Output type.
    type Output;

    /// Compute the greatest common divisor of `self` and `rhs`.
    #[must_use]
    fn gcd(&self, rhs: &Rhs) -> Self::Output;

    /// Compute the greatest common divisor of `self` and `rhs` in variable time.
    #[must_use]
    fn gcd_vartime(&self, rhs: &Rhs) -> Self::Output;
}

/// Compute the extended greatest common divisor of two integers.
pub trait Xgcd<Rhs = Self>: Sized {
    /// Output type.
    type Output;

    /// Compute the extended greatest common divisor of `self` and `rhs`.
    #[must_use]
    fn xgcd(&self, rhs: &Rhs) -> Self::Output;

    /// Compute the extended greatest common divisor of `self` and `rhs` in variable time.
    #[must_use]
    fn xgcd_vartime(&self, rhs: &Rhs) -> Self::Output;
}

/// Random number generation support.
#[cfg(feature = "rand_core")]
pub trait Random: Sized {
    /// Generate a random value.
    ///
    /// If `rng` is a CSRNG, the generation is cryptographically secure as well.
    ///
    /// # Errors
    /// - Returns `R::Error` in the event the RNG experienced an internal failure.
    fn try_random_from_rng<R: TryRng + ?Sized>(rng: &mut R) -> Result<Self, R::Error>;

    /// Generate a random value.
    ///
    /// If `rng` is a CSRNG, the generation is cryptographically secure as well.
    #[must_use]
    fn random_from_rng<R: Rng + ?Sized>(rng: &mut R) -> Self {
        let Ok(out) = Self::try_random_from_rng(rng);
        out
    }

    /// Randomly generate a value of this type using the system's ambient cryptographically secure
    /// random number generator.
    ///
    /// # Errors
    /// Returns [`getrandom::Error`] in the event the system's ambient RNG experiences an internal
    /// failure.
    #[cfg(feature = "getrandom")]
    fn try_random() -> Result<Self, getrandom::Error> {
        Self::try_random_from_rng(&mut getrandom::SysRng)
    }

    /// Randomly generate a value of this type using the system's ambient cryptographically secure
    /// random number generator.
    ///
    /// # Panics
    /// This method will panic in the event the system's ambient RNG experiences an internal
    /// failure.
    ///
    /// This shouldn't happen on most modern operating systems.
    #[cfg(feature = "getrandom")]
    #[must_use]
    fn random() -> Self {
        Self::try_random().expect("RNG failure")
    }
}

/// Possible errors of the methods in [`RandomBits`] trait.
#[cfg(feature = "rand_core")]
#[derive(Debug)]
pub enum RandomBitsError<T> {
    /// An error of the internal RNG library.
    RandCore(T),
    /// The requested `bits_precision` does not match the size of the integer
    /// corresponding to the type (in the cases where this is set in compile time).
    BitsPrecisionMismatch {
        /// The requested precision.
        bits_precision: u32,
        /// The compile-time size of the integer.
        integer_bits: u32,
    },
    /// The requested `bit_length` is larger than `bits_precision`.
    BitLengthTooLarge {
        /// The requested bit length of the random number.
        bit_length: u32,
        /// The requested precision.
        bits_precision: u32,
    },
}

#[cfg(feature = "rand_core")]
impl<T> fmt::Display for RandomBitsError<T>
where
    T: fmt::Display,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RandCore(err) => write!(f, "{err}"),
            Self::BitsPrecisionMismatch {
                bits_precision,
                integer_bits,
            } => write!(
                f,
                concat![
                    "The requested `bits_precision` ({}) does not match ",
                    "the size of the integer corresponding to the type ({})"
                ],
                bits_precision, integer_bits
            ),
            Self::BitLengthTooLarge {
                bit_length,
                bits_precision,
            } => write!(
                f,
                "The requested `bit_length` ({bit_length}) is larger than `bits_precision` ({bits_precision}).",
            ),
        }
    }
}

#[cfg(feature = "rand_core")]
impl<T> core::error::Error for RandomBitsError<T> where T: Debug + fmt::Display {}

/// Random bits generation support.
#[cfg(feature = "rand_core")]
pub trait RandomBits: Sized {
    /// Generate a random value in range `[0, 2^bit_length)`.
    ///
    /// A wrapper for [`RandomBits::try_random_bits`] that panics on error.
    #[must_use]
    fn random_bits<R: TryRng + ?Sized>(rng: &mut R, bit_length: u32) -> Self {
        Self::try_random_bits(rng, bit_length).expect("try_random_bits() failed")
    }

    /// Generate a random value in range `[0, 2^bit_length)`.
    ///
    /// This method is variable time wrt `bit_length`.
    ///
    /// If `rng` is a CSRNG, the generation is cryptographically secure as well.
    ///
    /// # Errors
    /// - Returns `R::Error` in the event the RNG experienced an internal failure.
    fn try_random_bits<R: TryRng + ?Sized>(
        rng: &mut R,
        bit_length: u32,
    ) -> Result<Self, RandomBitsError<R::Error>>;

    /// Generate a random value in range `[0, 2^bit_length)`,
    /// returning an integer with the closest available size to `bits_precision`
    /// (if the implementing type supports runtime sizing).
    ///
    /// A wrapper for [`RandomBits::try_random_bits_with_precision`] that panics on error.
    #[must_use]
    #[track_caller]
    fn random_bits_with_precision<R: TryRng + ?Sized>(
        rng: &mut R,
        bit_length: u32,
        bits_precision: u32,
    ) -> Self {
        Self::try_random_bits_with_precision(rng, bit_length, bits_precision)
            .expect("try_random_bits_with_precision() failed")
    }

    /// Generate a random value in range `[0, 2^bit_length)`,
    /// returning an integer with the closest available size to `bits_precision`
    /// (if the implementing type supports runtime sizing).
    ///
    /// This method is variable time wrt `bit_length`.
    ///
    /// If `rng` is a CSRNG, the generation is cryptographically secure as well.
    ///
    /// # Errors
    /// - Returns `R::Error` in the event the RNG experienced an internal failure.
    fn try_random_bits_with_precision<R: TryRng + ?Sized>(
        rng: &mut R,
        bit_length: u32,
        bits_precision: u32,
    ) -> Result<Self, RandomBitsError<R::Error>>;
}

/// Modular random number generation support.
#[cfg(feature = "rand_core")]
pub trait RandomMod: Sized + Zero {
    /// Generate a random number which is less than a given `modulus`.
    ///
    /// This uses rejection sampling.
    ///
    /// As a result, it runs in variable time that depends in part on
    /// `modulus`. If the generator `rng` is cryptographically secure (for
    /// example, it implements `CryptoRng`), then this is guaranteed not to
    /// leak anything about the output value aside from it being less than
    /// `modulus`.
    #[must_use]
    fn random_mod_vartime<R: Rng + ?Sized>(rng: &mut R, modulus: &NonZero<Self>) -> Self {
        let Ok(out) = Self::try_random_mod_vartime(rng, modulus);
        out
    }

    /// Generate a random number which is less than a given `modulus`.
    ///
    /// This uses rejection sampling.
    ///
    /// As a result, it runs in variable time that depends in part on
    /// `modulus`. If the generator `rng` is cryptographically secure (for
    /// example, it implements `CryptoRng`), then this is guaranteed not to
    /// leak anything about the output value aside from it being less than
    /// `modulus`.
    ///
    /// # Errors
    /// - Returns `R::Error` in the event the RNG experienced an internal failure.
    fn try_random_mod_vartime<R: TryRng + ?Sized>(
        rng: &mut R,
        modulus: &NonZero<Self>,
    ) -> Result<Self, R::Error>;

    /// Generate a random number which is less than a given `modulus`.
    ///
    /// This uses rejection sampling.
    ///
    /// As a result, it runs in variable time that depends in part on
    /// `modulus`. If the generator `rng` is cryptographically secure (for
    /// example, it implements `CryptoRng`), then this is guaranteed not to
    /// leak anything about the output value aside from it being less than
    /// `modulus`.
    #[deprecated(since = "0.7.0", note = "please use `random_mod_vartime` instead")]
    #[must_use]
    fn random_mod<R: Rng + ?Sized>(rng: &mut R, modulus: &NonZero<Self>) -> Self {
        Self::random_mod_vartime(rng, modulus)
    }

    /// Generate a random number which is less than a given `modulus`.
    ///
    /// This uses rejection sampling.
    ///
    /// As a result, it runs in variable time that depends in part on
    /// `modulus`. If the generator `rng` is cryptographically secure (for
    /// example, it implements `CryptoRng`), then this is guaranteed not to
    /// leak anything about the output value aside from it being less than
    /// `modulus`.
    ///
    /// # Errors
    /// - Returns `R::Error` in the event the RNG experienced an internal failure.
    #[deprecated(since = "0.7.0", note = "please use `try_random_mod_vartime` instead")]
    fn try_random_mod<R: TryRng + ?Sized>(
        rng: &mut R,
        modulus: &NonZero<Self>,
    ) -> Result<Self, R::Error> {
        Self::try_random_mod_vartime(rng, modulus)
    }
}

/// Compute `self + rhs mod p`.
pub trait AddMod<Rhs = Self, Mod = NonZero<Self>> {
    /// Output type.
    type Output;

    /// Compute `self + rhs mod p`.
    ///
    /// Assumes `self` and `rhs` are `< p`.
    #[must_use]
    fn add_mod(&self, rhs: &Rhs, p: &Mod) -> Self::Output;
}

/// Compute `self - rhs mod p`.
pub trait SubMod<Rhs = Self, Mod = NonZero<Self>> {
    /// Output type.
    type Output;

    /// Compute `self - rhs mod p`.
    ///
    /// Assumes `self` and `rhs` are `< p`.
    #[must_use]
    fn sub_mod(&self, rhs: &Rhs, p: &Mod) -> Self::Output;
}

/// Compute `-self mod p`.
pub trait NegMod<Mod = NonZero<Self>> {
    /// Output type.
    type Output;

    /// Compute `-self mod p`.
    #[must_use]
    fn neg_mod(&self, p: &Mod) -> Self::Output;
}

/// Compute `self * rhs mod p`.
pub trait MulMod<Rhs = Self, Mod = NonZero<Self>> {
    /// Output type.
    type Output;

    /// Compute `self * rhs mod p`.
    #[must_use]
    fn mul_mod(&self, rhs: &Rhs, p: &Mod) -> Self::Output;
}

/// Compute `self * self mod p`.
pub trait SquareMod<Mod = NonZero<Self>> {
    /// Output type.
    type Output;

    /// Compute `self * self mod p`.
    #[must_use]
    fn square_mod(&self, p: &Mod) -> Self::Output;
}

/// Compute `1 / self mod p`.
#[deprecated(since = "0.7.0", note = "please use `InvertMod` instead")]
pub trait InvMod<Rhs = Self>: Sized {
    /// Output type.
    type Output;

    /// Compute `1 / self mod p`.
    #[must_use]
    fn inv_mod(&self, p: &Rhs) -> CtOption<Self::Output>;
}

#[allow(deprecated)]
impl<T, Rhs> InvMod<Rhs> for T
where
    T: InvertMod<Rhs>,
{
    type Output = <T as InvertMod<Rhs>>::Output;

    fn inv_mod(&self, p: &Rhs) -> CtOption<Self::Output> {
        self.invert_mod(p)
    }
}

/// Compute `1 / self mod p`.
pub trait InvertMod<Mod = NonZero<Self>>: Sized {
    /// Output type.
    type Output;

    /// Compute `1 / self mod p`.
    #[must_use]
    fn invert_mod(&self, p: &Mod) -> CtOption<Self::Output>;
}

/// Checked addition.
pub trait CheckedAdd<Rhs = Self>: Sized {
    /// Perform checked addition, returning a [`CtOption`] which `is_some` only if the operation
    /// did not overflow.
    #[must_use]
    fn checked_add(&self, rhs: &Rhs) -> CtOption<Self>;
}

/// Checked division.
pub trait CheckedDiv<Rhs = Self>: Sized {
    /// Perform checked division, returning a [`CtOption`] which `is_some` only if the divisor is
    /// non-zero.
    #[must_use]
    fn checked_div(&self, rhs: &Rhs) -> CtOption<Self>;
}

/// Checked multiplication.
pub trait CheckedMul<Rhs = Self>: Sized {
    /// Perform checked multiplication, returning a [`CtOption`] which `is_some`
    /// only if the operation did not overflow.
    #[must_use]
    fn checked_mul(&self, rhs: &Rhs) -> CtOption<Self>;
}

/// Checked subtraction.
pub trait CheckedSub<Rhs = Self>: Sized {
    /// Perform checked subtraction, returning a [`CtOption`] which `is_some`
    /// only if the operation did not underflow.
    #[must_use]
    fn checked_sub(&self, rhs: &Rhs) -> CtOption<Self>;
}

/// Define the result of concatenating two numbers into a "wide" value.
pub trait Concat<const HI: usize> {
    /// Concatenated output: having the width of `Self` plus `HI`.
    type Output: Integer;
}

/// Define the result of splitting a number into two parts, with the
/// first part having the width `LO`.
pub trait Split<const LO: usize> {
    /// High limbs of output: having the width of `Self` minus `LO`.
    type Output: Integer;
}

/// Define the result of splitting a number into two parts, with
/// each part having an equal width.
pub trait SplitEven {
    /// Split output: each component having half the width of `Self`.
    type Output: Integer;
}

/// Encoding support.
pub trait Encoding: Sized {
    /// Byte array representation.
    type Repr: AsRef<[u8]>
        + AsMut<[u8]>
        + Clone
        + Sized
        + for<'a> TryFrom<&'a [u8], Error: core::error::Error>;

    /// Decode from big endian bytes.
    #[must_use]
    fn from_be_bytes(bytes: Self::Repr) -> Self;

    /// Decode from little endian bytes.
    #[must_use]
    fn from_le_bytes(bytes: Self::Repr) -> Self;

    /// Encode to big endian bytes.
    #[must_use]
    fn to_be_bytes(&self) -> Self::Repr;

    /// Encode to little endian bytes.
    #[must_use]
    fn to_le_bytes(&self) -> Self::Repr;
}

/// A trait mapping between encoded representations of integers.
pub trait EncodedSize {
    /// The equivalent encoded representation.
    type Target;
}

/// Possible errors in variable-time integer decoding methods.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecodeError {
    /// The input value was empty.
    Empty,

    /// The input was not consistent with the format restrictions.
    InvalidDigit,

    /// Input size is too small to fit in the given precision.
    InputSize,

    /// The deserialized number is larger than the given precision.
    Precision,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "empty value provided"),
            Self::InvalidDigit => {
                write!(f, "invalid digit character")
            }
            Self::InputSize => write!(f, "input size is too small to fit in the given precision"),
            Self::Precision => write!(
                f,
                "the deserialized number is larger than the given precision"
            ),
        }
    }
}

impl core::error::Error for DecodeError {}

/// Support for optimized squaring
pub trait Square {
    /// Computes the same as `self * self`, but may be more efficient.
    #[must_use]
    fn square(&self) -> Self;
}

/// Support for optimized squaring in-place
pub trait SquareAssign {
    /// Computes the same as `self * self`, but may be more efficient.
    /// Writes the result in `self`.
    fn square_assign(&mut self);
}

/// Support for calculating checked square roots.
pub trait CheckedSquareRoot: Sized {
    /// Output of the square root operation.
    type Output;

    /// Computes `sqrt(self)`, returning `none` if no root exists.
    #[must_use]
    fn checked_sqrt(&self) -> CtOption<Self::Output>;

    /// Computes `sqrt(self)`, returning `none` if no root exists.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    fn checked_sqrt_vartime(&self) -> Option<Self::Output>;
}

/// Support for calculating floored square roots.
pub trait FloorSquareRoot: CheckedSquareRoot {
    /// Computes `floor(sqrt(self))`.
    #[must_use]
    fn floor_sqrt(&self) -> Self::Output;

    /// Computes `floor(sqrt(self))`.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    fn floor_sqrt_vartime(&self) -> Self::Output;
}

/// Support for optimized division by a single limb.
pub trait DivRemLimb: Sized {
    /// Computes `self / rhs` using a pre-made reciprocal,
    /// returns the quotient (q) and remainder (r).
    #[must_use]
    fn div_rem_limb(&self, rhs: NonZero<Limb>) -> (Self, Limb) {
        self.div_rem_limb_with_reciprocal(&Reciprocal::new(rhs))
    }

    /// Computes `self / rhs`, returns the quotient (q) and remainder (r).
    #[must_use]
    fn div_rem_limb_with_reciprocal(&self, reciprocal: &Reciprocal) -> (Self, Limb);
}

/// Support for calculating the remainder of two differently sized integers.
pub trait RemMixed<Reductor>: Sized {
    /// Calculate the remainder of `self` by the `reductor`.
    #[must_use]
    fn rem_mixed(&self, reductor: &NonZero<Reductor>) -> Reductor;
}

/// Modular reduction from a larger value `T`.
///
/// This can be seen as fixed modular reduction, where the modulus is fixed at compile time
/// by `Self`.
///
/// For modular reduction with a variable modulus, use [`Rem`].
pub trait Reduce<T>: Sized {
    /// Reduces `self` modulo `Modulus`.
    #[must_use]
    fn reduce(value: &T) -> Self;
}

/// Division in variable time.
pub trait DivVartime: Sized {
    /// Computes `self / rhs` in variable time.
    #[must_use]
    fn div_vartime(&self, rhs: &NonZero<Self>) -> Self;
}

/// Support for optimized division by a single limb.
pub trait RemLimb: Sized {
    /// Computes `self % rhs` using a pre-made reciprocal.
    #[must_use]
    fn rem_limb(&self, rhs: NonZero<Limb>) -> Limb {
        self.rem_limb_with_reciprocal(&Reciprocal::new(rhs))
    }

    /// Computes `self % rhs`.
    #[must_use]
    fn rem_limb_with_reciprocal(&self, reciprocal: &Reciprocal) -> Limb;
}

/// Bit counting and bit operations.
pub trait BitOps {
    /// Precision of this integer in bits.
    #[must_use]
    fn bits_precision(&self) -> u32;

    /// `floor(log2(self.bits_precision()))`.
    #[must_use]
    fn log2_bits(&self) -> u32 {
        u32_bits(self.bits_precision()) - 1
    }

    /// Precision of this integer in bytes.
    #[must_use]
    fn bytes_precision(&self) -> usize;

    /// Get the value of the bit at position `index`, as a truthy or falsy `Choice`.
    /// Returns the falsy value for indices out of range.
    #[must_use]
    fn bit(&self, index: u32) -> Choice;

    /// Sets the bit at `index` to 0 or 1 depending on the value of `bit_value`.
    fn set_bit(&mut self, index: u32, bit_value: Choice);

    /// Calculate the number of bits required to represent a given number.
    #[must_use]
    fn bits(&self) -> u32 {
        self.bits_precision() - self.leading_zeros()
    }

    /// Calculate the number of trailing zeros in the binary representation of this number.
    #[must_use]
    fn trailing_zeros(&self) -> u32;

    /// Calculate the number of trailing ones in the binary representation of this number.
    #[must_use]
    fn trailing_ones(&self) -> u32;

    /// Calculate the number of leading zeros in the binary representation of this number.
    #[must_use]
    fn leading_zeros(&self) -> u32;

    /// Returns `true` if the bit at position `index` is set, `false` otherwise.
    ///
    /// # Remarks
    /// This operation is variable time with respect to `index` only.
    #[must_use]
    fn bit_vartime(&self, index: u32) -> bool;

    /// Calculate the number of bits required to represent a given number in variable-time with
    /// respect to `self`.
    #[must_use]
    fn bits_vartime(&self) -> u32 {
        self.bits()
    }

    /// Sets the bit at `index` to 0 or 1 depending on the value of `bit_value`,
    /// variable time in `self`.
    fn set_bit_vartime(&mut self, index: u32, bit_value: bool);

    /// Calculate the number of leading zeros in the binary representation of this number.
    #[must_use]
    fn leading_zeros_vartime(&self) -> u32 {
        self.bits_precision() - self.bits_vartime()
    }

    /// Calculate the number of trailing zeros in the binary representation of this number in
    /// variable-time with respect to `self`.
    #[must_use]
    fn trailing_zeros_vartime(&self) -> u32 {
        self.trailing_zeros()
    }

    /// Calculate the number of trailing ones in the binary representation of this number,
    /// variable time in `self`.
    #[must_use]
    fn trailing_ones_vartime(&self) -> u32 {
        self.trailing_ones()
    }
}

/// Constant-time exponentiation.
pub trait Pow<Exponent> {
    /// Raises to the `exponent` power.
    #[must_use]
    fn pow(&self, exponent: &Exponent) -> Self;
}

impl<T: PowBoundedExp<Exponent>, Exponent: Unsigned> Pow<Exponent> for T {
    fn pow(&self, exponent: &Exponent) -> Self {
        self.pow_bounded_exp(exponent, exponent.bits_precision())
    }
}

/// Constant-time exponentiation with exponent of a bounded bit size.
pub trait PowBoundedExp<Exponent> {
    /// Raises to the `exponent` power,
    /// with `exponent_bits` representing the number of (least significant) bits
    /// to take into account for the exponent.
    ///
    /// NOTE: `exponent_bits` may be leaked in the time pattern.
    #[must_use]
    fn pow_bounded_exp(&self, exponent: &Exponent, exponent_bits: u32) -> Self;
}

/// Performs modular multi-exponentiation using Montgomery's ladder.
///
/// See: Straus, E. G. Problems and solutions: Addition chains of vectors. American Mathematical Monthly 71 (1964), 806–808.
pub trait MultiExponentiate<Exponent, BasesAndExponents>: Pow<Exponent> + Sized
where
    BasesAndExponents: AsRef<[(Self, Exponent)]> + ?Sized,
{
    /// Calculates `x1 ^ k1 * ... * xn ^ kn`.
    #[must_use]
    fn multi_exponentiate(bases_and_exponents: &BasesAndExponents) -> Self;
}

impl<T, Exponent, BasesAndExponents> MultiExponentiate<Exponent, BasesAndExponents> for T
where
    T: MultiExponentiateBoundedExp<Exponent, BasesAndExponents>,
    Exponent: Bounded,
    BasesAndExponents: AsRef<[(Self, Exponent)]> + ?Sized,
{
    fn multi_exponentiate(bases_and_exponents: &BasesAndExponents) -> Self {
        Self::multi_exponentiate_bounded_exp(bases_and_exponents, Exponent::BITS)
    }
}

/// Performs modular multi-exponentiation using Montgomery's ladder.
/// `exponent_bits` represents the number of bits to take into account for the exponent.
///
/// See: Straus, E. G. Problems and solutions: Addition chains of vectors. American Mathematical Monthly 71 (1964), 806–808.
///
/// NOTE: this value is leaked in the time pattern.
pub trait MultiExponentiateBoundedExp<Exponent, BasesAndExponents>: Pow<Exponent> + Sized
where
    BasesAndExponents: AsRef<[(Self, Exponent)]> + ?Sized,
{
    /// Calculates `x1 ^ k1 * ... * xn ^ kn`.
    #[must_use]
    fn multi_exponentiate_bounded_exp(
        bases_and_exponents: &BasesAndExponents,
        exponent_bits: u32,
    ) -> Self;
}

/// Constant-time inversion.
pub trait Invert {
    /// Output of the inversion.
    type Output;

    /// Computes the inverse.
    fn invert(&self) -> Self::Output;

    /// Computes the inverse in variable-time.
    fn invert_vartime(&self) -> Self::Output {
        self.invert()
    }
}

/// Widening multiply: returns a value with a number of limbs equal to the sum of the inputs.
pub trait ConcatenatingMul<Rhs = Self>: Sized {
    /// Output of the widening multiplication.
    type Output: Integer;

    /// Perform widening multiplication.
    #[must_use]
    fn concatenating_mul(&self, rhs: Rhs) -> Self::Output;
}

/// Widening square: returns a value with a number of limbs equal to double the sum of the input.
pub trait ConcatenatingSquare: Sized {
    /// Output of the widening multiplication.
    type Output: Integer;

    /// Perform widening squaring.
    #[must_use]
    fn concatenating_square(&self) -> Self::Output;
}

/// Widening multiply: returns a value with a number of limbs equal to the sum of the inputs.
#[deprecated(since = "0.7.0", note = "please use `ConcatenatingMul` instead")]
pub trait WideningMul<Rhs = Self>: Sized {
    /// Output of the widening multiplication.
    type Output: Integer;

    /// Perform widening multiplication.
    #[must_use]
    fn widening_mul(&self, rhs: Rhs) -> Self::Output;
}

#[allow(deprecated)]
impl<T, Rhs> WideningMul<Rhs> for T
where
    T: ConcatenatingMul<Rhs>,
{
    type Output = <T as ConcatenatingMul<Rhs>>::Output;

    fn widening_mul(&self, rhs: Rhs) -> Self::Output {
        self.concatenating_mul(rhs)
    }
}

/// Left shifts, variable time in `shift`.
pub trait ShlVartime: Sized {
    /// Computes `self << shift`.
    ///
    /// Returns `None` if `shift >= self.bits_precision()`.
    fn overflowing_shl_vartime(&self, shift: u32) -> Option<Self>;

    /// Computes `self << shift`.
    ///
    /// Returns zero if `shift >= self.bits_precision()`.
    #[must_use]
    fn unbounded_shl_vartime(&self, shift: u32) -> Self;

    /// Computes `self << shift` in a panic-free manner, masking off bits of `shift`
    /// which would cause the shift to exceed the type's width.
    #[must_use]
    fn wrapping_shl_vartime(&self, shift: u32) -> Self;
}

/// Right shifts, variable time in `shift`.
pub trait ShrVartime: Sized {
    /// Computes `self >> shift`.
    ///
    /// Returns `None` if `shift >= self.bits_precision()`.
    fn overflowing_shr_vartime(&self, shift: u32) -> Option<Self>;

    /// Computes `self >> shift`.
    ///
    /// Returns zero if `shift >= self.bits_precision()`.
    #[must_use]
    fn unbounded_shr_vartime(&self, shift: u32) -> Self;

    /// Computes `self >> shift` in a panic-free manner, masking off bits of `shift`
    /// which would cause the shift to exceed the type's width.
    #[must_use]
    fn wrapping_shr_vartime(&self, shift: u32) -> Self;
}

/// Methods for resizing the allocated storage.
pub trait Resize: Sized {
    /// The result of the resizing.
    type Output;

    /// Resizes to the minimum storage that fits `at_least_bits_precision`
    /// without checking if the bit size of `self` is larger than `at_least_bits_precision`.
    ///
    /// Variable-time w.r.t. `at_least_bits_precision`.
    #[must_use]
    fn resize_unchecked(self, at_least_bits_precision: u32) -> Self::Output;

    /// Resizes to the minimum storage that fits `at_least_bits_precision`
    /// returning `None` if the bit size of `self` is larger than `at_least_bits_precision`.
    ///
    /// Variable-time w.r.t. `at_least_bits_precision`.
    fn try_resize(self, at_least_bits_precision: u32) -> Option<Self::Output>;

    /// Resizes to the minimum storage that fits `at_least_bits_precision`
    /// panicking if the bit size of `self` is larger than `at_least_bits_precision`.
    ///
    /// Variable-time w.r.t. `at_least_bits_precision`.
    #[must_use]
    #[track_caller]
    fn resize(self, at_least_bits_precision: u32) -> Self::Output {
        self.try_resize(at_least_bits_precision).unwrap_or_else(|| {
            panic!("The bit size of `self` is larger than `at_least_bits_precision`")
        })
    }
}

/// A representation of an integer optimized for the performance of modular operations.
pub trait MontyForm:
    'static
    + sealed::Sealed
    + Clone
    + CtEq
    + CtSelect
    + Debug
    + Eq
    + Invert<Output = CtOption<Self>>
    + Sized
    + Send
    + Sync
    + Add<Output = Self>
    + for<'a> Add<&'a Self, Output = Self>
    + AddAssign
    + for<'a> AddAssign<&'a Self>
    + Sub<Output = Self>
    + for<'a> Sub<&'a Self, Output = Self>
    + SubAssign
    + for<'a> SubAssign<&'a Self>
    + Mul<Output = Self>
    + for<'a> Mul<&'a Self, Output = Self>
    + MulAssign
    + for<'a> MulAssign<&'a Self>
    + Neg<Output = Self>
    + PowBoundedExp<Self::Integer>
    + Retrieve<Output = Self::Integer>
    + Square
    + SquareAssign
{
    /// The original integer type.
    type Integer: UnsignedWithMontyForm<MontyForm = Self>;

    /// Prepared Montgomery multiplier for tight loops.
    type Multiplier<'a>: Debug + Clone + MontyMultiplier<'a, Monty = Self>;

    /// The precomputed data needed for this representation.
    type Params: 'static
        + AsRef<MontyParams<Self::Integer>>
        + From<MontyParams<Self::Integer>>
        + Clone
        + Debug
        + Eq
        + Sized
        + Send
        + Sync;

    /// Create the precomputed data for Montgomery representation of integers modulo `modulus`,
    /// variable time in `modulus`.
    #[must_use]
    fn new_params_vartime(modulus: Odd<Self::Integer>) -> Self::Params;

    /// Convert the value into the representation using precomputed data.
    #[must_use]
    fn new(value: Self::Integer, params: &Self::Params) -> Self;

    /// Returns zero in this representation.
    #[must_use]
    fn zero(params: &Self::Params) -> Self;

    /// Determine if this value is equal to zero.
    ///
    /// # Returns
    ///
    /// If zero, returns `Choice(1)`. Otherwise, returns `Choice(0)`.
    #[must_use]
    fn is_zero(&self) -> Choice {
        self.as_montgomery().is_zero()
    }

    /// Returns one in this representation.
    #[must_use]
    fn one(params: &Self::Params) -> Self;

    /// Determine if this value is equal to one.
    ///
    /// # Returns
    ///
    /// If one, returns `Choice(1)`. Otherwise, returns `Choice(0)`.
    #[must_use]
    fn is_one(&self) -> Choice {
        self.as_montgomery().ct_eq(self.params().as_ref().one())
    }

    /// Returns the parameter struct used to initialize this object.
    #[must_use]
    fn params(&self) -> &Self::Params;

    /// Access the value in Montgomery form.
    #[must_use]
    fn as_montgomery(&self) -> &Self::Integer;

    /// Copy the Montgomery representation from `other` into `self`.
    /// NOTE: the parameters remain unchanged.
    fn copy_montgomery_from(&mut self, other: &Self);

    /// Create a new Montgomery representation from an integer in Montgomery form.
    #[must_use]
    fn from_montgomery(integer: Self::Integer, params: &Self::Params) -> Self;

    /// Move the Montgomery form result out of `self` and return it.
    #[must_use]
    fn into_montgomery(self) -> Self::Integer;

    /// Performs doubling, returning `self + self`.
    #[must_use]
    fn double(&self) -> Self;

    /// Performs division by 2, that is returns `x` such that `x + x = self`.
    #[must_use]
    fn div_by_2(&self) -> Self;

    /// Performs division by 2 inplace, that is finds `x` such that `x + x = self`
    /// and writes it into `self`.
    fn div_by_2_assign(&mut self) {
        *self = self.div_by_2();
    }

    /// Calculate the sum of products of pairs `(a, b)` in `products`.
    ///
    /// This method is variable time only with the value of the modulus.
    /// For a modulus with leading zeros, this method is more efficient than a naive sum of products.
    ///
    /// This method will panic if `products` is empty. All terms must be associated with equivalent
    /// Montgomery parameters.
    #[must_use]
    fn lincomb_vartime(products: &[(&Self, &Self)]) -> Self;
}

/// Prepared Montgomery multiplier for tight loops.
///
/// Allows one to perform inplace multiplication without allocations
/// (important for the `BoxedUint` case).
///
/// NOTE: You will be operating with Montgomery representations directly,
/// make sure they all correspond to the same set of parameters.
pub trait MontyMultiplier<'a>: From<&'a <Self::Monty as MontyForm>::Params> {
    /// The associated Montgomery-representation integer.
    type Monty: MontyForm;

    /// Performs a Montgomery multiplication, assigning a fully reduced result to `lhs`.
    fn mul_assign(&mut self, lhs: &mut Self::Monty, rhs: &Self::Monty);

    /// Performs a Montgomery squaring, assigning a fully reduced result to `lhs`.
    fn square_assign(&mut self, lhs: &mut Self::Monty);
}

/// Prepared Montgomery multiplier for tight loops, performing "Almost Montgomery Multiplication".
///
/// NOTE: the resulting output of any of these functions will be reduced to the *bit length* of the
/// modulus, but not fully reduced and may exceed the modulus. A final reduction is required to
/// ensure AMM results are fully reduced, and should not be exposed outside the internals of this
/// crate.
pub(crate) trait AmmMultiplier<'a>: MontyMultiplier<'a> {
    /// Perform an "Almost Montgomery Multiplication", assigning the product to `a`.
    fn mul_amm_assign(
        &mut self,
        a: &mut <Self::Monty as MontyForm>::Integer,
        b: &<Self::Monty as MontyForm>::Integer,
    );

    /// Perform a squaring using "Almost Montgomery Multiplication", assigning the result to `a`.
    fn square_amm_assign(&mut self, a: &mut <Self::Monty as MontyForm>::Integer);
}

/// Support for sealing traits defined in this module.
pub(crate) mod sealed {
    /// Sealed trait.
    pub trait Sealed {}
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{
        Integer, Invert, MontyForm, Retrieve, Signed, Square, SquareAssign, ToUnsigned, Unsigned,
        UnsignedWithMontyForm,
    };
    use crate::{Choice, CtEq, CtSelect, Limb, NonZero, Odd, One, Reciprocal, Zero};

    /// Apply a suite of tests against a type implementing Integer.
    pub fn test_integer<T: Integer>(min: T, max: T) {
        let zero = T::zero_like(&min);
        let one = T::one_like(&min);
        let two = one.clone() + &one;
        let inputs = &[zero.clone(), one.clone(), max.clone()];
        let nz_one = NonZero::new(one.clone()).expect("must be non-zero");
        let nz_two = NonZero::new(two.clone()).expect("must be non-zero");

        // FIXME Could use itertools combinations or an equivalent iterator
        let pairs = &[
            (zero.clone(), zero.clone()),
            (zero.clone(), one.clone()),
            (zero.clone(), max.clone()),
            (one.clone(), zero.clone()),
            (one.clone(), one.clone()),
            (one.clone(), max.clone()),
            (max.clone(), zero.clone()),
            (max.clone(), one.clone()),
            (max.clone(), max.clone()),
        ];

        // Test formatting
        #[cfg(feature = "alloc")]
        for a in inputs {
            let _ = format!("{a:?}");
            let _ = format!("{a:#?}");
            let _ = format!("{a:b}");
            let _ = format!("{a:x}");
            let _ = format!("{a:X}");
        }

        // Default must be zero
        assert_eq!(T::default(), zero);

        // Sanity checks
        assert_eq!(zero, T::zero());
        assert_eq!(one, T::one());
        assert_ne!(zero, one);
        assert_ne!(zero, max);
        assert_ne!(min, max);

        // Even/odd trait methods
        assert!(zero.is_even().to_bool());
        assert!(!zero.is_odd().to_bool());
        assert!(!one.is_even().to_bool());
        assert!(one.is_odd().to_bool());
        assert!(two.is_even().to_bool());
        assert!(!two.is_odd().to_bool());

        // AsRef<[Limb]>, Eq, Ord, CtEq, CtGt, CtLt, CtNe
        for (a, b) in pairs {
            assert_eq!(a.nlimbs(), a.as_limbs().len());
            assert_eq!(a.as_limbs(), a.as_ref());
            assert_eq!(a.clone().as_mut_limbs(), a.clone().as_mut());
            assert_eq!(&*a.clone().as_mut_limbs(), a.as_limbs());
            assert_eq!(
                a.ct_eq(b).to_bool(),
                a.as_limbs().ct_eq(b.as_limbs()).to_bool()
            );
            assert_ne!(a.ct_eq(b).to_bool(), a.ct_ne(b).to_bool());
            if a == b {
                assert!(!a.ct_lt(b).to_bool());
                assert!(!a.ct_gt(b).to_bool());
            } else {
                assert_ne!(a.ct_lt(b).to_bool(), a.ct_gt(b).to_bool());
            }
            assert_eq!(a.ct_lt(b).to_bool(), a < b);
            assert_eq!(a.ct_gt(b).to_bool(), a > b);
        }

        // CtAssign, CtSelect
        for (a, b) in pairs {
            let mut c = a.clone();
            c.ct_assign(b, Choice::FALSE);
            assert_eq!(&c, a);
            c.ct_assign(b, Choice::TRUE);
            assert_eq!(&c, b);

            assert_eq!(&CtSelect::ct_select(a, b, Choice::FALSE), a);
            assert_eq!(&CtSelect::ct_select(a, b, Choice::TRUE), b);
            let (mut c, mut d) = (a.clone(), b.clone());
            CtSelect::ct_swap(&mut c, &mut d, Choice::FALSE);
            assert_eq!((&c, &d), (a, b));
            CtSelect::ct_swap(&mut c, &mut d, Choice::TRUE);
            assert_eq!((&c, &d), (b, a));
        }

        // BitAnd
        for a in inputs {
            assert_eq!(a.clone().bitand(zero.clone()), zero);
            assert_eq!(a.clone().bitand(&zero), zero);
            assert_eq!(&a.clone().bitand(a), a);
            assert_eq!(zero.clone().bitand(a), zero);
            assert_eq!(a.clone().not().bitand(a), zero);
            // BitAndAssign ref
            let mut b = a.clone();
            b &= a.clone();
            assert_eq!(a, &b);
            // BitAndAssign owned
            let mut b = a.clone();
            b &= a;
            assert_eq!(a, &b);
        }

        // BitOr
        for a in inputs {
            assert_eq!(&a.clone().bitor(zero.clone()), a);
            assert_eq!(&a.clone().bitor(&zero), a);
            assert_eq!(&a.clone().bitor(a), a);
            assert_eq!(&zero.clone().bitor(a), a);
            // BitOrAssign ref
            let mut b = a.clone();
            b |= a;
            assert_eq!(a, &b);
            // BitOrAssign owned
            let mut b = a.clone();
            b |= a.clone();
            assert_eq!(a, &b);
        }

        // BitXor
        for a in inputs {
            assert_eq!(&a.clone().bitxor(zero.clone()), a);
            assert_eq!(&a.clone().bitor(&zero), a);
            assert_eq!(a.clone().bitxor(a), zero);
            assert_eq!(&zero.clone().bitxor(a), a);
            // BitXorAssign ref
            let mut b = a.clone();
            b ^= a;
            assert_eq!(T::zero(), b);
            // BitXorAssign owned
            let mut b = a.clone();
            b ^= a.clone();
            assert_eq!(T::zero(), b);
        }

        // Shr/Shl
        assert_eq!(zero.clone().shr(1u32), zero);
        assert_eq!(one.clone().shr(1u32), zero);
        assert_eq!(zero.clone().shl(1u32), zero);
        assert_eq!(one.clone().shl(1u32), two);
        assert_eq!(two.clone().shr(1u32), one);
        assert_ne!(max.clone().shr(1u32), max);
        let mut expect = one.clone();
        expect.shl_assign(1);
        assert_eq!(expect, two);
        expect.shr_assign(1);
        assert_eq!(expect, one);

        // Non-carrying Add
        for a in inputs {
            assert_eq!(&a.clone().add(zero.clone()), a);
            assert_eq!(&a.clone().add(&zero), a);
            assert_eq!(&zero.clone().add(a), a);
            // AddAssign ref
            let mut b = a.clone();
            b += &zero;
            assert_eq!(a, &b);
            // AddAssign owned
            let mut b = a.clone();
            b += zero.clone();
            assert_eq!(a, &b);
        }

        // Non-borrowing Sub
        for a in inputs {
            assert_eq!(&a.clone().sub(zero.clone()), a);
            assert_eq!(&a.clone().sub(&zero), a);
            assert_eq!(a.clone().sub(a), zero);
            // SubAssign ref
            let mut b = a.clone();
            b -= a;
            assert_eq!(zero, b);
            // SubAssign owned
            let mut b = a.clone();
            b -= a.clone();
            assert_eq!(zero, b);
        }

        // Non-carrying Mul
        for a in inputs {
            assert_eq!(a.clone().mul(zero.clone()), zero);
            assert_eq!(a.clone().mul(&zero), zero);
            assert_eq!(&a.clone().mul(&one), a);
            assert_eq!(zero.clone().mul(a), zero);
            assert_eq!(&one.clone().mul(a), a);
            // MulAssign ref
            let mut b = a.clone();
            b *= &one;
            assert_eq!(a, &b);
            // MulAssign owned
            let mut b = a.clone();
            b *= one.clone();
            assert_eq!(a, &b);
        }

        // DivAssign ref
        let mut a = one.clone();
        a /= &nz_one;
        assert_eq!(a, one);
        // DivAssign owned
        let mut a = one.clone();
        a /= nz_one.clone();
        assert_eq!(a, one);

        // Rem
        assert_eq!(zero.clone().rem(&nz_one), zero);
        assert_eq!(zero.clone().rem(nz_one.clone()), zero);
        assert_eq!(one.clone().rem(&nz_one), zero);
        assert_eq!(one.clone().rem(&nz_two), one);
        // RemAssign ref
        let mut a = one.clone();
        a %= &nz_one;
        assert_eq!(a, zero);
        // RemAssign owned
        let mut a = one.clone();
        a %= nz_one.clone();
        assert_eq!(a, zero);

        // CheckedAdd
        assert_eq!(
            zero.clone().checked_add(&zero).into_option(),
            Some(zero.clone())
        );
        assert_eq!(
            zero.clone().checked_add(&one).into_option(),
            Some(one.clone())
        );
        assert_eq!(
            zero.clone().checked_add(&max).into_option(),
            Some(max.clone())
        );
        assert_eq!(max.checked_add(&one).into_option(), None);
        assert_eq!(max.checked_add(&max).into_option(), None);

        // CheckedSub
        assert_eq!(
            zero.clone().checked_sub(&zero).into_option(),
            Some(zero.clone())
        );
        assert_eq!(min.checked_sub(&zero).into_option(), Some(min.clone()));
        assert_eq!(min.checked_sub(&one).into_option(), None);
        assert_eq!(min.checked_sub(&max).into_option(), None);
        assert_eq!(max.checked_sub(&zero).into_option(), Some(max.clone()));
        assert_eq!(max.checked_sub(&max).into_option(), Some(zero.clone()));

        // CheckedMul
        assert_eq!(
            zero.clone().checked_mul(&zero).into_option(),
            Some(zero.clone())
        );
        assert_eq!(
            zero.clone().checked_mul(&one).into_option(),
            Some(zero.clone())
        );
        assert_eq!(
            one.clone().checked_mul(&max).into_option(),
            Some(max.clone())
        );
        assert_eq!(max.checked_mul(&max).into_option(), None);

        // CheckedDiv
        assert_eq!(zero.clone().checked_div(&zero).into_option(), None);
        assert_eq!(one.clone().checked_div(&zero).into_option(), None);
        assert_eq!(
            one.clone().checked_div(&one).into_option(),
            Some(one.clone())
        );
        assert_eq!(max.checked_div(&max).into_option(), Some(one.clone()));

        // CheckedSquareRoot
        assert_eq!(zero.checked_sqrt().into_option(), Some(zero.clone()));
        assert_eq!(zero.checked_sqrt_vartime(), Some(zero.clone()));
        assert_eq!(one.checked_sqrt().into_option(), Some(one.clone()));
        assert_eq!(one.checked_sqrt_vartime(), Some(one.clone()));
        assert_eq!(two.checked_sqrt().into_option(), None);
        assert_eq!(two.checked_sqrt_vartime(), None);

        // WrappingAdd
        assert_eq!(zero.clone().wrapping_add(&zero), zero);
        assert_eq!(zero.clone().wrapping_add(&one), one);
        assert_eq!(one.clone().wrapping_add(&zero), one);
        assert_eq!(one.clone().wrapping_add(&one), two);
        assert_eq!(one.clone().wrapping_add(&max), min);
        assert_eq!(max.wrapping_add(&one), min);

        // WrappingSub
        assert_eq!(zero.clone().wrapping_sub(&zero), zero);
        assert_eq!(one.clone().wrapping_sub(&zero), one);
        assert_eq!(two.wrapping_sub(&one), one);
        assert_eq!(min.wrapping_sub(&one), max);
        assert_eq!(min.wrapping_sub(&min), zero);

        // WrappingMul
        assert_eq!(zero.clone().wrapping_mul(&zero), zero);
        assert_eq!(zero.clone().wrapping_mul(&one), zero);
        assert_eq!(one.clone().wrapping_mul(&zero), zero);
        assert_eq!(one.clone().wrapping_mul(&one), one);
        assert_eq!(one.clone().wrapping_mul(&max), max);
        assert_eq!(max.wrapping_mul(&zero), zero);
        assert_eq!(max.wrapping_mul(&one), max);
        assert_eq!(max.wrapping_mul(&two), max.clone().shl(1u32));

        // WrappingNeg
        assert_eq!(zero.clone().wrapping_neg(), zero);
        for a in inputs {
            assert_eq!(a.wrapping_add(&a.wrapping_neg()), zero);
            assert_eq!(zero.wrapping_sub(a), a.wrapping_neg());
        }

        // WrappingShr/WrappingShl
        assert_eq!(zero.clone().wrapping_shr(1u32), zero);
        assert_eq!(one.clone().wrapping_shr(1u32), zero);
        assert_eq!(zero.clone().wrapping_shl(1u32), zero);
        assert_eq!(one.clone().wrapping_shl(1u32), two);
        assert_eq!(two.clone().wrapping_shr(1u32), one);
        assert_ne!(max.clone().wrapping_shr(1u32), max);
    }

    /// Apply a suite of tests against a type implementing Unsigned.
    pub fn test_unsigned<T: Unsigned>(min: T, max: T) {
        let zero = T::zero_like(&min);
        let one = T::one_like(&min);
        let two = one.clone() + &one;
        let nz_one = NonZero::new(one.clone()).expect("must be non-zero");
        let nz_two = NonZero::new(two.clone()).expect("must be non-zero");
        let nz_limb_one = NonZero::new(Limb::ONE).expect("must be non-zero");
        let nz_limb_two = NonZero::new(Limb::from(2u8)).expect("must be non-zero");
        let inputs = &[zero.clone(), one.clone(), max.clone()];

        // Test Integer trait
        test_integer(min.clone(), max.clone());

        // Trait methods
        for a in inputs {
            assert_eq!(a.as_uint_ref(), a.as_ref());
            assert_eq!(a.clone().as_mut_uint_ref(), a.clone().as_mut());
            assert_eq!(T::from_limb_like(Limb::ZERO, &one), zero);
            assert_eq!(T::from_limb_like(Limb::ONE, &one), one);
        }

        // Zero trait
        assert!(zero.is_zero().to_bool());
        assert!(!one.is_zero().to_bool());
        let mut a = one.clone();
        a.set_zero();
        assert_eq!(a, zero);

        // One trait
        assert!(!zero.is_one().to_bool());
        assert!(one.is_one().to_bool());
        let mut a = zero.clone();
        a.set_one();
        assert_eq!(a, one);

        // From implementations
        assert_eq!(T::from(0u8), T::zero());
        assert_eq!(T::from(1u8), T::one());
        assert_eq!(T::from(1u16), T::one());
        assert_eq!(T::from(1u32), T::one());
        assert_eq!(T::from(1u64), T::one());
        assert_eq!(T::from(Limb::ONE), T::one());

        // ToUnsigned
        assert_eq!(one.to_unsigned(), one);
        assert_eq!(one.to_unsigned_zero(), zero);

        // FloorSquareRoot
        assert_eq!(zero.floor_sqrt(), zero);
        assert_eq!(zero.floor_sqrt_vartime(), zero);
        assert_eq!(one.floor_sqrt(), one);
        assert_eq!(one.floor_sqrt_vartime(), one);
        assert_eq!(two.floor_sqrt(), one);
        assert_eq!(two.floor_sqrt_vartime(), one);

        // Gcd
        assert_eq!(zero.gcd(&zero), zero);
        assert_eq!(zero.gcd_vartime(&zero), zero);
        assert_eq!(one.gcd(&one), one);
        assert_eq!(one.gcd_vartime(&one), one);
        assert_eq!(two.gcd(&one), one);
        assert_eq!(two.gcd_vartime(&one), one);

        // Div by ref
        assert_eq!(zero.clone().div(&nz_one), zero);
        assert_eq!(zero.clone().div(&nz_two), zero);
        assert_eq!(one.clone().div(&nz_one), one);
        assert_eq!(one.clone().div(&nz_two), zero);
        // Div by owned
        assert_eq!(zero.clone().div(nz_one.clone()), zero);
        assert_eq!(zero.clone().div(nz_two.clone()), zero);
        assert_eq!(one.clone().div(nz_one.clone()), one);
        assert_eq!(one.clone().div(nz_two.clone()), zero);

        // DivRemLimb
        assert_eq!(zero.div_rem_limb(nz_limb_one), (zero.clone(), Limb::ZERO));
        assert_eq!(zero.div_rem_limb(nz_limb_two), (zero.clone(), Limb::ZERO));
        assert_eq!(one.div_rem_limb(nz_limb_one), (one.clone(), Limb::ZERO));
        assert_eq!(one.div_rem_limb(nz_limb_two), (zero.clone(), Limb::ONE));
        assert_eq!(
            zero.div_rem_limb_with_reciprocal(&Reciprocal::new(nz_limb_one)),
            (zero.clone(), Limb::ZERO)
        );
        assert_eq!(
            one.div_rem_limb_with_reciprocal(&Reciprocal::new(nz_limb_one)),
            (one.clone(), Limb::ZERO)
        );
        assert_eq!(
            one.div_rem_limb_with_reciprocal(&Reciprocal::new(nz_limb_two)),
            (zero.clone(), Limb::ONE)
        );

        // RemLimb
        assert_eq!(zero.rem_limb(nz_limb_one), Limb::ZERO);
        assert_eq!(zero.rem_limb(nz_limb_two), Limb::ZERO);
        assert_eq!(one.rem_limb(nz_limb_one), Limb::ZERO);
        assert_eq!(one.rem_limb(nz_limb_two), Limb::ONE);
        assert_eq!(
            zero.rem_limb_with_reciprocal(&Reciprocal::new(nz_limb_one)),
            Limb::ZERO
        );
        assert_eq!(
            one.rem_limb_with_reciprocal(&Reciprocal::new(nz_limb_one)),
            Limb::ZERO
        );
        assert_eq!(
            one.rem_limb_with_reciprocal(&Reciprocal::new(nz_limb_two)),
            Limb::ONE
        );

        // BitOps
        assert_eq!(zero.bits(), 0);
        assert_eq!(one.bits(), 1);
        assert_eq!(one.bits_vartime(), 1);
        assert_eq!(one.bits_precision() as usize, one.bytes_precision() * 8);
        assert_eq!(one.bits_precision(), 1 << one.log2_bits());
        // Leading/trailing zeros and ones
        assert_eq!(zero.leading_zeros(), zero.bits_precision());
        assert_eq!(zero.leading_zeros_vartime(), zero.bits_precision());
        assert_eq!(zero.trailing_zeros(), zero.bits_precision());
        assert_eq!(zero.trailing_zeros_vartime(), zero.bits_precision());
        assert_eq!(zero.trailing_ones(), 0);
        assert_eq!(zero.trailing_ones_vartime(), 0);
        assert_eq!(one.leading_zeros(), one.bits_precision() - 1);
        assert_eq!(one.leading_zeros_vartime(), one.bits_precision() - 1);
        assert_eq!(one.trailing_zeros(), 0);
        assert_eq!(one.trailing_zeros_vartime(), 0);
        assert_eq!(one.trailing_ones(), 1);
        assert_eq!(one.trailing_ones_vartime(), 1);
        // Bit access
        assert!(!zero.bit(0).to_bool());
        assert!(!zero.bit_vartime(0));
        assert!(one.bit(0).to_bool());
        assert!(one.bit_vartime(0));
        assert!(!one.bit(1).to_bool());
        assert!(!one.bit_vartime(1));
        // Bit assignment
        let mut a = zero.clone();
        a.set_bit(0, Choice::TRUE);
        assert_eq!(a, one);
        let mut a = zero.clone();
        a.set_bit_vartime(0, true);
        assert_eq!(a, one);
        let mut a = one.clone();
        a.set_bit(0, Choice::FALSE);
        assert_eq!(a, zero);
        let mut a = one.clone();
        a.set_bit_vartime(0, false);
        assert_eq!(a, zero);

        // AddMod
        assert_eq!(zero.add_mod(&zero, &nz_two), zero);
        assert_eq!(zero.add_mod(&one, &nz_two), one);
        assert_eq!(one.add_mod(&zero, &nz_two), one);
        assert_eq!(one.add_mod(&one, &nz_two), zero);

        // SubMod
        assert_eq!(zero.sub_mod(&zero, &nz_two), zero);
        assert_eq!(zero.sub_mod(&one, &nz_two), one);
        assert_eq!(one.sub_mod(&zero, &nz_two), one);
        assert_eq!(one.sub_mod(&one, &nz_two), zero);

        // MulMod
        assert_eq!(zero.mul_mod(&zero, &nz_two), zero);
        assert_eq!(zero.mul_mod(&one, &nz_two), zero);
        assert_eq!(one.mul_mod(&zero, &nz_two), zero);
        assert_eq!(one.mul_mod(&one, &nz_two), one);

        // SquareMod
        assert_eq!(zero.square_mod(&nz_two), zero);
        assert_eq!(one.square_mod(&nz_two), one);

        // NegMod
        assert_eq!(zero.neg_mod(&nz_two), zero);
        assert_eq!(one.neg_mod(&nz_two), one);
    }

    pub fn test_signed<T: Signed>(min: T, max: T) {
        let zero = T::zero_like(&min);
        let one = T::one_like(&min);
        let two = one.clone() + &one;
        let zero_unsigned = T::Unsigned::zero();
        let one_unsigned = T::Unsigned::one();
        let minus_one = T::from(-1i8);
        let nz_one = NonZero::new(one.clone()).expect("must be non-zero");
        let nz_minus_one = NonZero::new(minus_one.clone()).expect("must be non-zero");
        let nz_two = NonZero::new(two.clone()).expect("must be non-zero");

        // Test Integer trait
        test_integer(min.clone(), max.clone());

        // Trait sign methods
        assert!(!zero.is_positive().to_bool());
        assert!(!zero.is_negative().to_bool());
        assert!(one.is_positive().to_bool());
        assert!(!one.is_negative().to_bool());
        assert!(!minus_one.is_positive().to_bool());
        assert!(minus_one.is_negative().to_bool());
        // Trait abs methods
        assert_eq!(zero.abs(), zero_unsigned);
        assert_eq!(one.abs(), one_unsigned);
        assert_eq!(minus_one.abs(), one_unsigned);
        let (check, check_sign) = zero.abs_sign();
        assert_eq!(
            (check, check_sign.to_bool()),
            (zero_unsigned.clone(), false)
        );
        let (check, check_sign) = one.abs_sign();
        assert_eq!((check, check_sign.to_bool()), (one_unsigned.clone(), false));
        let (check, check_sign) = minus_one.abs_sign();
        assert_eq!((check, check_sign.to_bool()), (one_unsigned.clone(), true));

        // From implementations
        assert_eq!(T::from(0i8), T::zero());
        assert_eq!(T::from(1i8), T::one());
        assert_eq!(T::from(1i16), T::one());
        assert_eq!(T::from(1i32), T::one());
        assert_eq!(T::from(1i64), T::one());
        assert_eq!(T::from(-1i64), T::zero() - T::one());

        // Gcd
        assert_eq!(zero.gcd(&zero), T::Unsigned::zero());
        assert_eq!(zero.gcd_vartime(&zero), T::Unsigned::zero());
        assert_eq!(one.gcd(&one), T::Unsigned::one());
        assert_eq!(one.gcd_vartime(&one), T::Unsigned::one());
        assert_eq!(two.gcd(&one), T::Unsigned::one());
        assert_eq!(two.gcd_vartime(&one), T::Unsigned::one());
        assert_eq!(minus_one.gcd(&one), T::Unsigned::one());
        assert_eq!(minus_one.gcd_vartime(&one), T::Unsigned::one());

        // Div by ref
        assert_eq!(zero.clone().div(&nz_one).into_option(), Some(zero.clone()));
        assert_eq!(
            zero.clone().div(&nz_minus_one).into_option(),
            Some(zero.clone())
        );
        assert_eq!(zero.clone().div(&nz_two).into_option(), Some(zero.clone()));
        assert_eq!(one.clone().div(&nz_one).into_option(), Some(one.clone()));
        assert_eq!(
            one.clone().div(&nz_minus_one).into_option(),
            Some(minus_one.clone())
        );
        assert_eq!(one.clone().div(&nz_two).into_option(), Some(zero.clone()));
        // Div by owned
        assert_eq!(
            zero.clone().div(nz_one.clone()).into_option(),
            Some(zero.clone())
        );
        assert_eq!(
            zero.clone().div(nz_minus_one.clone()).into_option(),
            Some(zero.clone())
        );
        assert_eq!(
            zero.clone().div(nz_two.clone()).into_option(),
            Some(zero.clone())
        );
        assert_eq!(
            one.clone().div(nz_one.clone()).into_option(),
            Some(one.clone())
        );
        assert_eq!(
            one.clone().div(nz_minus_one.clone()).into_option(),
            Some(minus_one.clone())
        );
        assert_eq!(
            one.clone().div(nz_two.clone()).into_option(),
            Some(zero.clone())
        );
    }

    pub fn test_unsigned_monty_form<T: UnsignedWithMontyForm>() {
        let modulus = Odd::new(T::from(17863u32)).unwrap();
        let params = T::MontyForm::new_params_vartime(modulus);

        // test AsRef, From for Params
        assert_eq!(
            <T::MontyForm as MontyForm>::Params::from(params.as_ref().clone()),
            params,
        );
        // test Clone for Params
        assert_eq!(params, params.clone());

        // test zero
        let zero = T::MontyForm::zero(&params);
        assert!(zero.is_zero().to_bool_vartime());
        assert!(!zero.is_one().to_bool_vartime());

        // test one
        let one = T::MontyForm::one(&params);
        assert!(!one.is_zero().to_bool_vartime());
        assert!(one.is_one().to_bool_vartime());

        // test as_montgomery()
        assert_eq!(zero.as_montgomery(), &T::zero());
        assert_eq!(one.as_montgomery(), params.as_ref().one());

        // test copy_montgomery_from()
        let mut z2 = one.clone();
        z2.copy_montgomery_from(&zero);
        assert_eq!(z2, zero);

        // test from_montgomery()
        let one2 =
            <T::MontyForm as MontyForm>::from_montgomery(params.as_ref().one().clone(), &params);
        assert_eq!(one2, one);

        // test into_montgomery()
        assert_eq!(&one2.into_montgomery(), params.as_ref().one());

        // test double(), div_by_2()
        assert_eq!(zero.double(), zero);
        assert_ne!(one.double(), one);
        assert_eq!(one.double().div_by_2(), one);
        let mut half = one.clone();
        half.div_by_2_assign();
        assert_ne!(half, one);
        assert_eq!(half.double(), one);

        // test lincomb_vartime()
        assert_eq!(
            <T::MontyForm as MontyForm>::lincomb_vartime(&[(&zero, &zero)]),
            zero
        );
        assert_eq!(
            <T::MontyForm as MontyForm>::lincomb_vartime(&[(&one, &one)]),
            one
        );
        assert_eq!(
            <T::MontyForm as MontyForm>::lincomb_vartime(&[(&one, &one), (&one, &one)]),
            one.double()
        );

        // test CtSelect
        assert_eq!(zero.ct_select(&one, Choice::FALSE), zero);
        assert_eq!(zero.ct_select(&one, Choice::TRUE), one);

        // test Invert
        assert!(zero.invert().is_none().to_bool_vartime());
        assert!(zero.invert_vartime().is_none().to_bool_vartime());
        assert!(
            one.invert()
                .expect("inversion error")
                .is_one()
                .to_bool_vartime()
        );
        assert!(
            one.invert_vartime()
                .expect("inversion error")
                .is_one()
                .to_bool_vartime()
        );

        // test Add, AddAssign
        assert_eq!(one.clone() + one.clone(), one.double());
        assert_eq!(one.clone() + &one, one.double());
        let mut two = one.clone();
        two += one.clone();
        assert_eq!(two, one.double());
        let mut two = one.clone();
        two += &one;
        assert_eq!(two, one.double());

        // test Sub, SubAssign
        assert_eq!(one.clone() - one.clone(), zero);
        assert_eq!(one.clone() - &one, zero);
        let mut check = one.double();
        check -= one.clone();
        assert_eq!(check, one);
        let mut check = one.double();
        check -= &one;
        assert_eq!(check, one);

        // test Mul, MulAssign
        assert_eq!(zero.clone() * &zero, zero);
        assert_eq!(zero.clone() * &one, zero);
        assert_eq!(one.clone() * one.clone(), one);
        let mut check = one.clone();
        check *= one.clone();
        assert_eq!(check, one);
        let mut check = one.clone();
        check *= &zero;
        assert_eq!(check, zero);

        // test Neg
        assert_eq!(-zero.clone(), zero);
        assert_ne!(-one.clone(), one);
        assert_eq!(-(-one.clone()), one);

        // test Retrieve
        assert_eq!(zero.retrieve(), T::zero());
        assert_eq!(one.retrieve(), T::one());

        // test Square, SquareAssign
        assert_eq!(zero.square(), zero);
        assert_eq!(one.square(), one);
        let mut check = one.double();
        check.square_assign();
        assert_eq!(check, one.double().double());
    }
}
