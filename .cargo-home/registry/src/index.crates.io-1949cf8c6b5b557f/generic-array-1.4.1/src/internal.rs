#![allow(dead_code, clippy::new_without_default)] // ArrayBuilder/ArrayConsumer are soft-deprecated internally

use crate::*;

pub trait Sealed {}

impl<T> Sealed for [T; 0] {}

/// **UNSAFE**: Creates an array one element at a time using a mutable iterator of pointers.
///
/// You MUST increment the position while iterating to mark off created elements,
/// which will be dropped if `into_inner` is not called.
///
/// This is soft-deprecated in favor of [`IntrusiveArrayBuilder`] due to Rust's
/// lack of return-value optimization causing issues moving the array in/out of the struct.
/// Still works fine for smaller arrays, though.
pub struct ArrayBuilder<T, N: ArrayLength> {
    array: GenericArray<MaybeUninit<T>, N>,
    position: usize,
}

impl<T, N: ArrayLength> ArrayBuilder<T, N> {
    /// Begin building an array
    #[inline(always)]
    pub const fn new() -> ArrayBuilder<T, N> {
        ArrayBuilder {
            array: GenericArray::uninit(),
            position: 0,
        }
    }

    /// Consume an iterator, `.zip`-ing it to fill some or all of the array. This does not check if the
    /// iterator had extra elements or too few elements.
    ///
    /// This makes no attempt to continue where a previous `extend` leaves off. Therefore, it should
    /// only be used once per `ArrayBuilder`.
    ///
    /// # Safety
    ///
    /// You MUST ensure that the source iterator yields enough elements to fill the array,
    /// or fill the remaining uninitialized elements in other ways, to avoid undefined behavior.
    #[inline(always)]
    pub unsafe fn extend(&mut self, source: impl Iterator<Item = T>) {
        let (destination, position) = (self.array.iter_mut(), &mut self.position);

        destination.zip(source).for_each(|(dst, src)| {
            dst.write(src);
            *position += 1;
        });
    }

    /// Returns true if the write position equals the array size
    #[inline(always)]
    pub const fn is_full(&self) -> bool {
        self.position == N::USIZE
    }

    /// Creates a mutable iterator for writing to the array elements.
    ///
    /// You MUST increment the position value (given as a mutable reference) as you iterate
    /// to mark how many elements have been created.
    ///
    /// ```
    /// #[cfg(feature = "internals")]
    /// # {
    /// # use generic_array::{GenericArray, internals::ArrayBuilder, typenum::U5};
    /// # struct SomeType;
    /// fn make_some_struct() -> SomeType { SomeType }
    /// unsafe {
    ///     let mut builder = ArrayBuilder::<SomeType, U5>::new();
    ///     let (dst_iter, position) = builder.iter_position();
    ///     for dst in dst_iter {
    ///         dst.write(make_some_struct());
    ///         // MUST be done AFTER ownership of the value has been given to `dst.write`
    ///         *position += 1;
    ///     }
    ///     let your_array = builder.assume_init();
    /// }
    /// # }
    /// ```
    ///
    /// # Safety
    ///
    /// You MUST increment the position as you write elements to avoid
    /// double-dropping or uninitialized data.
    #[inline(always)]
    pub unsafe fn iter_position(
        &'_ mut self,
    ) -> (slice::IterMut<'_, MaybeUninit<T>>, &'_ mut usize) {
        (self.array.iter_mut(), &mut self.position)
    }

    /// When done writing (assuming all elements have been written to),
    /// get the inner array.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    ///
    /// # Safety
    ///
    /// You MUST have written all elements to avoid undefined behavior.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub unsafe fn assume_init(self) -> GenericArray<T, N> {
        debug_assert!(self.is_full());

        let array = ptr::read(&self.array);
        mem::forget(self);
        GenericArray::assume_init(array)
    }
}

impl<T, N: ArrayLength> Drop for ArrayBuilder<T, N> {
    fn drop(&mut self) {
        unsafe {
            ptr::drop_in_place(
                // Same cast as MaybeUninit::slice_assume_init_mut
                self.array.get_unchecked_mut(..self.position) as *mut [MaybeUninit<T>]
                    as *mut [T],
            );
        }
    }
}

/// Similar to [`ArrayBuilder`] but uses a reference to a pre-allocated array, be
/// it on the stack or heap.
pub struct IntrusiveArrayBuilder<'a, T, N: ArrayLength> {
    array: &'a mut GenericArray<MaybeUninit<T>, N>,
    position: usize,
}

