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
    path: PathBuf,
}

const NONCE_LEN: usize = 24;

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
        let secrets = if path.exists() {
            let data = std::fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
            decrypt(&enc_key, &data)?
        } else {
            HashMap::new()
        };
        *self.inner.lock().unwrap() = Some(StoreInner {
            enc_key,
            secrets,
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
        inner.secrets.insert(key, value);
        save(inner)
    }

    pub fn delete(&self, key: &str) -> Result<(), AppError> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or("Secrets store is locked")?;
        inner.secrets.remove(key);
        save(inner)
    }

    #[allow(dead_code)]
    pub fn is_unlocked(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    /// Export all secrets (for backup_export).
    pub fn export_all(&self) -> Result<HashMap<String, String>, AppError> {
        let guard = self.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or("Secrets store is locked")?;
        Ok(inner.secrets.clone())
    }

    /// Import secrets from backup (bulk insert, no save — caller must call save explicitly).
    pub fn import_all(&self, secrets: HashMap<String, String>) -> Result<(), AppError> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or("Secrets store is locked")?;
        inner.secrets.extend(secrets);
        save(inner)
    }
}

fn save(inner: &StoreInner) -> Result<(), AppError> {
    let json = serde_json::to_vec(&inner.secrets)?;
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

fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<HashMap<String, String>, AppError> {
    if data.len() < NONCE_LEN {
        return Err("Secrets file too short".into());
    }
    let nonce = XNonce::from_slice(&data[..NONCE_LEN]);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let plaintext = cipher
        .decrypt(nonce, &data[NONCE_LEN..])
        .map_err(|_| "Decryption failed — wrong key or corrupted file".to_string())?;
    Ok(serde_json::from_slice(&plaintext)?)
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
    let secrets = if path.exists() {
        let data = std::fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
        decrypt(&old_key, &data)?
    } else {
        std::collections::HashMap::new()
    };

    let mut guard = state.inner.lock().unwrap();
    let inner = guard.as_mut().ok_or("Secrets store is locked")?;
    inner.secrets = secrets;
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
