use crate::commands::crdt::{is_alive, max_clock};
use crate::storage::config::{load_keys, save_keys, SshKey, SshKeyFormData};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

#[tauri::command]
pub fn key_list() -> Result<Vec<SshKey>, String> {
    let keys = load_keys();
    Ok(keys
        .into_iter()
        .filter(|k| is_alive(&k.deleted_at, &k.updated_at))
        .collect())
}

fn build_key(id: String, data: SshKeyFormData, now: &str, created_at: Option<String>) -> SshKey {
    let now = now.to_string();
    let mut clocks = HashMap::new();
    for field in &["name", "key_type", "tags", "folder_id", "vault_id"] {
        clocks.insert((*field).to_string(), now.clone());
    }
    SshKey {
        id,
        name: data.name,
        key_type: data.key_type,
        tags: data.tags,
        created_at: created_at.unwrap_or_else(|| now.clone()),
        folder_id: data.folder_id,
        vault_id: data.vault_id.unwrap_or_else(|| "personal".to_string()),
        updated_at: now,
        deleted_at: None,
        pinned: data.pinned,
        clocks,
    }
}

#[tauri::command]
pub fn key_save(data: SshKeyFormData) -> Result<SshKey, String> {
    let mut keys = load_keys();
    let now = Utc::now().to_rfc3339();
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let key = build_key(Uuid::new_v4().to_string(), data, &now, None);
    keys.push(key.clone());
    save_keys(&keys)?;
    Ok(key)
}

/// Inserts a key under a caller-supplied `id`, replacing any local row with that
/// id. Migration-only: see `connection_adopt`. The id must survive because the
/// private material is stored in the keychain under `key:<id>`.
#[tauri::command]
pub fn key_adopt(id: String, data: SshKeyFormData) -> Result<SshKey, String> {
    let mut keys = load_keys();
    let now = Utc::now().to_rfc3339();
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let created_at = keys
        .iter()
        .find(|k| k.id == id)
        .map(|k| k.created_at.clone());
    let adopted = build_key(id.clone(), data, &now, created_at);
    match keys.iter_mut().find(|k| k.id == id) {
        Some(slot) => *slot = adopted.clone(),
        None => keys.push(adopted.clone()),
    }
    save_keys(&keys)?;
    Ok(adopted)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn form() -> SshKeyFormData {
        SshKeyFormData {
            name: Some("deploy".into()),
            key_type: Some("ed25519".into()),
            tags: vec!["a".into()],
            folder_id: Some("folder-1".into()),
            vault_id: None,
            pinned: true,
        }
    }

    #[test]
    fn build_stamps_every_synced_field_at_now() {
        let built = build_key("k-1".into(), form(), "2026-01-01T00:00:00Z", None);
        let mut fields: Vec<&str> = built.clocks.keys().map(String::as_str).collect();
        fields.sort();
        assert_eq!(
            fields,
            ["folder_id", "key_type", "name", "tags", "vault_id"]
        );
        assert!(built.clocks.values().all(|v| v == "2026-01-01T00:00:00Z"));
    }

    #[test]
    fn build_defaults_an_absent_vault_to_personal() {
        let built = build_key("k-1".into(), form(), "2026-01-01T00:00:00Z", None);
        assert_eq!(built.vault_id, "personal");
    }

    #[test]
    fn build_keeps_an_explicit_vault() {
        let mut data = form();
        data.vault_id = Some("team-a".into());
        let built = build_key("k-1".into(), data, "2026-01-01T00:00:00Z", None);
        assert_eq!(built.vault_id, "team-a");
    }

    #[test]
    fn build_carries_a_supplied_created_at_and_otherwise_uses_now() {
        let carried = build_key(
            "k-1".into(),
            form(),
            "2026-02-01T00:00:00Z",
            Some("2020-01-01T00:00:00Z".into()),
        );
        assert_eq!(carried.created_at, "2020-01-01T00:00:00Z");
        let fresh = build_key("k-1".into(), form(), "2026-02-01T00:00:00Z", None);
        assert_eq!(fresh.created_at, "2026-02-01T00:00:00Z");
    }

    #[test]
    fn build_is_never_born_deleted_and_updates_at_now() {
        let built = build_key("k-1".into(), form(), "2026-01-01T00:00:00Z", None);
        assert_eq!(built.deleted_at, None);
        assert_eq!(built.updated_at, "2026-01-01T00:00:00Z");
        assert!(built.pinned);
    }
}
