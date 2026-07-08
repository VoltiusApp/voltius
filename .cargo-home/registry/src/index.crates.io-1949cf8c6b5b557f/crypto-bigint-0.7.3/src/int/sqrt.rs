//! [`Int`] square root operations.

use super::Int;
use crate::{CheckedSquareRoot, CtOption};

impl<const LIMBS: usize> Int<LIMBS> {
    /// Perform checked sqrt, returning a [`CtOption`] which `is_some`
    /// only if the integer is non-negative and the square root is exact.
    #[must_use]
    pub fn checked_sqrt(&self) -> CtOption<Self> {
        self.as_uint()
            .checked_sqrt()
            .map(|rt| Self::new(rt.limbs))
            .filter_by(self.is_negative().not())
    }

    /// Perform checked sqrt, returning a [`CtOption`] which `is_some`
    /// only if the integer is non-negative and the square root is exact.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    pub fn checked_sqrt_vartime(&self) -> Option<Self> {
        if self.is_negative().not().to_bool_vartime() {
            self.as_uint()
                .checked_sqrt_vartime()
                .map(|rt| Self::new(rt.limbs))
        } else {
            None
        }
    }
}

impl<const LIMBS: usize> CheckedSquareRoot for Int<LIMBS> {
    type Output = Self;

    fn checked_sqrt(&self) -> CtOption<Self::Output> {
        self.checked_sqrt()
    }

    fn checked_sqrt_vartime(&self) -> Option<Self::Output> {
        self.checked_sqrt_vartime()
    }
}

#[cfg(test)]
mod tests {
    use crate::{CheckedSquareRoot, I256};

    #[test]
    fn square_root_expected() {
        let tests = [
            (I256::ZERO, Some(I256::ZERO)),
            (I256::ONE, Some(I256::ONE)),
            (I256::MINUS_ONE, None),
            (I256::from_i8(4), Some(I256::from_i8(2))),
        ];
        for (case, expect) in tests {
            assert_eq!(CheckedSquareRoot::checked_sqrt(&case).into_option(), expect);
            assert_eq!(CheckedSquareRoot::checked_sqrt_vartime(&case), expect);
        }
    }
}
