use crate::crypto;
use serde::Serialize;

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
