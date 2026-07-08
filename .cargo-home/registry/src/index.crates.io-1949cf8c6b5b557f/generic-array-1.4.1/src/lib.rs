//! This crate implements a structure that can be used as a generic array type.
//!
//! **Requires minimum Rust version of 1.65.0**
//!
//! [Documentation on GH Pages](https://fizyk20.github.io/generic-array/generic_array/)
//! may be required to view certain types on foreign crates.
//!
//! ## Upgrading from 0.14 or using with `hybrid-array 0.4`
//!
//! `generic-array 0.14` has been officially deprecated, so here's a quick guide on how to upgrade from `generic-array 0.14` to `1.x`. Note that libraries depending on `generic-array` will need to update their usage as well. Some libraries are moving to `hybrid-array 0.4` instead, which we provide interoperability with `generic-array 1.x` via the `hybrid-array-0_4` feature flag.
//!
//! <details>
//! <summary>Click to expand</summary>
//!
//! To upgrade to `1.x`, change your `Cargo.toml` to use the new version:
//!
//! ```toml
//! [dependencies]
//! generic-array = "1"
//! ```
//!
//! then in your code, go through and remove the `<T>` from `ArrayLength<T>` bounds, as the type parameter has been removed. It's now just `ArrayLength`.
//!
//! If you _need_ to interoperate with `generic-array 0.14`, enable the `compat-0_14` feature flag:
//!
//! ```toml
//! [dependencies]
//! generic-array = { version = "1", features = ["compat-0_14"] }
//! ```
//!
//! then use the `to_0_14`/`from_0_14`/`as_0_14`/`as_0_14_mut` methods on `GenericArray` to convert between versions, or use the `From`/`AsRef`/`AsMut` implementations.
//!
//! The `arr!` macro has changed to no longer require a type parameter, so change:
//!
//! ```rust,ignore
//! let array = arr![i32; 1, 2, 3];
//! // to
//! let array = arr![1, 2, 3];
//! ```
//!
//! For interoperability with `hybrid-array 0.4`, enable the `hybrid-array-0_4` feature flag:
//!
//! ```toml
//! [dependencies]
//! generic-array = { version = "1", features = ["hybrid-array-0_4"] }
//! ```
//!
//! then use the `to_ha0_4`/`from_ha0_4`/`as_ha0_4`/`as_ha0_4_mut` methods on `GenericArray` to convert between versions, or use the `From`/`AsRef`/`AsMut` implementations.
//!
//! We also implement the `AssocArraySize` and `AsArrayRef`/`AsArrayMut` traits from `hybrid-array` for `GenericArray`.
//!
//! </details>
//!
//! ## Usage
//!
//! Before Rust 1.51, arrays `[T; N]` were problematic in that they couldn't be
//! generic with respect to the length `N`, so this wouldn't work:
//!
//! ```compile_fail
//! struct Foo<N> {
//!     data: [i32; N],
//! }
//! ```
//!
//! Since 1.51, the below syntax is valid:
//!
//! ```rust
//! struct Foo<const N: usize> {
//!     data: [i32; N],
//! }
//! ```
//!
//! However, the const-generics we have as of writing this are still the minimum-viable product (`min_const_generics`), so many situations still result in errors, such as this example:
//!
//! ```compile_fail
//! # struct Foo<const N: usize> {
//! #   data: [i32; N],
//! # }
//! trait Bar {
//!     const LEN: usize;
//!
//!     // Error: cannot perform const operation using `Self`
//!     fn bar(&self) -> Foo<{ Self::LEN }>;
//! }
//! ```
//!
//! **generic-array** defines a new trait [`ArrayLength`] and a struct [`GenericArray<T, N: ArrayLength>`](GenericArray),
//! which lets the above be implemented as:
//!
//! ```rust
//! use generic_array::{GenericArray, ArrayLength};
//!
//! struct Foo<N: ArrayLength> {
//!     data: GenericArray<i32, N>
//! }
//!
//! trait Bar {
//!     type LEN: ArrayLength;
//!     fn bar(&self) -> Foo<Self::LEN>;
//! }
//! ```
//!
//! The [`ArrayLength`] trait is implemented for
//! [unsigned integer types](typenum::Unsigned) from
//! [typenum]. For example, [`GenericArray<T, U5>`] would work almost like `[T; 5]`:
//!
//! ```rust
//! # use generic_array::{ArrayLength, GenericArray};
//! use generic_array::typenum::U5;
//!
//! struct Foo<T, N: ArrayLength> {
//!     data: GenericArray<T, N>
//! }
//!
//! let foo = Foo::<i32, U5> { data: GenericArray::default() };
//! ```
//!
//! The `arr!` macro is provided to allow easier creation of literal arrays, as shown below:
//!
//! ```rust
//! # use generic_array::arr;
//! let array = arr![1, 2, 3];
//! //  array: GenericArray<i32, typenum::U3>
//! assert_eq!(array[2], 3);
//! ```
//! ## Feature flags
//!
//! ```toml
//! [dependencies.generic-array]
//! features = [
//!     "serde",            # Serialize/Deserialize implementation
//!     "zeroize",          # Zeroize implementation for setting array elements to zero
//!     "const-default",    # Compile-time const default value support via trait
//!     "alloc",            # Enables From/TryFrom implementations between GenericArray and Vec<T>/Box<[T]>
//!     "faster-hex",       # Enables internal use of the `faster-hex` crate for faster hex encoding via SIMD
//!     "subtle",           # Enables `subtle` crate support for constant-time equality checks and conditional selection
//!     "arbitrary",        # Enables `arbitrary` crate support for fuzzing
//!     "bytemuck",         # Enables `bytemuck` crate support
//!     "bitvec",           # Enables `bitvec` crate support to use GenericArray as a storage backend for bit arrays
//!     "as_slice",         # Enables `as-slice` crate trait impls
//!     "compat-0_14",      # Enables interoperability with `generic-array` 0.14
//!     "hybrid-array-0_4"  # Enables interoperability with `hybrid-array` 0.4
//! ]
//! ```

#![no_std]
#![deny(missing_docs, meta_variable_misuse, clippy::missing_safety_doc)]
#![cfg_attr(docsrs, feature(doc_cfg))]

pub extern crate typenum;

#[doc(hidden)]
#[cfg(feature = "alloc")]
pub extern crate alloc;

