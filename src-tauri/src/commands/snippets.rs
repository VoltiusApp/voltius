use crate::local::session::LocalSessionManager;
use crate::ssh::session::SessionManager;
use crate::storage::config::{
    load_snippet_folders, load_snippets, save_snippet_folders, save_snippets, Snippet,
    SnippetFolder, SnippetFolderFormData, SnippetFormData,
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
pub fn snippet_list() -> Result<Vec<Snippet>, String> {
    let snippets = load_snippets();
    Ok(snippets
        .into_iter()
        .filter(|s| is_alive(&s.deleted_at, &s.updated_at))
        .collect())
}

#[tauri::command]
pub fn snippet_create(data: SnippetFormData) -> Result<Snippet, String> {
    let mut snippets = load_snippets();
    let now = Utc::now().to_rfc3339();
    let mut clocks = HashMap::new();
    for field in &[
        "name",
        "content",
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
    let vault_id = data.vault_id.unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let snippet = Snippet {
        id: Uuid::new_v4().to_string(),
        name: data.name,
        content: data.content,
        description: data.description,
        tags: data.tags,
        folder_id: data.folder_id,
        favorite: data.favorite,
        only_for_connection_tags: data.only_for_connection_tags,
        only_for_distros: data.only_for_distros,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
        vault_id,
        clocks,
    };
    snippets.push(snippet.clone());
    save_snippets(&snippets)?;
    Ok(snippet)
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
    if snippet.content != data.content {
        snippet.clocks.insert("content".to_string(), now.clone());
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
    snippet.content = data.content;
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

#[tauri::command]
pub fn snippet_folder_create(data: SnippetFolderFormData) -> Result<SnippetFolder, String> {
    let mut folders = load_snippet_folders();
    let now = Utc::now().to_rfc3339();
    let mut clocks = HashMap::new();
    for field in &["name", "parent_id", "color", "icon", "vault_id"] {
        clocks.insert(field.to_string(), now.clone());
    }
    let vault_id = data.vault_id.unwrap_or_else(|| "personal".to_string());
    check_vault_write(std::slice::from_ref(&vault_id))?;
    let folder = SnippetFolder {
        id: Uuid::new_v4().to_string(),
        name: data.name,
        parent_id: data.parent_id,
        color: data.color,
        icon: data.icon,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
        vault_id,
        clocks,
    };
    folders.push(folder.clone());
    save_snippet_folders(&folders)?;
    Ok(folder)
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

#[tauri::command]
pub fn snippet_folder_delete(id: String) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();

    // Cascade: move snippets in this folder to root (folder_id = None)
    let mut snippets = load_snippets();
    for s in snippets.iter_mut() {
        if s.folder_id.as_deref() == Some(id.as_str()) {
            s.folder_id = None;
            s.clocks.insert("folder_id".to_string(), now.clone());
            s.updated_at = max_clock(&s.clocks, &now);
        }
    }
    save_snippets(&snippets)?;

    // Soft-delete the folder
    let mut folders = load_snippet_folders();
    let folder = folders
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("SnippetFolder {} not found", id))?;
    check_vault_write(std::slice::from_ref(&folder.vault_id))?;
    folder.deleted_at = Some(now.clone());
    folder.clocks.insert("__deleted__".to_string(), now.clone());
    folder.updated_at = max_clock(&folder.clocks, &now);
    save_snippet_folders(&folders)
}
