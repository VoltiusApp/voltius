//! Unsigned integer reference type.

mod add;
mod bits;
mod cmp;
mod ct;
mod div;
mod invert_mod;
mod mul;
mod shl;
mod shr;
mod slice;
mod sub;

use crate::{Choice, Limb, NonZero, Odd, Uint, Word};
use core::{
    fmt,
    ops::{Index, IndexMut},
    ptr,
};

#[cfg(feature = "alloc")]
use {
    crate::{BoxedUint, ToUnsigned},
    alloc::borrow::ToOwned,
};

/// Unsigned integer reference type.
///
/// This type contains a limb slice which can be borrowed from either a [`Uint`] or [`BoxedUint`] and
/// thus provides an abstraction for writing shared implementations.
#[repr(transparent)]
#[derive(PartialEq, Eq)]
pub struct UintRef {
    /// Inner limb array. Stored from least significant to most significant.
    // TODO(tarcieri): maintain an invariant of at least one limb?
    pub(crate) limbs: [Limb],
}

impl UintRef {
    /// Create a [`UintRef`] reference type from a [`Limb`] slice.
    #[inline]
    #[must_use]
    pub const fn new(limbs: &[Limb]) -> &Self {
        // SAFETY: `UintRef` is a `repr(transparent)` newtype for `[Limb]`.
        #[allow(unsafe_code)]
        unsafe {
            &*(ptr::from_ref(limbs) as *const UintRef)
        }
    }

    /// Create a mutable [`UintRef`] reference type from a [`Limb`] slice.
    #[inline]
    pub const fn new_mut(limbs: &mut [Limb]) -> &mut Self {
        // SAFETY: `UintRef` is a `repr(transparent)` newtype for `[Limb]`.
        #[allow(unsafe_code)]
        unsafe {
            &mut *(ptr::from_mut(limbs) as *mut UintRef)
        }
    }

    /// Create a new mutable [`UintRef`] reference type from a slice of [`Limb`] arrays.
    pub const fn new_flattened_mut<const N: usize>(slice: &mut [[Limb; N]]) -> &mut Self {
        // This is a temporary shim for `[[T;N]]::as_flattened_mut` which is only const-stable as of
        // Rust 1.87.
        let len = slice.len() * N;

        // SAFETY: we are converting a slice of limb arrays to a slice of limbs, and `len` has been
        // calculated to be the total number of limbs. The pointer has the lifetime of `slice` and
        // is for `Word`, so we're requesting a slice of words the size of the total number of words
        // in the original slice, and giving it a valid pointer to the first word.
        #[allow(unsafe_code)]
        let slice = unsafe { core::slice::from_raw_parts_mut(slice.as_mut_ptr().cast(), len) };
        Self::new_mut(slice)
    }

    /// Borrow the inner `&[Limb]` slice.
    #[inline]
    #[must_use]
    pub const fn as_limbs(&self) -> &[Limb] {
        &self.limbs
    }

    /// Mutably borrow the inner `&mut [Limb]` slice.
    #[inline]
    pub const fn as_mut_limbs(&mut self) -> &mut [Limb] {
        &mut self.limbs
    }

    /// Borrow the inner limbs as a slice of [`Word`]s.
    #[inline]
    #[must_use]
    pub const fn as_words(&self) -> &[Word] {
        Limb::slice_as_words(&self.limbs)
    }

    /// Borrow the inner limbs as a mutable slice of [`Word`]s.
    #[inline]
    pub const fn as_mut_words(&mut self) -> &mut [Word] {
        Limb::slice_as_mut_words(&mut self.limbs)
    }

    /// Get an iterator over the inner limbs.
    #[inline]
    #[must_use]
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = &Limb> {
        self.limbs.iter()
    }

    /// Get a mutable iterator over the inner limbs.
    #[inline]
    #[allow(dead_code)] // TODO(tarcieri): use this
    pub fn iter_mut(&mut self) -> impl DoubleEndedIterator<Item = &mut Limb> {
        self.limbs.iter_mut()
    }