impl<'a, T, N: ArrayLength> IntrusiveArrayBuilder<'a, T, N> {
    /// Begin building an array
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn new(array: &'a mut GenericArray<MaybeUninit<T>, N>) -> IntrusiveArrayBuilder<'a, T, N> {
        IntrusiveArrayBuilder { array, position: 0 }
    }

    /// Begin building an array from a `MaybeUninit<GenericArray<T, N>>`, which can potentially
    /// result in better codegen.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn new_alt(
        array: &'a mut MaybeUninit<GenericArray<T, N>>,
    ) -> IntrusiveArrayBuilder<'a, T, N> {
        // SAFETY: GenericArray<MaybeUninit<T>, N> has the same memory layout as MaybeUninit<GenericArray<T, N>>
        IntrusiveArrayBuilder::new(unsafe {
            mem::transmute::<
                &mut MaybeUninit<GenericArray<T, N>>,
                &mut GenericArray<MaybeUninit<T>, N>,
            >(array)
        })
    }

    /// Consume an iterator, `.zip`-ing it to fill some or all of the array. This does not check if the
    /// iterator had extra elements or too few elements.
    ///
    /// This makes no attempt to continue where a previous `extend` leaves off. Therefore, it should
    /// only be used once per `ArrayBuilder`.
    ///
    /// # Safety
    ///
    /// You MUST ensure that the source iterator yields enough elements to fill the array,
    /// or fill the remaining uninitialized elements in other ways, to avoid undefined behavior.
    #[inline(always)]
    pub unsafe fn extend(&mut self, source: impl Iterator<Item = T>) {
        let (destination, position) = (self.array.iter_mut(), &mut self.position);

        destination.zip(source).for_each(|(dst, src)| {
            dst.write(src);
            *position += 1;
        });
    }

    /// Consume a fallible iterator, `.zip`-ing it to fill some or all of the array. This does not check if the
    /// iterator had extra elements or too few elements.
    ///
    /// This makes no attempt to continue where a previous `extend` leaves off. Therefore, it should
    /// only be used once per `ArrayBuilder`.
    ///
    /// # Safety
    ///
    /// You MUST ensure that the source iterator yields enough elements to fill the array,
    /// or fill the remaining uninitialized elements in other ways, to avoid undefined behavior.
    #[inline(always)]
    pub unsafe fn try_extend<E>(
        &mut self,
        source: impl Iterator<Item = Result<T, E>>,
    ) -> Result<(), E> {
        let (destination, position) = (self.array.iter_mut(), &mut self.position);

        destination
            .zip(source)
            .try_for_each(|(dst, src)| match src {
                Ok(value) => {
                    dst.write(value);
                    *position += 1;
                    Ok(())
                }
                Err(e) => Err(e),
            })
    }

    /// Returns true if the write position equals the array size
    #[inline(always)]
    pub const fn is_full(&self) -> bool {
        self.position == N::USIZE
    }

    /// Creates a mutable iterator for writing to the array elements.
    ///
    /// You MUST increment the position value (given as a mutable reference) as you iterate
    /// to mark how many elements have been created.
    ///
    /// ```
    /// #[cfg(feature = "internals")]
    /// # {
    /// # use generic_array::{GenericArray, internals::IntrusiveArrayBuilder, typenum::U5};
    /// # use core::mem::MaybeUninit;
    /// # struct SomeType;
    /// fn make_some_struct() -> SomeType { SomeType }
    /// unsafe {
    ///     let mut array = MaybeUninit::<GenericArray<SomeType, U5>>::uninit();
    ///     let mut builder = IntrusiveArrayBuilder::new_alt(&mut array);
    ///     let (dst_iter, position) = builder.iter_position();
    ///     for dst in dst_iter {
    ///         dst.write(make_some_struct());
    ///         // MUST be done AFTER ownership of the value has been given to `dst.write`
    ///         *position += 1;
    ///     }
    ///
    ///     let your_array = builder.finish_and_assume_init();
    /// }
    /// # }
    /// ```
    ///
    /// # Safety
    ///
    /// You MUST increment the position as you write elements to avoid
    /// double-dropping or uninitialized data.
    #[inline(always)]
    pub unsafe fn iter_position(
        &'_ mut self,
    ) -> (slice::IterMut<'_, MaybeUninit<T>>, &'_ mut usize) {
        (self.array.iter_mut(), &mut self.position)
    }

    /// When done writing (assuming all elements have been written to), mark the builder
    /// as finished to avoid dropping the initialized elements.
    ///
    /// # Safety
    ///
    /// You MUST have written all elements to avoid undefined behavior.
    #[inline(always)]
    pub const unsafe fn finish(self) {
        debug_assert!(self.is_full());
        mem::forget(self)
    }

    /// When done writing (assuming all elements have been written to), mark the builder
    /// as finished to avoid dropping the initialized elements, and get the inner array.
    ///
    /// This method is `const` since Rust 1.71.0, but non-`const` before.
    ///
    /// # Safety
    ///
    /// You MUST have written all elements to avoid undefined behavior.
    #[rustversion::attr(since(1.71), const)]
    #[inline(always)]
    pub unsafe fn finish_and_assume_init(self) -> GenericArray<T, N> {
        debug_assert!(self.is_full());

        // Same-ish as `assume_init`/`transmute_copy` but generates better codegen in Debug builds
        // SAFETY: The array is initialized, and by definition is the same size and alignment as GenericArray<T, N>
        let array = ptr::read(self.array as *const _ as *const GenericArray<T, N>);

        // avoid Drop logic, and since this is intrusive, doing this after reading the array is fine
        mem::forget(self);

        array
    }

    /// Similar to [`GenericArray::assume_init`] but for arrays passed to `IntrusiveArrayBuilder`.
    ///
    /// # Safety
    ///
    /// You MUST ensure that all elements have been initialized to avoid undefined behavior.
    #[deprecated(
        since = "1.3.4",
        note = "See `iter_position` for modern usage pattern without this function"
    )]
    #[inline(always)]
    pub unsafe fn array_assume_init(array: GenericArray<MaybeUninit<T>, N>) -> GenericArray<T, N> {
        ptr::read(&array as *const _ as *const MaybeUninit<GenericArray<T, N>>).assume_init()
    }
}

