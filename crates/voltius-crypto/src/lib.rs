use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng as AeadOsRng},
    Key, XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

/// Bumping this requires a vault migration — existing blobs will fail to decrypt.
const CIPHERTEXT_VERSION: u8 = 1;

fn derive_master_key(password: &str, account_id: &str) -> Result<[u8; 32], String> {
    derive_master_key_raw_salt(password, account_id.as_bytes())
}

fn derive_master_key_raw_salt(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(128 * 1024, 3, 4, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut master_key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut master_key)
        .map_err(|e| format!("Argon2id failed: {e}"))?;
    Ok(master_key)
}

/// Derive only the encryption key using a raw (binary) salt.
/// Used by the gist-sync plugin which stores a 16-byte random salt as hex.
pub fn derive_enc_key_raw_salt(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let master_key = derive_master_key_raw_salt(password, salt)?;
    hkdf_expand(&master_key, b"enc")
}

fn hkdf_expand(master_key: &[u8; 32], info: &[u8]) -> Result<[u8; 32], String> {
    let hkdf = Hkdf::<Sha256>::new(Some(b"voltius-hkdf-v1"), master_key);
    let mut out = [0u8; 32];
    hkdf.expand(info, &mut out)
        .map_err(|e| format!("HKDF expand failed: {e}"))?;
    Ok(out)
}

pub fn derive_keys(password: &str, account_id: &str) -> Result<DerivedKeys, String> {
    let master_key = derive_master_key(password, account_id)?;
    let auth_key = hkdf_expand(&master_key, b"auth")?;
    let enc_key = hkdf_expand(&master_key, b"enc")?;
    Ok(DerivedKeys { auth_key, enc_key })
}

pub struct DerivedKeys {
    pub auth_key: [u8; 32],
    pub enc_key: [u8; 32],
}

pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf
}

const XCHACHA20POLY1305_NONCE_LEN: usize = 24;

// Wire format: version(1) || nonce(24) || XChaCha20-Poly1305 ciphertext+tag
pub fn xchacha20poly1305_encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = XChaCha20Poly1305::generate_nonce(&mut AeadOsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("XChaCha20-Poly1305 encrypt failed: {e}"))?;
    let mut out = Vec::with_capacity(1 + XCHACHA20POLY1305_NONCE_LEN + ciphertext.len());
    out.push(CIPHERTEXT_VERSION);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn xchacha20poly1305_decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 1 + XCHACHA20POLY1305_NONCE_LEN {
        return Err("Ciphertext too short".to_string());
    }
    let version = data[0];
    if version != CIPHERTEXT_VERSION {
        return Err(format!("Unsupported ciphertext version: {version}"));
    }
    let nonce = XNonce::from_slice(&data[1..1 + XCHACHA20POLY1305_NONCE_LEN]);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    cipher
        .decrypt(nonce, &data[1 + XCHACHA20POLY1305_NONCE_LEN..])
        .map_err(|_| "XChaCha20-Poly1305 decrypt failed — wrong key or corrupted data".to_string())
}

/// Serialize and encrypt `{dek, x25519_private}` with `kek`.
/// Format: nonce(24) || XChaCha20-Poly1305(dek(32) || x25519_private(32))
pub fn wrap_user_secrets(
    kek: &[u8; 32],
    dek: &[u8; 32],
    x25519_private: &[u8; 32],
) -> Result<Vec<u8>, String> {
    let mut plaintext = Vec::with_capacity(64);
    plaintext.extend_from_slice(dek);
    plaintext.extend_from_slice(x25519_private);
    xchacha20poly1305_encrypt(kek, &plaintext)
}

/// Decrypt and deserialize `{dek, x25519_private}`.
pub fn unwrap_user_secrets(kek: &[u8; 32], wrapped: &[u8]) -> Result<([u8; 32], [u8; 32]), String> {
    let plaintext = xchacha20poly1305_decrypt(kek, wrapped)?;
    if plaintext.len() != 64 {
        return Err(format!(
            "Unexpected user_secrets length: {}",
            plaintext.len()
        ));
    }
    let mut dek = [0u8; 32];
    let mut x25519_private = [0u8; 32];
    dek.copy_from_slice(&plaintext[..32]);
    x25519_private.copy_from_slice(&plaintext[32..]);
    Ok((dek, x25519_private))
}

pub fn generate_keypair() -> Keypair {
    use rand::rngs::OsRng;
    use x25519_dalek::{PublicKey, StaticSecret};

    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);

    Keypair {
        public_key: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            public.as_bytes(),
        ),
        private_key_bytes: secret.to_bytes().to_vec(),
    }
}

pub struct Keypair {
    pub public_key: String,
    #[allow(dead_code)]
    pub private_key_bytes: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xchacha20poly1305_encrypt_uses_24_byte_nonce_and_round_trips() {
        let key = [7u8; 32];
        let plaintext = b"voltius secret payload";

        let encrypted = xchacha20poly1305_encrypt(&key, plaintext).unwrap();

        assert!(encrypted.len() >= 1 + 24 + plaintext.len());
        assert_eq!(encrypted[0], CIPHERTEXT_VERSION);
        let decrypted = xchacha20poly1305_decrypt(&key, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn xchacha20poly1305_decrypt_rejects_wrong_key() {
        let key = [7u8; 32];
        let wrong_key = [8u8; 32];
        let encrypted = xchacha20poly1305_encrypt(&key, b"secret").unwrap();

        let result = xchacha20poly1305_decrypt(&wrong_key, &encrypted);

        assert!(result.is_err());
    }

    #[test]
    fn wrap_user_secrets_uses_xchacha20poly1305_format() {
        let kek = [1u8; 32];
        let dek = [2u8; 32];
        let x25519_private = [3u8; 32];

        let wrapped = wrap_user_secrets(&kek, &dek, &x25519_private).unwrap();

        assert!(wrapped.len() >= 1 + 24 + 64);
        let (unwrapped_dek, unwrapped_private) = unwrap_user_secrets(&kek, &wrapped).unwrap();
        assert_eq!(unwrapped_dek, dek);
        assert_eq!(unwrapped_private, x25519_private);
    }
}
