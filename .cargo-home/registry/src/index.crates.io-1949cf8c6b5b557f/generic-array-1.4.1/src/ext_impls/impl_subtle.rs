use subtle::{ConditionallySelectable, ConstantTimeEq};

use crate::{ArrayLength, GenericArray};

impl<T, N: ArrayLength> ConstantTimeEq for GenericArray<T, N>
where
    T: ConstantTimeEq,
{
    #[inline]
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        self.as_slice().ct_eq(other.as_slice())
    }
}

impl<T, N: ArrayLength> ConditionallySelectable for GenericArray<T, N>
where
    GenericArray<T, N>: Copy,
    T: ConditionallySelectable,
{
    #[inline]
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        let mut out = *a;
        out.conditional_assign(b, choice);
        out
    }

    #[inline]
    fn conditional_assign(&mut self, other: &Self, choice: subtle::Choice) {
        for (a, b) in self.iter_mut().zip(other.iter()) {
            a.conditional_assign(b, choice);
        }
    }
}
