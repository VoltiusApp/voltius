#![no_std]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc = include_str!("../README.md")]
#![doc(
    html_logo_url = "https://raw.githubusercontent.com/RustCrypto/meta/master/logo.svg",
    html_favicon_url = "https://raw.githubusercontent.com/RustCrypto/meta/master/logo.svg"
)]
#![allow(non_snake_case)] // Allow notation matching the spec
#![allow(clippy::clone_on_copy)] // Be explicit about moving data

//! # Usage
//!
//! This crate implements the Module-Lattice-based Key Encapsulation Method (ML-KEM) algorithm
//! being standardized by NIST in FIPS 203.  ML-KEM is a KEM in the sense that it creates a
//! (decapsulation key, encapsulation key) pair, such that anyone can use the encapsulation key to
//! establish a shared key with the holder of the decapsulation key.  ML-KEM is the first KEM
//! algorithm standardized by NIST that is designed to be resistant to attacks using quantum
//! computers.
//!
#![cfg_attr(feature = "getrandom", doc = "```")]
#![cfg_attr(not(feature = "getrandom"), doc = "```ignore")]
//! // NOTE: requires the `getrandom` feature is enabled
//!
//! use ml_kem::{
//!     MlKem768,
//!     kem::{Decapsulate, Encapsulate, Kem}
//! };
//!
//! // Generate a decapsulation/encapsulation keypair
//! let (dk, ek) = MlKem768::generate_keypair();
//!
//! // Encapsulate a shared key to the holder of the decapsulation key, receive the shared
//! // secret `k_send` and the encapsulated form `ct`.
//! let (ct, k_send) = ek.encapsulate();
//!
//! // Decapsulate the shared key
//! let k_recv = dk.decapsulate(&ct);
//!
//! // We've now established a shared key
//! assert_eq!(k_send, k_recv);
//! ```
//!
//! [RFC 9180]: https://www.rfc-editor.org/info/rfc9180

/// Section 2.4. Interpreting the Pseudocode
/// Section 4.2.2. Sampling algorithms
/// Section 4.3. The Number-Theoretic Transform
mod algebra;

/// Section 4.1. Crytographic Functions
mod crypto;

/// Section 4.2.1. Conversion and Compression Algorithms, Compression and decompression
mod compress;

/// Section 6. The ML-KEM Key-Encapsulation Mechanism (Decapsulation)
mod decapsulation_key;

/// Section 6. The ML-KEM Key-Encapsulation Mechanism (Encapsulation)
mod encapsulation_key;

/// Section 5. The K-PKE Component Scheme
mod pke;

/// Section 7. Parameter Sets
mod param;

// PKCS#8 key encoding support (doc comments in module)
pub mod pkcs8;

pub use array::{self, ArraySize};
pub use decapsulation_key::DecapsulationKey;
#[allow(deprecated)]
pub use decapsulation_key::ExpandedKeyEncoding;
pub use encapsulation_key::EncapsulationKey;
pub use kem::{
    self, Ciphertext, Decapsulate, Encapsulate, FromSeed, Generate, InvalidKey, Kem, Key,
    KeyExport, KeyInit, KeySizeUser, TryKeyInit,
};
pub use ml_kem_512::MlKem512;
pub use ml_kem_768::MlKem768;
pub use ml_kem_1024::MlKem1024;
pub use param::{ExpandedDecapsulationKey, ParameterSet};

use array::{
    Array,
    sizes::{U2, U3, U4, U5, U10, U11, U32, U64},
};
use core::fmt::Debug;

/// A 32-byte array, defined here for brevity because it is used several times
pub type B32 = Array<u8, U32>;

/// ML-KEM seeds are decapsulation (private) keys, which are consistently 64-bytes across all
/// security levels, and are the preferred serialization for representing such keys.
pub type Seed = Array<u8, U64>;

