//! Wrapper type for non-zero integers.

use crate::{
    Bounded, Choice, ConstOne, Constants, CtAssign, CtEq, CtOption, CtSelect, Encoding, Int, Limb,
    Mul, Odd, One, ToUnsigned, Uint, UintRef, Zero,
};
use core::{
    fmt,
    num::{NonZeroU8, NonZeroU16, NonZeroU32, NonZeroU64, NonZeroU128},
    ops::Deref,
};
use ctutils::{CtAssignSlice, CtEqSlice};

#[cfg(feature = "alloc")]
use crate::BoxedUint;

#[cfg(feature = "hybrid-array")]
use crate::{ArrayEncoding, ByteArray};

#[cfg(feature = "rand_core")]
use {crate::Random, rand_core::TryRng};

#[cfg(feature = "serde")]
use serdect::serde::{
    Deserialize, Deserializer, Serialize, Serializer,
    de::{Error, Unexpected},
};

/// Non-zero limb.
pub type NonZeroLimb = NonZero<Limb>;

/// Non-zero unsigned integer.
pub type NonZeroUint<const LIMBS: usize> = NonZero<Uint<LIMBS>>;

/// Non-zero unsigned integer reference.
pub type NonZeroUintRef = NonZero<UintRef>;

/// Non-zero signed integer.
pub type NonZeroInt<const LIMBS: usize> = NonZero<Int<LIMBS>>;

/// Non-zero boxed unsigned integer.
#[cfg(feature = "alloc")]
pub type NonZeroBoxedUint = NonZero<BoxedUint>;

/// Wrapper type for non-zero integers.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct NonZero<T: ?Sized>(pub(crate) T);

