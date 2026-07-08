//! Random number generator support

use super::Uint;
use crate::{CtLt, Encoding, Limb, NonZero, Random, RandomBits, RandomBitsError, RandomMod};
use rand_core::{Rng, TryRng};

impl<const LIMBS: usize> Random for Uint<LIMBS> {
    fn try_random_from_rng<R: TryRng + ?Sized>(rng: &mut R) -> Result<Self, R::Error> {
        let mut limbs = [Limb::ZERO; LIMBS];

        for limb in &mut limbs {
            *limb = Limb::try_random_from_rng(rng)?;
        }

        Ok(limbs.into())
    }
}

/// Fill the given limbs slice with random bits.
///
/// NOTE: Assumes that the limbs in the given slice are zeroed!
///
/// When combined with a platform-independent "4-byte sequential" `rng`, this function is
/// platform-independent. We consider an RNG "`X`-byte sequential" whenever
/// `rng.fill_bytes(&mut bytes[..i]); rng.fill_bytes(&mut bytes[i..])` constructs the same `bytes`,
/// as long as `i` is a multiple of `X`.
/// Note that the `TryRng` trait does _not_ require this behaviour from `rng`.
#[allow(clippy::integer_division_remainder_used, reason = "public parameter")]
pub(crate) fn random_bits_core<T, R: TryRng + ?Sized>(
    rng: &mut R,
    x: &mut T,
    n_bits: u32,
) -> Result<(), R::Error>
where
    T: Encoding,
{
    if n_bits == 0 {
        return Ok(());
    }

    let n_bytes = n_bits.div_ceil(u8::BITS) as usize;
    let hi_mask = u8::MAX >> ((u8::BITS - (n_bits % u8::BITS)) % u8::BITS);

    let mut buffer = x.to_le_bytes();
    let slice = buffer.as_mut();
    rng.try_fill_bytes(&mut slice[..n_bytes])?;
    slice[n_bytes - 1] &= hi_mask;
    *x = T::from_le_bytes(buffer);

    Ok(())
}

impl<const LIMBS: usize> RandomBits for Uint<LIMBS> {
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
        if bits_precision != Self::BITS {
            return Err(RandomBitsError::BitsPrecisionMismatch {
                bits_precision,
                integer_bits: Self::BITS,
            });
        }
        if bit_length > Self::BITS {
            return Err(RandomBitsError::BitLengthTooLarge {
                bit_length,
                bits_precision,
            });
        }
        let mut x = Self::ZERO;
        random_bits_core(rng, &mut x, bit_length).map_err(RandomBitsError::RandCore)?;
        Ok(x)
    }
}

impl<const LIMBS: usize> RandomMod for Uint<LIMBS> {
    fn random_mod_vartime<R: Rng + ?Sized>(rng: &mut R, modulus: &NonZero<Self>) -> Self {
        let mut x = Self::ZERO;
        let Ok(()) = random_mod_vartime_core(rng, &mut x, modulus, modulus.bits_vartime());
        x
    }

    fn try_random_mod_vartime<R: TryRng + ?Sized>(
        rng: &mut R,
        modulus: &NonZero<Self>,
    ) -> Result<Self, R::Error> {
        let mut x = Self::ZERO;
        random_mod_vartime_core(rng, &mut x, modulus, modulus.bits_vartime())?;
        Ok(x)
    }
}

