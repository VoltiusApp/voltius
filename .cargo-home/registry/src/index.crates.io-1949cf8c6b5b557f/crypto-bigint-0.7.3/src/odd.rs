//! Wrapper type for non-zero integers.

use crate::{
    Bounded, Choice, ConstOne, CtAssign, CtEq, CtOption, CtSelect, Int, Integer, Limb, Mul,
    NonZero, One, Uint, UintRef,
};
use core::{cmp::Ordering, fmt, ops::Deref};
use ctutils::{CtAssignSlice, CtEqSlice};

#[cfg(feature = "alloc")]
use crate::{BoxedUint, Resize};

#[cfg(feature = "rand_core")]
use crate::{Random, rand_core::TryRng};

#[cfg(all(feature = "alloc", feature = "rand_core"))]
use crate::RandomBits;

#[cfg(feature = "serde")]
use crate::Zero;
#[cfg(feature = "serde")]
use serdect::serde::{
    Deserialize, Deserializer, Serialize, Serializer,
    de::{Error, Unexpected},
};

/// Odd unsigned integer.
pub type OddUint<const LIMBS: usize> = Odd<Uint<LIMBS>>;

/// Odd unsigned integer reference.
pub type OddUintRef = Odd<UintRef>;

/// Odd signed integer.
pub type OddInt<const LIMBS: usize> = Odd<Int<LIMBS>>;

/// Odd boxed unsigned integer.
#[cfg(feature = "alloc")]
pub type OddBoxedUint = Odd<BoxedUint>;

/// Wrapper type for odd integers.
///
/// These are frequently used in cryptography, e.g. as a modulus.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct Odd<T: ?Sized>(pub(crate) T);

impl<T> Odd<T> {
    /// Create a new odd integer.
    #[inline]
    pub fn new(mut n: T) -> CtOption<Self>
    where
        T: Integer,
    {
        let is_odd = n.is_odd();

        // Use one as a placeholder in the event an even number is provided, so functions that
        // operate on `NonZero` values really can expect the value to never be zero, even in the
        // case `CtOption::is_some` is false.
        n.ct_assign(&T::one_like(&n), !is_odd);
        CtOption::new(Self(n), is_odd)
    }

    /// Returns the inner value.
    #[inline]
    pub fn get(self) -> T {
        self.0
    }

    /// Returns a copy of the inner value for `Copy` types.
    ///
    /// This allows the function to be `const fn`, since `Copy` is implicitly `!Drop`, which avoids
    /// problems around `const fn` destructors.
    #[inline]
    pub const fn get_copy(self) -> T
    where
        T: Copy,
    {
        self.0
    }
}

impl<T: ?Sized> Odd<T> {
    /// Provides access to the contents of [`Odd`] in a `const` context.
    pub const fn as_ref(&self) -> &T {
        &self.0
    }

    /// All odd integers are definitionally non-zero, so we can also obtain a reference to
    /// the equivalent [`NonZero`] type.
    pub const fn as_nz_ref(&self) -> &NonZero<T> {
        // SAFETY: `NonZero` and `Odd` are both `repr(transparent)` newtypes of `T` and therefore
        // have the same layout. All `Odd` numbers are definitionally non-zero because zero is an
        // even number
        #[allow(unsafe_code)]
        unsafe {
            &*(&raw const self.0 as *const NonZero<T>)
        }
    }
}

impl<T> Odd<T>
where
    T: Bounded + ?Sized,
{
    /// Total size of the represented integer in bits.
    pub const BITS: u32 = T::BITS;

    /// Total size of the represented integer in bytes.
    pub const BYTES: usize = T::BYTES;
}

impl<const LIMBS: usize> OddUint<LIMBS> {
    /// Create a new [`OddUint`] from the provided big endian hex string.
    ///
    /// # Panics
    /// - if the hex is malformed or not zero-padded accordingly for the size.
    /// - if the value is even.
    #[must_use]
    #[track_caller]
    pub const fn from_be_hex(hex: &str) -> Self {
        let uint = Uint::<LIMBS>::from_be_hex(hex);
        assert!(uint.is_odd().to_bool_vartime(), "number must be odd");
        Odd(uint)
    }

    /// Create a new [`Odd<Uint<LIMBS>>`] from the provided little endian hex string.
    ///
    /// # Panics
    /// - if the hex is malformed or not zero-padded accordingly for the size.
    /// - if the value is even.
    #[must_use]
    #[track_caller]
    pub const fn from_le_hex(hex: &str) -> Self {
        let uint = Uint::<LIMBS>::from_le_hex(hex);
        assert!(uint.is_odd().to_bool_vartime(), "number must be odd");
        Odd(uint)
    }

    /// Borrow this `OddUint` as a `&OddUintRef`.
    #[inline]
    #[must_use]
    pub const fn as_uint_ref(&self) -> &OddUintRef {
        self.0.as_uint_ref().as_odd_unchecked()
    }

    /// Construct an [`Odd<Uint<T>>`] from the unsigned integer value,
    /// truncating the upper bits if the value is too large to be
    /// represented.
    #[must_use]
    pub const fn resize<const T: usize>(&self) -> Odd<Uint<T>> {
        Odd(self.0.resize())
    }
}

