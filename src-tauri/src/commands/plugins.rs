use crate::storage::config::config_dir;
use std::path::PathBuf;

fn plugins_dir() -> PathBuf {
    let dir = config_dir().join("plugins");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// List installed plugin IDs (subdirectories of `$APP_DATA/plugins/`)
#[tauri::command]
pub fn plugins_list_installed() -> Result<Vec<String>, String> {
    let dir = plugins_dir();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                ids.push(name.to_string());
            }
        }
    }
    Ok(ids)
}

/// Read a file from `$APP_DATA/plugins/<id>/<filename>`
#[tauri::command]
pub fn plugin_read_file(id: String, filename: String) -> Result<String, String> {
    // Prevent path traversal
    if id.contains("..") || id.contains('/') || filename.contains("..") || filename.contains('/') {
        return Err("invalid path component".to_string());
    }
    let path = plugins_dir().join(&id).join(&filename);
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write a file into `$APP_DATA/plugins/<id>/<filename>`
#[tauri::command]
pub fn plugin_write_file(id: String, filename: String, content: String) -> Result<(), String> {
    if id.contains("..") || id.contains('/') || filename.contains("..") || filename.contains('/') {
        return Err("invalid path component".to_string());
    }
    let dir = plugins_dir().join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(&filename), content).map_err(|e| e.to_string())
}

/// Delete `$APP_DATA/plugins/<id>/` and all contents
#[tauri::command]
pub fn plugin_delete(id: String) -> Result<(), String> {
    if id.contains("..") || id.contains('/') {
        return Err("invalid path component".to_string());
    }
    let path = plugins_dir().join(&id);
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Return the absolute path to `$APP_DATA/plugins/<id>/<filename>` as a string
/// (used by the frontend to build a `convertFileSrc` URL)
#[tauri::command]
pub fn plugin_resolve_path(id: String, filename: String) -> Result<String, String> {
    if id.contains("..") || id.contains('/') || filename.contains("..") || filename.contains('/') {
        return Err("invalid path component".to_string());
    }
    let path = plugins_dir().join(&id).join(&filename);
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "non-UTF-8 path".to_string())
}
