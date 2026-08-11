#[cfg(test)]
use crate::commands::vault_object::vault_build_tests;
use crate::commands::vault_object::{
    find_mut, finish_update, impl_vault_object, initial_clocks, merge_fields, requested_vault,
    retarget_vault, vault_object_commands,
};
use crate::storage::config::{load_identities, save_identities, Identity, IdentityFormData};
use crate::vault_auth::check_vault_write;
use chrono::Utc;

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

vault_object_commands!(
    Identity,
    IdentityFormData,
    build_identity,
    load_identities,
    save_identities,
    list = identity_list,
    create = identity_save,
    adopt = identity_adopt,
    adopt_doc = "The id must survive because the identity's password is stored in the keychain \
                 under `password:<id>`.",
    delete = identity_delete,
);

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

    vault_build_tests!(
        build_identity,
        form,
        "i-1",
        [
            "folder_id",
            "key_id",
            "name",
            "tags",
            "username",
            "vault_id"
        ],
        extra = |built| {
            assert!(built.pinned);
        },
    );
}
