use crate::{Choice, ConstZero, CtOption, Int, Uint, Word, word};

impl<const LIMBS: usize> Int<LIMBS> {
    /// Returns the word of most significant [`Limb`].
    ///
    /// For the degenerate case where the number of limbs is zero,
    /// zeroed word is returned (which is semantically correct).
    /// This method leaks the limb length of the value, which is also OK.
    #[inline(always)]
    const fn most_significant_word(&self) -> Word {
        if Self::LIMBS == 0 {
            Word::ZERO
        } else {
            self.0.to_words()[LIMBS - 1]
        }
    }

    /// Construct new [`Int`] from an absolute value and sign.
    ///
    /// Returns `None` when the result exceeds the bounds of an [`Int<LIMBS>`].
    #[inline]
    #[must_use]
    pub const fn new_from_abs_sign(abs: Uint<LIMBS>, is_negative: Choice) -> CtOption<Self> {
        let abs_int = abs.as_int();
        let abs_msb = abs_int.is_negative();
        let signed = abs_int.wrapping_neg_if(is_negative);

        // abs is an acceptable input if the high bit is unset, covering 0..=Int::MAX,
        // or if it is equal to Int::MIN (bit sequence '1000...0000') and the sign is negative.
        // Int::MIN and zero are the only values for which wrapping negation does not change
        // the MSB, so we check if the sign is negative (wrapping negation is performed) and
        // the sign of the wrapping negation is also negative.
        let fits = abs_msb.not().or(is_negative.and(signed.is_negative()));
        CtOption::new(signed, fits)
    }

    /// Construct a new [`Int`] from an [`CtOption`] of an absolute value and sign.
    #[inline]
    pub(crate) const fn new_from_abs_opt_sign(
        maybe_abs: CtOption<Uint<LIMBS>>,
        is_negative: Choice,
    ) -> CtOption<Self> {
        Self::new_from_abs_sign(maybe_abs.to_inner_unchecked(), is_negative)
            .filter_by(maybe_abs.is_some())
    }

    /// Whether this [`Int`] is negative, as a `Choice`.
    #[inline(always)]
    #[must_use]
    pub const fn is_negative(&self) -> Choice {
        word::choice_from_msb(self.most_significant_word())
    }

    /// Whether this [`Int`] is positive, as a `Choice`.
    #[must_use]
    pub const fn is_positive(&self) -> Choice {
        self.is_negative().not().and(self.is_nonzero())
    }

    /// The sign and magnitude of this [`Int`].
    #[must_use]
    pub const fn abs_sign(&self) -> (Uint<LIMBS>, Choice) {
        let sign = self.is_negative();
        // Note: this negate_if is safe to use, since we are negating based on self.is_negative()
        let abs = self.wrapping_neg_if(sign);
        (abs.0, sign)
    }

    /// The magnitude of this [`Int`].
    #[must_use]
    pub const fn abs(&self) -> Uint<LIMBS> {
        self.abs_sign().0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{I128, U128};

    #[test]
    fn new_from_abs_sign() {
        assert!(
            I128::new_from_abs_sign(U128::ZERO, Choice::FALSE)
                .is_some()
                .to_bool()
        );
        assert!(
            I128::new_from_abs_sign(U128::ZERO, Choice::TRUE)
                .is_some()
                .to_bool()
        );
        assert!(
            I128::new_from_abs_sign(I128::MIN.abs(), Choice::FALSE)
                .is_none()
                .to_bool()
        );
        assert!(
            I128::new_from_abs_sign(I128::MIN.abs(), Choice::TRUE)
                .is_some()
                .to_bool()
        );
        assert!(
            I128::new_from_abs_sign(I128::MAX.abs(), Choice::FALSE)
                .is_some()
                .to_bool()
        );
        assert!(
            I128::new_from_abs_sign(I128::MAX.abs(), Choice::TRUE)
                .is_some()
                .to_bool()
        );
        assert!(
            I128::new_from_abs_sign(U128::MAX, Choice::TRUE)
                .is_none()
                .to_bool()
        );
    }

    #[test]
    fn is_negative() {
        assert!(I128::MIN.is_negative().to_bool());
        assert!(I128::MINUS_ONE.is_negative().to_bool());
        assert!(!I128::ZERO.is_negative().to_bool());
        assert!(!I128::ONE.is_negative().to_bool());
        assert!(!I128::MAX.is_negative().to_bool());

        let random_negative = I128::from_be_hex("91113333555577779999BBBBDDDDFFFF");
        assert!(random_negative.is_negative().to_bool());

        let random_positive = I128::from_be_hex("71113333555577779999BBBBDDDDFFFF");
        assert!(!random_positive.is_negative().to_bool());
    }

    #[test]
    fn is_positive() {
        assert!(!I128::MIN.is_positive().to_bool());
        assert!(!I128::MINUS_ONE.is_positive().to_bool());
        assert!(!I128::ZERO.is_positive().to_bool());
        assert!(I128::ONE.is_positive().to_bool());
        assert!(I128::MAX.is_positive().to_bool());

        let random_negative = I128::from_be_hex("deadbeefcafebabedeadbeefcafebabe");
        assert!(!random_negative.is_positive().to_bool());

        let random_positive = I128::from_be_hex("0badc0dedeadc0decafebabedeadcafe");
        assert!(random_positive.is_positive().to_bool());
    }
}