impl<T> NonZero<T> {
    /// Create a new non-zero integer.
    #[inline]
    pub fn new(mut n: T) -> CtOption<Self>
    where
        T: Zero + One + CtAssign,
    {
        let is_zero = n.is_zero();

        // Use one as a placeholder in the event zero is provided, so functions that operate on
        // `NonZero` values really can expect the value to never be zero, even in the case
        // `CtOption::is_some` is false.
        n.ct_assign(&T::one_like(&n), is_zero);
        CtOption::new(Self(n), !is_zero)
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

impl<T: ?Sized> NonZero<T> {
    /// Provides access to the contents of `NonZero` in a `const` context.
    pub const fn as_ref(&self) -> &T {
        &self.0
    }
}

impl<T> NonZero<T>
where
    T: Bounded + ?Sized,
{
    /// Total size of the represented integer in bits.
    pub const BITS: u32 = T::BITS;

    /// Total size of the represented integer in bytes.
    pub const BYTES: usize = T::BYTES;
}

impl<T> NonZero<T>
where
    T: Constants,
{
    /// The value `1`.
    pub const ONE: Self = Self(T::ONE);

    /// Maximum value this integer can express.
    pub const MAX: Self = Self(T::MAX);
}

impl<T> NonZero<T>
where
    T: Zero + One + CtAssign + Encoding,
{
    /// Decode from big endian bytes.
    pub fn from_be_bytes(bytes: T::Repr) -> CtOption<Self> {
        Self::new(T::from_be_bytes(bytes))
    }

    /// Decode from little endian bytes.
    pub fn from_le_bytes(bytes: T::Repr) -> CtOption<Self> {
        Self::new(T::from_le_bytes(bytes))
    }
}

impl<T> ConstOne for NonZero<T>
where
    T: ConstOne + One,
{
    const ONE: Self = Self(T::ONE);
}

impl<T> One for NonZero<T>
where
    T: One,
    Self: CtEq,
{
    #[inline]
    fn one() -> Self {
        Self(T::one())
    }
}

impl<T> num_traits::One for NonZero<T>
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

/// Any non-zero integer multiplied by another non-zero integer is definitionally non-zero.
impl<T> Mul<Self> for NonZero<T>
where
    T: Mul<T, Output = T>,
{
    type Output = Self;

    fn mul(self, rhs: Self) -> Self {
        Self(self.0 * rhs.0)
    }
}

impl NonZero<Limb> {
    /// Creates a new non-zero limb in a const context.
    ///
    /// # Panics
    /// - if the value is zero.
    ///
    /// # Note
    /// In future versions of Rust it should be possible to replace this with
    /// `NonZero::new(…).unwrap()`
    // TODO: Remove when `Self::new` and `CtOption::unwrap` support `const fn`
    #[inline]
    #[must_use]
    #[track_caller]
    pub const fn new_unwrap(n: Limb) -> Self {
        assert!(n.is_nonzero().to_bool_vartime(), "invalid value: zero");
        Self(n)
    }

    /// Create a [`NonZero<Limb>`] from a [`NonZeroU8`] (const-friendly)
    // TODO(tarcieri): replace with `const impl From<NonZeroU8>` when stable
    #[must_use]
    pub const fn from_u8(n: NonZeroU8) -> Self {
        Self(Limb::from_u8(n.get()))
    }

    /// Create a [`NonZero<Limb>`] from a [`NonZeroU16`] (const-friendly)
    // TODO(tarcieri): replace with `const impl From<NonZeroU16>` when stable
    #[must_use]
    pub const fn from_u16(n: NonZeroU16) -> Self {
        Self(Limb::from_u16(n.get()))
    }

    /// Create a [`NonZero<Limb>`] from a [`NonZeroU32`] (const-friendly)
    // TODO(tarcieri): replace with `const impl From<NonZeroU32>` when stable
    #[must_use]
    pub const fn from_u32(n: NonZeroU32) -> Self {
        Self(Limb::from_u32(n.get()))
    }

    cpubits::cpubits! {
        64 => {
            /// Create a [`NonZero<Limb>`] from a [`NonZeroU64`] (const-friendly)
            // TODO(tarcieri): replace with `const impl From<NonZeroU64>` when stable
            #[must_use]
            pub const fn from_u64(n: NonZeroU64) -> Self {
                Self(Limb::from_u64(n.get()))
            }
        }
    }
}

impl<const LIMBS: usize> NonZeroUint<LIMBS> {
    /// Creates a new non-zero integer in a const context.
    ///
    /// In future versions of Rust it should be possible to replace this with
    /// `NonZero::new(…).unwrap()`
    ///
    /// # Panics
    /// - if the value is zero.
    // TODO: Remove when `Self::new` and `CtOption::unwrap` support `const fn`
    #[inline]
    #[track_caller]
    #[must_use]
    pub const fn new_unwrap(n: Uint<LIMBS>) -> Self {
        assert!(n.is_nonzero().to_bool_vartime(), "invalid value: zero");
        Self(n)
    }

    /// Create a new [`NonZero<Uint>`] from the provided big endian hex string.
    ///
    /// # Panics
    /// - if the hex is zero, malformed, or not zero-padded accordingly for the size.
    #[track_caller]
    #[must_use]
    pub const fn from_be_hex(hex: &str) -> Self {
        Self::new_unwrap(Uint::from_be_hex(hex))
    }

    /// Create a new [`NonZero<Uint>`] from the provided little endian hex string.
    ///
    /// # Panics
    /// - if the hex is zero, malformed, or not zero-padded accordingly for the size.
    #[track_caller]
    #[must_use]
    pub const fn from_le_hex(hex: &str) -> Self {
        Self::new_unwrap(Uint::from_le_hex(hex))
    }

    /// Create a [`NonZeroUint`] from a [`NonZeroU8`] (const-friendly)
    // TODO(tarcieri): replace with `const impl From<NonZeroU8>` when stable
    #[must_use]
    pub const fn from_u8(n: NonZeroU8) -> Self {
        Self(Uint::from_u8(n.get()))
    }

    /// Create a [`NonZeroUint`] from a [`NonZeroU16`] (const-friendly)
    // TODO(tarcieri): replace with `const impl From<NonZeroU16>` when stable
    #[must_use]
    pub const fn from_u16(n: NonZeroU16) -> Self {
        Self(Uint::from_u16(n.get()))
    }

    /// Create a [`NonZeroUint`] from a [`NonZeroU32`] (const-friendly)
    // TODO(tarcieri): replace with `const impl From<NonZeroU32>` when stable
    #[must_use]
    pub const fn from_u32(n: NonZeroU32) -> Self {
        Self(Uint::from_u32(n.get()))
    }

    /// Create a [`NonZeroUint`] from a [`NonZeroU64`] (const-friendly)
    // TODO(tarcieri): replace with `const impl From<NonZeroU64>` when stable
    #[must_use]
    pub const fn from_u64(n: NonZeroU64) -> Self {
        Self(Uint::from_u64(n.get()))
    }

    /// Create a [`NonZeroUint`] from a [`NonZeroU128`] (const-friendly)
    // TODO(tarcieri): replace with `const impl From<NonZeroU128>` when stable
    #[must_use]
    pub const fn from_u128(n: NonZeroU128) -> Self {
        Self(Uint::from_u128(n.get()))
    }

    /// Borrow this `NonZero<Uint>` as a `&NonZeroUintRef`.
    #[inline]
    #[must_use]
    pub const fn as_uint_ref(&self) -> &NonZeroUintRef {
        self.0.as_uint_ref().as_nz_unchecked()
    }
}

impl<const LIMBS: usize> AsRef<NonZeroUintRef> for NonZeroUint<LIMBS> {
    fn as_ref(&self) -> &NonZeroUintRef {
        self.as_uint_ref()
    }
}

impl<const LIMBS: usize> NonZeroInt<LIMBS> {
    /// Creates a new non-zero integer in a const context.
    ///
    /// # Panics
    /// - if the value is zero.
    ///
    /// # Note
    /// In future versions of Rust it should be possible to replace this with
    /// `NonZero::new(…).unwrap()`
    // TODO: Remove when `Self::new` and `CtOption::unwrap` support `const fn`
    #[inline]
    #[must_use]
    #[track_caller]
    pub const fn new_unwrap(n: Int<LIMBS>) -> Self {
        assert!(n.is_nonzero().to_bool_vartime(), "invalid value: zero");
        Self(n)
    }

    /// The sign and magnitude of this [`NonZeroInt`].
    #[must_use]
    pub const fn abs_sign(&self) -> (NonZero<Uint<LIMBS>>, Choice) {
        let (abs, sign) = self.0.abs_sign();
        // Absolute value of a non-zero value is non-zero
        (NonZero(abs), sign)
    }

    /// The magnitude of this [`NonZeroInt`].
    #[must_use]
    pub const fn abs(&self) -> NonZero<Uint<LIMBS>> {
        self.abs_sign().0
    }
}

#[cfg(feature = "alloc")]
impl NonZeroBoxedUint {
    /// Borrow this `NonZeroBoxedUint` as a `&NonZeroUintRef`.
    #[inline]
    #[must_use]
    pub fn as_uint_ref(&self) -> &NonZeroUintRef {
        self.0.as_uint_ref().as_nz_unchecked()
    }
}

#[cfg(feature = "alloc")]
impl AsRef<NonZeroUintRef> for NonZeroBoxedUint {
    fn as_ref(&self) -> &NonZeroUintRef {
        self.as_uint_ref()
    }
}

#[cfg(feature = "alloc")]
impl<T: AsRef<UintRef> + ?Sized> NonZero<T> {
    /// Get the least significant limb as a [`NonZeroLimb`].
    pub(crate) fn lower_limb(&self) -> NonZeroLimb {
        NonZero(self.0.as_ref().limbs[0])
    }

    /// Convert to a [`NonZeroBoxedUint`].
    pub(crate) fn to_boxed(&self) -> NonZeroBoxedUint {
        NonZero(BoxedUint::from(self.0.as_ref()))
    }
}

impl<T: ToUnsigned + ?Sized> NonZero<T> {
    /// Convert from a reference into an owned `NonZero<T: Unsigned>`.
    pub fn to_unsigned(&self) -> NonZero<T::Unsigned> {
        NonZero(self.0.to_unsigned())
    }
}

#[cfg(feature = "hybrid-array")]
impl<T> NonZero<T>
where
    T: ArrayEncoding + Zero + One + CtAssign,
{
    /// Decode a non-zero integer from big endian bytes.
    pub fn from_be_byte_array(bytes: ByteArray<T>) -> CtOption<Self> {
        Self::new(T::from_be_byte_array(bytes))
    }

    /// Decode a non-zero integer from little endian bytes.
    pub fn from_le_byte_array(bytes: ByteArray<T>) -> CtOption<Self> {
        Self::new(T::from_le_byte_array(bytes))
    }
}

impl<T: ?Sized> AsRef<T> for NonZero<T> {
    fn as_ref(&self) -> &T {
        &self.0
    }
}

impl<T> CtAssign for NonZero<T>
where
    T: CtAssign,
{
    #[inline]
    fn ct_assign(&mut self, other: &Self, choice: Choice) {
        self.0.ct_assign(&other.0, choice);
    }
}
impl<T> CtAssignSlice for NonZero<T> where T: CtAssign {}

impl<T> CtEq for NonZero<T>
where
    T: CtEq + ?Sized,
{
    #[inline]
    fn ct_eq(&self, other: &Self) -> Choice {
        CtEq::ct_eq(&self.0, &other.0)
    }
}
impl<T> CtEqSlice for NonZero<T> where T: CtEq {}

impl<T> CtSelect for NonZero<T>
where
    T: CtSelect,
{
    #[inline]
    fn ct_select(&self, other: &Self, choice: Choice) -> Self {
        Self(self.0.ct_select(&other.0, choice))
    }
}

impl<T> Default for NonZero<T>
where
    T: One,
{
    #[inline]
    fn default() -> Self {
        Self(T::one())
    }
}

impl<T: ?Sized> Deref for NonZero<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.0
    }
}

