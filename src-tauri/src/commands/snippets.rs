use crate::commands::crdt::{is_alive, max_clock};
use crate::local::session::LocalSessionManager;
use crate::ssh::session::SessionManager;
use crate::storage::config::{
    load_snippet_folders, load_snippets, save_snippet_folders, save_snippets, Snippet,
    SnippetFolder, SnippetFolderFormData, SnippetFormData,
};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

impl Snippet {
    fn steps_differs(&self, other: &[crate::storage::config::SnippetStep]) -> bool {
        serde_json::to_string(&self.steps).ok() != serde_json::to_string(other).ok()
    }
}

#[tauri::command]
pub fn snippet_list() -> Result<Vec<Snippet>, String> {
    let snippets = load_snippets();
    Ok(snippets
        .into_iter()
        .filter(|s| is_alive(&s.deleted_at, &s.updated_at))
        .collect())
}

fn build_snippet(
    id: String,
    data: SnippetFormData,
    now: &str,
    created_at: Option<String>,
) -> Snippet {
    let now = now.to_string();
    let mut clocks = HashMap::new();
    for field in &[
        "name",
        "steps",
        "description",
        "tags",
        "folder_id",
        "favorite",
        "only_for_connection_tags",
        "only_for_distros",
        "vault_id",
    ] {
        clocks.insert(field.to_string(), now.clone());
    }
    Snippet {
        id,
        name: data.name,
        content: None,
        steps: data.steps,
        description: data.description,
        tags: data.tags,
        folder_id: data.folder_id,
        favorite: data.favorite,
        only_for_connection_tags: data.only_for_connection_tags,
        only_for_distros: data.only_for_distros,
        created_at: created_at.unwrap_or_else(|| now.clone()),
        updated_at: now,
        deleted_at: None,
        vault_id: data.vault_id.unwrap_or_else(|| "personal".to_string()),
        clocks,
    }
}

#[tauri::command]
pub fn snippet_create(data: SnippetFormData) -> Result<Snippet, String> {
    let mut snippets = load_snippets();
    let now = Utc::now().to_rfc3339();
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let snippet = build_snippet(Uuid::new_v4().to_string(), data, &now, None);
    snippets.push(snippet.clone());
    save_snippets(&snippets)?;
    Ok(snippet)
}

/// Inserts a snippet under a caller-supplied `id`, replacing any local row with
/// that id. Migration-only: see `connection_adopt`. The id must survive because
/// connections reference snippets by `pre_snippet_id` / `post_snippet_id`.
#[tauri::command]
pub fn snippet_adopt(id: String, data: SnippetFormData) -> Result<Snippet, String> {
    let mut snippets = load_snippets();
    let now = Utc::now().to_rfc3339();
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let created_at = snippets
        .iter()
        .find(|s| s.id == id)
        .map(|s| s.created_at.clone());
    let adopted = build_snippet(id.clone(), data, &now, created_at);
    match snippets.iter_mut().find(|s| s.id == id) {
        Some(slot) => *slot = adopted.clone(),
        None => snippets.push(adopted.clone()),
    }
    save_snippets(&snippets)?;
    Ok(adopted)
}

#[tauri::command]
pub fn snippet_update(id: String, data: SnippetFormData) -> Result<Snippet, String> {
    let mut snippets = load_snippets();
    let snippet = snippets
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Snippet {} not found", id))?;

    let now = Utc::now().to_rfc3339();
    if snippet.name != data.name {
        snippet.clocks.insert("name".to_string(), now.clone());
    }
    if snippet.steps_differs(&data.steps) {
        snippet.clocks.insert("steps".to_string(), now.clone());
    }
    if snippet.description != data.description {
        snippet
            .clocks
            .insert("description".to_string(), now.clone());
    }
    if snippet.tags != data.tags {
        snippet.clocks.insert("tags".to_string(), now.clone());
    }
    if snippet.folder_id != data.folder_id {
        snippet.clocks.insert("folder_id".to_string(), now.clone());
    }
    if snippet.favorite != data.favorite {
        snippet.clocks.insert("favorite".to_string(), now.clone());
    }
    if snippet.only_for_connection_tags != data.only_for_connection_tags {
        snippet
            .clocks
            .insert("only_for_connection_tags".to_string(), now.clone());
    }
    if snippet.only_for_distros != data.only_for_distros {
        snippet
            .clocks
            .insert("only_for_distros".to_string(), now.clone());
    }
    if let Some(ref vid) = data.vault_id {
        if snippet.vault_id != *vid {
            snippet.clocks.insert("vault_id".to_string(), now.clone());
        }
    }
    let effective_vault = data
        .vault_id
        .as_deref()
        .unwrap_or(&snippet.vault_id)
        .to_string();
    check_vault_write(&[effective_vault])?;

    snippet.name = data.name;
    snippet.steps = data.steps;
    snippet.content = None;
    snippet.description = data.description;
    snippet.tags = data.tags;
    snippet.folder_id = data.folder_id;
    snippet.favorite = data.favorite;
    snippet.only_for_connection_tags = data.only_for_connection_tags;
    snippet.only_for_distros = data.only_for_distros;
    if let Some(vid) = data.vault_id {
        snippet.vault_id = vid;
    }
    snippet.deleted_at = None;
    snippet.updated_at = max_clock(&snippet.clocks, &now);

    let updated = snippet.clone();
    save_snippets(&snippets)?;
    Ok(updated)
}