/// ML-KEM-512 is the parameter set for security category 1, corresponding to key search on a block
/// cipher with a 128-bit key.
pub mod ml_kem_512 {
    use crate::{
        Debug, ParameterSet, U2, U3, U4, U10,
        kem::Kem,
        param::{self, EncodedUSize, EncodedVSize},
    };
    use array::{sizes::U32, typenum::Sum};

    /// `MlKem512` is the parameter set for security category 1, corresponding to key search on a
    /// block cipher with a 128-bit key.
    #[derive(Clone, Copy, Debug, Default, Eq, PartialEq, PartialOrd, Ord)]
    pub struct MlKem512;

    impl ParameterSet for MlKem512 {
        type K = U2;
        type Eta1 = U3;
        type Eta2 = U2;
        type Du = U10;
        type Dv = U4;
    }

    impl Kem for MlKem512 {
        type DecapsulationKey = DecapsulationKey;
        type EncapsulationKey = EncapsulationKey;
        type CiphertextSize = Sum<EncodedUSize<Self>, EncodedVSize<Self>>;
        type SharedKeySize = U32;
    }

    /// An ML-KEM-512 `DecapsulationKey` which provides the ability to generate a new key pair, and
    /// decapsulate an encapsulated shared key.
    pub type DecapsulationKey = crate::DecapsulationKey<MlKem512>;

    /// An ML-KEM-512 `EncapsulationKey` provides the ability to encapsulate a shared key so that it
    /// can only be decapsulated by the holder of the corresponding decapsulation key.
    pub type EncapsulationKey = crate::EncapsulationKey<MlKem512>;

    /// Encoded ML-KEM-512 ciphertexts.
    pub type Ciphertext = kem::Ciphertext<MlKem512>;

    /// Legacy expanded decapsulation keys. Prefer seeds instead.
    #[doc(hidden)]
    #[deprecated(since = "0.3.0", note = "use `Seed` instead")]
    pub type ExpandedDecapsulationKey = param::ExpandedDecapsulationKey<MlKem512>;
}

/// ML-KEM-768 is the parameter set for security category 3, corresponding to key search on a block
/// cipher with a 192-bit key.
pub mod ml_kem_768 {
    use crate::{
        Debug, ParameterSet, U2, U3, U4, U10,
        kem::Kem,
        param::{self, EncodedUSize, EncodedVSize},
    };
    use array::sizes::U32;
    use array::typenum::Sum;

    /// `MlKem768` is the parameter set for security category 3, corresponding to key search on a
    /// block cipher with a 192-bit key.
    #[derive(Clone, Copy, Debug, Default, Eq, PartialEq, PartialOrd, Ord)]
    pub struct MlKem768;

    impl ParameterSet for MlKem768 {
        type K = U3;
        type Eta1 = U2;
        type Eta2 = U2;
        type Du = U10;
        type Dv = U4;
    }

    impl Kem for MlKem768 {
        type DecapsulationKey = DecapsulationKey;
        type EncapsulationKey = EncapsulationKey;
        type CiphertextSize = Sum<EncodedUSize<Self>, EncodedVSize<Self>>;
        type SharedKeySize = U32;
    }

    /// An ML-KEM-768 `DecapsulationKey` which provides the ability to generate a new key pair, and
    /// decapsulate an encapsulated shared key.
    pub type DecapsulationKey = crate::DecapsulationKey<MlKem768>;

    /// An ML-KEM-768 `EncapsulationKey` provides the ability to encapsulate a shared key so that it
    /// can only be decapsulated by the holder of the corresponding decapsulation key.
    pub type EncapsulationKey = crate::EncapsulationKey<MlKem768>;

    /// Encoded ML-KEM-512 ciphertexts.
    pub type Ciphertext = kem::Ciphertext<MlKem768>;

    /// Legacy expanded decapsulation keys. Prefer seeds instead.
    #[doc(hidden)]
    #[deprecated(since = "0.3.0", note = "use `Seed` instead")]
    pub type ExpandedDecapsulationKey = param::ExpandedDecapsulationKey<MlKem768>;
}

