// ─── DB location ──────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};

const TERMIUS_DB_SUBPATH: &str = "Termius/IndexedDB/file__0.indexeddb.leveldb";

/// Returns all plausible Termius database locations for this platform. Termius
/// ships through several channels — classic installer, Microsoft Store (which
/// sandboxes the app under Packages/), and standalone — each with a different
/// data directory.
fn termius_db_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            out.push(PathBuf::from(&appdata).join(TERMIUS_DB_SUBPATH));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let pkgs = PathBuf::from(&local).join("Packages");
            if let Ok(entries) = std::fs::read_dir(&pkgs) {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("Crystalnix.Termius_")
                    {
                        out.push(
                            entry
                                .path()
                                .join("LocalCache/Roaming")
                                .join(TERMIUS_DB_SUBPATH),
                        );
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            out.push(
                home.join("Library/Application Support")
                    .join(TERMIUS_DB_SUBPATH),
            );
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(config) = dirs::config_dir() {
            out.push(config.join(TERMIUS_DB_SUBPATH));
        }
    }

    out
}

pub(super) fn termius_db_dir() -> Result<PathBuf, String> {
    let candidates = termius_db_candidates();
    for path in &candidates {
        if path.is_dir() {
            return Ok(path.clone());
        }
    }
    Err(format!(
        "Termius database not found. Looked in:\n  {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join("\n  ")
    ))
}

pub(super) fn copy_db_to_temp(src: &Path) -> Result<PathBuf, String> {
    let temp = std::env::temp_dir().join(format!("voltius-termius-ldb-{}", std::process::id()));
    if temp.exists() {
        let _ = std::fs::remove_dir_all(&temp);
    }
    std::fs::create_dir_all(&temp).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let entries = std::fs::read_dir(src).map_err(|e| format!("Cannot read Termius db: {e}"))?;
    let mut copied = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        // Skip the LOCK file; copying it would just recreate the lock semantics
        // in our temp copy and break opens.
        if name.to_string_lossy() == "LOCK" {
            continue;
        }
        if std::fs::copy(entry.path(), temp.join(&name)).is_ok() {
            copied += 1;
        }
    }
    if copied == 0 {
        return Err("No files copied from Termius db dir".to_string());
    }
    Ok(temp)
}
