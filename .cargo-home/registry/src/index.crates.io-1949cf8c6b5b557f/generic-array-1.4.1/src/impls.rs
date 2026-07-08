use core::borrow::{Borrow, BorrowMut};
use core::cmp::Ordering;
use core::fmt::{self, Debug};
use core::hash::{Hash, Hasher};

use typenum::{consts, Const};

use super::{ArrayLength, ConstArrayLength, GenericArray, IntoArrayLength};

use crate::functional::*;
use crate::sequence::*;

impl<T: Default, N: ArrayLength> Default for GenericArray<T, N> {
    #[inline(always)]
    fn default() -> Self {
        Self::generate(|_| T::default())
    }
}

impl<T: Clone, N: ArrayLength> Clone for GenericArray<T, N> {
    #[inline]
    fn clone(&self) -> GenericArray<T, N> {
        self.map(Clone::clone)
    }
}

impl<T: Copy, N: ArrayLength> Copy for GenericArray<T, N> where N::ArrayType<T>: Copy {}

impl<T: PartialEq, N: ArrayLength> PartialEq for GenericArray<T, N> {
    #[inline(always)]
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}
impl<T: Eq, N: ArrayLength> Eq for GenericArray<T, N> {}

impl<T: PartialOrd, N: ArrayLength> PartialOrd for GenericArray<T, N> {
    #[inline(always)]
    fn partial_cmp(&self, other: &GenericArray<T, N>) -> Option<Ordering> {
        PartialOrd::partial_cmp(self.as_slice(), other.as_slice())
    }
}

impl<T: Ord, N: ArrayLength> Ord for GenericArray<T, N> {
    #[inline(always)]
    fn cmp(&self, other: &GenericArray<T, N>) -> Ordering {
        Ord::cmp(self.as_slice(), other.as_slice())
    }
}

impl<T: Debug, N: ArrayLength> Debug for GenericArray<T, N> {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        self.as_slice().fmt(fmt)
    }
}

impl<T, N: ArrayLength> Borrow<[T]> for GenericArray<T, N> {
    #[inline(always)]
    fn borrow(&self) -> &[T] {
        self.as_slice()
    }
}

impl<T, N: ArrayLength> BorrowMut<[T]> for GenericArray<T, N> {
    #[inline(always)]
    fn borrow_mut(&mut self) -> &mut [T] {
        self.as_mut_slice()
    }
}

impl<T, N: ArrayLength> AsRef<[T]> for GenericArray<T, N> {
    #[inline(always)]
    fn as_ref(&self) -> &[T] {
        self.as_slice()
    }
}

impl<T, N: ArrayLength> AsMut<[T]> for GenericArray<T, N> {
    #[inline(always)]
    fn as_mut(&mut self) -> &mut [T] {
        self.as_mut_slice()
    }
}

impl<T: Hash, N: ArrayLength> Hash for GenericArray<T, N> {
    #[inline]
    fn hash<H>(&self, state: &mut H)
    where
        H: Hasher,
    {
        Hash::hash(self.as_slice(), state)
    }
}

impl<T, const N: usize> From<[T; N]> for GenericArray<T, ConstArrayLength<N>>
where
    Const<N>: IntoArrayLength,
{
    #[inline(always)]
    fn from(value: [T; N]) -> Self {
        GenericArray::from_array(value)
    }
}

impl<T, const N: usize> From<GenericArray<T, ConstArrayLength<N>>> for [T; N]
where
    Const<N>: IntoArrayLength,
{
    #[inline(always)]
    fn from(value: GenericArray<T, ConstArrayLength<N>>) -> Self {
        value.into_array()
    }
}

impl<'a, T, const N: usize> From<&'a [T; N]> for &'a GenericArray<T, ConstArrayLength<N>>
where
    Const<N>: IntoArrayLength,
{
    #[inline(always)]
    fn from(slice: &'a [T; N]) -> Self {
        unsafe { &*(slice.as_ptr() as *const GenericArray<T, ConstArrayLength<N>>) }
    }
}

impl<'a, T, const N: usize> From<&'a mut [T; N]> for &'a mut GenericArray<T, ConstArrayLength<N>>
where
    Const<N>: IntoArrayLength,
{
    #[inline(always)]
    fn from(slice: &'a mut [T; N]) -> Self {
        unsafe { &mut *(slice.as_mut_ptr() as *mut GenericArray<T, ConstArrayLength<N>>) }
    }
}

impl<T, const N: usize> AsRef<[T; N]> for GenericArray<T, ConstArrayLength<N>>
where
    Const<N>: IntoArrayLength,
{
    #[inline(always)]
    fn as_ref(&self) -> &[T; N] {
        unsafe { core::mem::transmute(self) }
    }
}
impl<T, const N: usize> AsMut<[T; N]> for GenericArray<T, ConstArrayLength<N>>
where
    Const<N>: IntoArrayLength,
{
    #[inline(always)]
    fn as_mut(&mut self) -> &mut [T; N] {
        unsafe { core::mem::transmute(self) }
    }
}

macro_rules! impl_tuple {
    (@T $t:ident) => { T };

    ($($len:ty => ($($t:ident,)*);)*) => {$(
        impl<T> From<($(impl_tuple!(@T $t),)*)> for GenericArray<T, $len> {
            #[inline]
            #[allow(non_snake_case)]
            fn from(tuple: ($(impl_tuple!(@T $t),)*)) -> Self {
                let ($($t,)*) = tuple;
                GenericArray::from_array([$($t,)*])
            }
        }

        impl<T> From<GenericArray<T, $len>> for ($(impl_tuple!(@T $t),)*) {
            #[inline]
            #[allow(non_snake_case)]
            fn from(array: GenericArray<T, $len>) -> Self {
                let [$($t),*] = array.into_array();
                ($($t,)*)
            }
        }
    )*};
}

impl_tuple! {
    consts::U1  => (A,);
    consts::U2  => (A,B,);
    consts::U3  => (A,B,C,);
    consts::U4  => (A,B,C,D,);
    consts::U5  => (A,B,C,D,E,);
    consts::U6  => (A,B,C,D,E,F,);
    consts::U7  => (A,B,C,D,E,F,G,);
    consts::U8  => (A,B,C,D,E,F,G,H,);
    consts::U9  => (A,B,C,D,E,F,G,H,I,);
    consts::U10 => (A,B,C,D,E,F,G,H,I,J,);
    consts::U11 => (A,B,C,D,E,F,G,H,I,J,K,);
    consts::U12 => (A,B,C,D,E,F,G,H,I,J,K,L,);
}

#[cfg(test)]
mod tests {
    use crate::*;

    #[test]
    fn test_from_inference() {
        let a = arr![1, 2, 3, 4];
        let _: [i8; 4] = a.into();
    }
}