mod compat;
mod hex;
mod impls;
mod iter;

mod ext_impls;

/// `BitArray` type alias with `GenericArray` as the backing storage
#[cfg(feature = "bitvec")]
pub type GenericBitArray<T, N, O = bitvec::order::Lsb0> =
    bitvec::array::BitArray<GenericArray<T, N>, O>;

use core::cell::Cell;
use core::iter::FromIterator;
use core::marker::PhantomData;
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ops::{Deref, DerefMut};
use core::{mem, ptr, slice};
use typenum::bit::{B0, B1};
use typenum::generic_const_mappings::{Const, ToUInt};
use typenum::uint::{UInt, UTerm, Unsigned};

#[doc(hidden)]
#[cfg_attr(test, macro_use)]
pub mod arr;

pub mod functional;
pub mod sequence;

mod internal;

// re-export to allow doc_auto_cfg to handle it
#[cfg(feature = "internals")]
pub mod internals {
    //! Very unsafe internal functionality.
    //!
    //! These are used internally for building and consuming generic arrays. When used correctly,
    //! they can ensure elements are correctly dropped if something panics while using them.
    //!
    //! The API of these is not guaranteed to be stable, as they are not intended for general use.

    pub use crate::internal::{IntrusiveArrayBuilder, IntrusiveArrayConsumer};

    // soft-deprecated
    pub use crate::internal::{ArrayBuilder, ArrayConsumer};
}

use internal::{IntrusiveArrayBuilder, IntrusiveArrayConsumer, Sealed};

use self::functional::*;
use self::sequence::*;

pub use self::iter::GenericArrayIter;

/// `ArrayLength` is a type-level [`Unsigned`] integer used to
/// define the number of elements in a [`GenericArray`].
///
/// Consider `N: ArrayLength` to be equivalent to `const N: usize`
///
/// ```
/// # use generic_array::{GenericArray, ArrayLength};
/// fn foo<N: ArrayLength>(arr: GenericArray<i32, N>) -> i32 {
///     arr.iter().sum()
/// }
/// ```
/// is equivalent to:
/// ```
/// fn foo<const N: usize>(arr: [i32; N]) -> i32 {
///     arr.iter().sum()
/// }
/// ```
///
/// # Safety
///
/// This trait is effectively sealed due to only being allowed on [`Unsigned`] types,
/// and therefore cannot be implemented in user code.
///
/// Furthermore, this is limited to lengths less than or equal to `usize::MAX`.
/// ```compile_fail
/// # #![recursion_limit = "256"]
/// # use generic_array::{GenericArray, ArrayLength};
/// # use generic_array::typenum::{self, Unsigned};
/// type Empty = core::convert::Infallible; // Uninhabited ZST, size_of::<Empty>() == 0
///
/// // 2^64, greater than usize::MAX on 64-bit systems
/// type TooBig = typenum::operator_aliases::Shleft<typenum::U1, typenum::U64>;
///
/// // Compile Error due to ArrayLength not implemented for TooBig
/// let _ = GenericArray::<Empty, TooBig>::from_slice(&[]);
/// ```
pub unsafe trait ArrayLength: Unsigned + 'static {
    /// Associated type representing the underlying contiguous memory
    /// that constitutes an array with the given number of elements.
    ///
    /// This is an implementation detail, but is required to be public in cases where certain attributes
    /// of the inner type of [`GenericArray`] cannot be proven, such as [`Copy`] bounds.
    ///
    /// [`Copy`] example:
    /// ```
    /// # use generic_array::{GenericArray, ArrayLength};
    /// struct MyType<N: ArrayLength> {
    ///     data: GenericArray<f32, N>,
    /// }
    ///
    /// impl<N: ArrayLength> Clone for MyType<N> where N::ArrayType<f32>: Copy {
    ///     fn clone(&self) -> Self { MyType { ..*self } }
    /// }
    ///
    /// impl<N: ArrayLength> Copy for MyType<N> where N::ArrayType<f32>: Copy {}
    /// ```
    ///
    /// Alternatively, using the entire `GenericArray<f32, N>` type as the bounds works:
    /// ```ignore
    /// where GenericArray<f32, N>: Copy
    /// ```
    type ArrayType<T>: Sealed;
}

unsafe impl ArrayLength for UTerm {
    #[doc(hidden)]
    type ArrayType<T> = [T; 0];
}

/// Implemented for types which can have an associated [`ArrayLength`],
/// such as [`Const<N>`] for use with const-generics.
///
/// ```
/// use generic_array::{GenericArray, IntoArrayLength, ConstArrayLength, typenum::Const};
///
/// fn some_array_interopt<const N: usize>(value: [u32; N]) -> GenericArray<u32, ConstArrayLength<N>>
/// where
///     Const<N>: IntoArrayLength,
/// {
///     let ga = GenericArray::from(value);
///     // do stuff
///     ga
/// }
/// ```
///
/// This is mostly to simplify the `where` bounds, equivalent to:
///
/// ```
/// use generic_array::{GenericArray, ArrayLength, typenum::{Const, U, ToUInt}};
///
/// fn some_array_interopt<const N: usize>(value: [u32; N]) -> GenericArray<u32, U<N>>
/// where
///     Const<N>: ToUInt,
///     U<N>: ArrayLength,
/// {
///     let ga = GenericArray::from(value);
///     // do stuff
///     ga
/// }
/// ```
pub trait IntoArrayLength {
    /// The associated `ArrayLength`
    type ArrayLength: ArrayLength;
}

impl<const N: usize> IntoArrayLength for Const<N>
where
    Const<N>: ToUInt,
    typenum::U<N>: ArrayLength,
{
    type ArrayLength = typenum::U<N>;
}

impl<N> IntoArrayLength for N
where
    N: ArrayLength,
{
    type ArrayLength = Self;
}

/// Associated [`ArrayLength`] for one [`Const<N>`]
///
/// See [`IntoArrayLength`] for more information.
///
/// Note that not all `N` values are valid due to limitations inherent to `typenum` and Rust. You
/// may need to combine [Const] with other typenum operations to get the desired length.
pub type ConstArrayLength<const N: usize> = <Const<N> as IntoArrayLength>::ArrayLength;

