//! [`BoxedUint`] negation operations.

use crate::{BoxedUint, Choice, CtAssign, Limb, WideWord, Word, WrappingNeg};

impl BoxedUint {
    /// Perform wrapping negation.
    #[must_use]
    #[allow(clippy::cast_possible_truncation)]
    pub fn wrapping_neg(&self) -> Self {
        let mut ret = vec![Limb::ZERO; self.nlimbs()];
        let mut carry = 1;

        for i in 0..self.nlimbs() {
            let r = WideWord::from(!self.limbs[i].0) + carry;
            ret[i] = Limb(r as Word);
            carry = r >> Limb::BITS;
        }

        ret.into()
    }

    /// Perform in-place wrapping subtraction, returning the truthy value as the second element of
    /// the tuple if an underflow has occurred.
    #[allow(clippy::cast_possible_truncation)]
    pub(crate) fn conditional_wrapping_neg_assign(&mut self, choice: Choice) {
        let mut carry = 1;

        for i in 0..self.nlimbs() {
            let r = WideWord::from(!self.limbs[i].0) + carry;
            self.limbs[i].ct_assign(&Limb(r as Word), choice);
            carry = r >> Limb::BITS;
        }
    }
}

impl WrappingNeg for BoxedUint {
    fn wrapping_neg(&self) -> Self {
        self.wrapping_neg()
    }
}

#[cfg(test)]
mod tests {
    use crate::{BoxedUint, Choice, CtNeg};

    #[test]
    fn ct_neg() {
        let a = BoxedUint::from(123u64);
        assert_eq!(a.ct_neg(Choice::FALSE), a);
        assert_eq!(a.ct_neg(Choice::TRUE), a.wrapping_neg());
    }

    #[test]
    fn ct_neg_assign() {
        let mut a = BoxedUint::from(123u64);
        let control = a.clone();

        a.ct_neg_assign(Choice::FALSE);
        assert_eq!(a, control);

        a.ct_neg_assign(Choice::TRUE);
        assert_ne!(a, control);
        assert_eq!(a, control.wrapping_neg());
    }

    #[cfg(feature = "subtle")]
    #[test]
    fn subtle_conditional_negate() {
        use subtle::ConditionallyNegatable;
        let mut a = BoxedUint::from(123u64);
        let control = a.clone();

        a.conditional_negate(Choice::FALSE.into());
        assert_eq!(a, control);

        a.conditional_negate(Choice::TRUE.into());
        assert_ne!(a, control);
        assert_eq!(a, control.wrapping_neg());
    }

    #[test]
    fn wrapping_neg() {
        assert_eq!(BoxedUint::zero().wrapping_neg(), BoxedUint::zero());
        assert_eq!(BoxedUint::max(64).wrapping_neg(), BoxedUint::one());
        // assert_eq!(
        //     BoxedUint::from(13u64).wrapping_neg(),
        //     BoxedUint::from(13u64).not().saturating_add(&BoxedUint::one())
        // );
        // assert_eq!(
        //     BoxedUint::from(42u64).wrapping_neg(),
        //     BoxedUint::from(42u64).saturating_sub(&BoxedUint::one()).not()
        // );
    }
}
