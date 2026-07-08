//! [Cipher Feedback with eight bit feedback][1] (CFB-8) mode.
//!
//! <img src="https://raw.githubusercontent.com/RustCrypto/media/26acc39f/img/block-modes/cfb_enc.svg" width="49%" />
//! <img src="https://raw.githubusercontent.com/RustCrypto/media/26acc39f/img/block-modes/cfb_dec.svg" width="49%"/>
//!
//! Mode functionality is accessed using traits from re-exported [`cipher`] crate.
//!
//! # ⚠️ Security Warning: Hazmat!
//!
//! This crate does not ensure ciphertexts are authentic! Thus ciphertext integrity
//! is not verified, which can lead to serious vulnerabilities!
//! [RustCrypto/AEADs] provide simple authenticated encryption,
//! which is much less error-prone than manual integrity verification.
//!
//! [RustCrypto/AEADs]: https://github.com/RustCrypto/AEADs
//!
//! # Example
//! ```
//! use aes::cipher::KeyIvInit;
//! use hex_literal::hex;
//!
//! type Aes128Cfb8Enc = cfb8::Encryptor<aes::Aes128>;
//! type Aes128Cfb8Dec = cfb8::Decryptor<aes::Aes128>;
//!
//! let key = [0x42; 16];
//! let iv = [0x24; 16];
//! let plaintext = *b"hello world! this is my plaintext.";
//! let ciphertext = hex!(
//!     "33b356ce9184290c4c8facc1c0b1f918d5475aeb75b88c161ca65bdf05c7137ff4b0"
//! );
//!
//! // encrypt/decrypt in-place
//! let mut buf = plaintext.to_vec();
//! Aes128Cfb8Enc::new(&key.into(), &iv.into()).encrypt(&mut buf);
//! assert_eq!(buf[..], ciphertext[..]);
//!
//! Aes128Cfb8Dec::new(&key.into(), &iv.into()).decrypt(&mut buf);
//! assert_eq!(buf[..], plaintext[..]);
//!
//! // encrypt/decrypt from buffer to buffer
//! // buffer length must be equal to input length
//! let mut buf1 = [0u8; 34];
//! Aes128Cfb8Enc::new(&key.into(), &iv.into())
//!     .encrypt_b2b(&plaintext, &mut buf1)
//!     .unwrap();
//! assert_eq!(buf1[..], ciphertext[..]);
//!
//! let mut buf2 = [0u8; 34];
//! Aes128Cfb8Dec::new(&key.into(), &iv.into())
//!     .decrypt_b2b(&buf1, &mut buf2)
//!     .unwrap();
//! assert_eq!(buf2[..], plaintext[..]);
//! ```
//!
//! [1]: https://en.wikipedia.org/wiki/Block_cipher_mode_of_operation#CFB-1,_CFB-8,_CFB-64,_CFB-128,_etc.

#![no_std]
#![doc(
    html_logo_url = "https://raw.githubusercontent.com/RustCrypto/media/6ee8e381/logo.svg",
    html_favicon_url = "https://raw.githubusercontent.com/RustCrypto/media/6ee8e381/logo.svg"
)]
#![cfg_attr(docsrs, feature(doc_cfg))]

mod decrypt;
mod encrypt;

pub use cipher;
pub use decrypt::Decryptor;
pub use encrypt::Encryptor;
