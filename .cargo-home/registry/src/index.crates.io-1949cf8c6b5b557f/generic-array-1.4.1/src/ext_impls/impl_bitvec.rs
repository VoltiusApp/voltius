use bitvec::{
    order::BitOrder,
    ptr::BitSpanError,
    slice::BitSlice,
    store::BitStore,
    view::{BitView, BitViewSized},
};

use crate::{ArrayLength, GenericArray};

impl<T, N: ArrayLength> BitView for GenericArray<T, N>
where
    T: BitStore,
{
    type Store = T;

    #[inline(always)]
    fn view_bits<O>(&self) -> &BitSlice<T, O>
    where
        O: BitOrder,
    {
        BitSlice::from_slice(self)
    }

    #[inline(always)]
    fn try_view_bits<O>(&self) -> Result<&BitSlice<T, O>, BitSpanError<T>>
    where
        O: BitOrder,
    {
        BitSlice::try_from_slice(self)
    }

    #[inline(always)]
    fn view_bits_mut<O>(&mut self) -> &mut BitSlice<T, O>
    where
        O: BitOrder,
    {
        BitSlice::from_slice_mut(self)
    }

    #[inline(always)]
    fn try_view_bits_mut<O>(&mut self) -> Result<&mut BitSlice<T, O>, BitSpanError<T>>
    where
        O: BitOrder,
    {
        BitSlice::try_from_slice_mut(self)
    }
}

use const_default::ConstDefault;

#[repr(transparent)]
struct ZeroHelper<T>(T);

impl<T> ConstDefault for ZeroHelper<T>
where
    T: BitStore,
{
    const DEFAULT: Self = Self(T::ZERO);
}

/// BitViewSized implementation for GenericArray
///
/// Ignore the ZeroHelper; it's just there to provide a way to create a zeroed
/// GenericArray as a const.
impl<T, N: ArrayLength> BitViewSized for GenericArray<T, N>
where
    T: BitStore,
    GenericArray<ZeroHelper<T>, N>: ConstDefault,
{
    // SAFETY: ZeroHelper<T> is transparent over T, so this is the same memory layout,
    // but we can exploit ConstDefault to create a zeroed array from T::ZERO.
    const ZERO: Self = unsafe { crate::const_transmute(GenericArray::<ZeroHelper<T>, N>::DEFAULT) };

    #[inline(always)]
    fn as_raw_slice(&self) -> &[Self::Store] {
        self.as_slice()
    }

    #[inline(always)]
    fn as_raw_mut_slice(&mut self) -> &mut [Self::Store] {
        self.as_mut_slice()
    }
}
