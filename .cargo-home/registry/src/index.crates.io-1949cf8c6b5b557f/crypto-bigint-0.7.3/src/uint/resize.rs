//! Support for converting between [`Uint`] instances with different sizes.

use super::Uint;
use crate::{Choice, CtOption};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Construct a [`Uint<T>`] from the unsigned integer value,
    /// truncating the upper bits if the value is too large to be
    /// represented.
    #[inline(always)]
    #[must_use]
    pub const fn resize<const T: usize>(&self) -> Uint<T> {
        self.as_uint_ref().to_uint_resize()
    }

    /// Construct a [`Uint<T>`] from the unsigned integer value, returning a [`CtOption`]
    /// which is `is_none` if the upper limbs were non-zero.
    #[inline(always)]
    #[must_use]
    pub const fn resize_checked<const T: usize>(&self) -> CtOption<Uint<T>> {
        let is_some = if T < LIMBS {
            self.as_uint_ref().trailing(T).is_zero()
        } else {
            Choice::TRUE
        };
        CtOption::new(self.resize(), is_some)
    }
}

#[cfg(test)]
mod tests {
    use crate::{U64, U128};

    #[test]
    fn resize_larger() {
        let u = U64::from_be_hex("AAAAAAAABBBBBBBB");
        let u2: U128 = u.resize();
        assert_eq!(u2, U128::from_be_hex("0000000000000000AAAAAAAABBBBBBBB"));
        let u3: Option<U128> = u.resize_checked().into_option();
        assert_eq!(
            u3,
            Some(U128::from_be_hex("0000000000000000AAAAAAAABBBBBBBB"))
        );
    }

    #[test]
    fn resize_smaller() {
        let u = U128::from_be_hex("AAAAAAAABBBBBBBBCCCCCCCCDDDDDDDD");
        let u2: U64 = u.resize();
        assert_eq!(u2, U64::from_be_hex("CCCCCCCCDDDDDDDD"));
        let u3: Option<U64> = u.resize_checked().into_option();
        assert_eq!(u3, None);
        let u4 = U128::ONE.resize_checked().into_option();
        assert_eq!(u4, Some(U64::ONE));
    }
}
