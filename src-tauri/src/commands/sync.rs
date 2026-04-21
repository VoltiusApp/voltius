use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

use crate::storage::config::config_dir;
use crate::storage::secrets::SecretsStore;

// ─── encrypt_payload ──────────────────────────────────────────────────────────

/// Encrypt an arbitrary files+secrets payload with the provided 32-byte AES-256-GCM key.
/// Uses the same binary format as backup_export (4-byte LE header len + header JSON + 12-byte nonce + ciphertext)
/// but with a minimal header (no account/device id needed for team blobs).
///
/// This command is used by the TypeScript team-vault-sync layer to encrypt the merged
/// CRDT payload before uploading it to the server's team_sync_blobs table.
#[tauri::command]
pub fn encrypt_payload(
    enc_key: Vec<u8>,
    files: HashMap<String, String>,
    secrets: HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    if enc_key.len() != 32 {
        return Err("enc_key must be 32 bytes".to_string());
    }

    // Minimal header so decrypt_blob can strip it out
    let header = serde_json::json!({ "version": BLOB_VERSION });
    let header_json = serde_json::to_vec(&header).map_err(|e| e.to_string())?;

    let payload = BlobPayload { files, secrets };
    let payload_json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    let key = Key::<Aes256Gcm>::from_slice(&enc_key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, payload_json.as_slice())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let header_len = header_json.len() as u32;
    let mut blob = Vec::with_capacity(4 + header_json.len() + 12 + ciphertext.len());
    blob.extend_from_slice(&header_len.to_le_bytes());
    blob.extend_from_slice(&header_json);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);

    Ok(blob)
}

const BLOB_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct BlobHeader {
    version: u32,
    account_id: String,
    device_id: String,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct BlobPayload {
    /// All JSON files from config_dir(), keyed by filename (e.g. "connections.json")
    files: HashMap<String, String>,
    secrets: HashMap<String, String>,
}

fn decrypt_blob(enc_key: &[u8], blob: &[u8]) -> Result<BlobPayload, String> {
    if enc_key.len() != 32 {
        return Err("enc_key must be 32 bytes".to_string());
    }
    if blob.len() < 4 + 12 {
        return Err("Blob too short".to_string());
    }
    let header_len = u32::from_le_bytes(blob[..4].try_into().unwrap()) as usize;
    if blob.len() < 4 + header_len + 12 {
        return Err("Blob malformed".to_string());
    }
    let nonce_start = 4 + header_len;
    let nonce = Nonce::from_slice(&blob[nonce_start..nonce_start + 12]);
    let ciphertext = &blob[nonce_start + 12..];
    let key = Key::<Aes256Gcm>::from_slice(enc_key);
    let cipher = Aes256Gcm::new(key);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed — wrong key or corrupted blob".to_string())?;
    serde_json::from_slice(&plaintext).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn backup_export(
    state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
    account_id: String,
    device_id: String,
) -> Result<Vec<u8>, String> {
    if enc_key.len() != 32 {
        return Err("enc_key must be 32 bytes".to_string());
    }

    let header = BlobHeader {
        version: BLOB_VERSION,
        account_id,
        device_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let header_json = serde_json::to_vec(&header).map_err(|e| e.to_string())?;

    let mut files = HashMap::new();
    let dir = config_dir();

    // Root JSON files (connections.json, identities.json, plugin-registry.json, …)
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let (Some(name), Ok(content)) = (
                    path.file_name().and_then(|n| n.to_str()).map(String::from),
                    std::fs::read_to_string(&path),
                ) {
                    files.insert(name, content);
                }
            }
        }
    }

    // plugin-data/<id>.json — api.storage de chaque plugin
    let plugin_data_dir = dir.join("plugin-data");
    if let Ok(entries) = std::fs::read_dir(&plugin_data_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let (Some(name), Ok(content)) = (
                    path.file_name().and_then(|n| n.to_str()).map(String::from),
                    std::fs::read_to_string(&path),
                ) {
                    files.insert(format!("plugin-data/{name}"), content);
                }
            }
        }
    }
    let secrets = state.export_all()?;
    let payload = BlobPayload { files, secrets };
    let payload_json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    let key = Key::<Aes256Gcm>::from_slice(&enc_key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, payload_json.as_slice())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let header_len = header_json.len() as u32;
    let mut blob = Vec::with_capacity(4 + header_json.len() + 12 + ciphertext.len());
    blob.extend_from_slice(&header_len.to_le_bytes());
    blob.extend_from_slice(&header_json);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);

    Ok(blob)
}