impl<const LIMBS: usize> AsRef<OddUintRef> for OddUint<LIMBS> {
    fn as_ref(&self) -> &OddUintRef {
        self.as_uint_ref()
    }
}

impl<const LIMBS: usize> Odd<Int<LIMBS>> {
    /// The sign and magnitude of this [`Odd<Int<{LIMBS}>>`].
    #[must_use]
    pub const fn abs_sign(&self) -> (Odd<Uint<LIMBS>>, Choice) {
        // Absolute value of an odd value is odd
        let (abs, sgn) = Int::abs_sign(self.as_ref());
        (Odd(abs), sgn)
    }

    /// The magnitude of this [`Odd<Int<{LIMBS}>>`].
    #[must_use]
    pub const fn abs(&self) -> Odd<Uint<LIMBS>> {
        self.abs_sign().0
    }
}

impl<T: ?Sized> AsRef<T> for Odd<T> {
    fn as_ref(&self) -> &T {
        &self.0
    }
}

impl<T> AsRef<[Limb]> for Odd<T>
where
    T: AsRef<[Limb]>,
{
    fn as_ref(&self) -> &[Limb] {
        self.0.as_ref()
    }
}

impl<T: ?Sized> AsRef<NonZero<T>> for Odd<T> {
    fn as_ref(&self) -> &NonZero<T> {
        self.as_nz_ref()
    }
}

impl<T> CtAssign for Odd<T>
where
    T: CtAssign,
{
    #[inline]
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.0.ct_assign(&other.0, choice);
    }
}
impl<T> CtAssignSlice for Odd<T> where T: CtAssignSlice {}

impl<T> CtEq for Odd<T>
where
    T: CtEq + ?Sized,
{
    #[inline]
    fn ct_eq(&self, other: &Self) -> Choice {
        CtEq::ct_eq(&self.0, &other.0)
    }
}
impl<T> CtEqSlice for Odd<T> where T: CtEq {}

impl<T> CtSelect for Odd<T>
where
    T: CtSelect,
{
    #[inline]
    fn ct_select(&self, other: &Self, choice: Choice) -> Self {
        Self(self.0.ct_select(&other.0, choice))
    }
}

impl<T> Default for Odd<T>
where
    T: One,
{
    #[inline]
    fn default() -> Self {
        Odd(T::one())
    }
}

impl<T: ?Sized> Deref for Odd<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T> ConstOne for Odd<T>
where
    T: ConstOne + One,
{
    const ONE: Self = Self(T::ONE);
}

impl<T> One for Odd<T>
where
    T: One,
{
    #[inline]
    fn one() -> Self {
        Self(T::one())
    }
}

impl<T> num_traits::One for Odd<T>
where
    T: One + Mul<T, Output = T>,
{
    #[inline]
    fn one() -> Self {
        Self(T::one())
    }

    fn is_one(&self) -> bool {
        self.0.is_one().into()
    }
}

/// Any odd integer multiplied by another odd integer is definitionally odd.
impl<T> Mul<Self> for Odd<T>
where
    T: Mul<T, Output = T>,
{
    type Output = Self;

    fn mul(self, rhs: Self) -> Self {
        Self(self.0 * rhs.0)
    }
}

impl<const LIMBS: usize> PartialEq<Odd<Uint<LIMBS>>> for Uint<LIMBS> {
    fn eq(&self, other: &Odd<Uint<LIMBS>>) -> bool {
        self.eq(&other.0)
    }
}

impl<const LIMBS: usize> PartialOrd<Odd<Uint<LIMBS>>> for Uint<LIMBS> {
    fn partial_cmp(&self, other: &Odd<Uint<LIMBS>>) -> Option<Ordering> {
        Some(self.cmp(&other.0))
    }
}

impl OddUintRef {
    /// Construct an [`Odd<Uint<T>>`] from the unsigned integer value,
    /// truncating the upper bits if the value is too large to be
    /// represented.
    #[must_use]
    pub const fn to_uint_resize<const T: usize>(&self) -> Odd<Uint<T>> {
        Odd(self.0.to_uint_resize())
    }
}

#[cfg(feature = "alloc")]
impl OddBoxedUint {
    /// Borrow this `OddBoxedUint` as a `&OddUintRef`.
    #[inline]
    #[must_use]
    pub const fn as_uint_ref(&self) -> &OddUintRef {
        self.0.as_uint_ref().as_odd_unchecked()
    }

    /// Generate a random `Odd<Uint<T>>`.
    #[cfg(feature = "rand_core")]
    pub fn random<R: TryRng + ?Sized>(rng: &mut R, bit_length: u32) -> Self {
        let mut ret = BoxedUint::random_bits(rng, bit_length);
        ret.limbs[0] |= Limb::ONE;
        Odd(ret)
    }
}

#[cfg(feature = "alloc")]
impl AsRef<OddUintRef> for OddBoxedUint {
    fn as_ref(&self) -> &OddUintRef {
        self.as_uint_ref()
    }
}