/// ML-KEM-1024 is the parameter set for security category 5, corresponding to key search on a block
/// cipher with a 256-bit key.
pub mod ml_kem_1024 {
    use crate::{
        Debug, ParameterSet, U2, U4, U5, U11,
        kem::Kem,
        param::{self, EncodedUSize, EncodedVSize},
    };
    use array::{sizes::U32, typenum::Sum};

    /// `MlKem1024` is the parameter set for security category 5, corresponding to key search on a
    /// block cipher with a 256-bit key.
    #[derive(Clone, Copy, Debug, Default, Eq, PartialEq, PartialOrd, Ord)]
    pub struct MlKem1024;

    impl ParameterSet for MlKem1024 {
        type K = U4;
        type Eta1 = U2;
        type Eta2 = U2;
        type Du = U11;
        type Dv = U5;
    }

    impl Kem for MlKem1024 {
        type DecapsulationKey = DecapsulationKey;
        type EncapsulationKey = EncapsulationKey;
        type CiphertextSize = Sum<EncodedUSize<Self>, EncodedVSize<Self>>;
        type SharedKeySize = U32;
    }

    /// An ML-KEM-1024 `DecapsulationKey` which provides the ability to generate a new key pair, and
    /// decapsulate an encapsulated shared key.
    pub type DecapsulationKey = crate::DecapsulationKey<MlKem1024>;

    /// An ML-KEM-1024 `EncapsulationKey` provides the ability to encapsulate a shared key so that
    /// it can only be decapsulated by the holder of the corresponding decapsulation key.
    pub type EncapsulationKey = crate::EncapsulationKey<MlKem1024>;

    /// Encoded ML-KEM-512 ciphertexts.
    pub type Ciphertext = kem::Ciphertext<MlKem1024>;

    /// Legacy expanded decapsulation keys. Prefer seeds instead.
    #[doc(hidden)]
    #[deprecated(since = "0.3.0", note = "use `Seed` instead")]
    pub type ExpandedDecapsulationKey = param::ExpandedDecapsulationKey<MlKem1024>;
}

/// An ML-KEM-512 `DecapsulationKey` which provides the ability to generate a new key pair, and
/// decapsulate an encapsulated shared key.
pub type DecapsulationKey512 = ml_kem_512::DecapsulationKey;

/// An ML-KEM-512 `EncapsulationKey` provides the ability to encapsulate a shared key so that it
/// can only be decapsulated by the holder of the corresponding decapsulation key.
pub type EncapsulationKey512 = ml_kem_512::EncapsulationKey;

/// An ML-KEM-768 `DecapsulationKey` which provides the ability to generate a new key pair, and
/// decapsulate an encapsulated shared key.
pub type DecapsulationKey768 = ml_kem_768::DecapsulationKey;

/// An ML-KEM-768 `EncapsulationKey` provides the ability to encapsulate a shared key so that it
/// can only be decapsulated by the holder of the corresponding decapsulation key.
pub type EncapsulationKey768 = ml_kem_768::EncapsulationKey;

/// An ML-KEM-1024 `DecapsulationKey` which provides the ability to generate a new key pair, and
/// decapsulate an encapsulated shared key.
pub type DecapsulationKey1024 = ml_kem_1024::DecapsulationKey;

/// An ML-KEM-1024 `EncapsulationKey` provides the ability to encapsulate a shared key so that it
/// can only be decapsulated by the holder of the corresponding decapsulation key.
pub type EncapsulationKey1024 = ml_kem_1024::EncapsulationKey;

/// Shared key established by using ML-KEM, returned from both encapsulation and decapsulation.
pub type SharedKey = Array<u8, U32>;

#[cfg(test)]
#[cfg(feature = "getrandom")]
mod test {
    use super::*;
    use crate::{MlKem512, MlKem768, MlKem1024, param::KemParams};
    use ::kem::{Encapsulate, Generate, InvalidKey, TryDecapsulate};
    use array::typenum::Unsigned;
    use getrandom::SysRng;
    use rand_core::{TryRng, UnwrapErr};

