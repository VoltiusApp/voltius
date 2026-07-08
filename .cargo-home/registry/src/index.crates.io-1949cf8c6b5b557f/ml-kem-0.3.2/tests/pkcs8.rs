//! PKCS#8 tests.

#![cfg(all(feature = "pkcs8", feature = "alloc"))]
#![allow(clippy::unwrap_used)]

use core::fmt::Debug;
use getrandom::SysRng;
use ml_kem::{Kem, MlKem512, MlKem768, MlKem1024, Seed, kem::KeyExport};
use pkcs8::{
    DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, PrivateKeyInfoRef,
    SubjectPublicKeyInfoRef,
    der::{
        self, Decode, SliceReader,
        asn1::{ContextSpecific, OctetStringRef},
    },
};
use rand_core::{Rng, TryCryptoRng, UnwrapErr};

/// ML-KEM seed serialized as ASN.1.
type SeedString<'a> = ContextSpecific<&'a OctetStringRef>;

fn der_serialization_and_deserialization<K>(expected_encaps_len: u32)
where
    K: Kem,
    K::EncapsulationKey: EncodePublicKey + DecodePublicKey,
    K::DecapsulationKey: EncodePrivateKey + DecodePrivateKey + Debug + From<Seed> + PartialEq,
{
    let mut rng = UnwrapErr(SysRng);
    let (decaps_key, encaps_key) = K::generate_keypair_from_rng(&mut rng);

    // TEST: (de)serialize encapsulation key into DER document
    {
        let der_document = encaps_key.to_public_key_der().unwrap();
        let serialized_document = der_document.as_bytes();

        // deserialize encapsulation key from DER document
        let parsed = der::Document::from_der(serialized_document).unwrap();
        assert_eq!(parsed.len(), der::Length::new(expected_encaps_len));

        // verify that original encapsulation key corresponds to deserialized encapsulation key
        let pub_key = parsed.decode_msg::<SubjectPublicKeyInfoRef>().unwrap();
        assert_eq!(
            encaps_key.to_bytes().as_slice(),
            pub_key.subject_public_key.as_bytes().unwrap()
        );
    }

    // TEST: (de)serialize encapsulation key into DER document with the blanket implementation for DecodePublicKey
    {
        let der_document = encaps_key.to_public_key_der().unwrap();
        let serialized_document = der_document.as_bytes();

        // deserialize encapsulation key from DER document
        let parsed = K::EncapsulationKey::from_public_key_der(serialized_document).unwrap();

        // verify that original encapsulation key corresponds to deserialized encapsulation key
        assert_eq!(parsed, encaps_key);
    }

    // TEST: (de)serialize decapsulation key into DER document
    {
        let der_document = decaps_key.to_pkcs8_der().unwrap();
        let serialized_document = der_document.as_bytes();

        // deserialize decapsulation key from DER document
        let secret_document = der::SecretDocument::from_pkcs8_der(serialized_document).unwrap();
        let expected_decaps_len = 64 + 22; // 22-byte PKCS#8 header
        assert_eq!(secret_document.len(), der::Length::new(expected_decaps_len));
        assert_eq!(secret_document.as_bytes(), der_document.as_bytes());

        // verify that original decapsulation key corresponds to deserialized decapsulation key
        let private_key_info = secret_document.decode_msg::<PrivateKeyInfoRef>().unwrap();

        let mut reader = SliceReader::new(private_key_info.private_key.as_bytes()).unwrap();
        let seed_string = SeedString::decode_implicit(&mut reader, 0.into())
            .unwrap()
            .unwrap();
        let seed = Seed::try_from(seed_string.value.as_bytes()).unwrap();
        assert_eq!(decaps_key, K::DecapsulationKey::from(seed));
    }

    // TEST: (de)serialize decapsulation key into DER document with the blanket implementation for DecodePrivateKey
    {
        let der_document = decaps_key.to_pkcs8_der().unwrap();
        let serialized_document = der_document.as_bytes();

        // deserialize decapsulation key from DER document
        let parsed = K::DecapsulationKey::from_pkcs8_der(serialized_document).unwrap();

        // verify that original decapsulation key corresponds to deserialized decapsulation key
        assert_eq!(parsed, decaps_key);
    }
}

#[test]
fn pkcs8_serialize_and_deserialize_round_trip() {
    // NOTE: standardized encapsulation key sizes for MlKem{512,768,1024} are {800,1184,1568} bytes respectively.
    //       DER serialization adds 22 bytes. Thus we expect a length of {822,1206,1590} respectively.
    der_serialization_and_deserialization::<MlKem512>(822);
    der_serialization_and_deserialization::<MlKem768>(1206);
    der_serialization_and_deserialization::<MlKem1024>(1590);
}

