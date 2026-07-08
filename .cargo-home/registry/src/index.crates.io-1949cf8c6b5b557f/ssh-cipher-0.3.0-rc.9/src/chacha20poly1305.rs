//! OpenSSH variant of ChaCha20Poly1305.

pub use chacha20::ChaCha20Legacy as ChaCha20;

use crate::Tag;
use aead::{
    AeadCore, AeadInOut, Error, KeyInit, KeySizeUser, Result, TagPosition,
    array::typenum::{U8, U16, U32},
    inout::InOutBuf,
};
use cipher::{KeyIvInit, StreamCipher, StreamCipherSeek};
use core::fmt::{self, Debug};
use ctutils::CtEq;
use poly1305::{Poly1305, universal_hash::UniversalHash};

#[cfg(feature = "zeroize")]
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Key for `chacha20-poly1305@openssh.com`.
pub type ChaChaKey = chacha20::Key;

/// Nonce for `chacha20-poly1305@openssh.com`.
pub type ChaChaNonce = chacha20::LegacyNonce;

/// OpenSSH variant of ChaCha20Poly1305: `chacha20-poly1305@openssh.com`
/// as described in [PROTOCOL.chacha20poly1305].
///
/// Differences from ChaCha20Poly1305-IETF as described in [RFC8439]:
/// - Nonce is 64-bit instead of 96-bit (i.e. uses legacy "djb" ChaCha20 variant).
/// - The AAD and ciphertext inputs of Poly1305 are not padded.
/// - The lengths of ciphertext and AAD are not authenticated using Poly1305.
/// - Maximum supported AAD size is 16.
///
/// ## Usage notes
/// - In the context of SSH packet encryption, AAD will be 4 bytes and contain the encrypted length.
/// - In the context of SSH key encryption, AAD will be empty.
///
/// [PROTOCOL.chacha20poly1305]: https://cvsweb.openbsd.org/src/usr.bin/ssh/PROTOCOL.chacha20poly1305?annotate=HEAD
/// [RFC8439]: https://datatracker.ietf.org/doc/html/rfc8439
#[derive(Clone)]
pub struct ChaCha20Poly1305 {
    key: ChaChaKey,
}

impl KeySizeUser for ChaCha20Poly1305 {
    type KeySize = U32;
}

impl KeyInit for ChaCha20Poly1305 {
    #[inline]
    fn new(key: &ChaChaKey) -> Self {
        Self { key: *key }
    }
}

impl AeadCore for ChaCha20Poly1305 {
    type NonceSize = U8;
    type TagSize = U16;
    const TAG_POSITION: TagPosition = TagPosition::Postfix;
}

impl AeadInOut for ChaCha20Poly1305 {
    fn encrypt_inout_detached(
        &self,
        nonce: &ChaChaNonce,
        associated_data: &[u8],
        buffer: InOutBuf<'_, '_, u8>,
    ) -> Result<Tag> {
        Cipher::new(&self.key, *nonce).encrypt(associated_data, buffer)
    }

    fn decrypt_inout_detached(
        &self,
        nonce: &ChaChaNonce,
        associated_data: &[u8],
        buffer: InOutBuf<'_, '_, u8>,
        tag: &Tag,
    ) -> Result<()> {
        Cipher::new(&self.key, *nonce).decrypt(associated_data, buffer, tag)
    }
}

impl Debug for ChaCha20Poly1305 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ChaCha20Poly1305").finish_non_exhaustive()
    }
}

impl Drop for ChaCha20Poly1305 {
    fn drop(&mut self) {
        #[cfg(feature = "zeroize")]
        self.key.zeroize();
    }
}

#[cfg(feature = "zeroize")]
impl ZeroizeOnDrop for ChaCha20Poly1305 {}

/// Internal type representing a cipher instance.
struct Cipher {
    cipher: ChaCha20,
    mac: Poly1305,
}

impl Cipher {
    /// Create a new cipher instance.
    fn new(key: &ChaChaKey, nonce: ChaChaNonce) -> Self {
        let mut cipher = ChaCha20::new(key, &nonce);
        let mut poly1305_key = poly1305::Key::default();
        cipher.apply_keystream(&mut poly1305_key);

        let mac = Poly1305::new(&poly1305_key);

        // Seek to block 1
        cipher.seek(64);

        Self { cipher, mac }
    }

    /// Encrypt the provided `buffer` in-place, returning the Poly1305 authentication tag.
    #[inline]
    fn encrypt(mut self, aad: &[u8], mut buffer: InOutBuf<'_, '_, u8>) -> Result<Tag> {
        self.cipher.apply_keystream_inout(buffer.reborrow());
        compute_mac(self.mac, aad, buffer.get_out())
    }

