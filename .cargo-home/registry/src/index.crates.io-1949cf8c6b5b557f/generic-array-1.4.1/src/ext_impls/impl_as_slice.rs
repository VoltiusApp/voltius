use as_slice::{AsMutSlice, AsSlice};

use crate::{ArrayLength, GenericArray};

impl<T, N: ArrayLength> AsSlice for GenericArray<T, N> {
    type Element = T;

    #[inline(always)]
    fn as_slice(&self) -> &[T] {
        self.as_ref()
    }
}

impl<T, N: ArrayLength> AsMutSlice for GenericArray<T, N> {
    #[inline(always)]
    fn as_mut_slice(&mut self) -> &mut [T] {
        self.as_mut()
    }
}
