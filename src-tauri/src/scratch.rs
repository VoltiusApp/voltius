use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The app's own scratch directory for in-flight transfers. Never `std::env::temp_dir()`:
/// on Android that is `/data/local/tmp`, owned by `shell:shell`, so an app uid cannot write it.
pub fn app_scratch_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|e| format!("Cannot resolve the app cache dir: {e}"))
}

pub fn safe_file_name(name: &str) -> String {
    let flat = name.replace(['/', '\\', '\0'], "_");
    match flat.trim() {
        "" | "." | ".." => "file".into(),
        _ => flat,
    }
}

fn transfer_dir_in(cache: &Path, area: &str, transfer_id: &str) -> PathBuf {
    cache.join(area).join(safe_file_name(transfer_id))
}

fn transfer_file_in(cache: &Path, area: &str, transfer_id: &str, name: &str) -> PathBuf {
    transfer_dir_in(cache, area, transfer_id).join(safe_file_name(name))
}

pub fn transfer_dir(app: &AppHandle, area: &str, transfer_id: &str) -> Result<PathBuf, String> {
    Ok(transfer_dir_in(&app_scratch_dir(app)?, area, transfer_id))
}

/// `<cache>/<area>/<transfer id>/<name>`, with its parent created.
pub fn transfer_file(
    app: &AppHandle,
    area: &str,
    transfer_id: &str,
    name: &str,
) -> Result<PathBuf, String> {
    let path = transfer_file_in(&app_scratch_dir(app)?, area, transfer_id, name);
    let dir = path
        .parent()
        .ok_or_else(|| "Invalid temp transfer path".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Cannot create temp dir: {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_file_nests_under_the_app_cache_dir() {
        let p = transfer_file_in(
            Path::new("/data/user/0/com.voltius.app/cache"),
            "voltius-downloads",
            "t1",
            "a.bin",
        );
        assert_eq!(
            p,
            Path::new("/data/user/0/com.voltius.app/cache/voltius-downloads/t1/a.bin"),
        );
    }

    #[test]
    fn transfer_file_flattens_separators_in_the_name() {
        let p = transfer_file_in(Path::new("/cache"), "up", "t1", "../../etc/passwd");
        assert_eq!(p, Path::new("/cache/up/t1/.._.._etc_passwd"));
        let p = transfer_file_in(Path::new("/cache"), "up", "t1", "a\\b\0c");
        assert_eq!(p, Path::new("/cache/up/t1/a_b_c"));
    }

    #[test]
    fn dot_and_empty_names_become_a_plain_file_name() {
        for name in ["", " ", ".", "..", " .. "] {
            let p = transfer_file_in(Path::new("/cache"), "up", "t1", name);
            assert_eq!(p, Path::new("/cache/up/t1/file"), "{name:?}");
        }
    }

    #[test]
    fn transfer_dir_never_escapes_its_area() {
        for tid in ["..", "../..", "", "/"] {
            let d = transfer_dir_in(Path::new("/cache"), "up", tid);
            assert_eq!(d.parent(), Some(Path::new("/cache/up")), "{tid:?}");
        }
    }
}