    /// Decrypt the provided `buffer` in-place, verifying it against the provided Poly1305
    /// authentication `tag`.
    #[inline]
    fn decrypt(mut self, aad: &[u8], buffer: InOutBuf<'_, '_, u8>, tag: &Tag) -> Result<()> {
        let expected_tag = compute_mac(self.mac, aad, buffer.get_in())?;

        if expected_tag.ct_eq(tag).into() {
            self.cipher.apply_keystream_inout(buffer);
            Ok(())
        } else {
            Err(Error)
        }
    }
}

/// Compute the MAC for a given input buffer (containing ciphertext).
fn compute_mac(mut mac: Poly1305, aad: &[u8], buffer: &[u8]) -> Result<Tag> {
    // We only support up to one block (16-bytes) of AAD.
    // In practice the sizes that matter are `0` and `4` (i.e. length prefix size).
    if aad.len() > poly1305::BLOCK_SIZE {
        return Err(Error);
    }

    // Compute the first Poly1305 block which incorporates any AAD.
    let mut block = poly1305::Block::default();
    block[..aad.len()].copy_from_slice(aad);

    let block_remaining = poly1305::BLOCK_SIZE.checked_sub(aad.len()).ok_or(Error)?;
    let remaining = if buffer.len() <= block_remaining {
        // If total AAD + buffer length is less than or equal to a block, compute a partial block
        let msg_len = aad.len().checked_add(buffer.len()).ok_or(Error)?;
        block[aad.len()..msg_len].copy_from_slice(buffer);
        &block[..msg_len]
    } else {
        // Compute the first block and return any remaining data
        let (head, tail) = buffer.split_at(block_remaining);
        block[aad.len()..].copy_from_slice(head);
        mac.update(&[block]);
        tail
    };

    // Compute Poly1305 over the remaining message data.
    Ok(mac.compute_unpadded(remaining))
}

#[cfg(test)]
mod tests {
    use super::{AeadInOut, ChaCha20Poly1305, KeyInit, Poly1305, compute_mac};
    use hex_literal::hex;

    #[test]
    fn test_vector() {
        const KEY: [u8; 32] =
            hex!("379a8ca9e7e705763633213511e8d92eb148a46f1dd0045ec8164e5d23e456eb");
        const NONCE: [u8; 8] = hex!("0000000000000003");
        const AAD: [u8; 4] = hex!("5709db2d");
        const PT: [u8; 24] = hex!("06050000000c7373682d7573657261757468de5949ab061f");
        const CT: [u8; 24] = hex!("6dcfb03be8a55e7f0220465672edd921489ea0171198e8a7");
        const TAG: [u8; 16] = hex!("3e82fe0a2db7128d58ef8d9047963ca3");

        let cipher = ChaCha20Poly1305::new(&KEY.into());
        let mut buffer = PT;
        let actual_tag = cipher
            .encrypt_inout_detached(&NONCE.into(), &AAD, buffer.as_mut_slice().into())
            .unwrap();

        assert_eq!(buffer, CT);
        assert_eq!(actual_tag, TAG);

        cipher
            .decrypt_inout_detached(
                &NONCE.into(),
                &AAD,
                buffer.as_mut_slice().into(),
                &actual_tag,
            )
            .unwrap();

        assert_eq!(buffer, PT);
    }

    #[test]
    fn mac_computation_with_aad() {
        const KEY: &[u8; poly1305::KEY_SIZE] = b"11112222333344445555666677778888";
        const AAD: &[u8; poly1305::BLOCK_SIZE] = b"0123456789ABCDEF";
        const PT: &[u8; poly1305::BLOCK_SIZE] = b"abcdefghijklmnop";

        for aad_len in 0..=poly1305::BLOCK_SIZE {
            for pt_len in 0..=poly1305::BLOCK_SIZE {
                let mut buffer = [0; poly1305::BLOCK_SIZE * 2];
                let aad = &AAD[..aad_len];
                let pt = &PT[..pt_len];

                let eob = aad_len + pt_len;
                buffer[..aad_len].copy_from_slice(aad);
                buffer[aad_len..eob].copy_from_slice(pt);

                let poly = Poly1305::new(KEY.into());
                let expected_mac = poly.clone().compute_unpadded(&buffer[..eob]);
                let actual_mac = compute_mac(poly, aad, pt).unwrap();

                assert_eq!(expected_mac, actual_mac);
            }
        }
    }
}
