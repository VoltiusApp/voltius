//! Const default implementation

use crate::{ArrayLength, GenericArray, GenericArrayImplEven, GenericArrayImplOdd};
use const_default::ConstDefault;

impl<T, U: ConstDefault> ConstDefault for GenericArrayImplEven<T, U> {
    const DEFAULT: Self = Self {
        parents: [U::DEFAULT; 2],
        _marker: core::marker::PhantomData,
    };
}

impl<T: ConstDefault, U: ConstDefault> ConstDefault for GenericArrayImplOdd<T, U> {
    const DEFAULT: Self = Self {
        parents: [U::DEFAULT; 2],
        data: T::DEFAULT,
    };
}

impl<T, U: ArrayLength> ConstDefault for GenericArray<T, U>
where
    U::ArrayType<T>: ConstDefault,
{
    const DEFAULT: Self = Self {
        data: ConstDefault::DEFAULT,
    };
}

// `T: ConstDefault` is intentionally redundant to provide better hints in the docs
impl<T: ConstDefault, U: ArrayLength> GenericArray<T, U>
where
    Self: ConstDefault,
{
    /// Returns the constant "default value" for an array using [ConstDefault]
    #[inline(always)]
    pub const fn const_default() -> Self {
        Self::DEFAULT
    }
}
