//! Useful traits for manipulating sequences of data stored in `GenericArray`s

use super::*;
use core::mem::MaybeUninit;
use core::ops::{Add, Div, Mul, Sub};
use core::ptr;
use typenum::operator_aliases::*;

/// Defines some sequence with an associated length and iteration capabilities.
///
/// This is useful for passing N-length generic arrays as generics.
///
/// # Safety
/// Care must be taken when implementing such that methods are safe.
///
/// Lengths must match, and element drop on panic must be handled.
pub unsafe trait GenericSequence<T>: Sized + IntoIterator {
    /// `GenericArray` associated length
    type Length: ArrayLength;

    /// Owned sequence type used in conjunction with reference implementations of `GenericSequence`
    type Sequence: GenericSequence<T, Length = Self::Length> + FromIterator<T>;

    /// Initializes a new sequence instance using the given function.
    ///
    /// If the generator function panics while initializing the sequence,
    /// any already initialized elements will be dropped.
    ///
    /// See also [`FallibleGenericSequence::try_generate`].
    fn generate<F>(f: F) -> Self::Sequence
    where
        F: FnMut(usize) -> T;

    /// Initializes a new sequence instance by repeating the given value.
    ///
    /// Clones the value for all but the last element, taking ownership of the original value for the last.
    ///
    /// This is semantically equivalent to `FromIterator::from_iter(core::iter::repeat_n(value, N::USIZE))`
    /// but available on older Rust versions. `repeat_n` was stabilized in Rust 1.82.0
    #[inline(always)]
    fn repeat(value: T) -> Self::Sequence
    where
        T: Clone,
    {
        let mut value = Some(value);

        Self::generate(move |i| unsafe {
            if i + 1 == Self::Length::USIZE {
                // for the last element, take the value
                value.take().unwrap_unchecked()
            } else if let Some(ref v) = value {
                // otherwise, clone it
                v.clone()
            } else {
                // SAFETY: this should never be reached
                core::hint::unreachable_unchecked()
            }
        })
    }

    /// Treats `self` as the right-hand operand in a zip operation
    ///
    /// This is optimized for stack-allocated `GenericArray`s
    #[cfg_attr(not(feature = "internals"), doc(hidden))]
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
            let mut left = IntrusiveArrayConsumer::new(&mut left);

            let (left_array_iter, left_position) = left.iter_position();

            FromIterator::from_iter(left_array_iter.zip(self).map(|(l, right_value)| {
                let left_value = ptr::read(l);

                *left_position += 1;

                f(left_value, right_value)
            }))
        }
    }

    /// Treats `self` as the right-hand operand in a zip operation
    #[cfg_attr(not(feature = "internals"), doc(hidden))]
    #[inline(always)]
    fn inverted_zip2<B, Lhs, U, F>(self, lhs: Lhs, mut f: F) -> MappedSequence<Lhs, B, U>
    where
        Lhs: GenericSequence<B, Length = Self::Length> + MappedGenericSequence<B, U>,
        Self: MappedGenericSequence<T, U>,
        F: FnMut(Lhs::Item, Self::Item) -> U,
    {
        FromIterator::from_iter(lhs.into_iter().zip(self).map(|(l, r)| f(l, r)))
    }
}

/// Extension to `FromIterator` for fallible initialization.
pub trait FromFallibleIterator<T>: Sized {
    /// Initializes a new collection from a fallible iterator.
    ///
    /// If the iterator returns an error or panics while initializing the sequence,
    /// any already initialized elements will be dropped and the error returned.
    ///
    /// Unlike `.collect::<Result<Self, E>>()`, which short-circuits the source iterator
    /// on the first error before the collection's `FromIterator` impl can verify the
    /// correct number of elements — causing a length-mismatch panic — this method
    /// handles the error and length check correctly.
    fn from_fallible_iter<I, E>(iter: I) -> Result<Self, E>
    where
        I: IntoIterator<Item = Result<T, E>>;
}

macro_rules! decl_fallible_sequence_inner {
    () => {
        /// Error type for sequence creation failures, independent of the element generator.
        ///
        /// For infallible sequence types such as [`GenericArray`](crate::GenericArray),
        /// this is [`Infallible`](core::convert::Infallible).
        type Error;

        /// Initializes a new sequence instance using the given fallible function.
        ///
        /// If the generator function returns an error or panics while initializing the sequence,
        /// any already initialized elements will be dropped.
        ///
        /// Returns `Ok(Ok(sequence))` on success, `Ok(Err(e))` if the generator fails,
        /// or `Err(Self::Error)` if the sequence itself cannot be created (e.g., allocation failure).
        fn try_generate<F, E>(f: F) -> Result<Result<Self::Sequence, E>, Self::Error>
        where
            F: FnMut(usize) -> Result<T, E>;
    };
}

