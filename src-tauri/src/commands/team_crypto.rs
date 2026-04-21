use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng as AeadOsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use hkdf::Hkdf;
use rand::RngCore;
use serde::Serialize;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

// ─── Keypair derivation ───────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct X25519KeypairResult {
    pub public_key: String,  // base64
    pub private_key: String, // base64
}

/// Derive a deterministic X25519 keypair from the vault encryption key.
/// This ensures the same keypair is always derived for the same account,
/// so the public key registered on the server remains consistent.
#[tauri::command]
pub fn derive_x25519_keypair(enc_key: Vec<u8>) -> Result<X25519KeypairResult, String> {
    let hkdf = Hkdf::<Sha256>::new(None, &enc_key);
    let mut key_bytes = [0u8; 32];
    hkdf.expand(b"x25519_keypair_v1", &mut key_bytes)
        .map_err(|e| e.to_string())?;

    let secret = StaticSecret::from(key_bytes);
    let public = PublicKey::from(&secret);

    Ok(X25519KeypairResult {
        public_key: STANDARD.encode(public.as_bytes()),
        private_key: STANDARD.encode(secret.to_bytes()),
    })
}

// ─── Session key generation ───────────────────────────────────────────────────

/// Generate a random 32-byte AES-256-GCM session key.
#[tauri::command]
pub fn generate_session_key() -> Vec<u8> {
    let mut key = vec![0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    key
}

// ─── Key wrapping / unwrapping ────────────────────────────────────────────────

/// Wrap (encrypt) a session key for a recipient using X25519 ECDH + AES-256-GCM.
///
/// Steps:
/// 1. ECDH: shared = X25519(my_private, recipient_public)
/// 2. Encrypt session_key with AES-256-GCM(key=shared)
/// 3. Return base64(nonce || ciphertext)
#[tauri::command]
pub fn x25519_wrap_key(
    my_private_key_b64: String,
    recipient_public_key_b64: String,
    plaintext: Vec<u8>,
) -> Result<String, String> {
    let my_private_bytes: [u8; 32] = STANDARD
        .decode(&my_private_key_b64)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "Invalid private key length".to_string())?;

    let recipient_public_bytes: [u8; 32] = STANDARD
        .decode(&recipient_public_key_b64)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "Invalid public key length".to_string())?;

    let my_secret = StaticSecret::from(my_private_bytes);
    let recipient_public = PublicKey::from(recipient_public_bytes);
    let shared = my_secret.diffie_hellman(&recipient_public);

    let key = Key::<Aes256Gcm>::from_slice(shared.as_bytes());
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut AeadOsRng);

    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;

    let mut out = nonce.to_vec();
    out.extend_from_slice(&ciphertext);
    Ok(STANDARD.encode(&out))
}

/// Unwrap (decrypt) a session key using X25519 ECDH + AES-256-GCM.
///
/// Steps:
/// 1. ECDH: shared = X25519(my_private, sender_public)
/// 2. Decrypt with AES-256-GCM(key=shared, nonce||ciphertext)
/// 3. Return plaintext session key bytes
#[tauri::command]
pub fn x25519_unwrap_key(
    my_private_key_b64: String,
    sender_public_key_b64: String,
    wrapped_b64: String,
) -> Result<Vec<u8>, String> {
    let my_private_bytes: [u8; 32] = STANDARD
        .decode(&my_private_key_b64)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "Invalid private key length".to_string())?;

    let sender_public_bytes: [u8; 32] = STANDARD
        .decode(&sender_public_key_b64)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "Invalid public key length".to_string())?;

    let my_secret = StaticSecret::from(my_private_bytes);
    let sender_public = PublicKey::from(sender_public_bytes);
    let shared = my_secret.diffie_hellman(&sender_public);

    let wrapped = STANDARD.decode(&wrapped_b64).map_err(|e| e.to_string())?;
    if wrapped.len() < 12 {
        return Err("Wrapped key too short".to_string());
    }

    let nonce = Nonce::from_slice(&wrapped[..12]);
    let ciphertext = &wrapped[12..];

    let key = Key::<Aes256Gcm>::from_slice(shared.as_bytes());
    let cipher = Aes256Gcm::new(key);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| e.to_string())
}
