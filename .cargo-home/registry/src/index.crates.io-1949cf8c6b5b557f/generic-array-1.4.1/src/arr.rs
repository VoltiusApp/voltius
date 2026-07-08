//! Implementation for `arr!` macro.

/// Macro allowing for easy construction of Generic Arrays.
///
/// Type-inference works similarly to `vec![]`
///
/// **`arr!` can be used in `const` expressions.**
///
/// Example:
/// ```
/// # use generic_array::arr;
/// use generic_array::typenum::U6;
///
/// let test = arr![1, 2, 3]; // implicit length
/// let test = arr![1; 6];    // explicit length via `Const<N>`
/// let test = arr![1; U6];   // explicit length via typenum
/// ```
///
/// # NOTES AND LIMITATIONS
/// * As of `generic-array 1.0`, [`From`]/[`from_array`](crate::GenericArray::from_array) can be used directly for a wide range of regular arrays.
/// * The `[T; N: ArrayLength]` and `[T; usize]` explicit forms are limited to `Copy` values. Use
///   [`GenericArray::generate(|| value.clone())`](crate::GenericSequence::generate) for non-`Copy` items.
/// * The `[T; usize]` explicit and `[0, 1, 2, 3]` implicit forms are limited to lengths supported by [`Const<U>`](typenum::Const)
#[macro_export]
macro_rules! arr {
    ($($x:expr),* $(,)*) => ( $crate::GenericArray::from_array([$($x),*]) );
    ($x:expr; $N:ty)     => ({
        // Bypass `from_array` to allow for any Unsigned array length
        const __INPUT_LENGTH: usize = <$N as $crate::typenum::Unsigned>::USIZE;

        #[inline(always)]
        const fn __do_transmute<T, N: $crate::ArrayLength>(arr: [T; __INPUT_LENGTH]) -> $crate::GenericArray<T, N> {
            unsafe { $crate::const_transmute(arr) }
        }

        __do_transmute::<_, $N>([$x; __INPUT_LENGTH])
    });
    ($x:expr; $n:expr) => ( $crate::GenericArray::from_array([$x; $n]) );
}

/// Like [`arr!`], but returns a `Box<GenericArray<T, N>>`
///
/// Unlike [`arr!`], this is not limited by stack size, only the heap.
///
/// Example:
/// ```
/// # use generic_array::{box_arr, typenum::{self, *}};
/// // allocate a 16MB Buffer of u128 elements (16 bytes * 10 ^ 6)
/// # #[cfg(not(miri))]
/// let test = box_arr![1u128; typenum::Exp<U10, U6>];
/// //  test: Box<GenericArray<u128, _>>
/// ```
///
/// # NOTES AND LIMITATIONS
/// * The `[T; usize]` explicit and `[0, 1, 2, 3]` implicit forms are limited to lengths supported by [`Const<U>`](typenum::Const)
#[cfg(feature = "alloc")]
#[macro_export]
macro_rules! box_arr {
    ($($x:expr),* $(,)*) => ({
        // deduce length based on a ZST array of units
        $crate::GenericArray::__from_vec_helper([$($crate::box_arr_helper!(@unit $x)),*], $crate::alloc::vec![$($x),*])
    });
    ($x:expr; $N:ty) => ( $crate::GenericArray::<_, $N>::try_from_vec($crate::alloc::vec![$x; <$N as $crate::typenum::Unsigned>::USIZE]).unwrap() );
    ($x:expr; $n:expr) => ({
        const __LEN: usize = $n;

        $crate::GenericArray::<_, <$crate::typenum::Const<__LEN> as $crate::IntoArrayLength>::ArrayLength>::try_from_vec($crate::alloc::vec![$x; __LEN]).unwrap()
    });
}

#[cfg(feature = "alloc")]
mod alloc_helper {
    use crate::{ArrayLength, GenericArray, IntoArrayLength};

    impl<T, N: ArrayLength> GenericArray<T, N> {
        #[doc(hidden)]
        #[inline(always)]
        pub fn __from_vec_helper<const U: usize>(
            _empty: [(); U],
            vec: alloc::vec::Vec<T>,
        ) -> alloc::boxed::Box<GenericArray<T, N>>
        where
            typenum::Const<U>: IntoArrayLength<ArrayLength = N>,
        {
            unsafe { GenericArray::try_from_vec(vec).unwrap_unchecked() }
        }
    }
}

// TODO: Remove this somehow?
#[cfg(feature = "alloc")]
#[doc(hidden)]
#[macro_export]
macro_rules! box_arr_helper {
    (@unit $e:expr) => {
        ()
    };
}

mod doctests_only {
    ///
    /// Testing that lifetimes aren't transmuted when they're ellided.
    ///
    /// ```compile_fail
    /// #[macro_use] extern crate generic_array;
    /// fn unsound_lifetime_extension<'a, A>(a: &'a A) -> &'static A {
    ///     arr![a as &A][0]
    /// }
    /// ```
    ///
    /// ```rust
    /// #[macro_use] extern crate generic_array;
    /// fn unsound_lifetime_extension<'a, A>(a: &'a A) -> &'a A {
    ///     arr![a][0]
    /// }
    /// ```
    #[allow(dead_code)]
    pub enum DocTests {}
}
