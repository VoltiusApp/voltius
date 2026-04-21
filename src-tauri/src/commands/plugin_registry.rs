use crate::storage::config::config_dir;
use std::collections::HashMap;

type Overrides = HashMap<String, bool>;

fn registry_file() -> std::path::PathBuf {
    config_dir().join("plugin-registry.json")
}

#[tauri::command]
pub fn plugin_registry_load() -> Result<Overrides, String> {
    let path = registry_file();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_registry_save(overrides: Overrides) -> Result<(), String> {
    let path = registry_file();
    let data = serde_json::to_string_pretty(&overrides).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}
