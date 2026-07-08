#![no_std]
#![doc = include_str!("../README.md")]
#![doc(
    html_logo_url = "https://raw.githubusercontent.com/RustCrypto/media/6ee8e381/logo.svg",
    html_favicon_url = "https://raw.githubusercontent.com/RustCrypto/media/6ee8e381/logo.svg"
)]
#![cfg_attr(docsrs, feature(doc_cfg))]

use hmac::{
    Hmac, SimpleHmac,
    digest::{Output, OutputSizeUser, array::typenum::Unsigned},
};

mod errors;
mod hmac_impl;

pub use errors::{InvalidLength, InvalidPrkLength};
pub use hmac;
pub use hmac_impl::HmacImpl;

#[cfg(feature = "kdf")]
pub use kdf::{self, Kdf};

/// [`GenericHkdfExtract`] variant which uses [`Hmac`] for the underlying HMAC implementation.
pub type HkdfExtract<H> = GenericHkdfExtract<Hmac<H>>;
/// [`GenericHkdf`] variant which uses [`Hmac`] for the underlying HMAC implementation.
pub type Hkdf<H> = GenericHkdf<Hmac<H>>;

/// [`GenericHkdfExtract`] variant which uses [`SimpleHmac`] for the underlying HMAC implementation.
pub type SimpleHkdfExtract<H> = GenericHkdfExtract<SimpleHmac<H>>;
/// [`GenericHkdf`] variant which uses [`SimpleHmac`] for the underlying HMAC implementation.
pub type SimpleHkdf<H> = GenericHkdf<SimpleHmac<H>>;

/// Structure representing the streaming context of an HKDF-Extract operation.
///
/// This type is generic over HMAC implementation. Most users should use
/// [`HkdfExtract`] or [`SimpleHkdfExtract`] type aliases.
#[derive(Clone, Debug)]
pub struct GenericHkdfExtract<H: HmacImpl> {
    hmac: H,
}

impl<H: HmacImpl> GenericHkdfExtract<H> {
    /// Initiates the HKDF-Extract context with the given optional salt
    #[must_use]
    pub fn new(salt: Option<&[u8]>) -> Self {
        let default_salt = Output::<H>::default();
        let salt = salt.unwrap_or(&default_salt);
        let hmac = H::new_from_slice(salt);
        Self { hmac }
    }

    /// Feeds in additional input key material to the HKDF-Extract context
    pub fn input_ikm(&mut self, ikm: &[u8]) {
        self.hmac.update(ikm);
    }

    /// Completes the HKDF-Extract operation, returning both the generated pseudorandom key and
    /// `Hkdf` struct for expanding.
    #[allow(clippy::missing_panics_doc, reason = "PRK size is correct")]
    pub fn finalize(self) -> (Output<H>, GenericHkdf<H>) {
        let prk = self.hmac.finalize();
        let hkdf = GenericHkdf::<H>::from_prk(&prk).expect("PRK size is correct");
        (prk, hkdf)
    }
}

#[cfg(feature = "kdf")]
impl<H: HmacImpl> Kdf for GenericHkdfExtract<H> {
    fn derive_key(&self, secret: &[u8], info: &[u8], out: &mut [u8]) -> kdf::Result<()> {
        let mut extract = self.clone();
        extract.input_ikm(secret);
        let (_, hkdf) = extract.finalize();
        hkdf.expand(info, out).map_err(|_| kdf::Error)
    }
}

/// Structure representing the HKDF, capable of HKDF-Expand and HKDF-Extract operations.
/// Recommendations for the correct usage of the parameters can be found in the
/// [crate root](index.html#usage).
///
/// This type is generic over HMAC implementation. Most users should use
/// [`Hkdf`] or [`SimpleHkdf`] type aliases.
#[derive(Clone, Debug)]
pub struct GenericHkdf<H: HmacImpl> {
    hmac: H,
}

impl<H: HmacImpl> GenericHkdf<H> {
    /// Convenience method for [`extract`][Hkdf::extract] when the generated
    /// pseudorandom key can be ignored and only HKDF-Expand operation is needed. This is the most
    /// common constructor.
    #[must_use]
    pub fn new(salt: Option<&[u8]>, ikm: &[u8]) -> Self {
        let (_, hkdf) = Self::extract(salt, ikm);
        hkdf
    }

    /// Create `Hkdf` from an already cryptographically strong pseudorandom key
    /// as per section 3.3 from RFC5869.
    ///
    /// # Errors
    /// Returns [`InvalidPrkLength`] if `prk` is shorter than the output size of `H`.
    pub fn from_prk(prk: &[u8]) -> Result<Self, InvalidPrkLength> {
        // section 2.3 specifies that `prk` must be "at least HashLen octets"
        let hash_len = <H as OutputSizeUser>::OutputSize::to_usize();
        if prk.len() < hash_len {
            return Err(InvalidPrkLength);
        }
        let hmac = H::new_from_slice(prk);
        Ok(Self { hmac })
    }

    /// The RFC5869 HKDF-Extract operation returning both the generated
    /// pseudorandom key and `Hkdf` struct for expanding.
    #[must_use]
    pub fn extract(salt: Option<&[u8]>, ikm: &[u8]) -> (Output<H>, Self) {
        let mut extract_ctx = GenericHkdfExtract::<H>::new(salt);
        extract_ctx.input_ikm(ikm);
        extract_ctx.finalize()
    }

    /// The RFC5869 HKDF-Expand operation. This is equivalent to calling
    /// [`expand`][Hkdf::extract] with the `info` argument set equal to the
    /// concatenation of all the elements of `info_components`.
    ///
    /// # Errors
    /// Returns [`InvalidLength`] in the event `okm` is too large.
    #[allow(clippy::missing_panics_doc, reason = "expect should not fail")]
    pub fn expand_multi_info(
        &self,
        info_components: &[&[u8]],
        okm: &mut [u8],
    ) -> Result<(), InvalidLength> {
        let mut prev: Option<Output<H>> = None;

        let chunk_len = <H as OutputSizeUser>::OutputSize::USIZE;
        if okm.len() > chunk_len * 255 {
            return Err(InvalidLength);
        }

        for (block_n, block) in okm.chunks_mut(chunk_len).enumerate() {
            let mut hmac = self.hmac.clone();

            if let Some(ref prev) = prev {
                hmac.update(prev);
            };

            // Feed in the info components in sequence. This is equivalent to feeding in the
            // concatenation of all the info components
            for info in info_components {
                hmac.update(info);
            }

            hmac.update(&[u8::try_from(block_n).expect("should convert") + 1]);

            let output = hmac.finalize();

            let block_len = block.len();
            block.copy_from_slice(&output[..block_len]);

            prev = Some(output);
        }

        Ok(())
    }

    /// The RFC5869 HKDF-Expand operation
    ///
    /// If you don't have any `info` to pass, use an empty slice.
    ///
    /// # Errors
    /// Returns [`InvalidLength`] in the event `okm` is too large.
    pub fn expand(&self, info: &[u8], okm: &mut [u8]) -> Result<(), InvalidLength> {
        self.expand_multi_info(&[info], okm)
    }
}