#[cfg(feature = "rand_core")]
impl<T> Random for NonZero<T>
where
    T: Random + Zero + One + CtAssign,
{
    /// This uses rejection sampling to avoid zero.
    ///
    /// As a result, it runs in variable time. If the generator `rng` is
    /// cryptographically secure (for example, it implements `CryptoRng`),
    /// then this is guaranteed not to leak anything about the output value.
    fn try_random_from_rng<R: TryRng + ?Sized>(rng: &mut R) -> Result<Self, R::Error> {
        loop {
            if let Some(result) = Self::new(T::try_random_from_rng(rng)?).into() {
                break Ok(result);
            }
        }
    }
}

impl From<NonZeroU8> for NonZero<Limb> {
    fn from(integer: NonZeroU8) -> Self {
        Self::from_u8(integer)
    }
}

impl From<NonZeroU16> for NonZero<Limb> {
    fn from(integer: NonZeroU16) -> Self {
        Self::from_u16(integer)
    }
}

impl From<NonZeroU32> for NonZero<Limb> {
    fn from(integer: NonZeroU32) -> Self {
        Self::from_u32(integer)
    }
}

cpubits::cpubits! {
    64 => {
        impl From<NonZeroU64> for NonZero<Limb> {
            fn from(integer: NonZeroU64) -> Self {
                Self::from_u64(integer)
            }
        }
    }
}

