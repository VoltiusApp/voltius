use crate::known_hosts::{ConflictAction, KnownHostsStore, PendingConflicts};
use crate::storage::config::KnownHost;
use std::sync::Arc;

#[tauri::command]
pub async fn known_host_list(
    known_hosts: tauri::State<'_, Arc<KnownHostsStore>>,
) -> Result<Vec<KnownHost>, String> {
    Ok(known_hosts.list().await)
}

#[tauri::command]
pub async fn known_host_delete(
    known_hosts: tauri::State<'_, Arc<KnownHostsStore>>,
    id: String,
) -> Result<(), String> {
    known_hosts.delete(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn known_host_move_vault(
    known_hosts: tauri::State<'_, Arc<KnownHostsStore>>,
    id: String,
    vault_id: String,
) -> Result<(), String> {
    known_hosts.move_vault(&id, &vault_id).await;
    Ok(())
}

#[tauri::command]
pub async fn known_host_copy_vault(
    known_hosts: tauri::State<'_, Arc<KnownHostsStore>>,
    id: String,
    vault_id: String,
) -> Result<KnownHost, String> {
    known_hosts
        .copy_to_vault(&id, &vault_id)
        .await
        .ok_or_else(|| format!("Known host {} not found", id))
}

#[tauri::command]
pub async fn known_host_resolve(
    pending: tauri::State<'_, Arc<PendingConflicts>>,
    session_id: String,
    action: String,
) -> Result<(), String> {
    let conflict_action = match action.as_str() {
        "add_new" => ConflictAction::AddNew,
        "replace" => ConflictAction::Replace,
        _ => ConflictAction::Abort,
    };
    if let Some(tx) = pending.0.lock().await.remove(&session_id) {
        let _ = tx.send(conflict_action);
    }
    Ok(())
}
