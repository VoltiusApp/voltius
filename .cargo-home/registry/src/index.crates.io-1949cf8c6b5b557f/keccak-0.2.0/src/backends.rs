//! Keccak backend implementations.
use crate::consts::F1600_ROUNDS;
use crate::types::*;
#[cfg(feature = "parallel")]
use hybrid_array::ArraySize;

#[cfg(target_arch = "aarch64")]
pub(crate) mod aarch64_sha3;
#[cfg(any(
    keccak_backend = "simd128",
    keccak_backend = "simd256",
    keccak_backend = "simd512",
))]
pub(crate) mod simd;
pub(crate) mod soft;

/// Trait used to define a closure which operates over Keccak backends.
pub trait BackendClosure {
    /// Execute closure with the provided backend.
    fn call_once<B: Backend>(self);
}

/// Trait implemented by a Keccak backend.
pub trait Backend {
    /// Parallelism width supported by the backend for [`State1600`].
    #[cfg(feature = "parallel")]
    type ParSize1600: ArraySize;

    /// Get scalar `p1600` function with the specified number of rounds.
    ///
    /// # Panics
    /// If `ROUNDS` is bigger than [`F1600_ROUNDS`].
    #[must_use]
    fn get_p1600<const ROUNDS: usize>() -> Fn1600;

    /// Get parallel `p1600` function with the specified number of rounds.
    ///
    /// # Panics
    /// If `ROUNDS` is bigger than [`F1600_ROUNDS`].
    #[cfg(feature = "parallel")]
    #[inline]
    #[must_use]
    fn get_par_p1600<const ROUNDS: usize>() -> ParFn1600<Self> {
        |par_state| par_state.iter_mut().for_each(Self::get_p1600::<ROUNDS>())
    }

    /// Get scalar `f1600` function.
    #[must_use]
    fn get_f1600() -> Fn1600 {
        Self::get_p1600::<F1600_ROUNDS>()
    }

    /// Get parallel `f1600` function.
    #[cfg(feature = "parallel")]
    #[inline]
    #[must_use]
    fn get_par_f1600() -> ParFn1600<Self> {
        Self::get_par_p1600::<F1600_ROUNDS>()
    }
}