impl<const LIMBS: usize> From<NonZeroU8> for NonZero<Uint<LIMBS>> {
    fn from(integer: NonZeroU8) -> Self {
        Self::from_u8(integer)
    }
}

impl<const LIMBS: usize> From<NonZeroU16> for NonZero<Uint<LIMBS>> {
    fn from(integer: NonZeroU16) -> Self {
        Self::from_u16(integer)
    }
}

impl<const LIMBS: usize> From<NonZeroU32> for NonZero<Uint<LIMBS>> {
    fn from(integer: NonZeroU32) -> Self {
        Self::from_u32(integer)
    }
}

impl<const LIMBS: usize> From<NonZeroU64> for NonZero<Uint<LIMBS>> {
    fn from(integer: NonZeroU64) -> Self {
        Self::from_u64(integer)
    }
}

impl<const LIMBS: usize> From<NonZeroU128> for NonZero<Uint<LIMBS>> {
    fn from(integer: NonZeroU128) -> Self {
        Self::from_u128(integer)
    }
}

impl<T> From<Odd<T>> for NonZero<T> {
    fn from(odd: Odd<T>) -> NonZero<T> {
        NonZero(odd.get())
    }
}

impl<T> fmt::Display for NonZero<T>
where
    T: fmt::Display + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl<T> fmt::Binary for NonZero<T>
where
    T: fmt::Binary + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Binary::fmt(&self.0, f)
    }
}