#[derive(Serialize)]
pub struct ImportResult {
    pub account_id: String,
}

#[tauri::command]
pub fn backup_import(
    state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
    blob: Vec<u8>,
) -> Result<ImportResult, String> {
    if blob.len() < 4 + 12 {
        return Err("Blob too short".to_string());
    }
    let header_len = u32::from_le_bytes(blob[..4].try_into().unwrap()) as usize;
    if blob.len() < 4 + header_len + 12 {
        return Err("Blob malformed".to_string());
    }
    let header: BlobHeader =
        serde_json::from_slice(&blob[4..4 + header_len]).map_err(|e| e.to_string())?;

    let payload = decrypt_blob(&enc_key, &blob)?;

    let dir = config_dir();
    for (filename, content) in payload.files {
        let dest = if let Some(sub) = filename.strip_prefix("plugin-data/") {
            let sub_dir = dir.join("plugin-data");
            std::fs::create_dir_all(&sub_dir)
                .map_err(|e| format!("Cannot create plugin-data dir: {e}"))?;
            sub_dir.join(sub)
        } else {
            dir.join(&filename)
        };
        std::fs::write(&dest, content).map_err(|e| format!("Failed to restore {filename}: {e}"))?;
    }
    state.import_all(payload.secrets)?;

    Ok(ImportResult {
        account_id: header.account_id,
    })
}

// ─── CRDT sync helpers ────────────────────────────────────────────────────────

/// All entity JSON files that participate in CRDT merge.
/// To add a new entity type, add its filename here — nothing else changes in the sync layer.
pub const ENTITY_FILES: &[&str] = &[
    "connections.json",
    "identities.json",
    "ssh_keys.json",
    "folders.json",
    "snippets.json",
    "snippet_folders.json",
];

/// Decrypt a remote blob and return its payload without writing anything to disk.
/// Used by the TypeScript CRDT merge to inspect remote device state.
#[tauri::command]
pub fn backup_decrypt(enc_key: Vec<u8>, blob: Vec<u8>) -> Result<BlobPayload, String> {
    decrypt_blob(&enc_key, &blob)
}

/// Export the current local entity state as a raw (unencrypted) payload.
/// Returns the same structure as backup_decrypt so TypeScript can merge both sides uniformly.
#[tauri::command]
pub fn state_export_raw(state: tauri::State<SecretsStore>) -> Result<BlobPayload, String> {
    let dir = config_dir();
    let mut files = HashMap::new();
    for name in ENTITY_FILES {
        let content = fs::read_to_string(dir.join(name)).unwrap_or_else(|_| "[]".to_string());
        files.insert(name.to_string(), content);
    }
    let secrets = state.export_all()?;
    Ok(BlobPayload { files, secrets })
}

/// Write CRDT-merged entity arrays to disk.
/// `files` maps filename → merged JSON array string (including tombstones).
/// Only filenames listed in ENTITY_FILES are written; others are ignored.
/// `secrets` is a union-merged key-value map.
#[tauri::command]
pub fn state_import(
    state: tauri::State<SecretsStore>,
    files: HashMap<String, String>,
    secrets: HashMap<String, String>,
) -> Result<(), String> {
    let dir = config_dir();
    for (filename, content) in &files {
        if ENTITY_FILES.contains(&filename.as_str()) {
            fs::write(dir.join(filename), content)
                .map_err(|e| format!("Failed to write {filename}: {e}"))?;
        }
    }
    if !secrets.is_empty() {
        state.import_all(secrets)?;
    }
    Ok(())
}

// ─── Theme preferences ────────────────────────────────────────────────────────

#[tauri::command]
pub fn theme_load() -> Option<String> {
    std::fs::read_to_string(config_dir().join("theme.json")).ok()
}

#[tauri::command]
pub fn theme_save(state: String) -> Result<(), String> {
    std::fs::write(config_dir().join("theme.json"), state)
        .map_err(|e| format!("theme_save failed: {e}"))
}
