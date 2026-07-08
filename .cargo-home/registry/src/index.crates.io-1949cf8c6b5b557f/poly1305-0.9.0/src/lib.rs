#![no_std]
#![doc = include_str!("../README.md")]
#![doc(
    html_logo_url = "https://raw.githubusercontent.com/RustCrypto/media/8f1a9894/logo.svg",
    html_favicon_url = "https://raw.githubusercontent.com/RustCrypto/media/8f1a9894/logo.svg"
)]

pub use universal_hash;

use core::fmt::{self, Debug};
use universal_hash::{
    KeyInit, UhfClosure, UniversalHash,
    common::{BlockSizeUser, KeySizeUser},
    consts::{U16, U32},
};

mod backend;

#[cfg(all(
    any(target_arch = "x86", target_arch = "x86_64"),
    not(poly1305_backend = "soft"),
    target_feature = "avx2", // Fuzz tests bypass AVX2 autodetection code
    any(fuzzing, test)
))]
mod fuzz;

#[cfg(all(
    any(target_arch = "x86", target_arch = "x86_64"),
    not(poly1305_backend = "soft")
))]
use crate::backend::autodetect::State;

#[cfg(not(all(
    any(target_arch = "x86", target_arch = "x86_64"),
    not(poly1305_backend = "soft")
)))]
use crate::backend::soft::State;

/// Size of a Poly1305 key
pub const KEY_SIZE: usize = 32;

/// Size of the blocks Poly1305 acts upon
pub const BLOCK_SIZE: usize = 16;

/// Poly1305 keys (32-bytes)
pub type Key = universal_hash::Key<Poly1305>;

/// Poly1305 blocks (16-bytes)
pub type Block = universal_hash::Block<Poly1305>;

/// Poly1305 tags (16-bytes)
pub type Tag = universal_hash::Block<Poly1305>;

/// The Poly1305 universal hash function.
///
/// Note that Poly1305 is not a traditional MAC and is single-use only
/// (a.k.a. "one-time authenticator").
///
/// For this reason it doesn't impl the `crypto_mac::Mac` trait.
#[derive(Clone)]
pub struct Poly1305 {
    state: State,
}

impl KeySizeUser for Poly1305 {
    type KeySize = U32;
}

impl KeyInit for Poly1305 {
    /// Initialize Poly1305 with the given key
    fn new(key: &Key) -> Poly1305 {
        Poly1305 {
            state: State::new(key),
        }
    }
}

impl BlockSizeUser for Poly1305 {
    type BlockSize = U16;
}

impl UniversalHash for Poly1305 {
    fn update_with_backend(&mut self, f: impl UhfClosure<BlockSize = Self::BlockSize>) {
        self.state.update_with_backend(f);
    }

    /// Get the hashed output
    fn finalize(self) -> Tag {
        self.state.finalize()
    }
}

impl Poly1305 {
    /// Compute unpadded Poly1305 for the given input data.
    ///
    /// The main use case for this is XSalsa20Poly1305.
    #[must_use]
    pub fn compute_unpadded(mut self, data: &[u8]) -> Tag {
        let (blocks, remaining) = Block::slice_as_chunks(data);

        for block in blocks {
            self.state.compute_block(block, false);
        }

        if !remaining.is_empty() {
            let mut block = Block::default();
            block[..remaining.len()].copy_from_slice(remaining);
            block[remaining.len()] = 1;
            self.state.compute_block(&block, true);
        }

        self.state.finalize()
    }
}

impl Debug for Poly1305 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Poly1305").finish_non_exhaustive()
    }
}

#[cfg(all(
    any(target_arch = "x86", target_arch = "x86_64"),
    not(poly1305_backend = "soft"),
    target_feature = "avx2", // Fuzz tests bypass AVX2 autodetection code
    any(fuzzing, test)
))]
pub use crate::fuzz::fuzz_avx2;
