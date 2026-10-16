use crate::storage::config::config_dir;
use std::collections::HashMap;

fn storage_file(plugin_id: &str) -> std::path::PathBuf {
    let dir = config_dir().join("plugin-data");
    std::fs::create_dir_all(&dir).ok();
    dir.join(format!("{plugin_id}.json"))
}

fn read_map(path: &std::path::Path) -> Result<Option<HashMap<String, String>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data)
        .map(Some)
        .map_err(|e| e.to_string())
}

fn load_storage_strict(plugin_id: &str) -> Result<Option<HashMap<String, String>>, String> {
    read_map(&storage_file(plugin_id))
}

fn load_storage(plugin_id: &str) -> HashMap<String, String> {
    load_storage_strict(plugin_id)
        .ok()
        .flatten()
        .unwrap_or_default()
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
pub fn plugin_storage_read_strict(
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    crate::commands::plugins::validate_id(&plugin_id)?;
    Ok(load_storage_strict(&plugin_id)?.and_then(|mut map| map.remove(&key)))
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

#[tauri::command]
pub fn plugin_storage_clear(plugin_id: String) -> Result<(), String> {
    crate::commands::plugins::validate_id(&plugin_id)?;
    let path = storage_file(&plugin_id);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::read_map;

    fn read(
        contents: Option<&str>,
    ) -> Result<Option<std::collections::HashMap<String, String>>, String> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("plugin.json");
        if let Some(c) = contents {
            std::fs::write(&path, c).unwrap();
        }
        read_map(&path)
    }

    #[test]
    fn missing_file_is_none() {
        assert_eq!(read(None).unwrap(), None);
    }

    #[test]
    fn corrupt_json_is_an_error() {
        assert!(read(Some("{not json")).is_err());
    }

    #[test]
    fn valid_file_returns_the_map() {
        let map = read(Some(r#"{"import_consent":"\"granted\""}"#))
            .unwrap()
            .unwrap();
        assert_eq!(
            map.get("import_consent").map(String::as_str),
            Some("\"granted\"")
        );
    }
}