impl<T> fmt::Octal for NonZero<T>
where
    T: fmt::Octal + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Octal::fmt(&self.0, f)
    }
}

impl<T> fmt::LowerHex for NonZero<T>
where
    T: fmt::LowerHex + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::LowerHex::fmt(&self.0, f)
    }
}

impl<T> fmt::UpperHex for NonZero<T>
where
    T: fmt::UpperHex + ?Sized,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::UpperHex::fmt(&self.0, f)
    }
}

#[cfg(feature = "serde")]
impl<'de, T: Deserialize<'de> + Zero> Deserialize<'de> for NonZero<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value: T = T::deserialize(deserializer)?;

        if bool::from(value.is_zero()) {
            Err(D::Error::invalid_value(
                Unexpected::Other("zero"),
                &"a non-zero value",
            ))
        } else {
            Ok(Self(value))
        }
    }
}

#[cfg(feature = "serde")]
impl<T: Serialize + Zero> Serialize for NonZero<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.serialize(serializer)
    }
}

#[cfg(feature = "subtle")]
impl<T> subtle::ConditionallySelectable for NonZero<T>
where
    T: Copy,
    Self: CtSelect,
{
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        CtSelect::ct_select(a, b, choice.into())
    }
}

#[cfg(feature = "subtle")]
impl<T> subtle::ConstantTimeEq for NonZero<T>
where
    T: ?Sized,
    Self: CtEq,
{
    #[inline]
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, other).into()
    }
}

#[cfg(feature = "zeroize")]
impl<T: zeroize::Zeroize + Zero> zeroize::Zeroize for NonZero<T> {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::NonZero;
    use crate::{I128, One, U128};
    use hex_literal::hex;

    #[test]
    fn default() {
        assert!(!NonZero::<U128>::default().is_zero().to_bool());
    }

    #[test]
    fn from_be_bytes() {
        assert_eq!(
            NonZero::<U128>::from_be_bytes(hex!("00000000000000000000000000000001").into())
                .unwrap(),
            NonZero::<U128>::ONE
        );

        assert_eq!(
            NonZero::<U128>::from_be_bytes(hex!("00000000000000000000000000000000").into())
                .into_option(),
            None
        );
    }

    #[test]
    fn from_le_bytes() {
        assert_eq!(
            NonZero::<U128>::from_le_bytes(hex!("01000000000000000000000000000000").into())
                .unwrap(),
            NonZero::<U128>::ONE
        );

        assert_eq!(
            NonZero::<U128>::from_le_bytes(hex!("00000000000000000000000000000000").into())
                .into_option(),
            None
        );
    }

    #[test]
    fn from_be_hex_when_nonzero() {
        assert_eq!(
            NonZero::<U128>::from_be_hex("00000000000000000000000000000001"),
            NonZero::<U128>::ONE
        );
    }

    #[test]
    #[should_panic]
    fn from_be_hex_when_zero() {
        let _ = NonZero::<U128>::from_be_hex("00000000000000000000000000000000");
    }

    #[test]
    fn from_le_hex_when_nonzero() {
        assert_eq!(
            NonZero::<U128>::from_le_hex("01000000000000000000000000000000"),
            NonZero::<U128>::ONE
        );
    }

    #[test]
    #[should_panic]
    fn from_le_hex_when_zero() {
        let _ = NonZero::<U128>::from_le_hex("00000000000000000000000000000000");
    }

    #[test]
    fn int_abs_sign() {
        let x = I128::from(-55).to_nz().unwrap();
        let (abs, sgn) = x.abs_sign();
        assert_eq!(abs, U128::from(55u32).to_nz().unwrap());
        assert!(sgn.to_bool());
    }

    #[test]
    fn one() {
        assert_eq!(
            NonZero::<U128>::from_le_bytes(hex!("01000000000000000000000000000000").into())
                .unwrap(),
            NonZero::<U128>::one()
        );
    }

    #[cfg(feature = "hybrid-array")]
    #[test]
    fn from_le_byte_array() {
        assert_eq!(
            NonZero::<U128>::from_le_byte_array(hex!("01000000000000000000000000000000").into())
                .unwrap(),
            NonZero::<U128>::ONE
        );
    }
}
