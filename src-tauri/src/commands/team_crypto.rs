use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng as AeadOsRng},
    Key, XChaCha20Poly1305, XNonce,
};
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

const NONCE_LEN: usize = 24;

/// Generate a random 32-byte XChaCha20-Poly1305 session key.
#[tauri::command]
pub fn generate_session_key() -> Vec<u8> {
    let mut key = vec![0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    key
}

// ─── Key wrapping / unwrapping ────────────────────────────────────────────────

/// Wrap (encrypt) a session key for a recipient using X25519 ECDH + XChaCha20-Poly1305.
///
/// Steps:
/// 1. ECDH: shared = X25519(my_private, recipient_public)
/// 2. Encrypt session_key with XChaCha20-Poly1305(key=shared)
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

    let key = Key::from_slice(shared.as_bytes());
    let cipher = XChaCha20Poly1305::new(key);
    let nonce = XChaCha20Poly1305::generate_nonce(&mut AeadOsRng);

    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;

    let mut out = nonce.to_vec();
    out.extend_from_slice(&ciphertext);
    Ok(STANDARD.encode(&out))
}

/// Unwrap (decrypt) a session key using X25519 ECDH + XChaCha20-Poly1305.
///
/// Steps:
/// 1. ECDH: shared = X25519(my_private, sender_public)
/// 2. Decrypt with XChaCha20-Poly1305(key=shared, nonce||ciphertext)
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
    if wrapped.len() < NONCE_LEN {
        return Err("Wrapped key too short".to_string());
    }

    let nonce = XNonce::from_slice(&wrapped[..NONCE_LEN]);
    let ciphertext = &wrapped[NONCE_LEN..];

    let key = Key::from_slice(shared.as_bytes());
    let cipher = XChaCha20Poly1305::new(key);

    cipher.decrypt(nonce, ciphertext).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypair(seed: &[u8]) -> (String, String) {
        let kp = derive_x25519_keypair(seed.to_vec()).unwrap();
        (kp.private_key, kp.public_key)
    }

    #[test]
    fn wrap_then_unwrap_round_trips() {
        let (a_priv, a_pub) = keypair(b"alice-enc-key");
        let (b_priv, b_pub) = keypair(b"bob-enc-key");
        let session_key = vec![7u8; 32];

        // Alice wraps for Bob.
        let wrapped = x25519_wrap_key(a_priv, b_pub, session_key.clone()).unwrap();
        // Bob unwraps from Alice.
        let unwrapped = x25519_unwrap_key(b_priv, a_pub, wrapped).unwrap();

        assert_eq!(unwrapped, session_key);
    }
}
