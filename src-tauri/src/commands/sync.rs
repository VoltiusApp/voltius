use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Key, XChaCha20Poly1305, XNonce,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;

use crate::storage::config::config_dir;
use crate::storage::secrets::SecretsStore;

// ─── encrypt_payload ──────────────────────────────────────────────────────────

/// Encrypt an arbitrary files+secrets payload with the provided 32-byte XChaCha20-Poly1305 key.
/// Uses the same binary format as backup_export (4-byte LE header len + header JSON + 24-byte nonce + ciphertext)
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

    // Team-vault blobs are server-authoritative per record and don't participate
    // in the per-secret clock merge, so no clocks are attached here.
    let payload = BlobPayload {
        files,
        secrets,
        secret_clocks: HashMap::new(),
    };
    let payload_json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    let key = Key::from_slice(&enc_key);
    let cipher = XChaCha20Poly1305::new(key);
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, payload_json.as_slice())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let header_len = header_json.len() as u32;
    let mut blob = Vec::with_capacity(4 + header_json.len() + NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&header_len.to_le_bytes());
    blob.extend_from_slice(&header_json);
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);

    Ok(blob)
}

const BLOB_VERSION: u32 = 2;
const NONCE_LEN: usize = 24;

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
    /// Per-secret last-write timestamps (RFC3339). A key present here but absent
    /// from `secrets` is a tombstone (deletion) that must keep propagating.
    /// `#[serde(default)]` keeps older blobs (which lack this field) readable.
    #[serde(default)]
    secret_clocks: HashMap<String, String>,
}

fn decrypt_blob(enc_key: &[u8], blob: &[u8]) -> Result<BlobPayload, String> {
    if enc_key.len() != 32 {
        return Err("enc_key must be 32 bytes".to_string());
    }
    if blob.len() < 4 + NONCE_LEN {
        return Err("Blob too short".to_string());
    }
    let header_len = u32::from_le_bytes(
        blob[..4]
            .try_into()
            .map_err(|_| "Blob too short".to_string())?,
    ) as usize;
    if blob.len() < 4 + header_len + NONCE_LEN {
        return Err("Blob malformed".to_string());
    }
    let nonce_start = 4 + header_len;
    let nonce = XNonce::from_slice(&blob[nonce_start..nonce_start + NONCE_LEN]);
    let ciphertext = &blob[nonce_start + NONCE_LEN..];
    let key = Key::from_slice(enc_key);
    let cipher = XChaCha20Poly1305::new(key);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed — wrong key or corrupted blob".to_string())?;
    serde_json::from_slice(&plaintext).map_err(|e| e.to_string())
}

/// Remove sync-excluded objects from an outbound blob payload, in place.
///
/// For each `ENTITY_FILES` entry, drops array elements whose `"id"` is in
/// `excluded`. For secrets, drops every key whose object-id segment (the 2nd
/// `:`-delimited token) is excluded — from BOTH `secrets` and `clocks`, so the
/// omission is never mistaken for a deletion tombstone by `mergeSecrets`.
/// Non-entity files and non-excluded ids are left untouched.
fn strip_excluded(
    files: &mut HashMap<String, String>,
    secrets: &mut HashMap<String, String>,
    clocks: &mut HashMap<String, String>,
    excluded: &HashSet<String>,
) {
    if excluded.is_empty() {
        return;
    }

    for name in ENTITY_FILES {
        let Some(content) = files.get(*name) else {
            continue;
        };
        let Ok(serde_json::Value::Array(items)) =
            serde_json::from_str::<serde_json::Value>(content)
        else {
            continue; // not a JSON array — leave as-is (defensive)
        };
        let kept: Vec<serde_json::Value> = items
            .into_iter()
            .filter(|it| {
                let id = it.get("id").and_then(|v| v.as_str());
                !matches!(id, Some(id) if excluded.contains(id))
            })
            .collect();
        if let Ok(s) = serde_json::to_string(&serde_json::Value::Array(kept)) {
            files.insert((*name).to_string(), s);
        }
    }

    let is_excluded_secret = |key: &str| {
        key.split(':')
            .nth(1)
            .map(|id| excluded.contains(id))
            .unwrap_or(false)
    };
    secrets.retain(|k, _| !is_excluded_secret(k));
    clocks.retain(|k, _| !is_excluded_secret(k));
}