/// [`GenericArray`] with a const-generic `usize` length, using the [`ConstArrayLength`] type alias for `N`.
///
/// To construct from a literal array, use [`from_array`](GenericArray::from_array).
///
/// Note that not all `N` values are valid due to limitations inherent to `typenum` and Rust. You
/// may need to combine [Const] with other typenum operations to get the desired length.
pub type ConstGenericArray<T, const N: usize> = GenericArray<T, ConstArrayLength<N>>;

/// Internal type used to generate a struct of appropriate size
#[allow(dead_code)]
#[repr(C)]
#[doc(hidden)]
pub struct GenericArrayImplEven<T, U> {
    parents: [U; 2],
    _marker: PhantomData<T>,
}

/// Internal type used to generate a struct of appropriate size
#[allow(dead_code)]
#[repr(C)]
#[doc(hidden)]
pub struct GenericArrayImplOdd<T, U> {
    parents: [U; 2],
    data: T,
}

impl<T: Clone, U: Clone> Clone for GenericArrayImplEven<T, U> {
    #[inline(always)]
    fn clone(&self) -> GenericArrayImplEven<T, U> {
        // Clone is never called on the GenericArrayImpl types,
        // as we use `self.map(clone)` elsewhere. This helps avoid
        // extra codegen for recursive clones when they are never used.
        unsafe { core::hint::unreachable_unchecked() }
    }
}

impl<T: Clone, U: Clone> Clone for GenericArrayImplOdd<T, U> {
    #[inline(always)]
    fn clone(&self) -> GenericArrayImplOdd<T, U> {
        unsafe { core::hint::unreachable_unchecked() }
    }
}

// Even if Clone is never used, they can still be byte-copyable.
impl<T: Copy, U: Copy> Copy for GenericArrayImplEven<T, U> {}
impl<T: Copy, U: Copy> Copy for GenericArrayImplOdd<T, U> {}

impl<T, U> Sealed for GenericArrayImplEven<T, U> {}
impl<T, U> Sealed for GenericArrayImplOdd<T, U> {}

// 1 << (size_of::<usize>() << 3) == usize::MAX + 1
type MaxArrayLengthP1 = typenum::Shleft<
    typenum::U1,
    typenum::Shleft<typenum::U<{ mem::size_of::<usize>() }>, typenum::U3>,
>;

/// Helper trait to hide the complex bound under a simpler name
trait IsWithinUsizeBound: typenum::IsLess<MaxArrayLengthP1, Output = typenum::consts::True> {}

impl<N> IsWithinUsizeBound for N where
    N: typenum::IsLess<MaxArrayLengthP1, Output = typenum::consts::True>
{
}

unsafe impl<N: ArrayLength> ArrayLength for UInt<N, B0>
where
    Self: IsWithinUsizeBound,
{
    #[doc(hidden)]
    type ArrayType<T> = GenericArrayImplEven<T, N::ArrayType<T>>;
}

unsafe impl<N: ArrayLength> ArrayLength for UInt<N, B1>
where
    Self: IsWithinUsizeBound,
{
    #[doc(hidden)]
    type ArrayType<T> = GenericArrayImplOdd<T, N::ArrayType<T>>;
}

/// Struct representing a generic array - `GenericArray<T, N>` works like `[T; N]`
///
/// For how to implement [`Copy`] on structs using a generic-length `GenericArray` internally, see
/// the docs for [`ArrayLength::ArrayType`].
///
/// # Usage Notes
///
/// ### Initialization
///
/// Initialization of known-length `GenericArray`s can be done via the [`arr![]`](arr!) macro,
/// or [`from_array`](GenericArray::from_array)/[`from_slice`](GenericArray::from_slice).
///
/// For generic arrays of unknown/generic length, several safe methods are included to initialize
/// them, such as the [`GenericSequence::generate`] method:
///
/// ```rust
/// use generic_array::{GenericArray, sequence::GenericSequence, typenum, arr};
///
/// let evens: GenericArray<i32, typenum::U4> =
///            GenericArray::generate(|i: usize| i as i32 * 2);
///
/// assert_eq!(evens, arr![0, 2, 4, 6]);
/// ```
///
/// Furthermore, [`FromIterator`] and [`try_from_iter`](GenericArray::try_from_iter) exist to construct them
/// from iterators, but will panic/fail if not given exactly the correct number of elements.
///
/// ### Utilities
///
/// The [`GenericSequence`], [`FunctionalSequence`], [`Lengthen`], [`Shorten`], [`Split`], and [`Concat`] traits implement
/// some common operations on generic arrays.
///
/// ### Optimizations
///
/// Prefer to use the slice iterators like `.iter()`/`.iter_mut()` rather than by-value [`IntoIterator`]/[`GenericArrayIter`] if you can.
/// Slices optimize better. Using the [`FunctionalSequence`] methods also optimize well.
///
/// # How it works
///
/// The `typenum` crate uses Rust's type system to define binary integers as nested types,
/// and allows for operations which can be applied to those type-numbers, such as `Add`, `Sub`, etc.
///
/// e.g. `6` would be `UInt<UInt<UInt<UTerm, B1>, B1>, B0>`
///
/// `generic-array` uses this nested type to recursively allocate contiguous elements, statically.
/// The [`ArrayLength`] trait is implemented on `UInt<N, B0>`, `UInt<N, B1>` and `UTerm`,
/// which correspond to even, odd and zero numeric values, respectively.
/// Together, these three cover all cases of `Unsigned` integers from `typenum`.
/// For `UInt<N, B0>` and `UInt<N, B1>`, it peels away the highest binary digit and
/// builds up a recursive structure that looks almost like a binary tree.
/// Then, within `GenericArray`, the recursive structure is reinterpreted as a contiguous
/// chunk of memory and allowing access to it as a slice.
///
/// <details>
/// <summary><strong>Expand for internal structure demonstration</strong></summary>
///
/// For example, `GenericArray<T, U6>` more or less expands to (at compile time):
///
/// ```ignore
/// GenericArray {
///     // 6 = UInt<UInt<UInt<UTerm, B1>, B1>, B0>
///     data: EvenData {
///         // 3 = UInt<UInt<UTerm, B1>, B1>
///         left: OddData {
///             // 1 = UInt<UTerm, B1>
///             left: OddData {
///                 left: (),  // UTerm
///                 right: (), // UTerm
///                 data: T,   // Element 0
///             },
///             // 1 = UInt<UTerm, B1>
///             right: OddData {
///                 left: (),  // UTerm
///                 right: (), // UTerm
///                 data: T,   // Element 1
///             },
///             data: T        // Element 2
///         },
///         // 3 = UInt<UInt<UTerm, B1>, B1>
///         right: OddData {
///             // 1 = UInt<UTerm, B1>
///             left: OddData {
///                 left: (),  // UTerm
///                 right: (), // UTerm
///                 data: T,   // Element 3
///             },
///             // 1 = UInt<UTerm, B1>
///             right: OddData {
///                 left: (),  // UTerm
///                 right: (), // UTerm
///                 data: T,   // Element 4
///             },
///             data: T        // Element 5
///         }
///     }
/// }
/// ```
///
/// This has the added benefit of only being `log2(N)` deep, which is important for things like `Drop`
/// to avoid stack overflows, since we can't implement `Drop` manually.
///
/// Then, we take the contiguous block of data and cast it to `*const T` or `*mut T` and use it as a slice:
///
/// ```ignore
/// unsafe {
///     slice::from_raw_parts(
///         self as *const GenericArray<T, N> as *const T,
///         <N as Unsigned>::USIZE
///     )
/// }
/// ```
///
/// </details>
#[repr(transparent)]
pub struct GenericArray<T, N: ArrayLength> {
    #[allow(dead_code)] // data is never accessed directly
    data: N::ArrayType<T>,
}

