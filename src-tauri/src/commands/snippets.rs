use crate::commands::vault_object::{
    bump, find_mut, finish_update, impl_vault_object, initial_clocks, merge_fields,
    requested_vault, retarget_vault, subtree_ids, tombstone, vault_object_commands,
};
use crate::local::session::LocalSessionManager;
use crate::ssh::session::SessionManager;
use crate::storage::config::{
    load_snippet_folders, load_snippets, save_snippet_folders, save_snippets, Snippet,
    SnippetFolder, SnippetFolderFormData, SnippetFormData,
};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use std::collections::HashSet;

impl_vault_object!(Snippet, "Snippet");
impl_vault_object!(SnippetFolder, "SnippetFolder");

impl Snippet {
    fn steps_differs(&self, other: &[crate::storage::config::SnippetStep]) -> bool {
        serde_json::to_string(&self.steps).ok() != serde_json::to_string(other).ok()
    }
}

/// The fields whose edits are stamped and synced.
const CLOCK_FIELDS: &[&str] = &[
    "name",
    "steps",
    "description",
    "tags",
    "folder_id",
    "favorite",
    "only_for_connection_tags",
    "only_for_distros",
    "vault_id",
];

const FOLDER_CLOCK_FIELDS: &[&str] = &["name", "parent_id", "color", "icon", "vault_id"];

vault_object_commands!(
    Snippet,
    SnippetFormData,
    build_snippet,
    load_snippets,
    save_snippets,
    list = snippet_list,
    create = snippet_create,
    adopt = snippet_adopt,
    adopt_doc = "The id must survive because connections reference snippets by \
                 `pre_snippet_id` / `post_snippet_id`.",
    delete = snippet_delete,
);

fn build_snippet(
    id: String,
    data: SnippetFormData,
    now: &str,
    created_at: Option<String>,
) -> Snippet {
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
        created_at: created_at.unwrap_or_else(|| now.to_string()),
        updated_at: now.to_string(),
        deleted_at: None,
        vault_id: requested_vault(&data.vault_id)[0].clone(),
        clocks: initial_clocks(CLOCK_FIELDS, now),
    }
}