#[tauri::command]
pub fn backup_export(
    state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
    account_id: String,
    device_id: String,
    excluded_ids: Option<Vec<String>>,
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

    // plugin-data/<id>.json — each plugin's api.storage
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
    let data = state.export_all()?;
    let mut secrets = data.secrets;
    let mut clocks = data.clocks;
    let excluded: HashSet<String> = excluded_ids.unwrap_or_default().into_iter().collect();
    strip_excluded(&mut files, &mut secrets, &mut clocks, &excluded);
    let payload = BlobPayload {
        files,
        secrets,
        secret_clocks: clocks,
    };
    let payload_json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    let key = Key::from_slice(&enc_key);
    let cipher = XChaCha20Poly1305::new(key);
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, payload_json.as_slice())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let header_len = header_json.len() as u32;
    let mut blob = Vec::with_capacity(4 + header_json.len() + NONCE_LEN + ciphertext.len());
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
    if blob.len() < 4 + NONCE_LEN {
        return Err("Blob too short".to_string());
    }
    let header_len = u32::from_le_bytes(
        blob[..4]
            .try_into()
            .map_err(|_| "Blob too short".to_string())?,
    ) as usize;
    if blob.len() < 4 + header_len + NONCE_LEN {
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
    state.replace_all(payload.secrets, payload.secret_clocks)?;

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
    "port_forwarding_rules.json",
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
    let data = state.export_all()?;
    Ok(BlobPayload {
        files,
        secrets: data.secrets,
        secret_clocks: data.clocks,
    })
}

/// Write CRDT-merged entity arrays to disk.
/// `files` maps filename → merged JSON array string (including tombstones).
/// Only filenames listed in ENTITY_FILES are written; others are ignored.
/// `secrets`/`secret_clocks` are the fully-merged authoritative secret set and
/// their per-secret clocks; the store is replaced with them so deletions
/// (tombstones present in `secret_clocks` but absent from `secrets`) take effect.
#[tauri::command]
pub fn state_import(
    state: tauri::State<SecretsStore>,
    files: HashMap<String, String>,
    secrets: HashMap<String, String>,
    secret_clocks: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let dir = config_dir();
    for (filename, content) in &files {
        if ENTITY_FILES.contains(&filename.as_str()) {
            fs::write(dir.join(filename), content)
                .map_err(|e| format!("Failed to write {filename}: {e}"))?;
        }
    }
    state.replace_all(secrets, secret_clocks.unwrap_or_default())?;
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

// ─── App settings ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn settings_load() -> Option<String> {
    std::fs::read_to_string(config_dir().join("settings.json")).ok()
}

#[tauri::command]
pub fn settings_save(state: String) -> Result<(), String> {
    std::fs::write(config_dir().join("settings.json"), state)
        .map_err(|e| format!("settings_save failed: {e}"))
}

// ─── Cross-device live-session manifest ──────────────────────────────────────
// Stored as a root JSON file in config_dir() so backup_export bundles it into
// the encrypted per-device sync blob automatically.

#[tauri::command]
pub fn live_sessions_load() -> Option<String> {
    std::fs::read_to_string(config_dir().join("live_sessions.json")).ok()
}

#[tauri::command]
pub fn live_sessions_save(state: String) -> Result<(), String> {
    std::fs::write(config_dir().join("live_sessions.json"), state)
        .map_err(|e| format!("live_sessions_save failed: {e}"))
}

#[tauri::command]
pub fn device_hostname() -> String {
    // Android's kernel hostname is always "localhost", so fall back to the
    // user-facing device model (e.g. "Pixel 8") via system properties.
    #[cfg(target_os = "android")]
    if let Some(name) = android_device_name() {
        return name;
    }
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "Unknown device".to_string())
}

