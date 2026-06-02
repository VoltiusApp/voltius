use crate::crypto;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use x25519_dalek::{PublicKey, StaticSecret};

fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    if !s.len().is_multiple_of(2) {
        return Err("hex string must have even length".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| format!("invalid hex: {e}")))
        .collect()
}

#[derive(Serialize)]
pub struct DeriveKeysResult {
    pub auth_key: String, // base64
    pub enc_key: Vec<u8>, // raw bytes for Stronghold
}

#[tauri::command]
pub async fn derive_keys(password: String, account_id: String) -> Result<DeriveKeysResult, String> {
    let keys =
        tauri::async_runtime::spawn_blocking(move || crypto::derive_keys(&password, &account_id))
            .await
            .map_err(|e| e.to_string())??;

    Ok(DeriveKeysResult {
        auth_key: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, keys.auth_key),
        enc_key: keys.enc_key.to_vec(),
    })
}

/// Derive an XChaCha20-Poly1305 key for gist-sync using Argon2id + HKDF-SHA256.
/// `salt_hex` is the 32-char hex salt stored in the Gist manifest (16 raw bytes).
/// Returns the 32-byte enc key as a 64-char hex string.
#[tauri::command]
pub async fn derive_gist_key(passphrase: String, salt_hex: String) -> Result<String, String> {
    let salt = decode_hex(&salt_hex)?;
    let key = tauri::async_runtime::spawn_blocking(move || {
        voltius_crypto::derive_enc_key_raw_salt(&passphrase, &salt)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(key.iter().map(|b| format!("{b:02x}")).collect())
}

#[derive(Serialize)]
pub struct GenerateKeypairResult {
    pub public_key: String, // base64
}

#[tauri::command]
pub fn generate_keypair() -> GenerateKeypairResult {
    let kp = crypto::generate_keypair();
    GenerateKeypairResult {
        public_key: kp.public_key,
    }
}

// ─── User secrets wrap/unwrap ──────────────────────────────────────────────────

#[tauri::command]
pub fn wrap_user_secrets_cmd(
    kek: Vec<u8>,
    dek: Vec<u8>,
    x25519_private: Vec<u8>,
) -> Result<String, String> {
    let kek: &[u8; 32] = kek
        .as_slice()
        .try_into()
        .map_err(|_| "kek must be 32 bytes")?;
    let dek: &[u8; 32] = dek
        .as_slice()
        .try_into()
        .map_err(|_| "dek must be 32 bytes")?;
    let x: &[u8; 32] = x25519_private
        .as_slice()
        .try_into()
        .map_err(|_| "x25519_private must be 32 bytes")?;
    let wrapped = voltius_crypto::wrap_user_secrets(kek, dek, x)?;
    Ok(STANDARD.encode(&wrapped))
}

#[derive(Serialize)]
pub struct UnwrappedUserSecrets {
    pub dek: Vec<u8>,
    pub x25519_private: Vec<u8>,
}

#[tauri::command]
pub fn unwrap_user_secrets_cmd(
    kek: Vec<u8>,
    wrapped_b64: String,
) -> Result<UnwrappedUserSecrets, String> {
    let kek: &[u8; 32] = kek
        .as_slice()
        .try_into()
        .map_err(|_| "kek must be 32 bytes")?;
    let wrapped = STANDARD.decode(&wrapped_b64).map_err(|e| e.to_string())?;
    let (dek, x25519_private) = voltius_crypto::unwrap_user_secrets(kek, &wrapped)?;
    Ok(UnwrappedUserSecrets {
        dek: dek.to_vec(),
        x25519_private: x25519_private.to_vec(),
    })
}

#[derive(Serialize)]
pub struct GeneratedUserSecrets {
    pub dek: Vec<u8>,
    pub x25519_private: Vec<u8>,
    pub x25519_public: String, // base64
}

#[tauri::command]
pub fn generate_user_secrets_cmd() -> GeneratedUserSecrets {
    let dek = voltius_crypto::random_bytes(32);
    let x25519_private_bytes = voltius_crypto::random_bytes(32);
    let private_arr: [u8; 32] = x25519_private_bytes.clone().try_into().unwrap();
    let secret = StaticSecret::from(private_arr);
    let public = PublicKey::from(&secret);
    GeneratedUserSecrets {
        dek,
        x25519_private: x25519_private_bytes,
        x25519_public: STANDARD.encode(public.as_bytes()),
    }
}
