//! `From`-like conversions for [`Uint`].

use crate::{Concat, Limb, NonZero, Odd, Split, U64, U128, Uint, WideWord, Word};

macro_rules! check_limbs {
    ($limbs:expr) => {
        check_limbs!($limbs, 1)
    };
    ($limbs:expr, $min:expr) => {
        const {
            assert!($limbs >= 1, "number of limbs too small of supplied type");
        }
    };
}

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Create a [`Uint`] from a `u8` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<u8>` when stable
    #[inline]
    #[must_use]
    pub const fn from_u8(n: u8) -> Self {
        check_limbs!(LIMBS);
        let mut limbs = [Limb::ZERO; LIMBS];
        limbs[0].0 = n as Word;
        Self { limbs }
    }

    /// Create a [`Uint`] from a `u16` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<u16>` when stable
    #[inline]
    #[must_use]
    pub const fn from_u16(n: u16) -> Self {
        check_limbs!(LIMBS);
        let mut limbs = [Limb::ZERO; LIMBS];
        limbs[0].0 = n as Word;
        Self { limbs }
    }

    /// Create a [`Uint`] from a `u32` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<u32>` when stable
    #[allow(trivial_numeric_casts)]
    #[inline]
    #[must_use]
    pub const fn from_u32(n: u32) -> Self {
        check_limbs!(LIMBS);
        let mut limbs = [Limb::ZERO; LIMBS];
        limbs[0].0 = n as Word;
        Self { limbs }
    }

    cpubits::cpubits! {
        32 => {
            /// Create a [`Uint`] from a `u64` (const-friendly)
            // TODO(tarcieri): replace with `const impl From<u64>` when stable
            #[inline]
            pub const fn from_u64(n: u64) -> Self {
                check_limbs!(LIMBS, 2);
                let mut limbs = [Limb::ZERO; LIMBS];
                limbs[0].0 = (n & 0xFFFFFFFF) as u32;
                limbs[1].0 = (n >> 32) as u32;
                Self { limbs }
            }
        }
        64 => {
            /// Create a [`Uint`] from a `u64` (const-friendly)
            // TODO(tarcieri): replace with `const impl From<u64>` when stable
            #[inline]
            #[must_use]
            pub const fn from_u64(n: u64) -> Self {
                check_limbs!(LIMBS);
                let mut limbs = [Limb::ZERO; LIMBS];
                limbs[0].0 = n;
                Self { limbs }
            }
        }
    }

    /// Create a [`Uint`] from a `u128` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<u128>` when stable
    #[inline]
    #[must_use]
    pub const fn from_u128(n: u128) -> Self {
        check_limbs!(LIMBS, 16 / Limb::BYTES);
        let lo = U64::from_u64((n & 0xffff_ffff_ffff_ffff) as u64);
        let hi = U64::from_u64((n >> 64) as u64);

        let mut limbs = [Limb::ZERO; LIMBS];

        let mut i = 0;
        while i < lo.limbs.len() {
            limbs[i] = lo.limbs[i];
            i += 1;
        }

        let mut j = 0;
        while j < hi.limbs.len() {
            limbs[i + j] = hi.limbs[j];
            j += 1;
        }

        Self { limbs }
    }

    /// Create a [`Uint`] from a `Word` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<Word>` when stable
    #[inline]
    #[must_use]
    pub const fn from_word(n: Word) -> Self {
        check_limbs!(LIMBS);
        let mut limbs = [Limb::ZERO; LIMBS];
        limbs[0].0 = n;
        Self { limbs }
    }

    /// Create a [`Uint`] from a `WideWord` (const-friendly)
    // TODO(tarcieri): replace with `const impl From<WideWord>` when stable
    #[inline]
    #[must_use]
    #[allow(clippy::cast_possible_truncation)]
    pub const fn from_wide_word(n: WideWord) -> Self {
        check_limbs!(LIMBS, 2);
        let mut limbs = [Limb::ZERO; LIMBS];
        limbs[0].0 = n as Word;
        limbs[1].0 = (n >> Limb::BITS) as Word;
        Self { limbs }
    }
}

