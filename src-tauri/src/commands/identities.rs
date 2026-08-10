use crate::commands::vault_object::{
    adopt_into, created_at_of, find_mut, finish_update, impl_vault_object, initial_clocks, live,
    merge_fields, requested_vault, retarget_vault, tombstone,
};
use crate::storage::config::{load_identities, save_identities, Identity, IdentityFormData};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use uuid::Uuid;

impl_vault_object!(Identity, "Identity");

/// The fields whose edits are stamped and synced.
const CLOCK_FIELDS: &[&str] = &[
    "name",
    "username",
    "key_id",
    "tags",
    "folder_id",
    "vault_id",
];

#[tauri::command]
pub fn identity_list() -> Result<Vec<Identity>, String> {
    Ok(live(load_identities()))
}

fn build_identity(
    id: String,
    data: IdentityFormData,
    now: &str,
    created_at: Option<String>,
) -> Identity {
    Identity {
        id,
        name: data.name,
        username: data.username,
        key_id: data.key_id,
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
pub fn identity_save(data: IdentityFormData) -> Result<Identity, String> {
    let mut identities = load_identities();
    let now = Utc::now().to_rfc3339();
    check_vault_write(&requested_vault(&data.vault_id))?;
    let identity = build_identity(Uuid::new_v4().to_string(), data, &now, None);
    identities.push(identity.clone());
    save_identities(&identities)?;
    Ok(identity)
}

/// Inserts an identity under a caller-supplied `id`, replacing any local row with
/// that id. Migration-only: see `connection_adopt`. The id must survive because
/// the identity's password is stored in the keychain under `password:<id>`.
#[tauri::command]
pub fn identity_adopt(id: String, data: IdentityFormData) -> Result<Identity, String> {
    let mut identities = load_identities();
    let now = Utc::now().to_rfc3339();
    check_vault_write(&requested_vault(&data.vault_id))?;
    let created_at = created_at_of(&identities, &id);
    let adopted = build_identity(id, data, &now, created_at);
    adopt_into(&mut identities, adopted.clone());
    save_identities(&identities)?;
    Ok(adopted)
}

#[tauri::command]
pub fn identity_update(id: String, data: IdentityFormData) -> Result<Identity, String> {
    let mut identities = load_identities();
    let identity = find_mut(&mut identities, &id)?;
    let now = Utc::now().to_rfc3339();
    let effective = retarget_vault(identity, &data.vault_id, &now);
    check_vault_write(std::slice::from_ref(&effective))?;

    merge_fields!(identity, data, &now, name, username, key_id, tags, folder_id);
    identity.vault_id = effective;
    identity.pinned = data.pinned;
    finish_update(identity, &now);
    let updated = identity.clone();
    save_identities(&identities)?;
    Ok(updated)
}
#[tauri::command]
pub fn identity_delete(id: String) -> Result<(), String> {
    let mut identities = load_identities();
    let now = Utc::now().to_rfc3339();
    let identity = find_mut(&mut identities, &id)?;
    check_vault_write(std::slice::from_ref(&identity.vault_id))?;
    tombstone(identity, &now);
    save_identities(&identities)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form() -> IdentityFormData {
        IdentityFormData {
            name: Some("root".into()),
            username: "root".into(),
            key_id: Some("key-1".into()),
            tags: vec!["a".into()],
            folder_id: Some("folder-1".into()),
            vault_id: None,
            pinned: true,
        }
    }

    #[test]
    fn build_stamps_every_synced_field_at_now() {
        let built = build_identity("i-1".into(), form(), "2026-01-01T00:00:00Z", None);
        let mut fields: Vec<&str> = built.clocks.keys().map(String::as_str).collect();
        fields.sort();
        assert_eq!(
            fields,
            [
                "folder_id",
                "key_id",
                "name",
                "tags",
                "username",
                "vault_id"
            ]
        );
        assert!(built.clocks.values().all(|v| v == "2026-01-01T00:00:00Z"));
    }

    #[test]
    fn build_defaults_an_absent_vault_to_personal() {
        let built = build_identity("i-1".into(), form(), "2026-01-01T00:00:00Z", None);
        assert_eq!(built.vault_id, "personal");
    }

    #[test]
    fn build_keeps_an_explicit_vault() {
        let mut data = form();
        data.vault_id = Some("team-a".into());
        let built = build_identity("i-1".into(), data, "2026-01-01T00:00:00Z", None);
        assert_eq!(built.vault_id, "team-a");
    }

    #[test]
    fn build_carries_a_supplied_created_at_and_otherwise_uses_now() {
        let carried = build_identity(
            "i-1".into(),
            form(),
            "2026-02-01T00:00:00Z",
            Some("2020-01-01T00:00:00Z".into()),
        );
        assert_eq!(carried.created_at, "2020-01-01T00:00:00Z");
        let fresh = build_identity("i-1".into(), form(), "2026-02-01T00:00:00Z", None);
        assert_eq!(fresh.created_at, "2026-02-01T00:00:00Z");
    }

    #[test]
    fn build_is_never_born_deleted_and_updates_at_now() {
        let built = build_identity("i-1".into(), form(), "2026-01-01T00:00:00Z", None);
        assert_eq!(built.deleted_at, None);
        assert_eq!(built.updated_at, "2026-01-01T00:00:00Z");
        assert_eq!(built.id, "i-1");
        assert!(built.pinned);
    }
}
