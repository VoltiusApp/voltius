use crate::storage::config::{
    load_connections, load_folders, load_identities, load_keys, save_connections, save_folders,
    save_identities, save_keys, Folder, FolderFormData,
};
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
pub fn folder_list() -> Result<Vec<Folder>, String> {
    let folders = load_folders();
    Ok(folders
        .into_iter()
        .filter(|f| is_alive(&f.deleted_at, &f.updated_at))
        .collect())
}

#[tauri::command]
pub fn folder_save(data: FolderFormData) -> Result<Folder, String> {
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(&[vault_id])?;
    let mut folders = load_folders();
    let now = Utc::now().to_rfc3339();
    let mut clocks = HashMap::new();
    clocks.insert("name".to_string(), now.clone());
    clocks.insert("parent_folder_id".to_string(), now.clone());
    clocks.insert("object_type".to_string(), now.clone());
    clocks.insert("vault_id".to_string(), now.clone());
    let folder = Folder {
        id: Uuid::new_v4().to_string(),
        name: data.name,
        parent_folder_id: data.parent_folder_id,
        object_type: data.object_type,
        vault_id: data.vault_id.unwrap_or_else(|| "personal".to_string()),
        pinned: data.pinned,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
        clocks,
    };
    folders.push(folder.clone());
    save_folders(&folders)?;
    Ok(folder)
}

#[tauri::command]
pub fn folder_update(id: String, data: FolderFormData) -> Result<Folder, String> {
    let mut folders = load_folders();
    let folder = folders
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("Folder {} not found", id))?;
    // Effective vault: new one if provided (vault move), otherwise keep existing
    let effective = data
        .vault_id
        .as_deref()
        .unwrap_or(&folder.vault_id)
        .to_string();
    check_vault_write(&[effective])?;
    let now = Utc::now().to_rfc3339();
    if folder.name != data.name {
        folder.clocks.insert("name".to_string(), now.clone());
    }
    if folder.parent_folder_id != data.parent_folder_id {
        folder
            .clocks
            .insert("parent_folder_id".to_string(), now.clone());
    }
    let new_vault_id = data.vault_id.unwrap_or_else(|| "personal".to_string());
    if folder.vault_id != new_vault_id {
        folder.clocks.insert("vault_id".to_string(), now.clone());
    }
    if folder.pinned != data.pinned {
        folder.clocks.insert("pinned".to_string(), now.clone());
    }
    folder.name = data.name;
    folder.parent_folder_id = data.parent_folder_id;
    folder.vault_id = new_vault_id;
    folder.pinned = data.pinned;
    folder.deleted_at = None;
    folder.updated_at = max_clock(&folder.clocks, &now);
    let updated = folder.clone();
    save_folders(&folders)?;
    Ok(updated)
}

/// Soft-delete: mark as deleted without cascading.
/// Child folders keep their parent_folder_id; items keep their folder_id.
/// The UI treats a missing/tombstoned folder_id as "top level".
#[tauri::command]
pub fn folder_delete(id: String) -> Result<(), String> {
    let mut folders = load_folders();
    let now = Utc::now().to_rfc3339();
    let folder = folders
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("Folder {} not found", id))?;
    check_vault_write(std::slice::from_ref(&folder.vault_id))?;
    folder.deleted_at = Some(now.clone());
    folder.clocks.insert("__deleted__".to_string(), now.clone());
    folder.updated_at = max_clock(&folder.clocks, &now);
    save_folders(&folders)
}

/// Move objects of a given type into a folder (or remove from folder if folder_id is null).
/// object_type: "connection" | "identity" | "key"
#[tauri::command]
pub fn folder_move_objects(
    object_ids: Vec<String>,
    object_type: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    match object_type.as_str() {
        "connection" => {
            let mut connections = load_connections();
            let affected: Vec<_> = connections
                .iter()
                .filter(|c| object_ids.contains(&c.id))
                .collect();
            let vaults: Vec<String> = affected
                .iter()
                .map(|c| c.vault_id.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            check_vault_write(&vaults)?;
            for c in connections.iter_mut() {
                if object_ids.contains(&c.id) {
                    c.folder_id = folder_id.clone();
                    c.clocks.insert("folder_id".to_string(), now.clone());
                    c.updated_at = max_clock(&c.clocks, &now);
                }
            }
            save_connections(&connections)
        }
        "identity" => {
            let mut identities = load_identities();
            let affected: Vec<_> = identities
                .iter()
                .filter(|i| object_ids.contains(&i.id))
                .collect();
            let vaults: Vec<String> = affected
                .iter()
                .map(|i| i.vault_id.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            check_vault_write(&vaults)?;
            for i in identities.iter_mut() {
                if object_ids.contains(&i.id) {
                    i.folder_id = folder_id.clone();
                    i.clocks.insert("folder_id".to_string(), now.clone());
                    i.updated_at = max_clock(&i.clocks, &now);
                }
            }
            save_identities(&identities)
        }
        "key" => {
            let mut keys = load_keys();
            let affected: Vec<_> = keys.iter().filter(|k| object_ids.contains(&k.id)).collect();
            let vaults: Vec<String> = affected
                .iter()
                .map(|k| k.vault_id.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            check_vault_write(&vaults)?;
            for k in keys.iter_mut() {
                if object_ids.contains(&k.id) {
                    k.folder_id = folder_id.clone();
                    k.clocks.insert("folder_id".to_string(), now.clone());
                    k.updated_at = max_clock(&k.clocks, &now);
                }
            }
            save_keys(&keys)
        }
        _ => Err(format!("Unknown object type: {}", object_type)),
    }
}