#[tauri::command]
pub fn snippet_delete(id: String) -> Result<(), String> {
    let mut snippets = load_snippets();
    let now = Utc::now().to_rfc3339();
    let snippet = snippets
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Snippet {} not found", id))?;
    check_vault_write(std::slice::from_ref(&snippet.vault_id))?;
    snippet.deleted_at = Some(now.clone());
    snippet
        .clocks
        .insert("__deleted__".to_string(), now.clone());
    snippet.updated_at = max_clock(&snippet.clocks, &now);
    save_snippets(&snippets)
}

/// Inject text into the active terminal session.
/// Handles both SSH and local sessions. Appends \n when execute=true.
/// Multiplayer injection must be gated by the caller (frontend checks controller status).
#[tauri::command]
pub async fn snippet_inject(
    session_id: String,
    session_type: String,
    text: String,
    execute: bool,
    ssh_state: tauri::State<'_, SessionManager>,
    local_state: tauri::State<'_, LocalSessionManager>,
) -> Result<(), String> {
    let payload = if execute { format!("{text}\n") } else { text };
    let bytes = payload.into_bytes();
    match session_type.as_str() {
        "ssh" => ssh_state.send_data(&session_id, &bytes).await,
        "local" => local_state.send_data(&session_id, bytes).await,
        _ => Err(format!("Unknown session type: {session_type}")),
    }
}

// ─── Snippet folder CRUD ──────────────────────────────────────────────────────

#[tauri::command]
pub fn snippet_folder_list() -> Result<Vec<SnippetFolder>, String> {
    let folders = load_snippet_folders();
    Ok(folders
        .into_iter()
        .filter(|f| is_alive(&f.deleted_at, &f.updated_at))
        .collect())
}

fn build_snippet_folder(
    id: String,
    data: SnippetFolderFormData,
    now: &str,
    created_at: Option<String>,
) -> SnippetFolder {
    let now = now.to_string();
    let mut clocks = HashMap::new();
    for field in &["name", "parent_id", "color", "icon", "vault_id"] {
        clocks.insert(field.to_string(), now.clone());
    }
    SnippetFolder {
        id,
        name: data.name,
        parent_id: data.parent_id,
        color: data.color,
        icon: data.icon,
        created_at: created_at.unwrap_or_else(|| now.clone()),
        updated_at: now,
        deleted_at: None,
        vault_id: data.vault_id.unwrap_or_else(|| "personal".to_string()),
        clocks,
    }
}

#[tauri::command]
pub fn snippet_folder_create(data: SnippetFolderFormData) -> Result<SnippetFolder, String> {
    let mut folders = load_snippet_folders();
    let now = Utc::now().to_rfc3339();
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let folder = build_snippet_folder(Uuid::new_v4().to_string(), data, &now, None);
    folders.push(folder.clone());
    save_snippet_folders(&folders)?;
    Ok(folder)
}

/// Inserts a snippet folder under a caller-supplied `id`, replacing any local row
/// with that id. Migration-only: see `connection_adopt`. The id must survive
/// because snippets reference their folder by `folder_id`.
#[tauri::command]
pub fn snippet_folder_adopt(
    id: String,
    data: SnippetFolderFormData,
) -> Result<SnippetFolder, String> {
    let mut folders = load_snippet_folders();
    let now = Utc::now().to_rfc3339();
    let vault_id = data
        .vault_id
        .clone()
        .unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let created_at = folders
        .iter()
        .find(|f| f.id == id)
        .map(|f| f.created_at.clone());
    let adopted = build_snippet_folder(id.clone(), data, &now, created_at);
    match folders.iter_mut().find(|f| f.id == id) {
        Some(slot) => *slot = adopted.clone(),
        None => folders.push(adopted.clone()),
    }
    save_snippet_folders(&folders)?;
    Ok(adopted)
}

