//! Random number generator support

use rand_core::TryRng;

use crate::{Int, Random, RandomBits, RandomBitsError};

use super::Uint;

impl<const LIMBS: usize> Random for Int<LIMBS> {
    /// Generate a cryptographically secure random [`Int`].
    fn try_random_from_rng<R: TryRng + ?Sized>(rng: &mut R) -> Result<Self, R::Error> {
        Ok(Self(Uint::try_random_from_rng(rng)?))
    }
}

impl<const LIMBS: usize> RandomBits for Int<LIMBS> {
    fn try_random_bits<R: TryRng + ?Sized>(
        rng: &mut R,
        bit_length: u32,
    ) -> Result<Self, RandomBitsError<R::Error>> {
        Self::try_random_bits_with_precision(rng, bit_length, Self::BITS)
    }

    fn try_random_bits_with_precision<R: TryRng + ?Sized>(
        rng: &mut R,
        bit_length: u32,
        bits_precision: u32,
    ) -> Result<Self, RandomBitsError<R::Error>> {
        Uint::try_random_bits_with_precision(rng, bit_length, bits_precision).map(Self)
    }
}
