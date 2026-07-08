use crate::{Choice, Limb, Uint, WideWord, Word, WrappingNeg, word};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Perform wrapping negation.
    #[must_use]
    pub const fn wrapping_neg(&self) -> Self {
        self.carrying_neg().0
    }

    /// Perform negation: map `self` to `(self ^ 1111...1111) + 0000...0001`.
    /// Additionally return whether the carry flag is set on the addition.
    ///
    /// Note: the carry is set if and only if `self == Self::ZERO`.
    #[must_use]
    #[allow(clippy::cast_possible_truncation)]
    pub const fn carrying_neg(&self) -> (Self, Choice) {
        let mut ret = [Limb::ZERO; LIMBS];
        let mut carry = 1;
        let mut i = 0;
        while i < LIMBS {
            let r = (!self.limbs[i].0 as WideWord) + carry;
            ret[i] = Limb(r as Word);
            carry = r >> Limb::BITS;
            i += 1;
        }
        (Uint::new(ret), word::choice_from_lsb(carry as Word))
    }

    /// Perform wrapping negation, if `negate` is truthy. Otherwise, return `self`.
    #[must_use]
    pub const fn wrapping_neg_if(&self, negate: Choice) -> Self {
        Uint::select(self, &self.wrapping_neg(), negate)
    }
}

impl<const LIMBS: usize> WrappingNeg for Uint<LIMBS> {
    #[inline]
    fn wrapping_neg(&self) -> Self {
        self.wrapping_neg()
    }
}

#[cfg(test)]
mod tests {
    use crate::{Choice, U256};

    #[test]
    fn wrapping_neg() {
        assert_eq!(U256::ZERO.wrapping_neg(), U256::ZERO);
        assert_eq!(U256::MAX.wrapping_neg(), U256::ONE);
        assert_eq!(
            U256::from_u64(13).wrapping_neg(),
            U256::from_u64(13).not().saturating_add(&U256::ONE)
        );
        assert_eq!(
            U256::from_u64(42).wrapping_neg(),
            U256::from_u64(42).saturating_sub(&U256::ONE).not()
        );
    }

    #[test]
    fn carrying_neg() {
        let (ret, carry) = U256::ZERO.carrying_neg();
        assert_eq!(ret, U256::ZERO);
        assert!(carry.to_bool());

        let (ret, carry) = U256::ONE.carrying_neg();
        assert_eq!(ret, U256::MAX);
        assert!(!carry.to_bool());

        let (ret, carry) = U256::MAX.carrying_neg();
        assert_eq!(ret, U256::ONE);
        assert!(!carry.to_bool());
    }

    #[test]
    fn wrapping_neg_if() {
        let negate = Choice::TRUE;
        assert_eq!(U256::ZERO.wrapping_neg_if(negate), U256::ZERO);
        assert_eq!(U256::ONE.wrapping_neg_if(negate), U256::MAX);
        assert_eq!(U256::MAX.wrapping_neg_if(negate), U256::ONE);

        let do_not_negate = Choice::FALSE;
        assert_eq!(U256::ZERO.wrapping_neg_if(do_not_negate), U256::ZERO);
        assert_eq!(U256::ONE.wrapping_neg_if(do_not_negate), U256::ONE);
        assert_eq!(U256::MAX.wrapping_neg_if(do_not_negate), U256::MAX);
    }
}