#[cfg(target_os = "android")]
fn android_device_name() -> Option<String> {
    fn getprop(key: &str) -> String {
        std::process::Command::new("getprop")
            .arg(key)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
    let model = getprop("ro.product.model");
    if model.is_empty() {
        return None;
    }
    let manufacturer = getprop("ro.product.manufacturer");
    // Avoid "Samsung Galaxy"/"samsung SM-..." dupes when model already names the brand.
    if manufacturer.is_empty()
        || model
            .to_lowercase()
            .starts_with(&manufacturer.to_lowercase())
    {
        Some(model)
    } else {
        Some(format!("{manufacturer} {model}"))
    }
}

// ─── Auto-update preference ─────────────────────────────────────────────────────

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
struct UpdaterPrefs {
    #[serde(default = "default_true")]
    auto: bool,
}

/// Whether the background updater loop may run. Missing/unreadable file ⇒ enabled.
pub fn updater_auto_enabled() -> bool {
    match fs::read_to_string(config_dir().join("updater.json")) {
        Ok(s) => serde_json::from_str::<UpdaterPrefs>(&s)
            .map(|p| p.auto)
            .unwrap_or(true),
        Err(_) => true,
    }
}

#[tauri::command]
pub fn updater_get_auto() -> bool {
    updater_auto_enabled()
}

#[tauri::command]
pub fn updater_set_auto(enabled: bool) -> Result<(), String> {
    let body = serde_json::to_string(&UpdaterPrefs { auto: enabled }).map_err(|e| e.to_string())?;
    fs::write(config_dir().join("updater.json"), body)
        .map_err(|e| format!("updater_set_auto failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_excluded_removes_entity_and_its_secrets_from_both_maps() {
        let mut files = HashMap::new();
        files.insert(
            "connections.json".to_string(),
            r#"[{"id":"a"},{"id":"b"}]"#.to_string(),
        );
        // Non-entity file must be left completely untouched.
        files.insert(
            "settings.json".to_string(),
            r#"{"theme":"dark"}"#.to_string(),
        );

        let mut secrets = HashMap::new();
        secrets.insert("password:a".to_string(), "pw".to_string());
        secrets.insert("key:a:private".to_string(), "kp".to_string());
        secrets.insert("key:shared:private".to_string(), "sk".to_string());

        let mut clocks = HashMap::new();
        clocks.insert("password:a".to_string(), "t".to_string());
        clocks.insert("key:shared:private".to_string(), "t".to_string());

        let excluded: HashSet<String> = ["a".to_string()].into_iter().collect();
        strip_excluded(&mut files, &mut secrets, &mut clocks, &excluded);

        // Entity "a" removed, sibling "b" kept.
        assert_eq!(files["connections.json"], r#"[{"id":"b"}]"#);
        // Non-entity file untouched.
        assert_eq!(files["settings.json"], r#"{"theme":"dark"}"#);
        // Excluded object's secrets gone from BOTH maps (no tombstone).
        assert!(!secrets.contains_key("password:a"));
        assert!(!secrets.contains_key("key:a:private"));
        assert!(!clocks.contains_key("password:a"));
        // A secret belonging to a NON-excluded id survives.
        assert!(secrets.contains_key("key:shared:private"));
        assert!(clocks.contains_key("key:shared:private"));
    }

    #[test]
    fn strip_excluded_empty_set_is_noop() {
        let mut files = HashMap::new();
        files.insert(
            "connections.json".to_string(),
            r#"[{"id":"a"}]"#.to_string(),
        );
        let mut secrets = HashMap::new();
        let mut clocks = HashMap::new();
        strip_excluded(&mut files, &mut secrets, &mut clocks, &HashSet::new());
        assert_eq!(files["connections.json"], r#"[{"id":"a"}]"#);
    }
}