unsafe impl<T: Send, N: ArrayLength> Send for GenericArray<T, N> {}
unsafe impl<T: Sync, N: ArrayLength> Sync for GenericArray<T, N> {}

impl<T, N: ArrayLength> Deref for GenericArray<T, N> {
    type Target = [T];

    #[inline(always)]
    fn deref(&self) -> &[T] {
        GenericArray::as_slice(self)
    }
}

impl<T, N: ArrayLength> DerefMut for GenericArray<T, N> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut [T] {
        GenericArray::as_mut_slice(self)
    }
}

impl<'a, T: 'a, N: ArrayLength> IntoIterator for &'a GenericArray<T, N> {
    type IntoIter = slice::Iter<'a, T>;
    type Item = &'a T;

    #[inline]
    fn into_iter(self: &'a GenericArray<T, N>) -> Self::IntoIter {
        self.as_slice().iter()
    }
}

impl<'a, T: 'a, N: ArrayLength> IntoIterator for &'a mut GenericArray<T, N> {
    type IntoIter = slice::IterMut<'a, T>;
    type Item = &'a mut T;

    #[inline]
    fn into_iter(self: &'a mut GenericArray<T, N>) -> Self::IntoIter {
        self.as_mut_slice().iter_mut()
    }
}

impl<T, N: ArrayLength> FromIterator<T> for GenericArray<T, N> {
    /// Create a `GenericArray` from an iterator.
    ///
    /// Will panic if the number of elements is not exactly the array length.
    ///
    /// See [`GenericArray::try_from_iter`] for a fallible alternative.
    #[inline]
    fn from_iter<I>(iter: I) -> GenericArray<T, N>
    where
        I: IntoIterator<Item = T>,
    {
        match Self::try_from_iter(iter) {
            Ok(res) => res,
            Err(_) => from_iter_length_fail(N::USIZE),
        }
    }
}

#[inline(never)]
#[cold]
pub(crate) fn from_iter_length_fail(length: usize) -> ! {
    panic!("GenericArray::from_iter expected {length} items");
}

unsafe impl<T, N: ArrayLength> GenericSequence<T> for GenericArray<T, N>
where
    Self: IntoIterator<Item = T>,
{
    type Length = N;
    type Sequence = Self;

    #[inline(always)]
    fn generate<F>(mut f: F) -> GenericArray<T, N>
    where
        F: FnMut(usize) -> T,
    {
        unsafe {
            let mut array = MaybeUninit::<GenericArray<T, N>>::uninit();
            let mut builder = IntrusiveArrayBuilder::new_alt(&mut array);

            let (builder_iter, position) = builder.iter_position();

            builder_iter.enumerate().for_each(|(i, dst)| {
                dst.write(f(i));
                *position += 1;
            });

            builder.finish_and_assume_init()
        }
    }

    #[inline(always)]
    fn inverted_zip<B, U, F>(
        self,
        lhs: GenericArray<B, Self::Length>,
        mut f: F,
    ) -> MappedSequence<GenericArray<B, Self::Length>, B, U>
    where
        GenericArray<B, Self::Length>:
            GenericSequence<B, Length = Self::Length> + MappedGenericSequence<B, U>,
        Self: MappedGenericSequence<T, U>,
        F: FnMut(B, Self::Item) -> U,
    {
        unsafe {
            let mut left = ManuallyDrop::new(lhs);
            let mut right = ManuallyDrop::new(self);

            if mem::needs_drop::<T>() || mem::needs_drop::<B>() {
                let mut left = IntrusiveArrayConsumer::new(&mut left);
                let mut right = IntrusiveArrayConsumer::new(&mut right);

                let (left_array_iter, left_position) = left.iter_position();
                let (right_array_iter, right_position) = right.iter_position();

                FromIterator::from_iter(left_array_iter.zip(right_array_iter).map(|(l, r)| {
                    let left_value = ptr::read(l);
                    let right_value = ptr::read(r);

                    *left_position += 1;
                    *right_position = *left_position;

                    f(left_value, right_value)
                }))
            } else {
                // Neither right nor left require `Drop` be called, so choose an iterator that's easily optimized,
                // though we still keep them in `ManuallyDrop` out of paranoia.
                //
                // Note that because ArrayConsumer checks for `needs_drop` itself, if `f` panics then nothing
                // would have been done about it anyway. Only the other branch needs `ArrayConsumer`
                FromIterator::from_iter(left.iter().zip(right.iter()).map(|(l, r)| {
                    f(ptr::read(l), ptr::read(r)) //
                }))
            }
        }
    }

    #[inline(always)]
    fn inverted_zip2<B, Lhs, U, F>(self, lhs: Lhs, mut f: F) -> MappedSequence<Lhs, B, U>
    where
        Lhs: GenericSequence<B, Length = Self::Length> + MappedGenericSequence<B, U>,
        Self: MappedGenericSequence<T, U>,
        F: FnMut(Lhs::Item, Self::Item) -> U,
    {
        unsafe {
            if mem::needs_drop::<T>() {
                let mut right = ManuallyDrop::new(self);
                let mut right = IntrusiveArrayConsumer::new(&mut right);

                let (right_array_iter, right_position) = right.iter_position();

                FromIterator::from_iter(right_array_iter.zip(lhs).map(|(r, left_value)| {
                    let right_value = ptr::read(r);

                    *right_position += 1;

                    f(left_value, right_value)
                }))
            } else {
                let right = ManuallyDrop::new(self);

                // Similar logic to `inverted_zip`'s no-drop branch
                FromIterator::from_iter(right.iter().zip(lhs).map(|(r, left_value)| {
                    f(left_value, ptr::read(r)) //
                }))
            }
        }
    }
}