/// Generic implementation of `random_mod_vartime` which can be shared with `BoxedUint`.
// TODO(tarcieri): obtain `n_bits` via a trait like `Integer`
pub(super) fn random_mod_vartime_core<T, R: TryRng + ?Sized>(
    rng: &mut R,
    x: &mut T,
    modulus: &NonZero<T>,
    n_bits: u32,
) -> Result<(), R::Error>
where
    T: Encoding + CtLt,
{
    loop {
        random_bits_core(rng, x, n_bits)?;
        if x.ct_lt(modulus).into() {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::uint::rand::random_bits_core;
    use crate::{Limb, NonZero, Random, RandomBits, RandomMod, U256, U1024, Uint};
    use chacha20::ChaCha8Rng;
    use rand_core::{Rng, SeedableRng};

    const RANDOM_OUTPUT: U1024 = Uint::from_be_hex(concat![
        "A484C4C693EECC47C3B919AE0D16DF2259CD1A8A9B8EA8E0862878227D4B40A3",
        "C54302F2EB1E2F69E17653A37F1BCC44277FA208E6B31E08CDC4A23A7E88E660",
        "EF781C7DD2D368BAD438539D6A2E923C8CAE14CB947EB0BDE10D666732024679",
        "0F6760A48F9B887CB2FB0D3281E2A6E67746A55FBAD8C037B585F767A79A3B6C"
    ]);

    /// Construct a 4-sequential `rng`, i.e., an `rng` such that
    /// `rng.fill_bytes(&mut buffer[..x]); rng.fill_bytes(&mut buffer[x..])` will construct the
    /// same `buffer`, for `x` any in `0..buffer.len()` that is `0 mod 4`.
    fn get_four_sequential_rng() -> ChaCha8Rng {
        ChaCha8Rng::seed_from_u64(0)
    }

    /// Make sure the random value constructed is consistent across platforms
    #[test]
    fn random_platform_independence() {
        let mut rng = get_four_sequential_rng();
        assert_eq!(U1024::random_from_rng(&mut rng), RANDOM_OUTPUT);
    }

    #[test]
    fn random_mod_vartime() {
        let mut rng = ChaCha8Rng::seed_from_u64(1);

        // Ensure `random_mod_vartime` runs in a reasonable amount of time
        let modulus = NonZero::new(U256::from(42u8)).unwrap();
        let res = U256::random_mod_vartime(&mut rng, &modulus);

        // Check that the value is in range
        assert!(res < U256::from(42u8));

        // Ensure `random_mod_vartime` runs in a reasonable amount of time
        // when the modulus is larger than 1 limb
        let modulus = NonZero::new(U256::from(0x10000000000000001u128)).unwrap();
        let res = U256::random_mod_vartime(&mut rng, &modulus);

        // Check that the value is in range
        assert!(res < U256::from(0x10000000000000001u128));
    }

    #[test]
    fn random_bits() {
        let mut rng = ChaCha8Rng::seed_from_u64(1);

        let lower_bound = 16;

        // Full length of the integer
        let bit_length = U256::BITS;
        for _ in 0..10 {
            let res = U256::random_bits(&mut rng, bit_length);
            assert!(res > (U256::ONE << (bit_length - lower_bound)));
        }

        // A multiple of limb size
        let bit_length = U256::BITS - Limb::BITS;
        for _ in 0..10 {
            let res = U256::random_bits(&mut rng, bit_length);
            assert!(res > (U256::ONE << (bit_length - lower_bound)));
            assert!(res < (U256::ONE << bit_length));
        }

        // A multiple of 8
        let bit_length = U256::BITS - Limb::BITS - 8;
        for _ in 0..10 {
            let res = U256::random_bits(&mut rng, bit_length);
            assert!(res > (U256::ONE << (bit_length - lower_bound)));
            assert!(res < (U256::ONE << bit_length));
        }

        // Not a multiple of 8
        let bit_length = U256::BITS - Limb::BITS - 8 - 3;
        for _ in 0..10 {
            let res = U256::random_bits(&mut rng, bit_length);
            assert!(res > (U256::ONE << (bit_length - lower_bound)));
            assert!(res < (U256::ONE << bit_length));
        }

        // One incomplete limb
        let bit_length = 7;
        for _ in 0..10 {
            let res = U256::random_bits(&mut rng, bit_length);
            assert!(res < (U256::ONE << bit_length));
        }

        // Zero bits
        let bit_length = 0;
        for _ in 0..10 {
            let res = U256::random_bits(&mut rng, bit_length);
            assert_eq!(res, U256::ZERO);
        }
    }

    /// Make sure the `random_bits` output is consistent across platforms
    #[test]
    fn random_bits_platform_independence() {
        let mut rng = get_four_sequential_rng();

        let bit_length = 989;
        let mut val = U1024::ZERO;
        random_bits_core(&mut rng, &mut val, bit_length).expect("safe");

        assert_eq!(
            val,
            RANDOM_OUTPUT.bitand(&U1024::ONE.shl(bit_length).wrapping_sub(&Uint::ONE))
        );

        // Test that the RNG is in the same state
        let mut state = [0u8; 16];
        rng.fill_bytes(&mut state);

        assert_eq!(
            state,
            [
                198, 196, 132, 164, 240, 211, 223, 12, 36, 189, 139, 48, 94, 1, 123, 253
            ]
        );
    }

    /// Make sure `random_mod_vartime` output is consistent across platforms
    #[test]
    fn random_mod_vartime_platform_independence() {
        let mut rng = get_four_sequential_rng();

        let modulus = NonZero::new(U256::from_u32(8192)).unwrap();
        let mut vals = [U256::ZERO; 5];
        for val in &mut vals {
            *val = U256::random_mod_vartime(&mut rng, &modulus);
        }
        let expected = [55, 3378, 2172, 1657, 5323];
        for (want, got) in expected.into_iter().zip(vals.into_iter()) {
            // assert_eq!(got.as_words()[0], want);
            assert_eq!(got, U256::from_u32(want));
        }

        let modulus =
            NonZero::new(U256::ZERO.wrapping_sub(&U256::from_u64(rng.next_u64()))).unwrap();
        let val = U256::random_mod_vartime(&mut rng, &modulus);
        assert_eq!(
            val,
            U256::from_be_hex("E17653A37F1BCC44277FA208E6B31E08CDC4A23A7E88E660EF781C7DD2D368BA")
        );

        let mut state = [0u8; 16];
        rng.fill_bytes(&mut state);

        assert_eq!(
            state,
            [
                105, 47, 30, 235, 242, 2, 67, 197, 163, 64, 75, 125, 34, 120, 40, 134,
            ],
        );
    }

    /// Test that random bytes are sampled consecutively.
    #[test]
    fn random_bits_4_bytes_sequential() {
        // Test for multiples of 4 bytes, i.e., multiples of 32 bits.
        let bit_lengths = [0, 32, 64, 128, 192, 992];

        for bit_length in bit_lengths {
            let mut rng = get_four_sequential_rng();
            let mut first = U1024::ZERO;
            let mut second = U1024::ZERO;
            random_bits_core(&mut rng, &mut first, bit_length).expect("safe");
            random_bits_core(&mut rng, &mut second, U1024::BITS - bit_length).expect("safe");
            assert_eq!(second.shl(bit_length).bitor(&first), RANDOM_OUTPUT);
        }
    }
}
