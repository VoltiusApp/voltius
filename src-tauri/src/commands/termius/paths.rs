// ─── DB location ──────────────────────────────────────────────────────────────

use std::path::{Path, PathBuf};

const TERMIUS_DB_SUBPATH: &str = "Termius/IndexedDB";
const SQLITE_STORE: &str = "file__0";
const LEVELDB_STORE: &str = "file__0.indexeddb.leveldb";

pub(super) enum TermiusStore {
    Sqlite(PathBuf),
    LevelDb(PathBuf),
}

impl TermiusStore {
    pub(super) fn dir(&self) -> &Path {
        match self {
            TermiusStore::Sqlite(dir) | TermiusStore::LevelDb(dir) => dir,
        }
    }
}

/// Returns all plausible Termius IndexedDB locations for this platform. Termius
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

/// Every IndexedDB store found, SQLite first: Chromium may leave the old LevelDB behind.
pub(super) fn termius_stores() -> Result<Vec<TermiusStore>, String> {
    let candidates = termius_db_candidates();
    let stores: Vec<TermiusStore> = candidates
        .iter()
        .flat_map(|idb| {
            [
                TermiusStore::Sqlite(idb.join(SQLITE_STORE)),
                TermiusStore::LevelDb(idb.join(LEVELDB_STORE)),
            ]
        })
        .filter(|store| store.dir().is_dir())
        .collect();
    if !stores.is_empty() {
        return Ok(stores);
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

pub(super) fn read_temp_copy<T>(
    src: &Path,
    read: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let temp = copy_db_to_temp(src)?;
    let out = read(&temp);
    let _ = std::fs::remove_dir_all(&temp);
    out
}

// Importing a desktop Termius install; the whole module is unreachable on Android.
#[allow(clippy::disallowed_methods)]
fn copy_db_to_temp(src: &Path) -> Result<PathBuf, String> {
    let temp = std::env::temp_dir().join(format!("voltius-termius-idb-{}", std::process::id()));
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