impl<T, N: ArrayLength> FromFallibleIterator<T> for GenericArray<T, N> {
    #[inline(always)]
    fn from_fallible_iter<I, E>(iter: I) -> Result<Self, E>
    where
        I: IntoIterator<Item = Result<T, E>>,
    {
        match Self::try_from_fallible_iter(iter) {
            Ok(res) => res,
            Err(_) => from_iter_length_fail(N::USIZE),
        }
    }
}

unsafe impl<T, N: ArrayLength> FallibleGenericSequence<T> for GenericArray<T, N>
where
    Self: IntoIterator<Item = T>,
{
    type Error = core::convert::Infallible;

    #[inline(always)]
    fn try_generate<F, E>(mut f: F) -> Result<Result<Self::Sequence, E>, Self::Error>
    where
        F: FnMut(usize) -> Result<T, E>,
    {
        unsafe {
            let mut array = MaybeUninit::<GenericArray<T, N>>::uninit();
            let mut builder = IntrusiveArrayBuilder::new_alt(&mut array);

            let (builder_iter, position) = builder.iter_position();

            if let Err(e) = builder_iter
                .enumerate()
                .try_for_each(|(i, dst)| match f(i) {
                    // NOTE: Using a match here instead of ? results in better codegen
                    Ok(value) => {
                        dst.write(value);
                        *position += 1;
                        Ok(())
                    }
                    Err(e) => Err(e),
                })
            {
                drop(builder); // explicitly drop to run the destructor and drop any initialized elements

                return Ok(Err(e));
            }

            Ok(Ok(builder.finish_and_assume_init()))
        }
    }
}

impl<T, U, N: ArrayLength> MappedGenericSequence<T, U> for GenericArray<T, N>
where
    GenericArray<U, N>: GenericSequence<U, Length = N>,
{
    type Mapped = GenericArray<U, N>;
}

impl<T, N: ArrayLength> FunctionalSequence<T> for GenericArray<T, N>
where
    Self: GenericSequence<T, Item = T, Length = N>,
{
    #[inline(always)]
    fn map<U, F>(self, mut f: F) -> MappedSequence<Self, T, U>
    where
        Self: MappedGenericSequence<T, U>,
        F: FnMut(T) -> U,
    {
        unsafe {
            let mut array = ManuallyDrop::new(self);
            let mut source = IntrusiveArrayConsumer::new(&mut array);

            let (array_iter, position) = source.iter_position();

            FromIterator::from_iter(array_iter.map(|src| {
                let value = ptr::read(src);

                *position += 1;

                f(value)
            }))
        }
    }

    #[inline(always)]
    fn try_map<U, F, E>(self, mut f: F) -> Result<MappedSequence<Self, T, U>, E>
    where
        Self: MappedGenericSequence<T, U>,
        MappedSequence<Self, T, U>: FromFallibleIterator<U>,
        F: FnMut(Self::Item) -> Result<U, E>,
    {
        unsafe {
            let mut array = ManuallyDrop::new(self);
            let mut source = IntrusiveArrayConsumer::new(&mut array);

            let (array_iter, position) = source.iter_position();

            FromFallibleIterator::from_fallible_iter(array_iter.map(|src| {
                let value = ptr::read(src);
                *position += 1;
                f(value)
            }))
        }
    }

    #[inline(always)]
    fn zip<B, Rhs, U, F>(self, rhs: Rhs, f: F) -> MappedSequence<Self, T, U>
    where
        Self: MappedGenericSequence<T, U>,
        Rhs: MappedGenericSequence<B, U, Mapped = MappedSequence<Self, T, U>>,
        Rhs: GenericSequence<B, Length = Self::Length>,
        F: FnMut(T, Rhs::Item) -> U,
    {
        rhs.inverted_zip(self, f)
    }

    #[inline(always)]
    fn fold<U, F>(self, init: U, mut f: F) -> U
    where
        F: FnMut(U, T) -> U,
    {
        unsafe {
            let mut array = ManuallyDrop::new(self);
            let mut source = IntrusiveArrayConsumer::new(&mut array);

            let (array_iter, position) = source.iter_position();

            array_iter.fold(init, |acc, src| {
                let value = ptr::read(src);
                *position += 1;
                f(acc, value)
            })
        }
    }

    #[inline(always)]
    fn try_fold<U, E, F>(self, init: U, mut f: F) -> Result<U, E>
    where
        F: FnMut(U, Self::Item) -> Result<U, E>,
    {
        unsafe {
            let mut array = ManuallyDrop::new(self);
            let mut source = IntrusiveArrayConsumer::new(&mut array);

            let (mut array_iter, position) = source.iter_position();

            array_iter.try_fold(init, |acc, src| {
                let value = ptr::read(src);
                *position += 1;
                f(acc, value)
            })
        }
    }
}

impl<T, N: ArrayLength> GenericArray<T, N> {
    /// Returns the number of elements in the array.
    ///
    /// Equivalent to [`<N as Unsigned>::USIZE`](typenum::Unsigned) where `N` is the array length.
    ///
    /// Useful for when only a type alias is available.
    pub const fn len() -> usize {
        N::USIZE
    }

    /// Extracts a slice containing the entire array.
    #[inline(always)]
    pub const fn as_slice(&self) -> &[T] {
        unsafe { slice::from_raw_parts(self as *const Self as *const T, N::USIZE) }
    }

