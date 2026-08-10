use crate::commands::vault_object::{
    adopt_into, created_at_of, find_mut, finish_update, impl_vault_object, initial_clocks, live,
    merge_fields, requested_vault, retarget_vault, tombstone,
};
use crate::storage::config::{load_keys, save_keys, SshKey, SshKeyFormData};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use uuid::Uuid;

impl_vault_object!(SshKey, "Key");

/// The fields whose edits are stamped and synced.
const CLOCK_FIELDS: &[&str] = &["name", "key_type", "tags", "folder_id", "vault_id"];

#[tauri::command]
pub fn key_list() -> Result<Vec<SshKey>, String> {
    Ok(live(load_keys()))
}

fn build_key(id: String, data: SshKeyFormData, now: &str, created_at: Option<String>) -> SshKey {
    SshKey {
        id,
        name: data.name,
        key_type: data.key_type,
        tags: data.tags,
        created_at: created_at.unwrap_or_else(|| now.to_string()),
        folder_id: data.folder_id,
        vault_id: requested_vault(&data.vault_id)[0].clone(),
        updated_at: now.to_string(),
        deleted_at: None,
        pinned: data.pinned,
        clocks: initial_clocks(CLOCK_FIELDS, now),
    }
}

#[tauri::command]
pub fn key_save(data: SshKeyFormData) -> Result<SshKey, String> {
    let mut keys = load_keys();
    let now = Utc::now().to_rfc3339();
    check_vault_write(&requested_vault(&data.vault_id))?;
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
    check_vault_write(&requested_vault(&data.vault_id))?;
    let created_at = created_at_of(&keys, &id);
    let adopted = build_key(id, data, &now, created_at);
    adopt_into(&mut keys, adopted.clone());
    save_keys(&keys)?;
    Ok(adopted)
}

#[tauri::command]
pub fn key_update(id: String, data: SshKeyFormData) -> Result<SshKey, String> {
    let mut keys = load_keys();
    let key = find_mut(&mut keys, &id)?;
    let now = Utc::now().to_rfc3339();
    let effective = retarget_vault(key, &data.vault_id, &now);
    check_vault_write(std::slice::from_ref(&effective))?;

    merge_fields!(key, data, &now, name, key_type, tags, folder_id);
    key.vault_id = effective;
    key.pinned = data.pinned;
    finish_update(key, &now);
    let updated = key.clone();
    save_keys(&keys)?;
    Ok(updated)
}
#[tauri::command]
pub fn key_delete(id: String) -> Result<(), String> {
    let mut keys = load_keys();
    let now = Utc::now().to_rfc3339();
    let key = find_mut(&mut keys, &id)?;
    check_vault_write(std::slice::from_ref(&key.vault_id))?;
    tombstone(key, &now);
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
