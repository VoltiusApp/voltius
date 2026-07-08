use crate::{consts::*, types::Fn1600};
use core::ops::{BitAnd, BitAndAssign, BitXor, BitXorAssign, Not};
#[cfg(feature = "parallel")]
use hybrid_array::typenum::U1;

/// Keccak is a permutation over an array of lanes which comprise the sponge
/// construction.
pub trait LaneSize:
    Copy
    + Clone
    + Default
    + PartialEq
    + BitAndAssign
    + BitAnd<Output = Self>
    + BitXorAssign
    + BitXor<Output = Self>
    + Not<Output = Self>
{
    /// Number of rounds of the Keccak-f permutation.
    const KECCAK_F_ROUND_COUNT: usize;

    /// Truncate function.
    fn truncate_rc(rc: u64) -> Self;

    /// Rotate left function.
    #[must_use]
    fn rotate_left(self, n: u32) -> Self;
}

macro_rules! impl_lanesize {
    ($type:ty, $round:expr) => {
        impl LaneSize for $type {
            const KECCAK_F_ROUND_COUNT: usize = $round;

            #[allow(clippy::cast_possible_truncation, trivial_numeric_casts)]
            fn truncate_rc(rc: u64) -> Self {
                rc as Self
            }

            fn rotate_left(self, n: u32) -> Self {
                self.rotate_left(n)
            }
        }
    };
}

impl_lanesize!(u8, F200_ROUNDS);
impl_lanesize!(u16, F400_ROUNDS);
impl_lanesize!(u32, F800_ROUNDS);
impl_lanesize!(u64, F1600_ROUNDS);

#[rustfmt::skip]
macro_rules! unroll5 {
    ($var: ident, $body: block) => {
        #[cfg(not(keccak_backend_soft = "compact"))]
        {
            { const $var: usize = 0; $body; }
            { const $var: usize = 1; $body; }
            { const $var: usize = 2; $body; }
            { const $var: usize = 3; $body; }
            { const $var: usize = 4; $body; }
        }
        #[cfg(keccak_backend_soft = "compact")]
        {
            for $var in 0..5 $body
        }
    };
}

#[rustfmt::skip]
macro_rules! unroll24 {
    ($var: ident, $body: block) => {
        #[cfg(not(keccak_backend_soft = "compact"))]
        {
            { const $var: usize = 0; $body; }
            { const $var: usize = 1; $body; }
            { const $var: usize = 2; $body; }
            { const $var: usize = 3; $body; }
            { const $var: usize = 4; $body; }
            { const $var: usize = 5; $body; }
            { const $var: usize = 6; $body; }
            { const $var: usize = 7; $body; }
            { const $var: usize = 8; $body; }
            { const $var: usize = 9; $body; }
            { const $var: usize = 10; $body; }
            { const $var: usize = 11; $body; }
            { const $var: usize = 12; $body; }
            { const $var: usize = 13; $body; }
            { const $var: usize = 14; $body; }
            { const $var: usize = 15; $body; }
            { const $var: usize = 16; $body; }
            { const $var: usize = 17; $body; }
            { const $var: usize = 18; $body; }
            { const $var: usize = 19; $body; }
            { const $var: usize = 20; $body; }
            { const $var: usize = 21; $body; }
            { const $var: usize = 22; $body; }
            { const $var: usize = 23; $body; }
        }
        #[cfg(keccak_backend_soft = "compact")]
        {
            for $var in 0..24 $body
        }
    };
}

/// Generic Keccak-p sponge function.
///
/// # Panics
/// If the `ROUNDS` is greater than `L::KECCAK_F_ROUND_COUNT`.
#[allow(non_upper_case_globals, unused_assignments)]
pub(crate) fn keccak_p<L: LaneSize, const ROUNDS: usize>(state: &mut [L; PLEN]) {
    // https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.202.pdf#page=25
    // "the rounds of KECCAK-p[b, nr] match the last rounds of KECCAK-f[b]"
    let round_consts = RC[..L::KECCAK_F_ROUND_COUNT]
        .last_chunk::<ROUNDS>()
        .expect("Number of rounds greater than `KECCAK_F_ROUND_COUNT` is not supported!")
        .map(L::truncate_rc);

    // Not unrolling this loop results in a much smaller function, plus
    // it positively influences performance due to the smaller load on I-cache
    for rc in round_consts {
        let mut array = [L::default(); 5];

        // Theta
        unroll5!(x, {
            unroll5!(y, {
                array[x] ^= state[5 * y + x];
            });
        });

        unroll5!(x, {
            let t1 = array[(x + 4) % 5];
            let t2 = array[(x + 1) % 5].rotate_left(1);
            unroll5!(y, {
                state[5 * y + x] ^= t1 ^ t2;
            });
        });

        // Rho and pi
        let mut last = state[1];
        unroll24!(x, {
            array[0] = state[PI[x]];
            state[PI[x]] = last.rotate_left(RHO[x]);
            last = array[0];
        });

        // Chi
        unroll5!(y_step, {
            let y = 5 * y_step;

            array.copy_from_slice(&state[y..][..5]);

            unroll5!(x, {
                let t1 = !array[(x + 1) % 5];
                let t2 = array[(x + 2) % 5];
                state[y + x] = array[x] ^ (t1 & t2);
            });
        });

        // Iota
        state[0] ^= rc;
    }
}

/// Default backend based on software implementation.
pub(crate) struct Backend;

impl super::Backend for Backend {
    #[cfg(feature = "parallel")]
    type ParSize1600 = U1;

    #[inline]
    fn get_p1600<const ROUNDS: usize>() -> Fn1600 {
        keccak_p::<u64, ROUNDS>
    }
}
