use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// The app's own scratch directory for in-flight transfers. Never `std::env::temp_dir()`:
/// on Android that is `/data/local/tmp`, owned by `shell:shell`, so an app uid cannot write it.
pub fn app_scratch_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|e| format!("Cannot resolve the app cache dir: {e}"))
}