    /// Access the number of limbs.
    #[inline]
    #[must_use]
    pub const fn nlimbs(&self) -> usize {
        self.limbs.len()
    }

    /// Conditionally assign all of the limbs to zero.
    #[inline(always)]
    pub const fn conditional_set_zero(&mut self, choice: Choice) {
        let mut i = 0;
        while i < self.nlimbs() {
            self.limbs[i] = Limb::select(self.limbs[i], Limb::ZERO, choice);
            i += 1;
        }
    }

    /// Conditionally assign all of the limbs to the maximum.
    #[inline]
    pub const fn conditional_set_max(&mut self, choice: Choice) {
        let mut i = 0;
        while i < self.nlimbs() {
            self.limbs[i] = Limb::select(self.limbs[i], Limb::MAX, choice);
            i += 1;
        }
    }

    /// Extract up to `LIMBS` limbs into a new `Uint`.
    #[must_use]
    pub const fn to_uint_resize<const LIMBS: usize>(&self) -> Uint<LIMBS> {
        let mut out = Uint::ZERO;
        let len = if self.nlimbs() > LIMBS {
            LIMBS
        } else {
            self.nlimbs()
        };
        let mut i = 0;
        while i < len {
            out.limbs[i] = self.limbs[i];
            i += 1;
        }
        out
    }

    /// Construct a [`NonZero`] reference, returning [`None`] in the event `self` is `0`.
    #[inline]
    #[must_use]
    pub const fn as_nz_vartime(&self) -> Option<&NonZero<Self>> {
        if self.is_zero_vartime() {
            return None;
        }
        Some(self.as_nz_unchecked())
    }

    /// Cast to [`NonZero`] without first checking that the contained value is non-zero.
    ///
    /// Use with care! This method bypasses [`NonZero`] invariant checks.
    ///
    /// # Warning: Panics
    /// We don't explicitly flag this function as `unsafe` because it doesn't have a memory safety
    /// impact, however functions called with `NonZero` arguments assume this value is non-zero
    /// and may panic if given a zero value.
    #[inline]
    #[must_use]
    #[allow(unsafe_code)]
    pub(crate) const fn as_nz_unchecked(&self) -> &NonZero<Self> {
        // SAFETY: `NonZero` is a `repr(transparent)` newtype
        unsafe { &*(ptr::from_ref(self) as *const NonZero<Self>) }
    }

    /// Construct a [`Odd`] reference, returning [`None`] in the event `self` is even.
    #[inline]
    #[must_use]
    pub const fn as_odd_vartime(&self) -> Option<&Odd<Self>> {
        if !self.is_odd().to_bool_vartime() {
            return None;
        }
        Some(self.as_odd_unchecked())
    }

    /// Cast to [`Odd`] without first checking that the contained value is actually odd.
    ///
    /// Use with care! This method bypasses [`Odd`] invariant checks.
    ///
    /// # Panics
    /// We don't explicitly flag this function as `unsafe` because it doesn't have a memory safety
    /// impact, however functions called with `Odd` arguments assume this value is actually odd
    /// and may panic if given an even value.
    #[inline]
    #[must_use]
    #[allow(unsafe_code)]
    pub(crate) const fn as_odd_unchecked(&self) -> &Odd<Self> {
        // SAFETY: `Odd` is a `repr(transparent)` newtype
        unsafe { &*(ptr::from_ref(self) as *const Odd<Self>) }
    }

    cpubits::cpubits! {
        32 => {
            /// Get the least significant 64-bits.
            #[inline(always)]
            pub(crate) const fn lowest_u64(&self) -> u64 {
                debug_assert!(self.nlimbs() >= 1);
                let mut ret = self.limbs[0].0 as u64;

                if self.nlimbs() >= 2 {
                    ret |= (self.limbs[1].0 as u64) << 32;
                }

                ret
            }
        }
        64 => {
            /// Get the least significant 64-bits.
            #[inline(always)]
            pub(crate) const fn lowest_u64(&self) -> u64 {
                self.limbs[0].0
            }
        }
    }