    /// Extracts a mutable slice containing the entire array.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn as_mut_slice(&mut self) -> &mut [T] {
        unsafe { slice::from_raw_parts_mut(self as *mut Self as *mut T, N::USIZE) }
    }

    /// Converts a slice to a generic array reference with inferred length.
    ///
    /// # Panics
    ///
    /// Panics if the slice is not equal to the length of the array.
    ///
    /// Consider [`TryFrom`]/[`TryInto`] for a fallible conversion,
    /// or [`try_from_slice`](GenericArray::try_from_slice) for use in const expressions.
    #[inline(always)]
    pub const fn from_slice(slice: &[T]) -> &GenericArray<T, N> {
        if slice.len() != N::USIZE {
            panic!("slice.len() != N in GenericArray::from_slice");
        }

        unsafe { &*(slice.as_ptr() as *const GenericArray<T, N>) }
    }

    /// Converts a slice to a generic array reference with inferred length.
    ///
    /// This is a fallible alternative to [`from_slice`](GenericArray::from_slice), and can be used in const expressions,
    /// but [`TryFrom`]/[`TryInto`] are also available to do the same thing.
    #[inline(always)]
    pub const fn try_from_slice(slice: &[T]) -> Result<&GenericArray<T, N>, LengthError> {
        if slice.len() != N::USIZE {
            return Err(LengthError);
        }

        Ok(unsafe { &*(slice.as_ptr() as *const GenericArray<T, N>) })
    }

    /// Converts a mutable slice to a mutable generic array reference with inferred length.
    ///
    /// # Panics
    ///
    /// Panics if the slice is not equal to the length of the array.
    ///
    /// Consider [`TryFrom`]/[`TryInto`] for a fallible conversion.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn from_mut_slice(slice: &mut [T]) -> &mut GenericArray<T, N> {
        assert!(
            slice.len() == N::USIZE,
            "slice.len() != N in GenericArray::from_mut_slice"
        );

        unsafe { &mut *(slice.as_mut_ptr() as *mut GenericArray<T, N>) }
    }

    /// Converts a mutable slice to a mutable generic array reference with inferred length.
    ///
    /// This is a fallible alternative to [`from_mut_slice`](GenericArray::from_mut_slice),
    /// and is equivalent to the [`TryFrom`] implementation with the added benefit of being `const`.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn try_from_mut_slice(slice: &mut [T]) -> Result<&mut GenericArray<T, N>, LengthError> {
        match slice.len() == N::USIZE {
            true => Ok(GenericArray::from_mut_slice(slice)),
            false => Err(LengthError),
        }
    }

    /// Borrows each element and returns a `GenericArray` of references
    /// with the same length as `self`.
    ///
    /// This method is const since Rust 1.83.0, but non-const before.
    ///
    /// See also [`each_mut`](GenericArray::each_mut) for mutable references.
    ///
    /// # Example
    ///
    /// ```
    /// # use generic_array::{arr, GenericArray};
    /// let ga = arr![1, 2, 3];
    /// let refs: GenericArray<&i32, _> = ga.each_ref();
    /// assert_eq!(*refs[0], 1);
    /// assert_eq!(*refs[1], 2);
    /// assert_eq!(*refs[2], 3);
    /// ```
    #[rustversion::attr(since(1.83), const)] // needed for `as_mut_slice` to be const
    pub fn each_ref(&self) -> GenericArray<&T, N> {
        let mut out: GenericArray<MaybeUninit<*const T>, N> = GenericArray::uninit();

        {
            // only slices allow `const` indexing
            let (this, out) = (self.as_slice(), out.as_mut_slice());

            let mut i = 0;
            while i < N::USIZE {
                out[i].write(ptr::addr_of!(this[i]));
                i += 1;
            }
        }

        // SAFETY: `*const T` has the same layout as `&T`, and we've also initialized each pointer as a valid reference.
        unsafe { const_transmute(out) }
    }

    /// Borrows each element mutably and returns a `GenericArray` of mutable references
    /// with the same length as `self`.
    ///
    /// This method is const since Rust 1.83.0, but non-const before.
    ///
    /// # Example
    ///
    /// ```
    /// # use generic_array::{arr, GenericArray};
    /// let mut ga = arr![1, 2, 3];
    /// let mut_refs: GenericArray<&mut i32, _> = ga.each_mut();
    /// for r in mut_refs {
    ///     *r *= 2;
    /// }
    /// assert_eq!(ga, arr![2, 4, 6]);
    /// ```
    #[rustversion::attr(since(1.83), const)]
    pub fn each_mut(&mut self) -> GenericArray<&mut T, N> {
        let mut out: GenericArray<MaybeUninit<*mut T>, N> = GenericArray::uninit();

        {
            // only slices allow `const` indexing
            let (this, out) = (self.as_mut_slice(), out.as_mut_slice());

            let mut i = 0;
            while i < N::USIZE {
                out[i].write(ptr::addr_of_mut!(this[i]));
                i += 1;
            }
        }

        // SAFETY: `*mut T` has the same layout as `&mut T`, and we've also initialized each pointer as a valid reference.
        unsafe { const_transmute(out) }
    }

    /// Converts a slice of `T` elements into a slice of `GenericArray<T, N>` chunks.
    ///
    /// Any remaining elements that do not fill the array will be returned as a second slice.
    ///
    /// # Panics
    ///
    /// Panics if `N` is `U0` _AND_ the input slice is not empty.
    pub const fn chunks_from_slice(slice: &[T]) -> (&[GenericArray<T, N>], &[T]) {
        if N::USIZE == 0 {
            assert!(slice.is_empty(), "GenericArray length N must be non-zero");
            return (&[], &[]);
        }

        // NOTE: Using `slice.split_at` adds an unnecessary assert
        let num_chunks = slice.len() / N::USIZE; // integer division
        let num_in_chunks = num_chunks * N::USIZE;
        let num_remainder = slice.len() - num_in_chunks;

        unsafe {
            (
                slice::from_raw_parts(slice.as_ptr() as *const GenericArray<T, N>, num_chunks),
                slice::from_raw_parts(slice.as_ptr().add(num_in_chunks), num_remainder),
            )
        }
    }

    /// Converts a mutable slice of `T` elements into a mutable slice `GenericArray<T, N>` chunks.
    ///
    /// Any remaining elements that do not fill the array will be returned as a second slice.
    ///
    /// # Panics
    ///
    /// Panics if `N` is `U0` _AND_ the input slice is not empty.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    pub fn chunks_from_slice_mut(slice: &mut [T]) -> (&mut [GenericArray<T, N>], &mut [T]) {
        if N::USIZE == 0 {
            assert!(slice.is_empty(), "GenericArray length N must be non-zero");
            return (&mut [], &mut []);
        }

        // NOTE: Using `slice.split_at_mut` adds an unnecessary assert
        let num_chunks = slice.len() / N::USIZE; // integer division
        let num_in_chunks = num_chunks * N::USIZE;
        let num_remainder = slice.len() - num_in_chunks;

        unsafe {
            (
                slice::from_raw_parts_mut(
                    slice.as_mut_ptr() as *mut GenericArray<T, N>,
                    num_chunks,
                ),
                slice::from_raw_parts_mut(slice.as_mut_ptr().add(num_in_chunks), num_remainder),
            )
        }
    }

    /// Convert a slice of `GenericArray<T, N>` into a slice of `T`, effectively flattening the arrays.
    #[inline(always)]
    pub const fn slice_from_chunks(slice: &[GenericArray<T, N>]) -> &[T] {
        unsafe { slice::from_raw_parts(slice.as_ptr() as *const T, slice.len() * N::USIZE) }
    }

    /// Convert a slice of `GenericArray<T, N>` into a slice of `T`, effectively flattening the arrays.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn slice_from_chunks_mut(slice: &mut [GenericArray<T, N>]) -> &mut [T] {
        unsafe { slice::from_raw_parts_mut(slice.as_mut_ptr() as *mut T, slice.len() * N::USIZE) }
    }

    /// Convert a native array into `GenericArray` of the same length and type.
    ///
    /// This is the `const` equivalent of using the standard [`From`]/[`Into`] traits methods.
    #[inline(always)]
    pub const fn from_array<const U: usize>(value: [T; U]) -> Self
    where
        Const<U>: IntoArrayLength<ArrayLength = N>,
    {
        unsafe { crate::const_transmute(value) }
    }

    /// Convert the `GenericArray` into a native array of the same length and type.
    ///
    /// This is the `const` equivalent of using the standard [`From`]/[`Into`] traits methods.
    #[inline(always)]
    pub const fn into_array<const U: usize>(self) -> [T; U]
    where
        Const<U>: IntoArrayLength<ArrayLength = N>,
    {
        unsafe { crate::const_transmute(self) }
    }

    /// Convert a slice of native arrays into a slice of `GenericArray`s.
    #[inline(always)]
    pub const fn from_chunks<const U: usize>(chunks: &[[T; U]]) -> &[GenericArray<T, N>]
    where
        Const<U>: IntoArrayLength<ArrayLength = N>,
    {
        unsafe { mem::transmute(chunks) }
    }

    /// Convert a mutable slice of native arrays into a mutable slice of `GenericArray`s.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn from_chunks_mut<const U: usize>(chunks: &mut [[T; U]]) -> &mut [GenericArray<T, N>]
    where
        Const<U>: IntoArrayLength<ArrayLength = N>,
    {
        unsafe { mem::transmute(chunks) }
    }

    /// Converts a slice `GenericArray<T, N>` into a slice of `[T; N]`
    #[inline(always)]
    pub const fn into_chunks<const U: usize>(chunks: &[GenericArray<T, N>]) -> &[[T; U]]
    where
        Const<U>: IntoArrayLength<ArrayLength = N>,
    {
        unsafe { mem::transmute(chunks) }
    }

    /// Converts a mutable slice `GenericArray<T, N>` into a mutable slice of `[T; N]`
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn into_chunks_mut<const U: usize>(chunks: &mut [GenericArray<T, N>]) -> &mut [[T; U]]
    where
        Const<U>: IntoArrayLength<ArrayLength = N>,
    {
        unsafe { mem::transmute(chunks) }
    }

    /// Returns a `&GenericArray<Cell<T>, N>` from a `&Cell<GenericArray<T, N>>`.
    #[inline(always)]
    pub const fn as_array_of_cells(cell: &Cell<GenericArray<T, N>>) -> &GenericArray<Cell<T>, N> {
        // SAFETY: `Cell<T>` has the same memory layout as `T`.
        unsafe { &*(cell as *const Cell<GenericArray<T, N>> as *const GenericArray<Cell<T>, N>) }
    }
}

