//! Random number generator support.

use super::BoxedUint;
use crate::{
    NonZero, RandomBits, RandomBitsError, RandomMod,
    uint::rand::{random_bits_core, random_mod_vartime_core},
};
use rand_core::{Rng, TryRng};

impl RandomBits for BoxedUint {
    fn try_random_bits<R: TryRng + ?Sized>(
        rng: &mut R,
        bit_length: u32,
    ) -> Result<Self, RandomBitsError<R::Error>> {
        Self::try_random_bits_with_precision(rng, bit_length, bit_length)
    }

    fn try_random_bits_with_precision<R: TryRng + ?Sized>(
        rng: &mut R,
        bit_length: u32,
        bits_precision: u32,
    ) -> Result<Self, RandomBitsError<R::Error>> {
        if bit_length > bits_precision {
            return Err(RandomBitsError::BitLengthTooLarge {
                bit_length,
                bits_precision,
            });
        }

        let mut ret = BoxedUint::zero_with_precision(bits_precision);
        random_bits_core(rng, &mut ret, bit_length).map_err(RandomBitsError::RandCore)?;
        Ok(ret)
    }
}

impl RandomMod for BoxedUint {
    fn random_mod_vartime<R: Rng + ?Sized>(rng: &mut R, modulus: &NonZero<Self>) -> Self {
        let mut n = BoxedUint::zero_with_precision(modulus.bits_precision());
        let Ok(()) = random_mod_vartime_core(rng, &mut n, modulus, modulus.bits());
        n
    }

    fn try_random_mod_vartime<R: TryRng + ?Sized>(
        rng: &mut R,
        modulus: &NonZero<Self>,
    ) -> Result<Self, R::Error> {
        let mut n = BoxedUint::zero_with_precision(modulus.bits_precision());
        random_mod_vartime_core(rng, &mut n, modulus, modulus.bits())?;
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use crate::{BoxedUint, NonZero, RandomBits, RandomMod};
    use rand_core::SeedableRng;

    #[test]
    fn random() {
        let mut rng = chacha20::ChaCha8Rng::seed_from_u64(1);

        let r = BoxedUint::random_bits(&mut rng, 256);
        assert!(r.bits_precision() == 256);

        let r = BoxedUint::random_bits(&mut rng, 256 - 32 + 1);
        assert!(r.bits_precision() == 256);
        assert!(r < BoxedUint::one_with_precision(256) << (256 - 32 + 1));
    }

    #[test]
    fn random_mod_vartime() {
        let mut rng = chacha20::ChaCha8Rng::seed_from_u64(1);

        // Ensure `random_mod_vartime` runs in a reasonable amount of time
        let modulus = NonZero::new(BoxedUint::from(42u8)).unwrap();
        let res = BoxedUint::random_mod_vartime(&mut rng, &modulus);

        // Check that the value is in range
        assert!(res < BoxedUint::from(42u8));

        // Ensure `random_mod_vartime` runs in a reasonable amount of time
        // when the modulus is larger than 1 limb
        let modulus = NonZero::new(BoxedUint::from(0x10000000000000001u128)).unwrap();
        let res = BoxedUint::random_mod_vartime(&mut rng, &modulus);

        // Check that the value is in range
        assert!(res < BoxedUint::from(0x10000000000000001u128));
    }
}
