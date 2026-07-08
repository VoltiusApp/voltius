//! Integration tests.
//!
//! XChaCha20Poly1305 test vectors generated using `test-vector-gen` which uses
//! a libsodium reference.
//!
//! XSalsa20Poly1305 test vectors adapted from NaCl's `tests/secretbox.c` and
//! `tests/secretbox.out`.

#![cfg(any(feature = "chacha20", feature = "salsa20"))]

use hex_literal::hex;

const KEY: &[u8; 32] = &hex!("1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389");
const NONCE: &[u8; 24] = &hex!("69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37");
const PLAINTEXT: &[u8] = &hex!(
    "be075fc53c81f2d5cf141316ebeb0c7b5228c52a4c62cbd44b66849b64244ffce5ecbaaf33bd751a"
    "1ac728d45e6c61296cdc3c01233561f41db66cce314adb310e3be8250c46f06dceea3a7fa1348057"
    "e2f6556ad6b1318a024a838f21af1fde048977eb48f59ffd4924ca1c60902e52f0a089bc76897040"
    "e082f937763848645e0705"
);

macro_rules! impl_tests {
    ($cipher:path, $ciphertext:expr) => {
        #[test]
        fn encrypt() {
            let key = GenericArray::from_slice(KEY);
            let nonce = GenericArray::from_slice(NONCE);
            let cipher = <$cipher>::new(key);
            let ciphertext = cipher.encrypt(nonce, PLAINTEXT).unwrap();

            assert_eq!($ciphertext, ciphertext.as_slice());
        }

        #[test]
        fn decrypt() {
            let key = GenericArray::from_slice(KEY);
            let nonce = GenericArray::from_slice(NONCE);
            let cipher = <$cipher>::new(key);
            let plaintext = cipher.decrypt(nonce, $ciphertext).unwrap();

            assert_eq!(PLAINTEXT, plaintext.as_slice());
        }

        #[test]
        fn decrypt_modified() {
            let key = GenericArray::from_slice(KEY);
            let nonce = GenericArray::from_slice(NONCE);
            let mut ciphertext = Vec::from($ciphertext);

            // Tweak the first byte
            ciphertext[0] ^= 0xaa;

            let cipher = <$cipher>::new(key);
            assert!(cipher.decrypt(nonce, ciphertext.as_slice()).is_err());
        }
    };
}

#[cfg(feature = "chacha20")]
mod xchacha20poly1305 {
    use super::{KEY, NONCE, PLAINTEXT};
    use crypto_secretbox::{
        aead::{generic_array::GenericArray, Aead, KeyInit},
        XChaCha20Poly1305,
    };
    use hex_literal::hex;

    const CIPHERTEXT: &[u8] = &hex!(
        "0c61fcffbc3fc8d3aa7464b91ab35374bf8af3198585e55d9cb07edcd1e5a69526547fbd0f2c642e"
        "9ee96e19462031f1032f1cd862bb952900103c06ac16344d7f9c9df0feaaf5a733dea7ea2df70a61"
        "9936fcc5501de75c5d112e8abd7573c461ada29ec016d131aa557804320011ff6d94092581ceea1b"
        "ad3cf0d651938802ca867cd52bbe50c2da1161cb09514407609920"
    );

    impl_tests!(XChaCha20Poly1305, CIPHERTEXT);
}

#[cfg(feature = "salsa20")]
mod xsalsa20poly1305 {
    use super::{KEY, NONCE, PLAINTEXT};
    use crypto_secretbox::{
        aead::{generic_array::GenericArray, Aead, KeyInit},
        XSalsa20Poly1305,
    };
    use hex_literal::hex;

    const CIPHERTEXT: &[u8] = &hex!(
        "f3ffc7703f9400e52a7dfb4b3d3305d98e993b9f48681273c29650ba32fc76ce48332ea7164d96a4"
        "476fb8c531a1186ac0dfc17c98dce87b4da7f011ec48c97271d2c20f9b928fe2270d6fb863d51738"
        "b48eeee314a7cc8ab932164548e526ae90224368517acfeabd6bb3732bc0e9da99832b61ca01b6de"
        "56244a9e88d5f9b37973f622a43d14a6599b1f654cb45a74e355a5"
    );

    impl_tests!(XSalsa20Poly1305, CIPHERTEXT);
}
