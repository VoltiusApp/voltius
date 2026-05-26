use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn derive_auth_key(password: &str, account_id: &str) -> Result<String, JsError> {
    let keys = voltius_crypto::derive_keys(password, account_id).map_err(|e| JsError::new(&e))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        keys.auth_key,
    ))
}

#[wasm_bindgen]
pub fn derive_kek(password: &str, account_id: &str) -> Result<Vec<u8>, JsError> {
    let keys = voltius_crypto::derive_keys(password, account_id).map_err(|e| JsError::new(&e))?;
    Ok(keys.enc_key.to_vec())
}

#[wasm_bindgen]
pub fn xchacha20poly1305_encrypt(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, JsError> {
    let k: &[u8; 32] = key
        .try_into()
        .map_err(|_| JsError::new("key must be 32 bytes"))?;
    voltius_crypto::xchacha20poly1305_encrypt(k, plaintext).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn xchacha20poly1305_decrypt(key: &[u8], data: &[u8]) -> Result<Vec<u8>, JsError> {
    let k: &[u8; 32] = key
        .try_into()
        .map_err(|_| JsError::new("key must be 32 bytes"))?;
    voltius_crypto::xchacha20poly1305_decrypt(k, data).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn random_bytes(n: u32) -> Vec<u8> {
    voltius_crypto::random_bytes(n as usize)
}

#[wasm_bindgen]
pub fn wrap_user_secrets(
    kek: &[u8],
    dek: &[u8],
    x25519_private: &[u8],
) -> Result<Vec<u8>, JsError> {
    let k: &[u8; 32] = kek
        .try_into()
        .map_err(|_| JsError::new("kek must be 32 bytes"))?;
    let d: &[u8; 32] = dek
        .try_into()
        .map_err(|_| JsError::new("dek must be 32 bytes"))?;
    let x: &[u8; 32] = x25519_private
        .try_into()
        .map_err(|_| JsError::new("x25519_private must be 32 bytes"))?;
    voltius_crypto::wrap_user_secrets(k, d, x).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn unwrap_user_secrets_dek(kek: &[u8], wrapped: &[u8]) -> Result<Vec<u8>, JsError> {
    let k: &[u8; 32] = kek
        .try_into()
        .map_err(|_| JsError::new("kek must be 32 bytes"))?;
    let (dek, _) = voltius_crypto::unwrap_user_secrets(k, wrapped).map_err(|e| JsError::new(&e))?;
    Ok(dek.to_vec())
}

#[wasm_bindgen]
pub fn unwrap_user_secrets_x25519(kek: &[u8], wrapped: &[u8]) -> Result<Vec<u8>, JsError> {
    let k: &[u8; 32] = kek
        .try_into()
        .map_err(|_| JsError::new("kek must be 32 bytes"))?;
    let (_, x25519_private) =
        voltius_crypto::unwrap_user_secrets(k, wrapped).map_err(|e| JsError::new(&e))?;
    Ok(x25519_private.to_vec())
}

/// Generate a random DEK + X25519 keypair. Returns base64-encoded public key.
#[wasm_bindgen]
pub fn generate_user_secrets_public_key() -> String {
    let kp = voltius_crypto::generate_keypair();
    kp.public_key
}