#[tauri::command]
pub fn snippet_update(id: String, data: SnippetFormData) -> Result<Snippet, String> {
    let mut snippets = load_snippets();
    let snippet = find_mut(&mut snippets, &id)?;
    let now = Utc::now().to_rfc3339();
    let effective = retarget_vault(snippet, &data.vault_id, &now);
    check_vault_write(std::slice::from_ref(&effective))?;

    // steps compare by serialized form, not by PartialEq, so it stays spelled out.
    let steps_changed = snippet.steps_differs(&data.steps);
    bump(&mut snippet.clocks, "steps", steps_changed, &now);
    snippet.steps = data.steps;
    snippet.content = None;

    merge_fields!(
        snippet,
        data,
        &now,
        name,
        description,
        tags,
        folder_id,
        favorite,
        only_for_connection_tags,
        only_for_distros,
    );
    snippet.vault_id = effective;
    finish_update(snippet, &now);
    let updated = snippet.clone();
    save_snippets(&snippets)?;
    Ok(updated)
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

vault_object_commands!(
    SnippetFolder,
    SnippetFolderFormData,
    build_snippet_folder,
    load_snippet_folders,
    save_snippet_folders,
    list = snippet_folder_list,
    create = snippet_folder_create,
    adopt = snippet_folder_adopt,
    adopt_doc = "The id must survive because snippets reference their folder by `folder_id`.",
);

fn build_snippet_folder(
    id: String,
    data: SnippetFolderFormData,
    now: &str,
    created_at: Option<String>,
) -> SnippetFolder {
    SnippetFolder {
        id,
        name: data.name,
        parent_id: data.parent_id,
        color: data.color,
        icon: data.icon,
        created_at: created_at.unwrap_or_else(|| now.to_string()),
        updated_at: now.to_string(),
        deleted_at: None,
        vault_id: requested_vault(&data.vault_id)[0].clone(),
        clocks: initial_clocks(FOLDER_CLOCK_FIELDS, now),
    }
}

/// Unlike every sibling update, this one neither retargets nor authorizes the
/// vault: a snippet folder is only ever renamed or reparented in place.
#[tauri::command]
pub fn snippet_folder_update(
    id: String,
    data: SnippetFolderFormData,
) -> Result<SnippetFolder, String> {
    let mut folders = load_snippet_folders();
    let folder = find_mut(&mut folders, &id)?;
    let now = Utc::now().to_rfc3339();
    merge_fields!(folder, data, &now, name, parent_id, color, icon);
    finish_update(folder, &now);
    let updated = folder.clone();
    save_snippet_folders(&folders)?;
    Ok(updated)
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
    let doomed = subtree_ids(&folders, &id, |f| f.parent_id.as_deref());

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
        tombstone(s, &now);
        touched += 1;
    }
    if touched > 0 {
        save_snippets(&snippets)?;
    }

    for f in folders.iter_mut().filter(|f| doomed.contains(&f.id)) {
        tombstone(f, &now);
    }
    save_snippet_folders(&folders)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::storage::config::SnippetStep;

    fn snippet_form() -> SnippetFormData {
        SnippetFormData {
            name: "s".into(),
            steps: vec![SnippetStep::Script {
                content: "echo hi".into(),
            }],
            description: Some("d".into()),
            tags: vec!["a".into()],
            folder_id: Some("folder-1".into()),
            favorite: true,
            only_for_connection_tags: vec!["t".into()],
            only_for_distros: vec!["ubuntu".into()],
            vault_id: None,
        }
    }

    fn snippet_folder_form() -> SnippetFolderFormData {
        SnippetFolderFormData {
            name: "f".into(),
            parent_id: Some("root".into()),
            color: Some("#fff".into()),
            icon: Some("folder".into()),
            vault_id: None,
        }
    }

    #[test]
    fn build_snippet_stamps_every_synced_field_at_now() {
        let built = build_snippet("s-1".into(), snippet_form(), "2026-01-01T00:00:00Z", None);
        let mut fields: Vec<&str> = built.clocks.keys().map(String::as_str).collect();
        fields.sort();
        assert_eq!(
            fields,
            [
                "description",
                "favorite",
                "folder_id",
                "name",
                "only_for_connection_tags",
                "only_for_distros",
                "steps",
                "tags",
                "vault_id",
            ]
        );
        assert!(built.clocks.values().all(|v| v == "2026-01-01T00:00:00Z"));
    }

    #[test]
    fn build_snippet_defaults_an_absent_vault_to_personal_and_clears_legacy_content() {
        let built = build_snippet("s-1".into(), snippet_form(), "2026-01-01T00:00:00Z", None);
        assert_eq!(built.vault_id, "personal");
        assert_eq!(built.content, None);
        assert_eq!(built.deleted_at, None);
        assert_eq!(built.updated_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn build_snippet_carries_a_supplied_created_at_and_otherwise_uses_now() {
        let carried = build_snippet(
            "s-1".into(),
            snippet_form(),
            "2026-02-01T00:00:00Z",
            Some("2020-01-01T00:00:00Z".into()),
        );
        assert_eq!(carried.created_at, "2020-01-01T00:00:00Z");
        let fresh = build_snippet("s-1".into(), snippet_form(), "2026-02-01T00:00:00Z", None);
        assert_eq!(fresh.created_at, "2026-02-01T00:00:00Z");
    }

    #[test]
    fn build_snippet_folder_stamps_every_synced_field_at_now() {
        let built = build_snippet_folder(
            "sf-1".into(),
            snippet_folder_form(),
            "2026-01-01T00:00:00Z",
            None,
        );
        let mut fields: Vec<&str> = built.clocks.keys().map(String::as_str).collect();
        fields.sort();
        assert_eq!(fields, ["color", "icon", "name", "parent_id", "vault_id"]);
        assert_eq!(built.vault_id, "personal");
        assert_eq!(built.created_at, "2026-01-01T00:00:00Z");
        assert_eq!(built.deleted_at, None);
    }

    #[test]
    fn build_snippet_folder_keeps_an_explicit_vault_and_carried_created_at() {
        let mut data = snippet_folder_form();
        data.vault_id = Some("team-a".into());
        let built = build_snippet_folder(
            "sf-1".into(),
            data,
            "2026-02-01T00:00:00Z",
            Some("2020-01-01T00:00:00Z".into()),
        );
        assert_eq!(built.vault_id, "team-a");
        assert_eq!(built.created_at, "2020-01-01T00:00:00Z");
    }

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
            clocks: std::collections::HashMap::new(),
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
        let ids = subtree_ids(&folders, "root", |f| f.parent_id.as_deref());
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
        let ids = subtree_ids(&folders, "root", |f| f.parent_id.as_deref());
        assert_eq!(ids, HashSet::from(["root".to_string()]));
    }

    #[test]
    fn subtree_terminates_on_a_parent_cycle() {
        let folders = vec![folder("a", Some("b")), folder("b", Some("a"))];
        let ids = subtree_ids(&folders, "a", |f| f.parent_id.as_deref());
        assert_eq!(ids, HashSet::from(["a".to_string(), "b".to_string()]));
    }
}