#[tauri::command]
pub fn snippet_folder_update(
    id: String,
    data: SnippetFolderFormData,
) -> Result<SnippetFolder, String> {
    let mut folders = load_snippet_folders();
    let folder = folders
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("SnippetFolder {} not found", id))?;

    let now = Utc::now().to_rfc3339();
    if folder.name != data.name {
        folder.clocks.insert("name".to_string(), now.clone());
    }
    if folder.parent_id != data.parent_id {
        folder.clocks.insert("parent_id".to_string(), now.clone());
    }
    if folder.color != data.color {
        folder.clocks.insert("color".to_string(), now.clone());
    }
    if folder.icon != data.icon {
        folder.clocks.insert("icon".to_string(), now.clone());
    }

    folder.name = data.name;
    folder.parent_id = data.parent_id;
    folder.color = data.color;
    folder.icon = data.icon;
    folder.deleted_at = None;
    folder.updated_at = max_clock(&folder.clocks, &now);

    let updated = folder.clone();
    save_snippet_folders(&folders)?;
    Ok(updated)
}

/// Ids of `root` plus every live snippet folder beneath it, following parent links.
fn snippet_folder_subtree_ids(folders: &[SnippetFolder], root: &str) -> HashSet<String> {
    let mut ids = HashSet::new();
    ids.insert(root.to_string());
    // Folder nesting is shallow, so repeated sweeps are cheaper than building an index.
    loop {
        let before = ids.len();
        for f in folders {
            if !is_alive(&f.deleted_at, &f.updated_at) {
                continue;
            }
            if let Some(parent) = &f.parent_id {
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

/// Soft-delete a snippet folder, everything nested under it, and every snippet
/// filed in that subtree.
#[tauri::command]
pub fn snippet_folder_delete(id: String) -> Result<(), String> {
    let mut folders = load_snippet_folders();
    if !folders.iter().any(|f| f.id == id) {
        return Err(format!("SnippetFolder {} not found", id));
    }
    let now = Utc::now().to_rfc3339();
    let doomed = snippet_folder_subtree_ids(&folders, &id);

    let mut snippets = load_snippets();
    let in_tree =
        |folder_id: &Option<String>| folder_id.as_deref().is_some_and(|f| doomed.contains(f));

    // Every vault touched by the cascade must be writable before anything is written.
    let mut vaults: HashSet<String> = folders
        .iter()
        .filter(|f| doomed.contains(&f.id))
        .map(|f| f.vault_id.clone())
        .collect();
    vaults.extend(
        snippets
            .iter()
            .filter(|s| in_tree(&s.folder_id))
            .map(|s| s.vault_id.clone()),
    );
    check_vault_write(&vaults.into_iter().collect::<Vec<_>>())?;

    // Saving is a whole-file rewrite, so skip it when the folder held nothing.
    let mut touched = 0;
    for s in snippets.iter_mut().filter(|s| in_tree(&s.folder_id)) {
        s.deleted_at = Some(now.clone());
        s.clocks.insert("__deleted__".to_string(), now.clone());
        s.updated_at = max_clock(&s.clocks, &now);
        touched += 1;
    }
    if touched > 0 {
        save_snippets(&snippets)?;
    }

    for f in folders.iter_mut().filter(|f| doomed.contains(&f.id)) {
        f.deleted_at = Some(now.clone());
        f.clocks.insert("__deleted__".to_string(), now.clone());
        f.updated_at = max_clock(&f.clocks, &now);
    }
    save_snippet_folders(&folders)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, parent: Option<&str>) -> SnippetFolder {
        SnippetFolder {
            id: id.to_string(),
            name: id.to_string(),
            parent_id: parent.map(|p| p.to_string()),
            color: None,
            icon: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            deleted_at: None,
            vault_id: "personal".to_string(),
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
        let ids = snippet_folder_subtree_ids(&folders, "root");
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
        let ids = snippet_folder_subtree_ids(&folders, "root");
        assert_eq!(ids, HashSet::from(["root".to_string()]));
    }

    #[test]
    fn subtree_terminates_on_a_parent_cycle() {
        let folders = vec![folder("a", Some("b")), folder("b", Some("a"))];
        let ids = snippet_folder_subtree_ids(&folders, "a");
        assert_eq!(ids, HashSet::from(["a".to_string(), "b".to_string()]));
    }
}
