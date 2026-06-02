use crate::storage::config::{load_keys, save_keys, SshKey, SshKeyFormData};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

fn is_alive(deleted_at: &Option<String>, updated_at: &str) -> bool {
    match deleted_at {
        None => true,
        Some(d) => updated_at > d.as_str(),
    }
}

fn max_clock(clocks: &HashMap<String, String>, fallback: &str) -> String {
    clocks
        .values()
        .max()
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

#[tauri::command]
pub fn key_list() -> Result<Vec<SshKey>, String> {
    let keys = load_keys();
    Ok(keys
        .into_iter()
        .filter(|k| is_alive(&k.deleted_at, &k.updated_at))
        .collect())
}

#[tauri::command]
pub fn key_save(data: SshKeyFormData) -> Result<SshKey, String> {
    let mut keys = load_keys();
    let now = Utc::now().to_rfc3339();
    let mut clocks = HashMap::new();
    clocks.insert("name".to_string(), now.clone());
    clocks.insert("key_type".to_string(), now.clone());
    clocks.insert("tags".to_string(), now.clone());
    clocks.insert("folder_id".to_string(), now.clone());
    clocks.insert("vault_id".to_string(), now.clone());
    let vault_id = data.vault_id.unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let key = SshKey {
        id: Uuid::new_v4().to_string(),
        name: data.name,
        key_type: data.key_type,
        tags: data.tags,
        created_at: now.clone(),
        folder_id: data.folder_id,
        vault_id,
        updated_at: now,
        deleted_at: None,
        pinned: data.pinned,
        clocks,
    };
    keys.push(key.clone());
    save_keys(&keys)?;
    Ok(key)
}

#[tauri::command]
pub fn key_update(id: String, data: SshKeyFormData) -> Result<SshKey, String> {
    let mut keys = load_keys();
    let key = keys
        .iter_mut()
        .find(|k| k.id == id)
        .ok_or_else(|| format!("Key {} not found", id))?;
    let now = Utc::now().to_rfc3339();
    if key.name != data.name {
        key.clocks.insert("name".to_string(), now.clone());
    }
    if key.key_type != data.key_type {
        key.clocks.insert("key_type".to_string(), now.clone());
    }
    if key.tags != data.tags {
        key.clocks.insert("tags".to_string(), now.clone());
    }
    if key.folder_id != data.folder_id {
        key.clocks.insert("folder_id".to_string(), now.clone());
    }

    let effective_vault = data
        .vault_id
        .as_deref()
        .unwrap_or(&key.vault_id)
        .to_string();
    if let Some(ref vid) = data.vault_id {
        if key.vault_id != *vid {
            key.clocks.insert("vault_id".to_string(), now.clone());
        }
    }
    check_vault_write(&[effective_vault])?;

    key.name = data.name;
    key.key_type = data.key_type;
    key.tags = data.tags;
    key.folder_id = data.folder_id;
    key.pinned = data.pinned;
    if let Some(vid) = data.vault_id {
        key.vault_id = vid;
    }
    key.deleted_at = None;
    key.updated_at = max_clock(&key.clocks, &now);
    let updated = key.clone();
    save_keys(&keys)?;
    Ok(updated)
}

#[tauri::command]
pub fn key_delete(id: String) -> Result<(), String> {
    let mut keys = load_keys();
    let now = Utc::now().to_rfc3339();
    let key = keys
        .iter_mut()
        .find(|k| k.id == id)
        .ok_or_else(|| format!("Key {} not found", id))?;
    check_vault_write(std::slice::from_ref(&key.vault_id))?;
    key.deleted_at = Some(now.clone());
    key.clocks.insert("__deleted__".to_string(), now.clone());
    key.updated_at = max_clock(&key.clocks, &now);
    save_keys(&keys)
}