impl<T, N: ArrayLength> GenericArray<T, N> {
    /// Create a new array of `MaybeUninit<T>` items, in an uninitialized state.
    ///
    /// See [`GenericArray::assume_init`] for a full example.
    #[inline(always)]
    #[allow(clippy::uninit_assumed_init)]
    pub const fn uninit() -> GenericArray<MaybeUninit<T>, N> {
        unsafe {
            // SAFETY: An uninitialized `[MaybeUninit<_>; N]` is valid, same as regular array
            MaybeUninit::<GenericArray<MaybeUninit<T>, N>>::uninit().assume_init()
        }
    }

    /// Extracts the values from a generic array of `MaybeUninit` containers.
    ///
    /// # Safety
    ///
    /// It is up to the caller to guarantee that all elements of the array are in an initialized state.
    ///
    /// # Example
    ///
    /// ```
    /// # use core::mem::MaybeUninit;
    /// # use generic_array::{GenericArray, typenum::U3, arr};
    /// let mut array: GenericArray<MaybeUninit<i32>, U3> = GenericArray::uninit();
    /// array[0].write(0);
    /// array[1].write(1);
    /// array[2].write(2);
    ///
    /// // SAFETY: Now safe as we initialised all elements
    /// let array = unsafe {
    ///     GenericArray::assume_init(array)
    /// };
    ///
    /// assert_eq!(array, arr![0, 1, 2]);
    /// ```
    #[inline(always)]
    pub const unsafe fn assume_init(array: GenericArray<MaybeUninit<T>, N>) -> Self {
        const_transmute::<GenericArray<MaybeUninit<T>, N>, GenericArray<T, N>>(array)
    }
}

/// Error type for [`TryFrom`] and [`try_from_iter`](GenericArray::try_from_iter) implementations.
#[derive(Debug, Clone, Copy)]
pub struct LengthError;

#[rustversion::since(1.81)]
impl core::error::Error for LengthError {}

impl core::fmt::Display for LengthError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("LengthError: Slice or iterator does not match GenericArray length")
    }
}

/// Error type for heap allocation failures.
///
/// Returned by [`FallibleGenericSequence::try_generate`](sequence::FallibleGenericSequence::try_generate)
/// on `Box<GenericArray<T, N>>` when the underlying allocation fails.
#[cfg(feature = "alloc")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllocError;