    fn round_trip_test<K>()
    where
        K: Kem,
    {
        let (dk, ek) = K::generate_keypair();
        let (ct, k_send) = ek.encapsulate();
        let k_recv = dk.try_decapsulate(&ct).unwrap();
        assert_eq!(k_send, k_recv);
    }

    #[test]
    fn round_trip() {
        round_trip_test::<MlKem512>();
        round_trip_test::<MlKem768>();
        round_trip_test::<MlKem1024>();
    }

    fn seed_test<P>()
    where
        P: KemParams,
    {
        let mut rng = UnwrapErr(SysRng);
        let mut seed = Seed::default();
        rng.try_fill_bytes(&mut seed).unwrap();

        let dk = DecapsulationKey::<P>::from_seed(seed.clone());
        let seed_encoded = dk.to_seed().unwrap();
        assert_eq!(seed, seed_encoded);

        let ek_original = dk.encapsulation_key();
        let ek_encoded = ek_original.to_bytes();
        let ek_decoded = EncapsulationKey::new(&ek_encoded).unwrap();
        assert_eq!(ek_original, &ek_decoded);
    }

    #[test]
    fn seed() {
        seed_test::<MlKem512>();
        seed_test::<MlKem768>();
        seed_test::<MlKem1024>();
    }

    #[allow(deprecated)]
    fn expanded_key_test<P>()
    where
        P: KemParams,
    {
        let mut rng = UnwrapErr(SysRng);
        let dk_original = DecapsulationKey::<P>::generate_from_rng(&mut rng);
        let dk_encoded = dk_original.to_expanded_bytes();
        let dk_decoded = DecapsulationKey::from_expanded_bytes(&dk_encoded).unwrap();
        assert_eq!(dk_original, dk_decoded);
    }

    #[test]
    fn expanded_key() {
        expanded_key_test::<MlKem512>();
        expanded_key_test::<MlKem768>();
        expanded_key_test::<MlKem1024>();
    }

    fn invalid_hash_expanded_key_test<P>()
    where
        P: KemParams,
    {
        let mut rng = UnwrapErr(SysRng);
        let dk_original = DecapsulationKey::<P>::generate_from_rng(&mut rng);

        #[allow(deprecated)]
        let mut dk_encoded = dk_original.to_expanded_bytes();

        // Corrupt the hash value
        let hash_offset = P::NttVectorSize::USIZE + P::EncryptionKeySize::USIZE;
        dk_encoded[hash_offset] ^= 0xFF;

        #[allow(deprecated)]
        let dk_decoded: Result<DecapsulationKey<P>, InvalidKey> =
            DecapsulationKey::from_expanded_bytes(&dk_encoded);

        assert!(dk_decoded.is_err());
    }

    #[test]
    fn invalid_hash_expanded_key() {
        invalid_hash_expanded_key_test::<MlKem512>();
        invalid_hash_expanded_key_test::<MlKem768>();
        invalid_hash_expanded_key_test::<MlKem1024>();
    }

    fn key_inequality_test<P>()
    where
        P: KemParams,
    {
        let mut rng = UnwrapErr(SysRng);

        // Generate two different keys
        let dk1 = DecapsulationKey::<P>::generate_from_rng(&mut rng);
        let dk2 = DecapsulationKey::<P>::generate_from_rng(&mut rng);

        let ek1 = dk1.encapsulation_key();
        let ek2 = dk2.encapsulation_key();

        // Verify inequality (catches PartialEq mutation that returns true unconditionally)
        assert_ne!(dk1, dk2);
        assert_ne!(ek1, ek2);
    }

    #[test]
    fn key_inequality() {
        key_inequality_test::<MlKem512>();
        key_inequality_test::<MlKem768>();
        key_inequality_test::<MlKem1024>();
    }
}
