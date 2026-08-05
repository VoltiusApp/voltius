use crate::storage::config::{load_identities, save_identities, Identity, IdentityFormData};
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
pub fn identity_list() -> Result<Vec<Identity>, String> {
    let identities = load_identities();
    Ok(identities
        .into_iter()
        .filter(|i| is_alive(&i.deleted_at, &i.updated_at))
        .collect())
}

fn build_identity(
    id: String,
    data: IdentityFormData,
    now: &str,
    created_at: Option<String>,
) -> Identity {
    let now = now.to_string();
    let mut clocks = HashMap::new();
    for field in &[
        "name",
        "username",
        "key_id",
        "tags",
        "folder_id",
        "vault_id",
    ] {
        clocks.insert((*field).to_string(), now.clone());
    }
    Identity {
        id,
        name: data.name,
        username: data.username,
        key_id: data.key_id,
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
pub fn identity_save(data: IdentityFormData) -> Result<Identity, String> {
    let mut identities = load_identities();
    let now = Utc::now().to_rfc3339();
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
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
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let created_at = identities
        .iter()
        .find(|i| i.id == id)
        .map(|i| i.created_at.clone());
    let adopted = build_identity(id.clone(), data, &now, created_at);
    match identities.iter_mut().find(|i| i.id == id) {
        Some(slot) => *slot = adopted.clone(),
        None => identities.push(adopted.clone()),
    }
    save_identities(&identities)?;
    Ok(adopted)
}

#[tauri::command]
pub fn identity_update(id: String, data: IdentityFormData) -> Result<Identity, String> {
    let mut identities = load_identities();
    let identity = identities
        .iter_mut()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("Identity {} not found", id))?;
    let now = Utc::now().to_rfc3339();
    if identity.name != data.name {
        identity.clocks.insert("name".to_string(), now.clone());
    }
    if identity.username != data.username {
        identity.clocks.insert("username".to_string(), now.clone());
    }
    if identity.key_id != data.key_id {
        identity.clocks.insert("key_id".to_string(), now.clone());
    }
    if identity.tags != data.tags {
        identity.clocks.insert("tags".to_string(), now.clone());
    }
    if identity.folder_id != data.folder_id {
        identity.clocks.insert("folder_id".to_string(), now.clone());
    }

    let effective_vault = data
        .vault_id
        .as_deref()
        .unwrap_or(&identity.vault_id)
        .to_string();
    if let Some(ref vid) = data.vault_id {
        if identity.vault_id != *vid {
            identity.clocks.insert("vault_id".to_string(), now.clone());
        }
    }
    check_vault_write(&[effective_vault])?;

    identity.name = data.name;
    identity.username = data.username;
    identity.key_id = data.key_id;
    identity.tags = data.tags;
    identity.folder_id = data.folder_id;
    identity.pinned = data.pinned;
    if let Some(vid) = data.vault_id {
        identity.vault_id = vid;
    }
    identity.deleted_at = None;
    identity.updated_at = max_clock(&identity.clocks, &now);
    let updated = identity.clone();
    save_identities(&identities)?;
    Ok(updated)
}

#[tauri::command]
pub fn identity_delete(id: String) -> Result<(), String> {
    let mut identities = load_identities();
    let now = Utc::now().to_rfc3339();
    let identity = identities
        .iter_mut()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("Identity {} not found", id))?;
    check_vault_write(std::slice::from_ref(&identity.vault_id))?;
    identity.deleted_at = Some(now.clone());
    identity
        .clocks
        .insert("__deleted__".to_string(), now.clone());
    identity.updated_at = max_clock(&identity.clocks, &now);
    save_identities(&identities)
}
