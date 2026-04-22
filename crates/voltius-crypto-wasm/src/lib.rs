use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn derive_auth_key(password: &str, account_id: &str) -> Result<String, JsError> {
    let keys = voltius_crypto::derive_keys(password, account_id)
        .map_err(|e| JsError::new(&e))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        keys.auth_key,
    ))
}
