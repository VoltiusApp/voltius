use crate::crypto;
use serde::Serialize;

fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
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

/// Derive an AES-256-GCM key for gist-sync using Argon2id + HKDF-SHA256.
/// `salt_hex` is the 32-char hex salt stored in the Gist manifest (16 raw bytes).
/// Returns the 32-byte enc key as a 64-char hex string.
#[tauri::command]
pub async fn derive_gist_key(passphrase: String, salt_hex: String) -> Result<String, String> {
    let salt = decode_hex(&salt_hex)?;
    let key =
        tauri::async_runtime::spawn_blocking(move || {
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
    // private_key_bytes would be stored in Stronghold, encrypted with enc_key
    // For now, we only return the public key
    GenerateKeypairResult {
        public_key: kp.public_key,
    }
}
