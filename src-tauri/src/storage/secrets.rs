use crate::error::AppError;
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Key, XChaCha20Poly1305, XNonce,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

pub struct SecretsStore {
    inner: Mutex<Option<StoreInner>>,
}

struct StoreInner {
    enc_key: [u8; 32],
    secrets: HashMap<String, String>,
    /// Per-secret last-write timestamps (RFC3339). A key present here but absent
    /// from `secrets` is a tombstone: a deletion that must still propagate on sync.
    clocks: HashMap<String, String>,
    path: PathBuf,
}

const NONCE_LEN: usize = 24;

/// On-disk / in-blob representation of the secrets store.
#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct SecretsData {
    pub secrets: HashMap<String, String>,
    #[serde(default)]
    pub clocks: HashMap<String, String>,
}

fn now_ts() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn secrets_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("secrets.enc")
}

impl SecretsStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn unlock(&self, path: PathBuf, enc_key: [u8; 32]) -> Result<(), AppError> {
        let data = if path.exists() {
            let bytes = std::fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
            decrypt(&enc_key, &bytes)?
        } else {
            SecretsData::default()
        };
        *self.inner.lock().unwrap() = Some(StoreInner {
            enc_key,
            secrets: data.secrets,
            clocks: data.clocks,
            path,
        });
        Ok(())
    }

    pub fn lock(&self) {
        *self.inner.lock().unwrap() = None;
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, AppError> {
        let guard = self.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or("Secrets store is locked")?;
        Ok(inner.secrets.get(key).cloned())
    }

    pub fn set(&self, key: String, value: String) -> Result<(), AppError> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or("Secrets store is locked")?;
        inner.clocks.insert(key.clone(), now_ts());
        inner.secrets.insert(key, value);
        save(inner)
    }

    pub fn delete(&self, key: &str) -> Result<(), AppError> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or("Secrets store is locked")?;
        inner.secrets.remove(key);
        // Leave a tombstone (clock without value) so the deletion propagates on sync.
        inner.clocks.insert(key.to_string(), now_ts());
        save(inner)
    }

    #[allow(dead_code)]
    pub fn is_unlocked(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    /// Export all secrets plus their per-secret clocks (for backup/sync export).
    pub fn export_all(&self) -> Result<SecretsData, AppError> {
        let guard = self.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or("Secrets store is locked")?;
        Ok(SecretsData {
            secrets: inner.secrets.clone(),
            clocks: inner.clocks.clone(),
        })
    }

    /// Replace the store with a merged secrets+clocks set (from a sync merge or a
    /// full backup restore). Replacing rather than extending lets deletions apply:
    /// a key merged away (tombstoned) is removed from the live secret map.
    pub fn replace_all(
        &self,
        secrets: HashMap<String, String>,
        clocks: HashMap<String, String>,
    ) -> Result<(), AppError> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or("Secrets store is locked")?;
        inner.secrets = secrets;
        inner.clocks = clocks;
        save(inner)
    }
}

fn save(inner: &StoreInner) -> Result<(), AppError> {
    let data = SecretsData {
        secrets: inner.secrets.clone(),
        clocks: inner.clocks.clone(),
    };
    let json = serde_json::to_vec(&data)?;
    let encrypted = encrypt(&inner.enc_key, &json)?;
    std::fs::write(&inner.path, encrypted).map_err(|e| AppError::Msg(format!("Write failed: {e}")))
}

fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<SecretsData, AppError> {
    if data.len() < NONCE_LEN {
        return Err("Secrets file too short".into());
    }
    let nonce = XNonce::from_slice(&data[..NONCE_LEN]);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let plaintext = cipher
        .decrypt(nonce, &data[NONCE_LEN..])
        .map_err(|_| "Decryption failed — wrong key or corrupted file".to_string())?;
    parse_secrets(&plaintext)
}