#[cfg(feature = "alloc")]
#[rustversion::since(1.81)]
impl core::error::Error for AllocError {}

#[cfg(feature = "alloc")]
impl core::fmt::Display for AllocError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("memory allocation failed")
    }
}

impl<'a, T, N: ArrayLength> TryFrom<&'a [T]> for &'a GenericArray<T, N> {
    type Error = LengthError;

    #[inline(always)]
    fn try_from(slice: &'a [T]) -> Result<Self, Self::Error> {
        GenericArray::try_from_slice(slice)
    }
}

impl<'a, T, N: ArrayLength> TryFrom<&'a mut [T]> for &'a mut GenericArray<T, N> {
    type Error = LengthError;

    #[inline(always)]
    fn try_from(slice: &'a mut [T]) -> Result<Self, Self::Error> {
        GenericArray::try_from_mut_slice(slice)
    }
}

impl<T, N: ArrayLength> GenericArray<T, N> {
    /// Fallible equivalent of [`FromIterator::from_iter`]
    ///
    /// Given iterator must yield exactly `N` elements or an error will be returned. Using [`.take(N)`](Iterator::take)
    /// with an iterator longer than the array may be helpful.
    #[inline]
    pub fn try_from_iter<I>(iter: I) -> Result<Self, LengthError>
    where
        I: IntoIterator<Item = T>,
    {
        let mut iter = iter.into_iter();

        // pre-checks
        match iter.size_hint() {
            // if the lower bound is greater than N, array will overflow
            (n, _) if n > N::USIZE => return Err(LengthError),
            // if the upper bound is smaller than N, array cannot be filled
            (_, Some(n)) if n < N::USIZE => return Err(LengthError),
            _ => {}
        }

        unsafe {
            let mut array = MaybeUninit::<GenericArray<T, N>>::uninit();
            let mut builder = IntrusiveArrayBuilder::new_alt(&mut array);

            builder.extend(&mut iter);

            if !builder.is_full() || iter.next().is_some() {
                return Err(LengthError);
            }

            Ok(builder.finish_and_assume_init())
        }
    }

    /// Fallible equivalent of [`FromFallibleIterator::from_fallible_iter`].
    ///
    /// Unlike `.collect::<Result<GenericArray<T, N>, E>>()`, this method will not panic
    /// on length mismatch, instead returning a `LengthError`.
    ///
    /// Given iterator must yield exactly `N` elements or an error will be returned. Using [`.take(N)`](Iterator::take)
    /// with an iterator longer than the array may be helpful.
    #[inline]
    pub fn try_from_fallible_iter<I, E>(iter: I) -> Result<Result<Self, E>, LengthError>
    where
        I: IntoIterator<Item = Result<T, E>>,
    {
        let mut iter = iter.into_iter();

        // pre-checks
        match iter.size_hint() {
            // if the lower bound is greater than N, array will overflow
            (n, _) if n > N::USIZE => return Err(LengthError),
            // if the upper bound is smaller than N, array cannot be filled
            (_, Some(n)) if n < N::USIZE => return Err(LengthError),
            _ => {}
        }

        unsafe {
            let mut array = MaybeUninit::<GenericArray<T, N>>::uninit();
            let mut builder = IntrusiveArrayBuilder::new_alt(&mut array);

            if let Err(e) = builder.try_extend(&mut iter) {
                drop(builder); // explicitly drop to run the destructor and drop any initialized elements

                return Ok(Err(e));
            }

            if !builder.is_full() || iter.next().is_some() {
                return Err(LengthError);
            }

            Ok(Ok(builder.finish_and_assume_init()))
        }
    }
}

/// A const reimplementation of the [`transmute`](core::mem::transmute) function,
/// avoiding problems when the compiler can't prove equal sizes for some reason.
///
/// This will still check that the sizes of `A` and `B` are equal at compile time:
/// ```compile_fail
/// # use generic_array::const_transmute;
///
/// let _ = unsafe { const_transmute::<u32, u64>(0u32) }; // panics at compile time
/// ```
///
/// # Safety
/// Treat this the same as [`transmute`](core::mem::transmute), or (preferably) don't use it at all.
#[inline(always)]
#[cfg_attr(not(feature = "internals"), doc(hidden))]
pub const unsafe fn const_transmute<A, B>(a: A) -> B {
    struct SizeAsserter<A, B>(PhantomData<(A, B)>);

    impl<A, B> SizeAsserter<A, B> {
        const ASSERT_SIZE_EQUALITY: () = {
            if mem::size_of::<A>() != mem::size_of::<B>() {
                panic!("Size mismatch for generic_array::const_transmute");
            }
        };
    }

    let () = SizeAsserter::<A, B>::ASSERT_SIZE_EQUALITY;

    #[rustversion::since(1.83)]
    #[inline(always)]
    const unsafe fn do_transmute<A, B>(a: ManuallyDrop<A>) -> B {
        mem::transmute_copy(&a)
    }

    #[rustversion::before(1.83)]
    #[inline(always)]
    const unsafe fn do_transmute<A, B>(a: ManuallyDrop<A>) -> B {
        #[repr(C)]
        union Union<A, B> {
            a: ManuallyDrop<A>,
            b: ManuallyDrop<B>,
        }

        ManuallyDrop::into_inner(Union { a }.b)
    }

    do_transmute(ManuallyDrop::new(a))
}

#[cfg(test)]
mod test {
    // Compile with:
    // cargo rustc --lib --profile test --release --
    //      -C target-cpu=native -C opt-level=3 --emit asm
    // and view the assembly to make sure test_assembly generates
    // SIMD instructions instead of a naive loop.

    #[inline(never)]
    pub fn black_box<T>(val: T) -> T {
        use core::{mem, ptr};

        let ret = unsafe { ptr::read_volatile(&val) };
        mem::forget(val);
        ret
    }

    #[test]
    fn test_assembly() {
        use crate::functional::*;

        let a = black_box(arr![1, 3, 5, 7]);
        let b = black_box(arr![2, 4, 6, 8]);

        let c = (&a).zip(b, |l, r| l + r);

        let d = a.fold(0, |a, x| a + x);

        assert_eq!(c, arr![3, 7, 11, 15]);

        assert_eq!(d, 16);
    }
}