#[cfg(feature = "alloc")]
impl PartialEq<OddBoxedUint> for BoxedUint {
    fn eq(&self, other: &OddBoxedUint) -> bool {
        self.eq(&other.0)
    }
}

#[cfg(feature = "alloc")]
impl PartialOrd<OddBoxedUint> for BoxedUint {
    fn partial_cmp(&self, other: &OddBoxedUint) -> Option<Ordering> {
        Some(self.cmp(&other.0))
    }
}

#[cfg(feature = "alloc")]
impl Resize for OddBoxedUint {
    type Output = Self;

    fn resize_unchecked(self, at_least_bits_precision: u32) -> Self::Output {
        Odd(self.0.resize_unchecked(at_least_bits_precision))
    }

    fn try_resize(self, at_least_bits_precision: u32) -> Option<Self::Output> {
        self.0.try_resize(at_least_bits_precision).map(Odd)
    }
}

#[cfg(feature = "alloc")]
impl Resize for &OddBoxedUint {
    type Output = OddBoxedUint;

    fn resize_unchecked(self, at_least_bits_precision: u32) -> Self::Output {
        Odd((&self.0).resize_unchecked(at_least_bits_precision))
    }

    fn try_resize(self, at_least_bits_precision: u32) -> Option<Self::Output> {
        (&self.0).try_resize(at_least_bits_precision).map(Odd)
    }
}

#[cfg(feature = "rand_core")]
impl<const LIMBS: usize> Random for Odd<Uint<LIMBS>> {
    /// Generate a random `Odd<Uint<T>>`.
    fn try_random_from_rng<R: TryRng + ?Sized>(rng: &mut R) -> Result<Self, R::Error> {
        let mut ret = Uint::try_random_from_rng(rng)?;
        ret.limbs[0] |= Limb::ONE;
        Ok(Odd(ret))
    }
}

impl<T> fmt::Display for Odd<T>
where
    T: fmt::Display + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl<T> fmt::Binary for Odd<T>
where
    T: fmt::Binary + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Binary::fmt(&self.0, f)
    }
}

impl<T> fmt::Octal for Odd<T>
where
    T: fmt::Octal + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Octal::fmt(&self.0, f)
    }
}

impl<T> fmt::LowerHex for Odd<T>
where
    T: fmt::LowerHex + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::LowerHex::fmt(&self.0, f)
    }
}

impl<T> fmt::UpperHex for Odd<T>
where
    T: fmt::UpperHex + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::UpperHex::fmt(&self.0, f)
    }
}

#[cfg(feature = "serde")]
impl<'de, T: Deserialize<'de> + Integer + Zero> Deserialize<'de> for Odd<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value: T = T::deserialize(deserializer)?;
        Option::<Self>::from(Self::new(value)).ok_or(D::Error::invalid_value(
            Unexpected::Other("even"),
            &"a non-zero odd value",
        ))
    }
}

#[cfg(feature = "serde")]
impl<T: Serialize + Zero> Serialize for Odd<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.serialize(serializer)
    }
}

#[cfg(feature = "subtle")]
impl<T> subtle::ConditionallySelectable for Odd<T>
where
    T: Copy,
    Self: CtSelect,
{
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        a.ct_select(b, choice.into())
    }
}

#[cfg(feature = "subtle")]
impl<T> subtle::ConstantTimeEq for Odd<T>
where
    T: ?Sized,
    Self: CtEq,
{
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, other).into()
    }
}

#[cfg(feature = "zeroize")]
impl<T: zeroize::Zeroize> zeroize::Zeroize for Odd<T> {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::Odd;
    use crate::{ConstOne, U128, Uint};

    #[cfg(feature = "alloc")]
    use crate::BoxedUint;

    #[test]
    fn default() {
        assert!(Odd::<U128>::default().is_odd().to_bool());
    }

    #[test]
    fn from_be_hex_when_odd() {
        assert_eq!(
            Odd::<U128>::from_be_hex("00000000000000000000000000000001"),
            Odd::<U128>::ONE
        );
    }

    #[test]
    #[should_panic]
    fn from_be_hex_when_even() {
        let _ = Odd::<U128>::from_be_hex("00000000000000000000000000000002");
    }

    #[test]
    fn from_le_hex_when_odd() {
        assert_eq!(
            Odd::<U128>::from_le_hex("01000000000000000000000000000000"),
            Odd::<U128>::ONE
        );
    }

    #[test]
    #[should_panic]
    fn from_le_hex_when_even() {
        let _ = Odd::<U128>::from_le_hex("20000000000000000000000000000000");
    }

    #[test]
    fn not_odd_numbers() {
        let zero = Odd::new(Uint::<4>::ZERO);
        assert!(bool::from(zero.is_none()));
        let two = Odd::new(Uint::<4>::from(2u8));
        assert!(bool::from(two.is_none()));
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn not_odd_numbers_boxed() {
        let zero = Odd::new(BoxedUint::zero());
        assert!(bool::from(zero.is_none()));
        let two = Odd::new(BoxedUint::from(2u8));
        assert!(bool::from(two.is_none()));
    }
}