/// Parse decrypted bytes as a [`SecretsData`] envelope, tolerating the legacy
/// format (a bare `{key: value}` map written before per-secret clocks existed).
fn parse_secrets(plaintext: &[u8]) -> Result<SecretsData, AppError> {
    let value: serde_json::Value = serde_json::from_slice(plaintext)?;
    // Envelope form: an object with a `secrets` object field.
    if value.get("secrets").map(|s| s.is_object()).unwrap_or(false) {
        return Ok(serde_json::from_value(value)?);
    }
    // Legacy form: the whole object is the secrets map (clocks unknown → empty).
    let secrets: HashMap<String, String> = serde_json::from_value(value)?;
    Ok(SecretsData {
        secrets,
        clocks: HashMap::new(),
    })
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn secrets_unlock(
    app: AppHandle,
    state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
) -> Result<(), AppError> {
    let key: [u8; 32] = enc_key.try_into().map_err(|_| "enc_key must be 32 bytes")?;
    let path = secrets_path(&app);
    state.unlock(path, key)
}

#[tauri::command]
pub fn secrets_verify(
    app: AppHandle,
    _state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
) -> Result<(), AppError> {
    let key: [u8; 32] = enc_key.try_into().map_err(|_| "enc_key must be 32 bytes")?;
    let path = secrets_path(&app);
    // If no file yet, key is always valid (will be created on first write)
    if !path.exists() {
        return Ok(());
    }
    // Try to decrypt without mutating state
    let data = std::fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
    decrypt(&key, &data).map(|_| ())
}

#[tauri::command]
pub fn secrets_exists(app: AppHandle) -> bool {
    secrets_path(&app).exists()
}

#[tauri::command]
pub fn secrets_lock(state: tauri::State<SecretsStore>) {
    state.lock();
}

/// Re-encrypt the secrets store with a new key (used for account migration).
#[tauri::command]
pub fn secrets_reencrypt(
    state: tauri::State<SecretsStore>,
    new_enc_key: Vec<u8>,
) -> Result<(), AppError> {
    let new_key: [u8; 32] = new_enc_key
        .try_into()
        .map_err(|_| "new_enc_key must be 32 bytes")?;
    let mut guard = state.inner.lock().unwrap();
    let inner = guard.as_mut().ok_or("Secrets store is locked")?;
    inner.enc_key = new_key;
    save(inner)
}

/// Re-key the secrets store: decrypt with old_key, re-encrypt with new_key.
/// Used during the KEK/DEK migration when the DEK changes.
#[tauri::command]
pub fn secrets_rekey(
    app: AppHandle,
    state: tauri::State<SecretsStore>,
    old_enc_key: Vec<u8>,
    new_enc_key: Vec<u8>,
) -> Result<(), AppError> {
    let old_key: [u8; 32] = old_enc_key
        .try_into()
        .map_err(|_| "old_enc_key must be 32 bytes")?;
    let new_key: [u8; 32] = new_enc_key
        .try_into()
        .map_err(|_| "new_enc_key must be 32 bytes")?;

    let path = secrets_path(&app);
    let data = if path.exists() {
        let bytes = std::fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
        decrypt(&old_key, &bytes)?
    } else {
        SecretsData::default()
    };

    let mut guard = state.inner.lock().unwrap();
    let inner = guard.as_mut().ok_or("Secrets store is locked")?;
    inner.secrets = data.secrets;
    inner.clocks = data.clocks;
    inner.enc_key = new_key;
    save(inner)
}

#[tauri::command]
pub fn secrets_get(
    state: tauri::State<SecretsStore>,
    key: String,
) -> Result<Option<String>, AppError> {
    state.get(&key)
}

#[tauri::command]
pub fn secrets_set(
    state: tauri::State<SecretsStore>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    state.set(key, value)
}

#[tauri::command]
pub fn secrets_delete(state: tauri::State<SecretsStore>, key: String) -> Result<(), AppError> {
    state.delete(&key)
}

/// Delete secrets.enc from disk and lock the store.
/// Used for recovery when the file was encrypted with a stale key.
#[tauri::command]
pub fn secrets_wipe(app: AppHandle, state: tauri::State<SecretsStore>) -> Result<(), AppError> {
    state.lock();
    let path = secrets_path(&app);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Wipe failed: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_bare_map_with_empty_clocks() {
        // Secrets written before per-secret clocks existed: a bare {key: value} map.
        let legacy = br#"{"password:c1":"secret","key:k1:private":"pem"}"#;
        let data = parse_secrets(legacy).expect("legacy parse");
        assert_eq!(data.secrets.get("password:c1").unwrap(), "secret");
        assert_eq!(data.secrets.get("key:k1:private").unwrap(), "pem");
        assert!(data.clocks.is_empty(), "legacy secrets have no clocks");
    }

    #[test]
    fn parses_envelope_with_clocks() {
        let envelope = br#"{"secrets":{"password:c1":"v"},"clocks":{"password:c1":"2026-07-21T00:00:00Z","password:c2":"2026-07-20T00:00:00Z"}}"#;
        let data = parse_secrets(envelope).expect("envelope parse");
        assert_eq!(data.secrets.get("password:c1").unwrap(), "v");
        // A clock with no matching live secret is a tombstone (deleted secret).
        assert_eq!(
            data.clocks.get("password:c2").unwrap(),
            "2026-07-20T00:00:00Z"
        );
        assert!(!data.secrets.contains_key("password:c2"));
    }

    #[test]
    fn parses_envelope_without_clocks_field() {
        let envelope = br#"{"secrets":{"password:c1":"v"}}"#;
        let data = parse_secrets(envelope).expect("envelope parse");
        assert_eq!(data.secrets.get("password:c1").unwrap(), "v");
        assert!(data.clocks.is_empty());
    }

    #[test]
    fn envelope_round_trips_through_serde() {
        let mut secrets = HashMap::new();
        secrets.insert("password:c1".to_string(), "v".to_string());
        let mut clocks = HashMap::new();
        clocks.insert(
            "password:c1".to_string(),
            "2026-07-21T00:00:00Z".to_string(),
        );
        let json = serde_json::to_vec(&SecretsData {
            secrets: secrets.clone(),
            clocks: clocks.clone(),
        })
        .unwrap();
        let back = parse_secrets(&json).unwrap();
        assert_eq!(back.secrets, secrets);
        assert_eq!(back.clocks, clocks);
    }
}
