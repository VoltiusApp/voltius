use crate::{Choice, CtEq};
use core::ops::Neg;

/// Possible return values for Jacobi symbol calculations.
#[derive(Debug, Copy, Clone)]
#[repr(i8)]
pub enum JacobiSymbol {
    /// The two arguments are not coprime, they have a common divisor apart from 1.
    Zero = 0,

    /// The two arguments are coprime. If the lower argument is prime, then the upper argument
    /// is quadratic residue modulo the lower argument. Otherwise, the upper argument is known to
    /// be quadratic nonresidue for an even number of prime factors of the lower argument.
    One = 1,

    /// The two terms are coprime, and the upper argument is a quadratic nonresidue modulo the
    /// lower argument.
    MinusOne = -1,
}

impl JacobiSymbol {
    /// Determine if the symbol is zero.
    #[must_use]
    pub const fn is_zero(&self) -> Choice {
        Choice::from_i64_eq(*self as i8 as i64, 0)
    }

    /// Determine if the symbol is one.
    #[must_use]
    pub const fn is_one(&self) -> Choice {
        Choice::from_i64_eq(*self as i8 as i64, 1)
    }

    /// Determine if the symbol is minus one.
    #[must_use]
    pub const fn is_minus_one(&self) -> Choice {
        Choice::from_i64_eq(*self as i8 as i64, -1)
    }

    /// Negate the symbol.
    #[must_use]
    pub const fn neg(self) -> Self {
        match self {
            Self::Zero => Self::Zero,
            Self::One => Self::MinusOne,
            Self::MinusOne => Self::One,
        }
    }

    pub(crate) const fn from_i8(value: i8) -> Self {
        match value {
            0 => Self::Zero,
            1 => Self::One,
            -1 => Self::MinusOne,
            _ => panic!("invalid value for Jacobi symbol"),
        }
    }
}

impl CtEq for JacobiSymbol {
    fn ct_eq(&self, other: &Self) -> Choice {
        (*self as i8).ct_eq(&(*other as i8))
    }
}

impl Eq for JacobiSymbol {}

impl PartialEq for JacobiSymbol {
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).to_bool()
    }
}

impl From<JacobiSymbol> for i8 {
    fn from(symbol: JacobiSymbol) -> i8 {
        symbol as i8
    }
}

impl Neg for JacobiSymbol {
    type Output = Self;

    fn neg(self) -> Self {
        Self::neg(self)
    }
}

#[cfg(feature = "subtle")]
impl subtle::ConstantTimeEq for JacobiSymbol {
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, other).into()
    }
}

#[cfg(test)]
mod tests {
    use super::JacobiSymbol;

    #[test]
    fn jacobi_eq() {
        assert_eq!(JacobiSymbol::Zero, JacobiSymbol::Zero);
        assert_ne!(JacobiSymbol::Zero, JacobiSymbol::One);
        assert_ne!(JacobiSymbol::Zero, JacobiSymbol::MinusOne);
        assert!(JacobiSymbol::Zero.is_zero().to_bool());
        assert!(!JacobiSymbol::One.is_zero().to_bool());
        assert!(JacobiSymbol::One.is_one().to_bool());
        assert!(!JacobiSymbol::MinusOne.is_one().to_bool());
        assert!(JacobiSymbol::MinusOne.is_minus_one().to_bool());
        #[cfg(feature = "subtle")]
        assert!(bool::from(subtle::ConstantTimeEq::ct_eq(
            &JacobiSymbol::Zero,
            &JacobiSymbol::Zero
        )));
        #[cfg(feature = "subtle")]
        assert!(!bool::from(subtle::ConstantTimeEq::ct_eq(
            &JacobiSymbol::Zero,
            &JacobiSymbol::One
        )));
    }

    #[test]
    fn jacobi_from() {
        assert_eq!(i8::from(JacobiSymbol::Zero), 0i8);
        assert_eq!(i8::from(JacobiSymbol::One), 1i8);
        assert_eq!(i8::from(JacobiSymbol::MinusOne), -1i8);
        assert_eq!(JacobiSymbol::from_i8(0i8), JacobiSymbol::Zero);
        assert_eq!(JacobiSymbol::from_i8(1i8), JacobiSymbol::One);
        assert_eq!(JacobiSymbol::from_i8(-1i8), JacobiSymbol::MinusOne);
    }

    #[test]
    fn jacobi_neg() {
        assert_eq!(JacobiSymbol::Zero.neg(), JacobiSymbol::Zero);
        assert_eq!(-JacobiSymbol::One, JacobiSymbol::MinusOne);
        assert_eq!(-JacobiSymbol::MinusOne, JacobiSymbol::One);
    }
}
