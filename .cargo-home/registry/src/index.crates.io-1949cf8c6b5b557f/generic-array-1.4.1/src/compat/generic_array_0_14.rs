#![allow(deprecated)] // 0.14 is deprecated, but this is specifically for compatibility with it to allow gradual migration.

use generic_array_0_14::{ArrayLength as ArrayLength_0_14, GenericArray as GenericArray_0_14};

use crate::{ArrayLength, GenericArray};

impl<T, N: ArrayLength + ArrayLength_0_14<T>> From<GenericArray_0_14<T, N>> for GenericArray<T, N> {
    #[inline(always)]
    fn from(value: GenericArray_0_14<T, N>) -> Self {
        GenericArray::from_0_14(value)
    }
}

impl<T, N: ArrayLength + ArrayLength_0_14<T>> From<GenericArray<T, N>> for GenericArray_0_14<T, N> {
    #[inline(always)]
    fn from(value: GenericArray<T, N>) -> Self {
        value.into_0_14()
    }
}

impl<T, N: ArrayLength + ArrayLength_0_14<T>> AsRef<GenericArray_0_14<T, N>>
    for GenericArray<T, N>
{
    #[inline(always)]
    fn as_ref(&self) -> &GenericArray_0_14<T, N> {
        self.as_0_14()
    }
}

impl<T, N: ArrayLength + ArrayLength_0_14<T>> AsMut<GenericArray_0_14<T, N>>
    for GenericArray<T, N>
{
    #[inline(always)]
    fn as_mut(&mut self) -> &mut GenericArray_0_14<T, N> {
        self.as_0_14_mut()
    }
}

impl<T, N: ArrayLength + ArrayLength_0_14<T>> GenericArray<T, N> {
    /// From `&self` of this version, create a reference to the [`GenericArray`](GenericArray_0_14) type from `generic-array` 0.14.
    #[inline(always)]
    pub const fn as_0_14(&self) -> &GenericArray_0_14<T, N> {
        unsafe { core::mem::transmute(self) }
    }

    /// From `&mut self` of this version, create a mutable reference to the [`GenericArray`](GenericArray_0_14) type from `generic-array` 0.14.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn as_0_14_mut(&mut self) -> &mut GenericArray_0_14<T, N> {
        unsafe { core::mem::transmute(self) }
    }

    /// From `self` of this version, create the [`GenericArray`](GenericArray_0_14) type from `generic-array` 0.14.
    #[inline(always)]
    pub const fn into_0_14(self) -> GenericArray_0_14<T, N> {
        unsafe { crate::const_transmute(self) }
    }

    /// From the [`GenericArray`](GenericArray_0_14) type from `generic-array` 0.14, create a [`GenericArray`] of this version.
    #[inline(always)]
    pub const fn from_0_14(value: GenericArray_0_14<T, N>) -> Self {
        unsafe { crate::const_transmute(value) }
    }
}
