#![no_std]
#![doc = include_str!("../README.md")]
#![doc(
    html_logo_url = "https://raw.githubusercontent.com/RustCrypto/media/8f1a9894/logo.svg",
    html_favicon_url = "https://raw.githubusercontent.com/RustCrypto/media/8f1a9894/logo.svg"
)]
#![warn(missing_docs)]

pub use polyval::universal_hash;

use polyval::{Polyval, hazmat::FieldElement};
use universal_hash::{
    KeyInit, UhfBackend, UhfClosure, UniversalHash,
    common::{BlockSizeUser, KeySizeUser, ParBlocksSizeUser},
    consts::U16,
};

#[cfg(feature = "zeroize")]
use zeroize::Zeroize;

/// GHASH keys (16-bytes)
pub type Key = universal_hash::Key<GHash>;

/// GHASH blocks (16-bytes)
pub type Block = universal_hash::Block<GHash>;

/// GHASH tags (16-bytes)
pub type Tag = universal_hash::Block<GHash>;

/// **GHASH**: universal hash over GF(2^128) used by AES-GCM.
///
/// GHASH is a universal hash function used for message authentication in the AES-GCM authenticated
/// encryption cipher.
#[derive(Clone)]
pub struct GHash(Polyval);

impl KeySizeUser for GHash {
    type KeySize = U16;
}

impl GHash {
    /// Initialize GHASH with the given `H` field element as the key.
    #[inline]
    pub fn new(h: &Key) -> Self {
        #[allow(unused_mut)]
        let mut h_polyval = FieldElement::from(*h).reverse().mulx();
        #[allow(clippy::let_and_return)]
        let result = Self(Polyval::new(&h_polyval.into()));
        #[cfg(feature = "zeroize")]
        h_polyval.zeroize();
        result
    }
}

impl KeyInit for GHash {
    /// Initialize GHASH with the given `H` field element
    #[inline]
    fn new(h: &Key) -> Self {
        Self::new(h)
    }
}

struct GHashBackend<'b, B: UhfBackend>(&'b mut B);

impl<B: UhfBackend> BlockSizeUser for GHashBackend<'_, B> {
    type BlockSize = B::BlockSize;
}

impl<B: UhfBackend> ParBlocksSizeUser for GHashBackend<'_, B> {
    type ParBlocksSize = B::ParBlocksSize;
}

impl<B: UhfBackend> UhfBackend for GHashBackend<'_, B> {
    fn proc_block(&mut self, x: &universal_hash::Block<B>) {
        let mut x = x.clone();
        x.reverse();
        self.0.proc_block(&x);
    }

    fn proc_par_blocks(&mut self, par_blocks: &universal_hash::ParBlocks<B>) {
        let mut par_blocks = par_blocks.clone();
        for block in &mut par_blocks {
            block.reverse();
        }
        self.0.proc_par_blocks(&par_blocks);
    }
}

impl BlockSizeUser for GHash {
    type BlockSize = U16;
}

impl UniversalHash for GHash {
    fn update_with_backend(&mut self, f: impl UhfClosure<BlockSize = Self::BlockSize>) {
        struct GHashClosure<C: UhfClosure>(C);

        impl<C: UhfClosure> BlockSizeUser for GHashClosure<C> {
            type BlockSize = C::BlockSize;
        }

        impl<C: UhfClosure> UhfClosure for GHashClosure<C> {
            fn call<B: UhfBackend<BlockSize = Self::BlockSize>>(self, backend: &mut B) {
                self.0.call(&mut GHashBackend(backend));
            }
        }

        self.0.update_with_backend(GHashClosure(f));
    }

    /// Get GHASH output
    #[inline]
    fn finalize(self) -> Tag {
        let mut output = self.0.finalize();
        output.reverse();
        output
    }
}

impl core::fmt::Debug for GHash {
    fn fmt(&self, f: &mut core::fmt::Formatter) -> Result<(), core::fmt::Error> {
        f.debug_tuple("GHash").finish_non_exhaustive()
    }
}
