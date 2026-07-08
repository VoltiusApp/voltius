//! Integration tests for `ssh-cipher`.
// TODO(tarcieri): test vectors for each supported cipher

use ssh_cipher::Cipher;

#[test]
fn round_trip() {
    const MSG: &[u8] = b"Testing 1 2 3...";
    const CIPHERS: &[Cipher] = &[
        #[cfg(feature = "aes-cbc")]
        Cipher::Aes128Cbc,
        #[cfg(feature = "aes-cbc")]
        Cipher::Aes192Cbc,
        #[cfg(feature = "aes-cbc")]
        Cipher::Aes256Cbc,
        #[cfg(feature = "aes-ctr")]
        Cipher::Aes128Ctr,
        #[cfg(feature = "aes-ctr")]
        Cipher::Aes192Ctr,
        #[cfg(feature = "aes-ctr")]
        Cipher::Aes256Ctr,
        #[cfg(feature = "aes-gcm")]
        Cipher::Aes128Gcm,
        #[cfg(feature = "aes-gcm")]
        Cipher::Aes256Gcm,
        #[cfg(feature = "chacha20poly1305")]
        Cipher::ChaCha20Poly1305,
        #[cfg(feature = "tdes")]
        Cipher::TDesCbc,
    ];

    for &cipher in CIPHERS {
        let (key_len, iv_len) = cipher.key_and_iv_size().unwrap();

        // TODO(tarcieri): randomize keys?
        let key = vec![0; key_len];
        let iv = vec![0; iv_len];
        let mut buffer = Vec::from(MSG);

        let tag = cipher.encrypt(&key, &iv, &mut buffer).unwrap();
        assert_ne!(buffer, MSG);

        cipher.decrypt(&key, &iv, &mut buffer, tag).unwrap();
        assert_eq!(buffer, MSG);
    }
}
