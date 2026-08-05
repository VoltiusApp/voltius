use crate::storage::config::{
    load_connections, load_folders, load_identities, load_keys, load_port_forwarding_rules,
    save_connections, save_folders, save_identities, save_keys, save_port_forwarding_rules, Folder,
    FolderFormData,
};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use std::collections::{HashMap, HashSet};
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

fn build_folder(id: String, data: FolderFormData, now: &str, created_at: Option<String>) -> Folder {
    let now = now.to_string();
    let mut clocks = HashMap::new();
    for field in &["name", "parent_folder_id", "object_type", "vault_id"] {
        clocks.insert((*field).to_string(), now.clone());
    }
    Folder {
        id,
        name: data.name,
        parent_folder_id: data.parent_folder_id,
        object_type: data.object_type,
        vault_id: data.vault_id.unwrap_or_else(|| "personal".to_string()),
        pinned: data.pinned,
        created_at: created_at.unwrap_or_else(|| now.clone()),
        updated_at: now,
        deleted_at: None,
        clocks,
    }
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
    let folder = build_folder(Uuid::new_v4().to_string(), data, &now, None);
    folders.push(folder.clone());
    save_folders(&folders)?;
    Ok(folder)
}

/// Inserts a folder under a caller-supplied `id`, replacing any local row with
/// that id. Migration-only: see `connection_adopt`. The id must survive because
/// every object filed in the folder references it by `folder_id`.
#[tauri::command]
pub fn folder_adopt(id: String, data: FolderFormData) -> Result<Folder, String> {
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(&[vault_id])?;
    let mut folders = load_folders();
    let now = Utc::now().to_rfc3339();
    let created_at = folders
        .iter()
        .find(|f| f.id == id)
        .map(|f| f.created_at.clone());
    let adopted = build_folder(id.clone(), data, &now, created_at);
    match folders.iter_mut().find(|f| f.id == id) {
        Some(slot) => *slot = adopted.clone(),
        None => folders.push(adopted.clone()),
    }
    save_folders(&folders)?;
    Ok(adopted)
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

/// Ids of `root` plus every live folder beneath it, following parent links.
fn folder_subtree_ids(folders: &[Folder], root: &str) -> HashSet<String> {
    let mut ids = HashSet::new();
    ids.insert(root.to_string());
    // Folder nesting is shallow, so repeated sweeps are cheaper than building an index.
    loop {
        let before = ids.len();
        for f in folders {
            if !is_alive(&f.deleted_at, &f.updated_at) {
                continue;
            }
            if let Some(parent) = &f.parent_folder_id {
                if ids.contains(parent) {
                    ids.insert(f.id.clone());
                }
            }
        }
        if ids.len() == before {
            return ids;
        }
    }
}

fn tombstone(deleted_at: &mut Option<String>, clocks: &mut HashMap<String, String>, now: &str) {
    *deleted_at = Some(now.to_string());
    clocks.insert("__deleted__".to_string(), now.to_string());
}

/// Soft-delete a folder, everything nested under it, and every item filed in
/// that subtree (connections, identities, keys, port-forwarding rules).
///
/// `cascade: Some(false)` tombstones only this folder, leaving its contents at
/// the top level. That is what undoing a folder *creation* needs: it must not
/// destroy items the user filed in the folder after creating it.
#[tauri::command]
pub fn folder_delete(id: String, cascade: Option<bool>) -> Result<(), String> {
    let mut folders = load_folders();
    if !folders.iter().any(|f| f.id == id) {
        return Err(format!("Folder {} not found", id));
    }
    let now = Utc::now().to_rfc3339();
    let cascading = cascade.unwrap_or(true);
    let doomed = if cascading {
        folder_subtree_ids(&folders, &id)
    } else {
        HashSet::from([id.clone()])
    };

    let mut connections = load_connections();
    let mut identities = load_identities();
    let mut keys = load_keys();
    let mut rules = load_port_forwarding_rules();

    let in_tree = |folder_id: &Option<String>| {
        cascading && folder_id.as_deref().is_some_and(|f| doomed.contains(f))
    };

    // Every vault touched by the cascade must be writable before anything is written.
    let mut vaults: HashSet<String> = folders
        .iter()
        .filter(|f| doomed.contains(&f.id))
        .map(|f| f.vault_id.clone())
        .collect();
    vaults.extend(
        connections
            .iter()
            .filter(|c| in_tree(&c.folder_id))
            .map(|c| c.vault_id.clone()),
    );
    vaults.extend(
        identities
            .iter()
            .filter(|i| in_tree(&i.folder_id))
            .map(|i| i.vault_id.clone()),
    );
    vaults.extend(
        keys.iter()
            .filter(|k| in_tree(&k.folder_id))
            .map(|k| k.vault_id.clone()),
    );
    vaults.extend(
        rules
            .iter()
            .filter(|r| in_tree(&r.folder_id))
            .map(|r| r.vault_id.clone()),
    );
    check_vault_write(&vaults.into_iter().collect::<Vec<_>>())?;

    // Each save is a whole-file rewrite, so skip the untouched types entirely.
    let mut touched = 0;
    for c in connections.iter_mut().filter(|c| in_tree(&c.folder_id)) {
        tombstone(&mut c.deleted_at, &mut c.clocks, &now);
        c.updated_at = max_clock(&c.clocks, &now);
        touched += 1;
    }
    if touched > 0 {
        save_connections(&connections)?;
    }

    touched = 0;
    for i in identities.iter_mut().filter(|i| in_tree(&i.folder_id)) {
        tombstone(&mut i.deleted_at, &mut i.clocks, &now);
        i.updated_at = max_clock(&i.clocks, &now);
        touched += 1;
    }
    if touched > 0 {
        save_identities(&identities)?;
    }

    touched = 0;
    for k in keys.iter_mut().filter(|k| in_tree(&k.folder_id)) {
        tombstone(&mut k.deleted_at, &mut k.clocks, &now);
        k.updated_at = max_clock(&k.clocks, &now);
        touched += 1;
    }
    if touched > 0 {
        save_keys(&keys)?;
    }

    touched = 0;
    for r in rules.iter_mut().filter(|r| in_tree(&r.folder_id)) {
        tombstone(&mut r.deleted_at, &mut r.clocks, &now);
        r.updated_at = max_clock(&r.clocks, &now);
        touched += 1;
    }
    if touched > 0 {
        save_port_forwarding_rules(&rules)?;
    }

    for f in folders.iter_mut().filter(|f| doomed.contains(&f.id)) {
        tombstone(&mut f.deleted_at, &mut f.clocks, &now);
        f.updated_at = max_clock(&f.clocks, &now);
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, parent: Option<&str>) -> Folder {
        Folder {
            id: id.to_string(),
            name: id.to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            parent_folder_id: parent.map(|p| p.to_string()),
            object_type: "connection".to_string(),
            vault_id: "personal".to_string(),
            pinned: None,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            deleted_at: None,
            clocks: HashMap::new(),
        }
    }

    #[test]
    fn subtree_collects_nested_descendants() {
        let folders = vec![
            folder("root", None),
            folder("child", Some("root")),
            folder("grandchild", Some("child")),
            folder("sibling", None),
        ];
        let ids = folder_subtree_ids(&folders, "root");
        assert_eq!(ids.len(), 3);
        assert!(ids.contains("root") && ids.contains("child") && ids.contains("grandchild"));
        assert!(!ids.contains("sibling"));
    }

    #[test]
    fn subtree_skips_already_deleted_folders() {
        let mut deleted = folder("child", Some("root"));
        deleted.deleted_at = Some("2026-02-01T00:00:00Z".to_string());
        let folders = vec![
            folder("root", None),
            deleted,
            folder("grandchild", Some("child")),
        ];
        let ids = folder_subtree_ids(&folders, "root");
        assert_eq!(ids, HashSet::from(["root".to_string()]));
    }

    #[test]
    fn subtree_terminates_on_a_parent_cycle() {
        let folders = vec![folder("a", Some("b")), folder("b", Some("a"))];
        let ids = folder_subtree_ids(&folders, "a");
        assert_eq!(ids, HashSet::from(["a".to_string(), "b".to_string()]));
    }
}
