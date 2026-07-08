#![no_std]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![cfg_attr(
    any(
        keccak_backend = "simd128",
        keccak_backend = "simd256",
        keccak_backend = "simd512",
    ),
    feature(portable_simd)
)]
#![doc = include_str!("../README.md")]
#![doc(
    html_logo_url = "https://raw.githubusercontent.com/RustCrypto/meta/master/logo.svg",
    html_favicon_url = "https://raw.githubusercontent.com/RustCrypto/meta/master/logo.svg"
)]

#[cfg(target_arch = "aarch64")]
cpufeatures::new!(armv8_sha3_intrinsics, "sha3");

pub mod backends;
pub mod consts;
pub mod types;

pub use backends::*;
pub use consts::*;
pub use types::*;

/// Struct which handles switching between available backends.
#[derive(Debug, Copy, Clone)]
pub struct Keccak {
    #[cfg(target_arch = "aarch64")]
    armv8_sha3: armv8_sha3_intrinsics::InitToken,
}

impl Default for Keccak {
    #[inline]
    fn default() -> Self {
        Self {
            #[cfg(target_arch = "aarch64")]
            armv8_sha3: armv8_sha3_intrinsics::init(),
        }
    }
}

impl Keccak {
    /// Create new Keccak backend.
    #[inline]
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Execute the provided backend closure with Keccak backend.
    #[inline]
    // The auto-detection code will not be reached if `keccak_backend` is set.
    #[allow(unreachable_code)]
    pub fn with_backend(&self, f: impl BackendClosure) {
        cfg_if::cfg_if!(
            if #[cfg(any(
                keccak_backend = "simd128",
                keccak_backend = "simd256",
                keccak_backend = "simd512",
            ))] {
                return f.call_once::<simd::Backend>()
            } else if #[cfg(keccak_backend = "aarch64_sha3")] {
                #[cfg(not(target_arch = "aarch64"))]
                compile_error!("aarch64_sha3 backend can be used only on AArch64 targets!");
                #[cfg(not(target_feature = "sha3"))]
                compile_error!("aarch64_sha3 backend requires sha3 target feature to be enabled!");

                return f.call_once::<aarch64_sha3::Backend>()
            } else if #[cfg(keccak_backend = "soft")] {
                return f.call_once::<soft::Backend>()
            }
        );

        #[cfg(target_arch = "aarch64")]
        if self.armv8_sha3.get() {
            #[target_feature(enable = "sha3")]
            unsafe fn aarch64_sha3_inner(f: impl BackendClosure) {
                f.call_once::<aarch64_sha3::Backend>();
            }
            // SAFETY: we checked target feature availability above
            return unsafe { aarch64_sha3_inner(f) };
        }

        f.call_once::<soft::Backend>();
    }

    /// Execute the closure with `f200` function.
    #[inline]
    pub fn with_f200(&self, f: impl FnOnce(Fn200)) {
        self.with_p200::<F200_ROUNDS>(f);
    }

    /// Execute the closure with `f400` function.
    #[inline]
    pub fn with_f400(&self, f: impl FnOnce(Fn400)) {
        self.with_p400::<F400_ROUNDS>(f);
    }

    /// Execute the closure with `f800` function.
    #[inline]
    pub fn with_f800(&self, f: impl FnOnce(Fn800)) {
        self.with_p800::<F800_ROUNDS>(f);
    }

    /// Execute the closure with `f1600` function.
    #[inline]
    pub fn with_f1600(&self, f: impl FnOnce(Fn1600)) {
        self.with_p1600::<F1600_ROUNDS>(f);
    }

    /// Execute the closure with `p200` function with the specified number of rounds.
    ///
    /// # Panics
    /// If `ROUNDS` is bigger than [`F200_ROUNDS`].
    #[inline]
    pub fn with_p200<const ROUNDS: usize>(&self, f: impl FnOnce(Fn200)) {
        f(soft::keccak_p::<u8, ROUNDS>);
    }

    /// Execute the closure with `p200` function with the specified number of rounds.
    ///
    /// # Panics
    /// If `ROUNDS` is bigger than [`F400_ROUNDS`].
    #[inline]
    pub fn with_p400<const ROUNDS: usize>(&self, f: impl FnOnce(Fn400)) {
        f(soft::keccak_p::<u16, ROUNDS>);
    }

    /// Execute the closure with `p800` function with the specified number of rounds.
    ///
    /// # Panics
    /// If `ROUNDS` is bigger than [`F800_ROUNDS`].
    #[inline]
    pub fn with_p800<const ROUNDS: usize>(&self, f: impl FnOnce(Fn800)) {
        f(soft::keccak_p::<u32, ROUNDS>);
    }

    /// Execute the closure with `p1600` function with the specified number of rounds.
    ///
    /// # Panics
    /// If `ROUNDS` is bigger than [`F1600_ROUNDS`].
    #[inline]
    pub fn with_p1600<const ROUNDS: usize>(&self, f: impl FnOnce(Fn1600)) {
        struct Closure<const ROUNDS: usize, F: FnOnce(Fn1600)>(F);

        impl<const ROUNDS: usize, F: FnOnce(Fn1600)> BackendClosure for Closure<ROUNDS, F> {
            #[inline(always)]
            fn call_once<B: Backend>(self) {
                (self.0)(B::get_p1600::<ROUNDS>());
            }
        }

        self.with_backend(Closure::<ROUNDS, _>(f));
    }
}
