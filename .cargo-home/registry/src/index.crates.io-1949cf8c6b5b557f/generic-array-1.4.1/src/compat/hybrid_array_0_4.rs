use hybrid_array_0_4::{Array as HybridArray, ArraySize, AsArrayMut, AsArrayRef, AssocArraySize};

use crate::{ArrayLength, GenericArray};

impl<T, N: ArrayLength + ArraySize> AssocArraySize for GenericArray<T, N> {
    type Size = N;
}

impl<T, N: ArrayLength + ArraySize> AsArrayRef<T> for GenericArray<T, N> {
    #[inline(always)]
    fn as_array_ref(&self) -> &HybridArray<T, N> {
        self.as_ha0_4()
    }
}

impl<T, N: ArrayLength + ArraySize> AsArrayMut<T> for GenericArray<T, N> {
    #[inline(always)]
    fn as_array_mut(&mut self) -> &mut HybridArray<T, N> {
        self.as_ha0_4_mut()
    }
}

impl<T, N: ArrayLength + ArraySize> From<HybridArray<T, N>> for GenericArray<T, N> {
    #[inline(always)]
    fn from(value: HybridArray<T, N>) -> Self {
        GenericArray::from_ha0_4(value)
    }
}

impl<T, N: ArrayLength + ArraySize> From<GenericArray<T, N>> for HybridArray<T, N> {
    #[inline(always)]
    fn from(value: GenericArray<T, N>) -> Self {
        value.into_ha0_4()
    }
}

impl<T, N: ArrayLength + ArraySize> AsRef<HybridArray<T, N>> for GenericArray<T, N> {
    #[inline(always)]
    fn as_ref(&self) -> &HybridArray<T, N> {
        self.as_ha0_4()
    }
}

impl<T, N: ArrayLength + ArraySize> AsMut<HybridArray<T, N>> for GenericArray<T, N> {
    #[inline(always)]
    fn as_mut(&mut self) -> &mut HybridArray<T, N> {
        self.as_ha0_4_mut()
    }
}

impl<T, N: ArrayLength + ArraySize> GenericArray<T, N> {
    /// From `&self` of this version, create a reference to a [`Array`](hybrid_array_0_4::Array) from `hybrid-array` 0.4.
    #[inline(always)]
    pub const fn as_ha0_4(&self) -> &HybridArray<T, N> {
        unsafe { core::mem::transmute(self) }
    }

    /// From `&mut self` of this version, create a mutable reference to a [`Array`](hybrid_array_0_4::Array) from `hybrid-array` 0.4.
    ///
    /// This method is `const` since Rust 1.83.0, but non-`const` before.
    #[rustversion::attr(since(1.83), const)]
    #[inline(always)]
    pub fn as_ha0_4_mut(&mut self) -> &mut HybridArray<T, N> {
        unsafe { core::mem::transmute(self) }
    }

    /// From `self` of this version, create a [`Array`](hybrid_array_0_4::Array) from `hybrid-array` 0.4.
    #[inline(always)]
    pub const fn into_ha0_4(self) -> HybridArray<T, N> {
        unsafe { crate::const_transmute(self) }
    }

    /// From a [`Array`](hybrid_array_0_4::Array) from `hybrid-array` 0.4, create a [`GenericArray`] of this version.
    #[inline(always)]
    pub const fn from_ha0_4(value: HybridArray<T, N>) -> Self {
        unsafe { crate::const_transmute(value) }
    }
}
