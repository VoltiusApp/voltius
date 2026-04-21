use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
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

    pub fn unlock(&self, path: PathBuf, enc_key: [u8; 32]) -> Result<(), String> {
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

    pub fn get(&self, key: &str) -> Result<Option<String>, String> {
        let guard = self.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or("Secrets store is locked")?;
        Ok(inner.secrets.get(key).cloned())
    }

    pub fn set(&self, key: String, value: String) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or("Secrets store is locked")?;
        inner.secrets.insert(key, value);
        save(inner)
    }

    pub fn delete(&self, key: &str) -> Result<(), String> {
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
    pub fn export_all(&self) -> Result<HashMap<String, String>, String> {
        let guard = self.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or("Secrets store is locked")?;
        Ok(inner.secrets.clone())
    }

    /// Import secrets from backup (bulk insert, no save — caller must call save explicitly).
    pub fn import_all(&self, secrets: HashMap<String, String>) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or("Secrets store is locked")?;
        inner.secrets.extend(secrets);
        save(inner)
    }
}

fn save(inner: &StoreInner) -> Result<(), String> {
    let json = serde_json::to_vec(&inner.secrets).map_err(|e| e.to_string())?;
    let encrypted = encrypt(&inner.enc_key, &json)?;
    std::fs::write(&inner.path, encrypted).map_err(|e| format!("Write failed: {e}"))
}

fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<HashMap<String, String>, String> {
    if data.len() < 12 {
        return Err("Secrets file too short".to_string());
    }
    let nonce = Nonce::from_slice(&data[..12]);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(nonce, &data[12..])
        .map_err(|_| "Decryption failed — wrong key or corrupted file".to_string())?;
    serde_json::from_slice(&plaintext).map_err(|e| e.to_string())
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn secrets_unlock(
    app: AppHandle,
    state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
) -> Result<(), String> {
    if enc_key.len() != 32 {
        return Err("enc_key must be 32 bytes".to_string());
    }
    let path = secrets_path(&app);
    let key: [u8; 32] = enc_key.try_into().unwrap();
    state.unlock(path, key)
}

#[tauri::command]
pub fn secrets_verify(
    app: AppHandle,
    _state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
) -> Result<(), String> {
    if enc_key.len() != 32 {
        return Err("enc_key must be 32 bytes".to_string());
    }
    let path = secrets_path(&app);
    // If no file yet, key is always valid (will be created on first write)
    if !path.exists() {
        return Ok(());
    }
    let key: [u8; 32] = enc_key.try_into().unwrap();
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
) -> Result<(), String> {
    if new_enc_key.len() != 32 {
        return Err("new_enc_key must be 32 bytes".to_string());
    }
    let mut guard = state.inner.lock().unwrap();
    let inner = guard.as_mut().ok_or("Secrets store is locked")?;
    let new_key: [u8; 32] = new_enc_key.try_into().unwrap();
    inner.enc_key = new_key;
    save(inner)
}

#[tauri::command]
pub fn secrets_get(
    state: tauri::State<SecretsStore>,
    key: String,
) -> Result<Option<String>, String> {
    state.get(&key)
}

#[tauri::command]
pub fn secrets_set(
    state: tauri::State<SecretsStore>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.set(key, value)
}

#[tauri::command]
pub fn secrets_delete(state: tauri::State<SecretsStore>, key: String) -> Result<(), String> {
    state.delete(&key)
}

/// Delete secrets.enc from disk and lock the store.
/// Used for recovery when the file was encrypted with a stale key.
#[tauri::command]
pub fn secrets_wipe(app: AppHandle, state: tauri::State<SecretsStore>) -> Result<(), String> {
    state.lock();
    let path = secrets_path(&app);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Wipe failed: {e}"))?;
    }
    Ok(())
}