impl<T, N: ArrayLength> Drop for IntrusiveArrayBuilder<'_, T, N> {
    fn drop(&mut self) {
        unsafe {
            ptr::drop_in_place(
                // Same cast as MaybeUninit::slice_assume_init_mut
                self.array.get_unchecked_mut(..self.position) as *mut [MaybeUninit<T>]
                    as *mut [T],
            );
        }
    }
}

/// **UNSAFE**: Consumes an array one element at a time.
///
/// You MUST increment the position while iterating and any leftover elements
/// will be dropped if position does not go to N
///
/// This is soft-deprecated in favor of [`IntrusiveArrayConsumer`] due to Rust's
/// lack of return-value optimization causing issues moving the array in/out of the struct.
pub struct ArrayConsumer<T, N: ArrayLength> {
    array: ManuallyDrop<GenericArray<T, N>>,
    position: usize,
}

impl<T, N: ArrayLength> ArrayConsumer<T, N> {
    /// Give ownership of the array to the consumer
    #[inline(always)]
    pub const fn new(array: GenericArray<T, N>) -> ArrayConsumer<T, N> {
        ArrayConsumer {
            array: ManuallyDrop::new(array),
            position: 0,
        }
    }

    /// Creates an iterator and mutable reference to the internal position
    /// to keep track of consumed elements.
    ///
    /// You MUST increment the position as you iterate to mark off consumed elements.
    ///
    /// # Safety
    ///
    /// You MUST increment the position while iterating.
    #[inline(always)]
    pub unsafe fn iter_position(&'_ mut self) -> (slice::Iter<'_, T>, &'_ mut usize) {
        (self.array.iter(), &mut self.position)
    }
}

impl<T, N: ArrayLength> Drop for ArrayConsumer<T, N> {
    fn drop(&mut self) {
        unsafe {
            ptr::drop_in_place(self.array.get_unchecked_mut(self.position..));
        }
    }
}

/// **UNSAFE**: Consumes an array one element at a time.
///
/// You MUST increment the position while iterating and any leftover elements
/// will be dropped if position does not go to N
pub struct IntrusiveArrayConsumer<'a, T, N: ArrayLength> {
    array: &'a mut ManuallyDrop<GenericArray<T, N>>,
    position: usize,
}

impl<'a, T, N: ArrayLength> IntrusiveArrayConsumer<'a, T, N> {
    /// Give exclusive access for the array to the consumer
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn new(
        array: &'a mut ManuallyDrop<GenericArray<T, N>>,
    ) -> IntrusiveArrayConsumer<'a, T, N> {
        IntrusiveArrayConsumer { array, position: 0 }
    }

    /// Creates an iterator and mutable reference to the internal position
    /// to keep track of consumed elements.
    ///
    /// You MUST increment the position as you iterate to mark off consumed elements.
    ///
    /// # Safety
    ///
    /// You MUST increment the position while iterating.
    #[inline(always)]
    pub unsafe fn iter_position(&'_ mut self) -> (slice::Iter<'_, T>, &'_ mut usize) {
        (self.array.iter(), &mut self.position)
    }
}

impl<T, N: ArrayLength> Drop for IntrusiveArrayConsumer<'_, T, N> {
    fn drop(&mut self) {
        unsafe {
            ptr::drop_in_place(self.array.get_unchecked_mut(self.position..));
        }
    }
}
