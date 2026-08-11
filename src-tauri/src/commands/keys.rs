#[cfg(test)]
use crate::commands::vault_object::vault_build_tests;
use crate::commands::vault_object::{
    find_mut, finish_update, impl_vault_object, initial_clocks, merge_fields, requested_vault,
    retarget_vault, vault_object_commands,
};
use crate::storage::config::{load_keys, save_keys, SshKey, SshKeyFormData};
use crate::vault_auth::check_vault_write;
use chrono::Utc;

impl_vault_object!(SshKey, "Key");

/// The fields whose edits are stamped and synced.
const CLOCK_FIELDS: &[&str] = &["name", "key_type", "tags", "folder_id", "vault_id"];

vault_object_commands!(
    SshKey,
    SshKeyFormData,
    build_key,
    load_keys,
    save_keys,
    list = key_list,
    create = key_save,
    adopt = key_adopt,
    adopt_doc = "The id must survive because the private material is stored in the keychain \
                 under `key:<id>`.",
    delete = key_delete,
);

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

    vault_build_tests!(
        build_key,
        form,
        "k-1",
        ["folder_id", "key_type", "name", "tags", "vault_id"],
        extra = |built| {
            assert!(built.pinned);
        },
    );
}
