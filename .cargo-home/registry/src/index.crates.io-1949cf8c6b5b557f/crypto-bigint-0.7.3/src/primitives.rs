use crate::{Choice, WideWord, Word};

/// Adds wide numbers represented by pairs of (least significant word, most significant word)
/// and returns the result in the same format `(lo, hi)`.
#[inline(always)]
#[allow(clippy::cast_possible_truncation)]
pub(crate) const fn addhilo(x_lo: Word, x_hi: Word, y_lo: Word, y_hi: Word) -> (Word, Word) {
    let res = (((x_hi as WideWord) << Word::BITS) | (x_lo as WideWord))
        + (((y_hi as WideWord) << Word::BITS) | (y_lo as WideWord));
    (res as Word, (res >> Word::BITS) as Word)
}

/// Computes `lhs + rhs + carry`, returning the result along with the new carry (0, 1, or 2).
#[inline(always)]
#[allow(clippy::cast_possible_truncation)]
pub(crate) const fn carrying_add(lhs: Word, rhs: Word, carry: Word) -> (Word, Word) {
    // We could use `Word::overflowing_add()` here analogous to `overflowing_add()`,
    // but this version seems to produce a slightly better assembly.
    let a = lhs as WideWord;
    let b = rhs as WideWord;
    let carry = carry as WideWord;
    let ret = a + b + carry;
    (ret as Word, (ret >> Word::BITS) as Word)
}

/// Computes `lhs + rhs`, returning the result along with the carry (0 or 1).
#[inline(always)]
pub(crate) const fn overflowing_add(lhs: Word, rhs: Word) -> (Word, Word) {
    let (res, carry) = lhs.overflowing_add(rhs);
    (res, carry as Word)
}

/// Computes `lhs - (rhs + borrow)`, returning the result along with the new borrow.
#[inline(always)]
pub(crate) const fn borrowing_sub(lhs: Word, rhs: Word, borrow: Word) -> (Word, Word) {
    // XXX we cannot use WideWord casts here: https://github.com/rust-lang/rust/issues/149522
    // rustc 1.87 through 1.91 incorrectly optimize some WideWord bit arithmetic.
    let (ret, b2) = lhs.overflowing_sub(borrow >> (Word::BITS - 1));
    let (ret, b1) = ret.overflowing_sub(rhs);
    (ret, Word::MIN.wrapping_sub((b1 | b2) as Word))
}

/// Computes `lhs * rhs`, returning the low and the high words of the result.
#[inline(always)]
#[allow(clippy::cast_possible_truncation)]
pub(crate) const fn widening_mul(lhs: Word, rhs: Word) -> (Word, Word) {
    let a = lhs as WideWord;
    let b = rhs as WideWord;
    let ret = a * b;
    (ret as Word, (ret >> Word::BITS) as Word)
}

/// Computes `(lhs * rhs) + addend + carry`, returning the result along with the new carry.
#[inline(always)]
#[allow(clippy::cast_possible_truncation)]
pub(crate) const fn carrying_mul_add(
    lhs: Word,
    rhs: Word,
    addend: Word,
    carry: Word,
) -> (Word, Word) {
    let lhs = lhs as WideWord;
    let rhs = rhs as WideWord;
    let addend = addend as WideWord;
    let carry = carry as WideWord;

    // Cannot overflow:
    // lhs      * rhs      + addend   + carry
    // (2^64-1) * (2^64-1) + (2^64-1) + (2^64-1) =
    // 2^128 - 2^65 + 1 + 2^64 - 1 + 2^64 - 1 =
    // 2^128 - 2^65 + 2*2^64 - 1 =
    // 2^128 - 1 = u128::MAX
    let ret = ((lhs * rhs) + addend) + carry;
    (ret as Word, (ret >> Word::BITS) as Word)
}

/// `const fn` equivalent of `u32::max(a, b)`.
#[inline]
pub(crate) const fn u32_max(a: u32, b: u32) -> u32 {
    Choice::from_u32_lt(a, b).select_u32(a, b)
}

/// `const` equivalent of `u32::min(a, b)`.
#[inline]
pub(crate) const fn u32_min(a: u32, b: u32) -> u32 {
    Choice::from_u32_lt(a, b).select_u32(b, a)
}

/// Remainder calculation, constant time for a given divisor `d`.
/// Based on "Faster Remainder by Direct Computation: Applications to Compilers and Software Libraries"
/// by Daniel Lemire, Owen Kaser, and Nathan Kurz., Fig. 1.
#[inline(never)]
#[allow(clippy::cast_possible_truncation, reason = "needs triage")]
#[allow(clippy::integer_division_remainder_used, reason = "needs triage")]
pub(crate) const fn u32_rem(n: u32, d: u32) -> u32 {
    assert!(d > 0, "divisor must be nonzero");
    let c = u64::MAX / (d as u64) + 1;
    (((c.wrapping_mul(n as u64) as u128) * d as u128) >> 64) as u32
}

/// Compute the number of bits needed to represent `n`.
#[inline(always)]
pub(crate) const fn u32_bits(n: u32) -> u32 {
    u32::BITS - n.leading_zeros()
}

#[cfg(test)]
mod tests {
    use super::{u32_max, u32_min, u32_rem};
    use crate::Word;

    #[test]
    fn carrying_mul_add_cannot_overflow() {
        let lhs = Word::MAX;
        let rhs = Word::MAX;
        let addend = Word::MAX;
        let carry_in = Word::MAX;
        let (result, carry_out) = super::carrying_mul_add(lhs, rhs, addend, carry_in);
        assert_eq!(result, Word::MAX);
        assert_eq!(carry_out, Word::MAX);
    }

    #[test]
    fn test_u32_const_min() {
        assert_eq!(u32_min(0, 5), 0);
        assert_eq!(u32_min(7, 0), 0);
        assert_eq!(u32_min(7, 5), 5);
        assert_eq!(u32_min(7, 7), 7);
    }

    #[test]
    fn test_u32_const_max() {
        assert_eq!(u32_max(0, 5), 5);
        assert_eq!(u32_max(7, 0), 7);
        assert_eq!(u32_max(7, 5), 7);
        assert_eq!(u32_max(7, 7), 7);
    }

    #[test]
    fn test_u32_const_rem() {
        assert_eq!(u32_rem(0, 5), 0);
        assert_eq!(u32_rem(4, 5), 4);
        assert_eq!(u32_rem(7, 5), 2);
        assert_eq!(u32_rem(101, 5), 1);
    }
}
