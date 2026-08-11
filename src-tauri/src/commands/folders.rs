use crate::commands::vault_object::{
    adopt_into, bump, cascade_tombstone, created_at_of, effective_vault, find_mut, finish_update,
    impl_vault_object, initial_clocks, live, merge_fields, refile_into_folder, requested_vault,
    subtree_ids, tombstone, vaults_of,
};
use crate::storage::config::{
    load_connections, load_folders, load_identities, load_keys, load_port_forwarding_rules,
    save_connections, save_folders, save_identities, save_keys, save_port_forwarding_rules, Folder,
    FolderFormData,
};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use std::collections::HashSet;
use uuid::Uuid;

impl_vault_object!(Folder, "Folder");

/// The fields whose edits are stamped and synced.
const CLOCK_FIELDS: &[&str] = &["name", "parent_folder_id", "object_type", "vault_id"];

#[tauri::command]
pub fn folder_list() -> Result<Vec<Folder>, String> {
    Ok(live(load_folders()))
}

fn build_folder(id: String, data: FolderFormData, now: &str, created_at: Option<String>) -> Folder {
    Folder {
        id,
        name: data.name,
        parent_folder_id: data.parent_folder_id,
        object_type: data.object_type,
        vault_id: requested_vault(&data.vault_id)[0].clone(),
        pinned: data.pinned,
        created_at: created_at.unwrap_or_else(|| now.to_string()),
        updated_at: now.to_string(),
        deleted_at: None,
        clocks: initial_clocks(CLOCK_FIELDS, now),
    }
}

#[tauri::command]
pub fn folder_save(data: FolderFormData) -> Result<Folder, String> {
    check_vault_write(&requested_vault(&data.vault_id))?;
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
    check_vault_write(&requested_vault(&data.vault_id))?;
    let mut folders = load_folders();
    let now = Utc::now().to_rfc3339();
    let created_at = created_at_of(&folders, &id);
    let adopted = build_folder(id, data, &now, created_at);
    adopt_into(&mut folders, adopted.clone());
    save_folders(&folders)?;
    Ok(adopted)
}

