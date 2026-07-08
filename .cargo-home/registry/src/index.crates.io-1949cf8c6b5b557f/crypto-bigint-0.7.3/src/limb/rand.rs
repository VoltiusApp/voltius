//! Random number generator support

use super::Limb;
use crate::{CtLt, Encoding, NonZero, Random, RandomMod};
use rand_core::TryRng;

impl Random for Limb {
    fn try_random_from_rng<R: TryRng + ?Sized>(rng: &mut R) -> Result<Self, R::Error> {
        cpubits::cpubits! {
            32 => { rng.try_next_u32().map(Self) }
            64 => { rng.try_next_u64().map(Self) }
        }
    }
}

impl RandomMod for Limb {
    fn try_random_mod_vartime<R: TryRng + ?Sized>(
        rng: &mut R,
        modulus: &NonZero<Self>,
    ) -> Result<Self, R::Error> {
        let mut bytes = <Self as Encoding>::Repr::default();

        let n_bits = modulus.bits() as usize;
        let n_bytes = n_bits.div_ceil(8);
        let mask = 0xffu8 >> (8 * n_bytes - n_bits);

        loop {
            rng.try_fill_bytes(&mut bytes[..n_bytes])?;
            bytes[n_bytes - 1] &= mask;

            let n = Limb::from_le_bytes(bytes);
            if n.ct_lt(modulus).into() {
                return Ok(n);
            }
        }
    }
}
