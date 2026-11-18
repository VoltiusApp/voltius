use crate::cli_state::pending::{self, PendingDoc, Settled};
use crate::cli_state::{logout_marker, mirror};
use crate::storage::config::config_dir;
use serde_json::Value;

#[tauri::command]
pub fn cli_pending_load() -> PendingDoc {
    let (doc, warning) = pending::load(&config_dir());
    if let Some(w) = warning {
        log::warn!("{w}");
    }
    doc
}

#[tauri::command]
pub fn cli_pending_settle(results: Vec<Settled>) -> Result<(), String> {
    pending::settle(&config_dir(), &results).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cli_mirror_save(mirror: Value) -> Result<(), String> {
    mirror::write(&config_dir(), &mirror).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cli_logout_marker_take() -> Vec<String> {
    logout_marker::take(&config_dir())
}
