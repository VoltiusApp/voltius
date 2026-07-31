use crate::storage::config::config_dir;
use reqwest;
use std::path::PathBuf;

/// Charset guard for a `<id>` path component under `plugins/`.
///
/// Deliberately WIDER than the manifest-id rule the TS layer enforces
/// (`src/plugins/pluginId.ts`): this one also has to admit the reserved `__meta__`
/// directory — the installed-plugin list, marketplace sources and seeded tombstones
/// all reach these commands with `id: "__meta__"` — which the TS rule rejects
/// precisely so no plugin can claim it. Both layers reject separators and traversal.
///
/// `\` matters here even though the old guard omitted it: it is a path separator on
/// Windows, so `a\..\..\evil` escaped the plugins directory there.
fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        Err("invalid path component".to_string())
    }
}

/// Same rule for the `<filename>` component. Every caller passes a static name
/// (`manifest.json`, `index.js`, `voltius.css`, the `__meta__` json files).
fn validate_filename(filename: &str) -> Result<(), String> {
    validate_id(filename)
}

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
    // read_dir order is filesystem-dependent (ext4 hashes it) and changes after any
    // uninstall/reinstall. Callers load plugins in this order, so leaving it unsorted
    // makes every order-sensitive downstream surface non-deterministic.
    ids.sort();
    Ok(ids)
}

/// Read a file from `$APP_DATA/plugins/<id>/<filename>`
#[tauri::command]
pub fn plugin_read_file(id: String, filename: String) -> Result<String, String> {
    // Prevent path traversal
    validate_id(&id)?;
    validate_filename(&filename)?;
    let path = plugins_dir().join(&id).join(&filename);
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Write a file into `$APP_DATA/plugins/<id>/<filename>`
#[tauri::command]
pub fn plugin_write_file(id: String, filename: String, content: String) -> Result<(), String> {
    validate_id(&id)?;
    validate_filename(&filename)?;
    let dir = plugins_dir().join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(&filename), content).map_err(|e| e.to_string())
}

/// Delete `$APP_DATA/plugins/<id>/` and all contents
#[tauri::command]
pub fn plugin_delete(id: String) -> Result<(), String> {
    validate_id(&id)?;
    let path = plugins_dir().join(&id);
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Fetch a URL from the Rust backend (bypasses webview CORS restrictions)
#[tauri::command]
pub async fn plugin_fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Voltius")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Return the absolute path to `$APP_DATA/plugins/<id>/<filename>` as a string
/// (used by the frontend to build a `convertFileSrc` URL)
#[tauri::command]
pub fn plugin_resolve_path(id: String, filename: String) -> Result<String, String> {
    validate_id(&id)?;
    validate_filename(&filename)?;
    let path = plugins_dir().join(&id).join(&filename);
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "non-UTF-8 path".to_string())
}

use tauri::Manager;

fn seeded_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/plugins", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())
}

/// List seeded (shipped-with-the-app) plugin IDs.
#[tauri::command]
pub fn plugins_list_seeded(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = match seeded_dir(&app) {
        Ok(d) => d,
        Err(_) => return Ok(Vec::new()),
    };
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };
    let mut ids = Vec::new();
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                ids.push(name.to_string());
            }
        }
    }
    // read_dir order is filesystem-dependent (ext4 hashes it) and changes after any
    // uninstall/reinstall. Callers load plugins in this order, so leaving it unsorted
    // makes every order-sensitive downstream surface non-deterministic.
    ids.sort();
    Ok(ids)
}

/// Read `resources/plugins/<id>/<filename>` as text.
#[tauri::command]
pub fn plugin_seeded_read(
    app: tauri::AppHandle,
    id: String,
    filename: String,
) -> Result<String, String> {
    validate_id(&id)?;
    validate_filename(&filename)?;
    let path = seeded_dir(&app)?.join(&id).join(&filename);
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_real_plugin_ids_and_the_reserved_meta_dir() {
        for id in [
            "plugin-docker",
            "plugin-ssh-config",
            "acme.theme",
            "my_plugin",
            // The installed-plugin list, marketplace sources and seeded tombstones all
            // arrive here under this id. Rejecting it would break sync and the
            // installed-plugin list, not just a hostile plugin.
            "__meta__",
        ] {
            assert!(validate_id(id).is_ok(), "should accept {id:?}");
        }
    }

    #[test]
    fn accepts_the_filenames_callers_actually_use() {
        for name in [
            "manifest.json",
            "index.js",
            "voltius.css",
            "installed-plugins.json",
            "removed-seeded.json",
        ] {
            assert!(validate_filename(name).is_ok(), "should accept {name:?}");
        }
    }

    #[test]
    fn rejects_traversal_and_separators() {
        for id in [
            "..",
            ".",
            "",
            "../evil",
            "a/b",
            // Windows separator — the previous guard checked only '/', so this escaped
            // the plugins directory there.
            "a\\..\\..\\evil",
            "a\\b",
            "foo:x",
            "a b",
            "nul\0byte",
        ] {
            assert!(validate_id(id).is_err(), "should reject {id:?}");
        }
    }

    #[test]
    fn rejects_an_over_long_id() {
        assert!(validate_id(&"a".repeat(64)).is_ok());
        assert!(validate_id(&"a".repeat(65)).is_err());
    }
}
