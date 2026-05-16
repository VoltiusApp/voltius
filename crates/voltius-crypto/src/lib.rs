use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng as AeadOsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

fn derive_master_key(password: &str, account_id: &str) -> Result<[u8; 32], String> {
    derive_master_key_raw_salt(password, account_id.as_bytes())
}

fn derive_master_key_raw_salt(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(32 * 1024, 2, 1, Some(32)).map_err(|e| e.to_string())?;
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
    let hkdf = Hkdf::<Sha256>::new(None, master_key);
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

pub fn aes_gcm_encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut AeadOsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("AES-GCM encrypt failed: {e}"))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn aes_gcm_decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("Ciphertext too short".to_string());
    }
    let nonce = Nonce::from_slice(&data[..12]);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(nonce, &data[12..])
        .map_err(|_| "AES-GCM decrypt failed — wrong key or corrupted data".to_string())
}

/// Serialize and encrypt `{dek, x25519_private}` with `kek`.
/// Format: nonce(12) || AES-GCM(dek(32) || x25519_private(32))
pub fn wrap_user_secrets(
    kek: &[u8; 32],
    dek: &[u8; 32],
    x25519_private: &[u8; 32],
) -> Result<Vec<u8>, String> {
    let mut plaintext = Vec::with_capacity(64);
    plaintext.extend_from_slice(dek);
    plaintext.extend_from_slice(x25519_private);
    aes_gcm_encrypt(kek, &plaintext)
}

/// Decrypt and deserialize `{dek, x25519_private}`.
pub fn unwrap_user_secrets(kek: &[u8; 32], wrapped: &[u8]) -> Result<([u8; 32], [u8; 32]), String> {
    let plaintext = aes_gcm_decrypt(kek, wrapped)?;
    if plaintext.len() != 64 {
        return Err(format!("Unexpected user_secrets length: {}", plaintext.len()));
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