#[cfg(feature = "pem")]
fn compare_with_reference_keys<K>(variant: usize, ref_pub_key_pem: &str, ref_priv_key_pem: &str)
where
    K: Kem,
    K::EncapsulationKey: EncodePublicKey,
    K::DecapsulationKey: EncodePrivateKey,
{
    // auxiliary RNG implementation for a static seed
    struct SeedBasedRng {
        index: usize,
        seed: [u8; SEED_LEN],
    }

    impl rand_core::TryRng for SeedBasedRng {
        type Error = core::convert::Infallible;

        fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
            let mut buf = [0u8; 4];
            self.fill_bytes(&mut buf);
            Ok(u32::from_be_bytes(buf))
        }

        fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
            let mut buf = [0u8; 8];
            self.fill_bytes(&mut buf);
            Ok(u64::from_be_bytes(buf))
        }

        fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Self::Error> {
            for item in dst {
                *item = self.seed[self.index];
                self.index = self.index.wrapping_add(1) & ((1 << SEED_LEN.ilog2()) - 1);
            }
            Ok(())
        }
    }

    impl TryCryptoRng for SeedBasedRng {}

    const SEED_LEN: usize = 64;
    assert_eq!(SEED_LEN & (SEED_LEN - 1), 0);

    let seed: [u8; SEED_LEN] = core::array::from_fn(|i| u8::try_from(i).unwrap());
    let mut rng = SeedBasedRng { seed, index: 0 };
    let (decaps_key, encaps_key) = K::generate_keypair_from_rng(&mut rng);

    let gen_pub_key_pem = encaps_key
        .to_public_key_pem(pkcs8::LineEnding::LF)
        .expect("serialization works");
    let gen_priv_key_pem = decaps_key
        .to_pkcs8_pem(pkcs8::LineEnding::LF)
        .expect("serialization works");

    {
        // TEST: DER document of public key must match
        let gen_pub_key_der = encaps_key.to_public_key_der().expect("serialization works");
        let ref_pub_key_der = der::Document::from_pem(ref_pub_key_pem)
            .expect("can read pubkey PEM document")
            .1;
        assert_eq!(gen_pub_key_der, ref_pub_key_der);
    }

    // TEST: PEM document of public key must match
    assert_eq!(
        gen_pub_key_pem, ref_pub_key_pem,
        "key generated from static seed and reference public key for ML-KEM-{variant} do not match"
    );
    // TEST: PEM document of private key must match
    assert_eq!(
        gen_priv_key_pem.as_str(),
        ref_priv_key_pem,
        "key generated from static seed and reference private key for ML-KEM-{variant} do not match"
    );
}

#[cfg(feature = "pem")]
#[test]
fn pkcs8_generate_same_keys_like_golang_for_static_seed() {
    // NOTE: test vector files come from https://github.com/lamps-wg/kyber-certificates/tree/624bcaa4bd9ea9e72de5b51d81ce2d90cbd7e54a
    const PEM_512_PUB: &str = include_str!("examples/ML-KEM-512.pub");
    const PEM_768_PUB: &str = include_str!("examples/ML-KEM-768.pub");
    const PEM_1024_PUB: &str = include_str!("examples/ML-KEM-1024.pub");
    const PEM_512_PRIV: &str = include_str!("examples/ML-KEM-512-seed.priv");
    const PEM_768_PRIV: &str = include_str!("examples/ML-KEM-768-seed.priv");
    const PEM_1024_PRIV: &str = include_str!("examples/ML-KEM-1024-seed.priv");

    compare_with_reference_keys::<MlKem512>(512, PEM_512_PUB, PEM_512_PRIV);
    compare_with_reference_keys::<MlKem768>(768, PEM_768_PUB, PEM_768_PRIV);
    compare_with_reference_keys::<MlKem1024>(1024, PEM_1024_PUB, PEM_1024_PRIV);
}

#[cfg(feature = "pem")]
#[test]
fn pkcs8_can_read_reference_private_keys() {
    // NOTE: test vector files come from https://github.com/lamps-wg/kyber-certificates/tree/624bcaa4bd9ea9e72de5b51d81ce2d90cbd7e54a
    const PEM_512_SEED: &str = include_str!("examples/ML-KEM-512-seed.priv");
    const PEM_768_SEED: &str = include_str!("examples/ML-KEM-768-seed.priv");
    const PEM_1024_SEED: &str = include_str!("examples/ML-KEM-1024-seed.priv");

    fn expect_seed_bytes(ref_pem: &str, expected_seed_prefix: &[u8]) {
        let length = expected_seed_prefix.len();
        let secret_document = der::SecretDocument::from_pkcs8_pem(ref_pem)
            .expect("can read reference PEM private key file");
        let private_key_info = secret_document.decode_msg::<PrivateKeyInfoRef>().unwrap();
        let mut reader = SliceReader::new(private_key_info.private_key.as_bytes()).unwrap();
        let seed_string = SeedString::decode_implicit(&mut reader, 0.into())
            .unwrap()
            .unwrap();
        let seed = Seed::try_from(seed_string.value.as_bytes()).unwrap();

        let given_prefix = &seed[..length];
        assert_eq!(given_prefix, expected_seed_prefix);
    }

    const STATIC_SEED_PREFIX: &[u8] =
        &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

    expect_seed_bytes(PEM_512_SEED, STATIC_SEED_PREFIX);
    expect_seed_bytes(PEM_768_SEED, STATIC_SEED_PREFIX);
    expect_seed_bytes(PEM_1024_SEED, STATIC_SEED_PREFIX);
}