impl<const LIMBS: usize> From<u8> for Uint<LIMBS> {
    #[inline]
    fn from(n: u8) -> Self {
        check_limbs!(LIMBS);
        Self::from_u8(n)
    }
}

impl<const LIMBS: usize> From<u16> for Uint<LIMBS> {
    #[inline]
    fn from(n: u16) -> Self {
        check_limbs!(LIMBS);
        Self::from_u16(n)
    }
}

impl<const LIMBS: usize> From<u32> for Uint<LIMBS> {
    #[inline]
    fn from(n: u32) -> Self {
        check_limbs!(LIMBS);
        Self::from_u32(n)
    }
}

impl<const LIMBS: usize> From<u64> for Uint<LIMBS> {
    #[inline]
    fn from(n: u64) -> Self {
        check_limbs!(LIMBS, 8 / Limb::BYTES);
        Self::from_u64(n)
    }
}

impl<const LIMBS: usize> From<u128> for Uint<LIMBS> {
    #[inline]
    fn from(n: u128) -> Self {
        check_limbs!(LIMBS, 16 / Limb::BYTES);
        Self::from_u128(n)
    }
}

cpubits::cpubits! {
    32 => {
        impl From<U64> for u64 {
            #[inline]
            fn from(n: U64) -> u64 {
                (n.limbs[0].0 as u64) | ((n.limbs[1].0 as u64) << 32)
            }
        }
    }
    64 => {
        impl From<U64> for u64 {
            #[inline]
            fn from(n: U64) -> u64 {
                n.limbs[0].into()
            }
        }
    }
}

impl From<U128> for u128 {
    #[inline]
    fn from(n: U128) -> u128 {
        let mut i = U128::LIMBS - 1;
        let mut res = u128::from(n.limbs[i].0);
        while i > 0 {
            i -= 1;
            res = (res << Limb::BITS) | u128::from(n.limbs[i].0);
        }
        res
    }
}

impl<const LIMBS: usize> From<[Word; LIMBS]> for Uint<LIMBS> {
    #[inline]
    fn from(arr: [Word; LIMBS]) -> Self {
        Self::from_words(arr)
    }
}

impl<const LIMBS: usize> From<Uint<LIMBS>> for [Word; LIMBS] {
    #[inline]
    fn from(n: Uint<LIMBS>) -> [Word; LIMBS] {
        *n.as_ref()
    }
}

impl<const LIMBS: usize> From<[Limb; LIMBS]> for Uint<LIMBS> {
    #[inline]
    fn from(limbs: [Limb; LIMBS]) -> Self {
        Self { limbs }
    }
}

impl<const LIMBS: usize> From<Uint<LIMBS>> for [Limb; LIMBS] {
    #[inline]
    fn from(n: Uint<LIMBS>) -> [Limb; LIMBS] {
        n.limbs
    }
}

impl<const LIMBS: usize> From<Limb> for Uint<LIMBS> {
    #[inline]
    fn from(limb: Limb) -> Self {
        limb.0.into()
    }
}

impl<const LIMBS: usize> From<NonZero<Limb>> for NonZero<Uint<LIMBS>> {
    #[inline]
    fn from(limb: NonZero<Limb>) -> Self {
        NonZero(limb.0.into())
    }
}

impl<const LIMBS: usize> From<Odd<Limb>> for Odd<Uint<LIMBS>> {
    #[inline]
    fn from(limb: Odd<Limb>) -> Self {
        Odd(limb.0.into())
    }
}

impl<const LO_LIMBS: usize, const HI_LIMBS: usize, const WIDE_LIMBS: usize>
    From<(Uint<LO_LIMBS>, Uint<HI_LIMBS>)> for Uint<WIDE_LIMBS>
where
    Uint<LO_LIMBS>: Concat<HI_LIMBS, Output = Uint<WIDE_LIMBS>>,
{
    #[inline]
    fn from(nums: (Uint<LO_LIMBS>, Uint<HI_LIMBS>)) -> Uint<WIDE_LIMBS> {
        nums.0.concat_mixed(&nums.1)
    }
}

