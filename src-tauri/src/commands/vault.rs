use crate::storage::vault;
use tauri::AppHandle;

#[tauri::command]
pub fn vault_status(app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "exists": vault::vault_exists(&app),
        "path": vault::vault_file_path(&app).to_string_lossy()
    })
}

#[tauri::command]
pub fn vault_reset(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    // Delete secrets store
    let secrets = data_dir.join("secrets.enc");
    if secrets.exists() {
        std::fs::remove_file(&secrets).map_err(|e| format!("Failed to delete secrets: {e}"))?;
    }

    // Delete legacy Stronghold vault if still present
    let vault_hold = vault::vault_file_path(&app);
    if vault_hold.exists() {
        std::fs::remove_file(&vault_hold).ok();
    }

    // Delete entire config directory (covers all current and future config files)
    let config = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("voltius");
    if config.exists() {
        std::fs::remove_dir_all(&config)
            .map_err(|e| format!("Failed to delete config directory: {e}"))?;
    }

    Ok(())
}

/// Wipe local config + secrets so a different account can start clean.
/// Deletes:
///   - secrets.enc  (encrypted with the OLD account's key — new key can't open it)
///   - ~/.config/voltius/  (connections, identities, keys, folders JSON files)
/// Does NOT touch the OS keychain — caller handles that separately.
#[tauri::command]
pub fn config_wipe(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;

    // Delete secrets store (keyed to old account — new enc_key cannot decrypt it)
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let secrets = data_dir.join("secrets.enc");
    if secrets.exists() {
        std::fs::remove_file(&secrets)
            .map_err(|e| format!("Failed to delete secrets.enc: {e}"))?;
    }

    // Delete config directory (covers all JSON entity files)
    let config = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("voltius");
    if config.exists() {
        std::fs::remove_dir_all(&config)
            .map_err(|e| format!("Failed to wipe config: {e}"))?;
    }
    Ok(())
}