/// Unlike the sibling entities, a folder stamps `pinned` — it is a synced field
/// here — and authorizes the destination vault before stamping anything.
#[tauri::command]
pub fn folder_update(id: String, data: FolderFormData) -> Result<Folder, String> {
    let mut folders = load_folders();
    let folder = find_mut(&mut folders, &id)?;
    let effective = effective_vault(&data.vault_id, &folder.vault_id);
    check_vault_write(std::slice::from_ref(&effective))?;
    let now = Utc::now().to_rfc3339();
    bump(
        &mut folder.clocks,
        "vault_id",
        folder.vault_id != effective,
        &now,
    );
    folder.vault_id = effective;
    merge_fields!(folder, data, &now, name, parent_folder_id, pinned);
    finish_update(folder, &now);
    let updated = folder.clone();
    save_folders(&folders)?;
    Ok(updated)
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
        subtree_ids(&folders, &id, |f| f.parent_folder_id.as_deref())
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
    let mut vaults = vaults_of(&folders, |f| doomed.contains(&f.id));
    vaults.extend(vaults_of(&connections, |c| in_tree(&c.folder_id)));
    vaults.extend(vaults_of(&identities, |i| in_tree(&i.folder_id)));
    vaults.extend(vaults_of(&keys, |k| in_tree(&k.folder_id)));
    vaults.extend(vaults_of(&rules, |r| in_tree(&r.folder_id)));
    check_vault_write(&vaults.into_iter().collect::<Vec<_>>())?;

    // Each save is a whole-file rewrite, so skip the untouched types entirely.
    if cascade_tombstone(&mut connections, |c| in_tree(&c.folder_id), &now) > 0 {
        save_connections(&connections)?;
    }
    if cascade_tombstone(&mut identities, |i| in_tree(&i.folder_id), &now) > 0 {
        save_identities(&identities)?;
    }
    if cascade_tombstone(&mut keys, |k| in_tree(&k.folder_id), &now) > 0 {
        save_keys(&keys)?;
    }
    if cascade_tombstone(&mut rules, |r| in_tree(&r.folder_id), &now) > 0 {
        save_port_forwarding_rules(&rules)?;
    }

    for f in folders.iter_mut().filter(|f| doomed.contains(&f.id)) {
        tombstone(f, &now);
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
            let mut items = load_connections();
            refile_into_folder(&mut items, &object_ids, &folder_id, &now, |c| {
                &mut c.folder_id
            })?;
            save_connections(&items)
        }
        "identity" => {
            let mut items = load_identities();
            refile_into_folder(&mut items, &object_ids, &folder_id, &now, |i| {
                &mut i.folder_id
            })?;
            save_identities(&items)
        }
        "key" => {
            let mut items = load_keys();
            refile_into_folder(&mut items, &object_ids, &folder_id, &now, |k| {
                &mut k.folder_id
            })?;
            save_keys(&items)
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
            clocks: std::collections::HashMap::new(),
        }
    }

    fn folder_form() -> FolderFormData {
        FolderFormData {
            name: "f".into(),
            parent_folder_id: Some("root".into()),
            object_type: "connection".into(),
            vault_id: None,
            pinned: Some(true),
        }
    }

    #[test]
    fn build_folder_stamps_every_synced_field_at_now() {
        let built = build_folder("f-1".into(), folder_form(), "2026-01-01T00:00:00Z", None);
        let mut fields: Vec<&str> = built.clocks.keys().map(String::as_str).collect();
        fields.sort();
        assert_eq!(
            fields,
            ["name", "object_type", "parent_folder_id", "vault_id"]
        );
        assert!(built.clocks.values().all(|v| v == "2026-01-01T00:00:00Z"));
        // `pinned` is deliberately unstamped: it is not a synced field.
        assert_eq!(built.pinned, Some(true));
    }

    #[test]
    fn build_folder_defaults_an_absent_vault_to_personal() {
        let built = build_folder("f-1".into(), folder_form(), "2026-01-01T00:00:00Z", None);
        assert_eq!(built.vault_id, "personal");
        assert_eq!(built.deleted_at, None);
        assert_eq!(built.updated_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn build_folder_keeps_an_explicit_vault_and_carried_created_at() {
        let mut data = folder_form();
        data.vault_id = Some("team-a".into());
        let built = build_folder(
            "f-1".into(),
            data,
            "2026-02-01T00:00:00Z",
            Some("2020-01-01T00:00:00Z".into()),
        );
        assert_eq!(built.vault_id, "team-a");
        assert_eq!(built.created_at, "2020-01-01T00:00:00Z");
    }

    #[test]
    fn an_omitted_vault_id_keeps_the_folder_where_it_is() {
        assert_eq!(effective_vault(&None, "team-abc"), "team-abc");
    }

    #[test]
    fn an_explicit_vault_id_moves_the_folder() {
        assert_eq!(
            effective_vault(&Some("personal".to_string()), "team-abc"),
            "personal"
        );
    }

    #[test]
    fn subtree_collects_nested_descendants() {
        let folders = vec![
            folder("root", None),
            folder("child", Some("root")),
            folder("grandchild", Some("child")),
            folder("sibling", None),
        ];
        let ids = subtree_ids(&folders, "root", |f| f.parent_folder_id.as_deref());
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
        let ids = subtree_ids(&folders, "root", |f| f.parent_folder_id.as_deref());
        assert_eq!(ids, HashSet::from(["root".to_string()]));
    }

    #[test]
    fn subtree_terminates_on_a_parent_cycle() {
        let folders = vec![folder("a", Some("b")), folder("b", Some("a"))];
        let ids = subtree_ids(&folders, "a", |f| f.parent_folder_id.as_deref());
        assert_eq!(ids, HashSet::from(["a".to_string(), "b".to_string()]));
    }
}