impl<const LO_LIMBS: usize, const HI_LIMBS: usize, const WIDE_LIMBS: usize>
    From<&(Uint<LO_LIMBS>, Uint<HI_LIMBS>)> for Uint<WIDE_LIMBS>
where
    Uint<LO_LIMBS>: Concat<HI_LIMBS, Output = Uint<WIDE_LIMBS>>,
{
    #[inline]
    fn from(nums: &(Uint<LO_LIMBS>, Uint<HI_LIMBS>)) -> Uint<WIDE_LIMBS> {
        nums.0.concat_mixed(&nums.1)
    }
}

impl<const LO_LIMBS: usize, const HI_LIMBS: usize, const WIDE_LIMBS: usize> From<Uint<WIDE_LIMBS>>
    for (Uint<LO_LIMBS>, Uint<HI_LIMBS>)
where
    Uint<WIDE_LIMBS>: Split<LO_LIMBS, Output = Uint<HI_LIMBS>>,
{
    #[inline]
    fn from(num: Uint<WIDE_LIMBS>) -> (Uint<LO_LIMBS>, Uint<HI_LIMBS>) {
        num.split_mixed()
    }
}

impl<const LO_LIMBS: usize, const HI_LIMBS: usize, const WIDE_LIMBS: usize> From<&Uint<WIDE_LIMBS>>
    for (Uint<LO_LIMBS>, Uint<HI_LIMBS>)
where
    Uint<WIDE_LIMBS>: Split<LO_LIMBS, Output = Uint<HI_LIMBS>>,
{
    #[inline]
    fn from(num: &Uint<WIDE_LIMBS>) -> (Uint<LO_LIMBS>, Uint<HI_LIMBS>) {
        num.split_mixed()
    }
}

impl<const LIMBS: usize, const LIMBS2: usize> From<&Uint<LIMBS>> for Uint<LIMBS2> {
    #[inline]
    fn from(num: &Uint<LIMBS>) -> Uint<LIMBS2> {
        num.resize()
    }
}

#[cfg(test)]
mod tests {
    use crate::{Limb, U64, U128, Word};

    cpubits::cpubits! {
        32 => { use crate::U64 as UintEx; }
        64 => { use crate::U128 as UintEx; }
    }

    #[test]
    fn from_u8() {
        let n = UintEx::from(42u8);
        assert_eq!(n.as_limbs(), &[Limb(42), Limb(0)]);
    }

    #[test]
    fn from_u16() {
        let n = UintEx::from(42u16);
        assert_eq!(n.as_limbs(), &[Limb(42), Limb(0)]);
    }

    #[test]
    fn from_u64() {
        let n = UintEx::from(42u64);
        assert_eq!(n.as_limbs(), &[Limb(42), Limb(0)]);
    }

    #[test]
    fn from_u128() {
        let n = U128::from(42u128);
        assert_eq!(&n.as_limbs()[..2], &[Limb(42), Limb(0)]);
        assert_eq!(u128::from(n), 42u128);
    }

    #[test]
    fn concat_mixed() {
        let wide: U128 = (U64::ONE, U64::ZERO).into();
        assert_eq!(wide, U128::ONE);

        let wide: U128 = (&(U64::MAX, U64::MAX)).into();
        assert_eq!(wide, U128::MAX);
    }

    #[test]
    fn split_mixed() {
        let lo_hi: (U64, _) = U128::ONE.into();
        assert_eq!(lo_hi, (U64::ONE, U64::ZERO));

        let lo_hi: (U64, _) = (&U128::MAX).into();
        assert_eq!(lo_hi, (U64::MAX, U64::MAX));
    }

    #[test]
    fn array_round_trip() {
        let arr1 = [1, 2];
        let n = UintEx::from(arr1);
        let arr2: [Word; 2] = n.into();
        assert_eq!(arr1, arr2);
    }
}