    /// Perform a carry chain-like operation over the limbs of `lhs` and `rhs` inputs, virtually
    /// padding each with `Limb::ZERO` as needed to match the width of `self` and assigning the
    /// result to `self`.
    #[cfg(feature = "alloc")]
    #[inline(always)]
    pub(crate) fn fold_limbs<F>(&mut self, lhs: &Self, rhs: &Self, mut carry: Limb, f: F) -> Limb
    where
        F: Fn(Limb, Limb, Limb) -> (Limb, Limb),
    {
        for i in 0..self.nlimbs() {
            let &a = lhs.limbs.get(i).unwrap_or(&Limb::ZERO);
            let &b = rhs.limbs.get(i).unwrap_or(&Limb::ZERO);
            (self.limbs[i], carry) = f(a, b, carry);
        }

        carry
    }

    /// Perform a carry chain-like operation over the limbs of the inputs, virtually padding
    /// `rhs` with `Limb::ZERO` as needed to match the width of `self` and assigning the result
    /// to `self`.
    #[cfg(feature = "alloc")]
    #[inline(always)]
    pub(crate) fn fold_limbs_assign<F>(&mut self, rhs: &UintRef, mut carry: Limb, f: F) -> Limb
    where
        F: Fn(Limb, Limb, Limb) -> (Limb, Limb),
    {
        for i in 0..self.nlimbs() {
            let &b = rhs.limbs.get(i).unwrap_or(&Limb::ZERO);
            (self.limbs[i], carry) = f(self.limbs[i], b, carry);
        }

        carry
    }
}

impl AsRef<[Limb]> for UintRef {
    #[inline]
    fn as_ref(&self) -> &[Limb] {
        self.as_limbs()
    }
}

impl AsRef<UintRef> for UintRef {
    #[inline]
    fn as_ref(&self) -> &Self {
        self
    }
}

impl AsMut<[Limb]> for UintRef {
    #[inline]
    fn as_mut(&mut self) -> &mut [Limb] {
        self.as_mut_limbs()
    }
}

impl AsMut<UintRef> for UintRef {
    #[inline]
    fn as_mut(&mut self) -> &mut Self {
        self
    }
}

impl Index<usize> for UintRef {
    type Output = Limb;

    #[inline]
    fn index(&self, index: usize) -> &Limb {
        self.limbs.index(index)
    }
}

impl IndexMut<usize> for UintRef {
    #[inline]
    fn index_mut(&mut self, index: usize) -> &mut Limb {
        self.limbs.index_mut(index)
    }
}

#[cfg(feature = "alloc")]
impl ToOwned for UintRef {
    type Owned = BoxedUint;

    fn to_owned(&self) -> BoxedUint {
        BoxedUint::from(self)
    }
}

#[cfg(feature = "alloc")]
impl ToUnsigned for UintRef {
    type Unsigned = BoxedUint;

    fn to_unsigned(&self) -> Self::Unsigned {
        BoxedUint::from(self)
    }

    fn to_unsigned_zero(&self) -> Self::Unsigned {
        BoxedUint::zero_with_precision(self.bits_precision())
    }
}

impl fmt::Debug for UintRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "UintRef(0x{self:X})")
    }
}

impl fmt::Binary for UintRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if f.alternate() {
            write!(f, "0b")?;
        }

        for limb in self.iter().rev() {
            write!(f, "{:0width$b}", &limb.0, width = Limb::BITS as usize)?;
        }
        Ok(())
    }
}

impl fmt::Display for UintRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::UpperHex::fmt(self, f)
    }
}

impl fmt::LowerHex for UintRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if f.alternate() {
            write!(f, "0x")?;
        }
        for limb in self.iter().rev() {
            write!(f, "{:0width$x}", &limb.0, width = Limb::BYTES * 2)?;
        }
        Ok(())
    }
}

impl fmt::UpperHex for UintRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if f.alternate() {
            write!(f, "0x")?;
        }
        for limb in self.iter().rev() {
            write!(f, "{:0width$X}", &limb.0, width = Limb::BYTES * 2)?;
        }
        Ok(())
    }
}
