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

#[tauri::command]
pub fn identity_save(data: IdentityFormData) -> Result<Identity, String> {
    let mut identities = load_identities();
    let now = Utc::now().to_rfc3339();
    let mut clocks = HashMap::new();
    clocks.insert("name".to_string(), now.clone());
    clocks.insert("username".to_string(), now.clone());
    clocks.insert("key_id".to_string(), now.clone());
    clocks.insert("tags".to_string(), now.clone());
    clocks.insert("folder_id".to_string(), now.clone());
    clocks.insert("vault_id".to_string(), now.clone());
    let vault_id = data.vault_id.unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let identity = Identity {
        id: Uuid::new_v4().to_string(),
        name: data.name,
        username: data.username,
        key_id: data.key_id,
        tags: data.tags,
        created_at: now.clone(),
        folder_id: data.folder_id,
        vault_id,
        updated_at: now,
        deleted_at: None,
        pinned: data.pinned,
        clocks,
    };
    identities.push(identity.clone());
    save_identities(&identities)?;
    Ok(identity)
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