#[rustversion::before(1.79)]
macro_rules! decl_fallible_sequence {
    ($(#[$meta:meta])*) => {
        $(#[$meta])*
        pub unsafe trait FallibleGenericSequence<T>: GenericSequence<T>
        where
            Self::Sequence: FromFallibleIterator<T>,
        {
            decl_fallible_sequence_inner!();
        }
    };
}

#[rustversion::since(1.79)]
macro_rules! decl_fallible_sequence {
    ($(#[$meta:meta])*) => {
        $(#[$meta])*
        pub unsafe trait FallibleGenericSequence<T>:
            GenericSequence<T, Sequence: FromFallibleIterator<T>>
        {
            decl_fallible_sequence_inner!();
        }
    };
}

decl_fallible_sequence! {
    /// Extension to `GenericSequence` for fallible initialization.
    ///
    /// # Safety
    ///
    /// Care must be taken when implementing such that methods are safe.
    ///
    /// Lengths must match, and element drop on panic or error must be handled.
    ///
    /// # Compatibility
    ///
    /// Associated type bounds were only introduced in Rust 1.79, and to ensure easy usage
    /// on newer versions of Rust this trait uses that. However, on pre-1.79 Rust, the
    /// `Sequence: FromFallibleIterator<T>` trait is not implied, and must be manually
    /// specified when `FallibleGenericSequence` is used.
}

/// Accessor for `GenericSequence` item type, which is really `IntoIterator::Item`
///
/// For deeply nested generic mapped sequence types, like shown in `tests/generics.rs`,
/// this can be useful for keeping things organized.
pub type SequenceItem<T> = <T as IntoIterator>::Item;

unsafe impl<'a, T: 'a, S: GenericSequence<T>> GenericSequence<T> for &'a S
where
    &'a S: IntoIterator,
{
    type Length = S::Length;
    type Sequence = S::Sequence;

    #[inline(always)]
    fn generate<F>(f: F) -> Self::Sequence
    where
        F: FnMut(usize) -> T,
    {
        S::generate(f)
    }
}

unsafe impl<'a, T: 'a, S: FallibleGenericSequence<T>> FallibleGenericSequence<T> for &'a S
where
    &'a S: IntoIterator,
    Self::Sequence: FromFallibleIterator<T>,
{
    type Error = S::Error;

    #[inline(always)]
    fn try_generate<F, E>(f: F) -> Result<Result<Self::Sequence, E>, Self::Error>
    where
        F: FnMut(usize) -> Result<T, E>,
    {
        S::try_generate(f)
    }
}

unsafe impl<'a, T: 'a, S: GenericSequence<T>> GenericSequence<T> for &'a mut S
where
    &'a mut S: IntoIterator,
{
    type Length = S::Length;
    type Sequence = S::Sequence;

    #[inline(always)]
    fn generate<F>(f: F) -> Self::Sequence
    where
        F: FnMut(usize) -> T,
    {
        S::generate(f)
    }
}

unsafe impl<'a, T: 'a, S: FallibleGenericSequence<T>> FallibleGenericSequence<T> for &'a mut S
where
    &'a mut S: IntoIterator,
    Self::Sequence: FromFallibleIterator<T>,
{
    type Error = S::Error;

    #[inline(always)]
    fn try_generate<F, E>(f: F) -> Result<Result<Self::Sequence, E>, Self::Error>
    where
        F: FnMut(usize) -> Result<T, E>,
    {
        S::try_generate(f)
    }
}

/// Defines any `GenericSequence` which can be lengthened or extended by appending
/// or prepending an element to it.
///
/// Any lengthened sequence can be shortened back to the original using `pop_front` or `pop_back`
///
/// # Safety
/// While the [`append`](Lengthen::append) and [`prepend`](Lengthen::prepend)
/// methods are marked safe, care must be taken when implementing them.
pub unsafe trait Lengthen<T>: Sized + GenericSequence<T> {
    /// `GenericSequence` that has one more element than `Self`
    type Longer: Shorten<T, Shorter = Self>;

    /// Returns a new array with the given element appended to the end of it.
    ///
    /// Example:
    ///
    /// ```rust
    /// # use generic_array::{arr, sequence::Lengthen};
    ///
    /// let a = arr![1, 2, 3];
    ///
    /// let b = a.append(4);
    ///
    /// assert_eq!(b, arr![1, 2, 3, 4]);
    /// ```
    fn append(self, last: T) -> Self::Longer;

    /// Returns a new array with the given element prepended to the front of it.
    ///
    /// Example:
    ///
    /// ```rust
    /// # use generic_array::{arr, sequence::Lengthen};
    ///
    /// let a = arr![1, 2, 3];
    ///
    /// let b = a.prepend(4);
    ///
    /// assert_eq!(b, arr![4, 1, 2, 3]);
    /// ```
    fn prepend(self, first: T) -> Self::Longer;
}

/// Defines a `GenericSequence` which can be shortened by removing the first or last element from it.
///
/// Additionally, any shortened sequence can be lengthened by
/// appending or prepending an element to it.
///
/// # Safety
/// While the [`pop_back`](Shorten::pop_back) and [`pop_front`](Shorten::pop_front)
/// methods are marked safe, care must be taken when implementing them.
pub unsafe trait Shorten<T>: Sized + GenericSequence<T> {
    /// `GenericSequence` that has one less element than `Self`
    type Shorter: Lengthen<T, Longer = Self>;

    /// Returns a new array without the last element, and the last element.
    ///
    /// Example:
    ///
    /// ```rust
    /// # use generic_array::{arr, sequence::Shorten};
    ///
    /// let a = arr![1, 2, 3, 4];
    ///
    /// let (init, last) = a.pop_back();
    ///
    /// assert_eq!(init, arr![1, 2, 3]);
    /// assert_eq!(last, 4);
    /// ```
    fn pop_back(self) -> (Self::Shorter, T);

    /// Returns a new array without the first element, and the first element.
    /// Example:
    ///
    /// ```rust
    /// # use generic_array::{arr, sequence::Shorten};
    ///
    /// let a = arr![1, 2, 3, 4];
    ///
    /// let (head, tail) = a.pop_front();
    ///
    /// assert_eq!(head, 1);
    /// assert_eq!(tail, arr![2, 3, 4]);
    /// ```
    fn pop_front(self) -> (T, Self::Shorter);
}

unsafe impl<T, N: ArrayLength> Lengthen<T> for GenericArray<T, N>
where
    N: Add<B1>,
    Add1<N>: ArrayLength,
    Add1<N>: Sub<B1, Output = N>,
    Sub1<Add1<N>>: ArrayLength,
{
    type Longer = GenericArray<T, Add1<N>>;

    #[inline]
    fn append(self, last: T) -> Self::Longer {
        let mut longer: MaybeUninit<Self::Longer> = MaybeUninit::uninit();

        // Note this is *mut Self, so add(1) increments by the whole array
        let out_ptr = longer.as_mut_ptr() as *mut Self;

        unsafe {
            // write self first
            ptr::write(out_ptr, self);
            // increment past self, then write the last
            ptr::write(out_ptr.add(1) as *mut T, last);

            longer.assume_init()
        }
    }

    #[inline]
    fn prepend(self, first: T) -> Self::Longer {
        let mut longer: MaybeUninit<Self::Longer> = MaybeUninit::uninit();

        // Note this is *mut T, so add(1) increments by a single T
        let out_ptr = longer.as_mut_ptr() as *mut T;

        unsafe {
            // write the first at the start
            ptr::write(out_ptr, first);
            // increment past the first, then write self
            ptr::write(out_ptr.add(1) as *mut Self, self);

            longer.assume_init()
        }
    }
}

unsafe impl<T, N: ArrayLength> Shorten<T> for GenericArray<T, N>
where
    N: Sub<B1>,
    Sub1<N>: ArrayLength,
    Sub1<N>: Add<B1, Output = N>,
    Add1<Sub1<N>>: ArrayLength,
{
    type Shorter = GenericArray<T, Sub1<N>>;

    #[inline]
    fn pop_back(self) -> (Self::Shorter, T) {
        let whole = ManuallyDrop::new(self);

        unsafe {
            let init = ptr::read(whole.as_ptr() as _);
            let last = ptr::read(whole.as_ptr().add(Sub1::<N>::USIZE) as _);

            (init, last)
        }
    }

    #[inline]
    fn pop_front(self) -> (T, Self::Shorter) {
        // ensure this doesn't get dropped
        let whole = ManuallyDrop::new(self);

        unsafe {
            let head = ptr::read(whole.as_ptr() as _);
            let tail = ptr::read(whole.as_ptr().offset(1) as _);

            (head, tail)
        }
    }
}

/// Defines a `GenericSequence` that can be split into two parts at a given pivot index.
///
/// # Safety
/// While the [`split`](Split::split) method is marked safe,
/// care must be taken when implementing it.
pub unsafe trait Split<T, K: ArrayLength>: GenericSequence<T> {
    /// First part of the resulting split array
    type First: GenericSequence<T>;
    /// Second part of the resulting split array
    type Second: GenericSequence<T>;

    /// Splits an array at the given index, returning the separate parts of the array.
    fn split(self) -> (Self::First, Self::Second);
}

unsafe impl<T, N, K> Split<T, K> for GenericArray<T, N>
where
    N: ArrayLength,
    K: ArrayLength,
    N: Sub<K>,
    Diff<N, K>: ArrayLength,
{
    type First = GenericArray<T, K>;
    type Second = GenericArray<T, Diff<N, K>>;

    #[inline]
    fn split(self) -> (Self::First, Self::Second) {
        unsafe {
            // ensure this doesn't get dropped
            let whole = ManuallyDrop::new(self);

            let head = ptr::read(whole.as_ptr() as *const _);
            let tail = ptr::read(whole.as_ptr().add(K::USIZE) as *const _);

            (head, tail)
        }
    }
}

unsafe impl<'a, T, N, K> Split<T, K> for &'a GenericArray<T, N>
where
    N: ArrayLength,
    K: ArrayLength,
    N: Sub<K>,
    Diff<N, K>: ArrayLength,
{
    type First = &'a GenericArray<T, K>;
    type Second = &'a GenericArray<T, Diff<N, K>>;

    #[inline]
    fn split(self) -> (Self::First, Self::Second) {
        unsafe {
            let ptr_to_first: *const T = self.as_ptr();
            let head = &*(ptr_to_first as *const _);
            let tail = &*(ptr_to_first.add(K::USIZE) as *const _);
            (head, tail)
        }
    }
}

unsafe impl<'a, T, N, K> Split<T, K> for &'a mut GenericArray<T, N>
where
    N: ArrayLength,
    K: ArrayLength,
    N: Sub<K>,
    Diff<N, K>: ArrayLength,
{
    type First = &'a mut GenericArray<T, K>;
    type Second = &'a mut GenericArray<T, Diff<N, K>>;

    #[inline]
    fn split(self) -> (Self::First, Self::Second) {
        unsafe {
            let ptr_to_first: *mut T = self.as_mut_ptr();
            let head = &mut *(ptr_to_first as *mut _);
            let tail = &mut *(ptr_to_first.add(K::USIZE) as *mut _);
            (head, tail)
        }
    }
}

/// Defines `GenericSequence`s which can be joined together, forming a larger array.
///
/// # Safety
/// While the [`concat`](Concat::concat) method is marked safe,
/// care must be taken when implementing it.
pub unsafe trait Concat<T, M: ArrayLength>: GenericSequence<T> {
    /// Sequence to be concatenated with `self`
    type Rest: GenericSequence<T, Length = M>;

    /// Resulting sequence formed by the concatenation.
    type Output: GenericSequence<T>;

    /// Concatenate, or join, two sequences.
    fn concat(self, rest: Self::Rest) -> Self::Output;
}

unsafe impl<T, N, M> Concat<T, M> for GenericArray<T, N>
where
    N: ArrayLength + Add<M>,
    M: ArrayLength,
    Sum<N, M>: ArrayLength,
{
    type Rest = GenericArray<T, M>;
    type Output = GenericArray<T, Sum<N, M>>;

    #[inline]
    fn concat(self, rest: Self::Rest) -> Self::Output {
        let mut output: MaybeUninit<Self::Output> = MaybeUninit::uninit();

        let out_ptr = output.as_mut_ptr() as *mut Self;

        unsafe {
            // write all of self to the pointer
            ptr::write(out_ptr, self);
            // increment past self, then write the rest
            ptr::write(out_ptr.add(1) as *mut _, rest);

            output.assume_init()
        }
    }
}

/// Defines a `GenericSequence` which can be shortened by removing an element at a given index.
///
/// # Safety
/// While the [`remove`](Remove::remove) and [`swap_remove`](Remove::swap_remove) methods are marked safe,
/// care must be taken when implementing it. The [`remove_unchecked`](Remove::remove_unchecked)
/// and [`swap_remove_unchecked`](Remove::swap_remove_unchecked) methods are unsafe
/// and must be used with caution.
pub unsafe trait Remove<T, N: ArrayLength>: GenericSequence<T> {
    /// Resulting sequence formed by removing an element at the given index.
    type Output: GenericSequence<T>;

    /// Removes an element at the given index, shifting elements
    /// after the given index to the left to fill the gap, resulting
    /// in a time complexity of O(n) where `n=N-idx-1`
    ///
    /// # Example
    ///
    /// ```rust
    /// # use generic_array::{arr, sequence::Remove};
    /// let a = arr![1, 2, 3, 4];
    ///
    /// let (removed, b) = a.remove(2);
    /// assert_eq!(removed, 3);
    /// assert_eq!(b, arr![1, 2, 4]);
    /// ```
    ///
    /// # Panics
    ///
    /// Panics if the index is out of bounds.
    #[inline]
    fn remove(self, idx: usize) -> (T, Self::Output) {
        assert!(
            idx < N::USIZE,
            "Index out of bounds: the len is {} but the index is {}",
            N::USIZE,
            idx
        );

        unsafe { self.remove_unchecked(idx) }
    }

    /// Removes an element at the given index, swapping it with the last element.
    ///
    /// # Example
    ///
    /// ```rust
    /// # use generic_array::{arr, sequence::Remove};
    /// let a = arr![1, 2, 3, 4];
    ///
    /// let (removed, b) = a.swap_remove(1);
    /// assert_eq!(removed, 2);
    /// assert_eq!(b, arr![1, 4, 3]); // note 4 is now at index 1
    /// ```
    ///
    /// # Panics
    ///
    /// Panics if the index is out of bounds.
    fn swap_remove(self, idx: usize) -> (T, Self::Output) {
        assert!(
            idx < N::USIZE,
            "Index out of bounds: the len is {} but the index is {}",
            N::USIZE,
            idx
        );

        unsafe { self.swap_remove_unchecked(idx) }
    }

    /// Removes an element at the given index without bounds checking,
    /// shifting elements after the given index to the left to fill the gap,
    /// resulting in a time complexity of O(n) where `n=N-idx-1`
    ///
    /// See [`remove`](Remove::remove) for an example.
    ///
    /// # Safety
    /// The caller must ensure that the index is within bounds, otherwise
    /// it is undefined behavior.
    unsafe fn remove_unchecked(self, idx: usize) -> (T, Self::Output);

    /// Removes an element at the given index without bounds checking, swapping it with the last element.
    ///
    /// See [`swap_remove`](Remove::swap_remove) for an example.
    ///
    /// # Safety
    /// The caller must ensure that the index is within bounds, otherwise
    /// it is undefined behavior.
    unsafe fn swap_remove_unchecked(self, idx: usize) -> (T, Self::Output);
}

unsafe impl<T, N> Remove<T, N> for GenericArray<T, N>
where
    N: ArrayLength + Sub<B1>,
    Sub1<N>: ArrayLength,
{
    type Output = GenericArray<T, Sub1<N>>;

    #[inline]
    unsafe fn remove_unchecked(self, idx: usize) -> (T, Self::Output) {
        if idx >= N::USIZE || N::USIZE == 0 {
            core::hint::unreachable_unchecked();
        }

        let mut array = ManuallyDrop::new(self);

        let dst = array.as_mut_ptr().add(idx);

        let removed = ptr::read(dst);

        // shift all elements over by one to fill gap
        ptr::copy(dst.add(1), dst, N::USIZE - idx - 1);

        // return removed element and truncated array
        (removed, mem::transmute_copy(&array))
    }

    #[inline]
    unsafe fn swap_remove_unchecked(self, idx: usize) -> (T, Self::Output) {
        if idx >= N::USIZE || N::USIZE == 0 {
            core::hint::unreachable_unchecked();
        }

        let mut array = ManuallyDrop::new(self);

        array.swap(idx, N::USIZE - 1);

        // remove the last element
        let removed = ptr::read(array.as_ptr().add(N::USIZE - 1));

        // return removed element and truncated array
        (removed, mem::transmute_copy(&array))
    }
}

/// Defines a `GenericSequence` of `GenericArray`s which can be flattened into a single `GenericArray`,
/// at zero cost.
///
/// # Safety
/// While the [`flatten`](Flatten::flatten) method is marked safe,
/// care must be taken when implementing it. However, the given trait bounds
/// should be sufficient to ensure safety.
pub unsafe trait Flatten<T, N, M>: GenericSequence<GenericArray<T, N>, Length = M>
where
    N: ArrayLength + Mul<M>,
    Prod<N, M>: ArrayLength,
{
    /// Flattened sequence type
    type Output: GenericSequence<T, Length = Prod<N, M>>;

    /// Flattens the sequence into a single `GenericArray`.
    ///
    /// # Example
    ///
    /// ```rust
    /// # use generic_array::{arr, sequence::Flatten};
    /// assert_eq!(
    ///     arr![arr![1, 2], arr![3, 4], arr![5, 6]].flatten(),
    ///     arr![1, 2, 3, 4, 5, 6]
    /// );
    /// ```
    fn flatten(self) -> Self::Output;
}

/// Defines a `GenericSequence` of `T` which can be split evenly into a sequence of `GenericArray`s,
///
/// # Safety
/// While the [`unflatten`](Unflatten::unflatten) method is marked safe,
/// care must be taken when implementing it. However, the given trait bounds
/// should be sufficient to ensure safety.
pub unsafe trait Unflatten<T, NM, N>: GenericSequence<T, Length = NM>
where
    NM: ArrayLength + Div<N>,
    N: ArrayLength,
    Quot<NM, N>: ArrayLength,
{
    /// Unflattened sequence type
    type Output: GenericSequence<GenericArray<T, N>, Length = Quot<NM, N>>;

    /// Unflattens the sequence into a sequence of `GenericArray`s.
    ///
    /// # Example
    ///
    /// ```rust
    /// # use generic_array::{arr, sequence::Unflatten};
    /// assert_eq!(
    ///     arr![1, 2, 3, 4, 5, 6].unflatten(),
    ///     arr![arr![1, 2], arr![3, 4], arr![5, 6]]
    /// );
    /// ```
    fn unflatten(self) -> Self::Output;
}

unsafe impl<T, N, M> Flatten<T, N, M> for GenericArray<GenericArray<T, N>, M>
where
    N: ArrayLength + Mul<M>,
    M: ArrayLength,
    Prod<N, M>: ArrayLength,
{
    type Output = GenericArray<T, Prod<N, M>>;

    #[inline(always)]
    fn flatten(self) -> Self::Output {
        unsafe { crate::const_transmute(self) }
    }
}

unsafe impl<'a, T, N, M> Flatten<T, N, M> for &'a GenericArray<GenericArray<T, N>, M>
where
    N: ArrayLength + Mul<M>,
    M: ArrayLength,
    Prod<N, M>: ArrayLength,
{
    type Output = &'a GenericArray<T, Prod<N, M>>;

    #[inline(always)]
    fn flatten(self) -> Self::Output {
        unsafe { mem::transmute(self) }
    }
}

unsafe impl<'a, T, N, M> Flatten<T, N, M> for &'a mut GenericArray<GenericArray<T, N>, M>
where
    N: ArrayLength + Mul<M>,
    M: ArrayLength,
    Prod<N, M>: ArrayLength,
{
    type Output = &'a mut GenericArray<T, Prod<N, M>>;

    #[inline(always)]
    fn flatten(self) -> Self::Output {
        unsafe { mem::transmute(self) }
    }
}

unsafe impl<T, NM, N> Unflatten<T, NM, N> for GenericArray<T, NM>
where
    NM: ArrayLength + Div<N>,
    N: ArrayLength,
    Quot<NM, N>: ArrayLength,
{
    type Output = GenericArray<GenericArray<T, N>, Quot<NM, N>>;

    #[inline(always)]
    fn unflatten(self) -> Self::Output {
        unsafe { crate::const_transmute(self) }
    }
}

unsafe impl<'a, T, NM, N> Unflatten<T, NM, N> for &'a GenericArray<T, NM>
where
    NM: ArrayLength + Div<N>,
    N: ArrayLength,
    Quot<NM, N>: ArrayLength,
{
    type Output = &'a GenericArray<GenericArray<T, N>, Quot<NM, N>>;

    #[inline(always)]
    fn unflatten(self) -> Self::Output {
        unsafe { mem::transmute(self) }
    }
}

unsafe impl<'a, T, NM, N> Unflatten<T, NM, N> for &'a mut GenericArray<T, NM>
where
    NM: ArrayLength + Div<N>,
    N: ArrayLength,
    Quot<NM, N>: ArrayLength,
{
    type Output = &'a mut GenericArray<GenericArray<T, N>, Quot<NM, N>>;

    #[inline(always)]
    fn unflatten(self) -> Self::Output {
        unsafe { mem::transmute(self) }
    }
}
