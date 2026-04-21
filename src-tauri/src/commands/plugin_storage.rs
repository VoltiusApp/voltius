use crate::storage::config::config_dir;
use std::collections::HashMap;

fn storage_file(plugin_id: &str) -> std::path::PathBuf {
    let dir = config_dir().join("plugin-data");
    std::fs::create_dir_all(&dir).ok();
    dir.join(format!("{plugin_id}.json"))
}

fn load_storage(plugin_id: &str) -> HashMap<String, String> {
    let path = storage_file(plugin_id);
    if !path.exists() {
        return HashMap::new();
    }
    let data = std::fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_storage(plugin_id: &str, map: &HashMap<String, String>) -> Result<(), String> {
    let path = storage_file(plugin_id);
    let data = serde_json::to_string(map).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_storage_get(plugin_id: String, key: String) -> Result<Option<String>, String> {
    let map = load_storage(&plugin_id);
    Ok(map.get(&key).cloned())
}

#[tauri::command]
pub fn plugin_storage_set(plugin_id: String, key: String, value: String) -> Result<(), String> {
    let mut map = load_storage(&plugin_id);
    map.insert(key, value);
    save_storage(&plugin_id, &map)
}

#[tauri::command]
pub fn plugin_storage_delete(plugin_id: String, key: String) -> Result<(), String> {
    let mut map = load_storage(&plugin_id);
    map.remove(&key);
    save_storage(&plugin_id, &map)
}
