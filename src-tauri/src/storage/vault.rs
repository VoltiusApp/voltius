use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

fn vault_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("vault.hold")
}

pub fn vault_exists(app: &AppHandle) -> bool {
    vault_path(app).exists()
}

pub fn vault_file_path(app: &AppHandle) -> PathBuf {
    vault_path(app)
}
