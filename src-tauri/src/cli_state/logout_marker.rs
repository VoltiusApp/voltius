use crate::policy::write_text_atomic;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;

const LOGOUT_MARKER: &str = "cli-logout.json";

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Marker {
    account_ids: Vec<String>,
}

fn read(path: &Path) -> io::Result<Marker> {
    let text = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

pub fn write(dir: &Path, account_id: &str) -> io::Result<()> {
    let path = dir.join(LOGOUT_MARKER);
    let mut marker = read(&path).unwrap_or_default();
    if !marker.account_ids.iter().any(|id| id == account_id) {
        marker.account_ids.push(account_id.into());
    }
    let text = serde_json::to_string(&marker).map_err(io::Error::other)?;
    write_text_atomic(&path, &text)
}

// A marker that can't be deleted would wipe the next account's state on every launch.
pub fn take(dir: &Path) -> Vec<String> {
    let path = dir.join(LOGOUT_MARKER);
    let Ok(marker) = read(&path) else {
        return Vec::new();
    };
    if let Err(e) = std::fs::remove_file(&path) {
        log::warn!("ignoring {}: cannot remove it: {e}", path.display());
        return Vec::new();
    }
    marker.account_ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_take_once() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("voltius");
        write(&config, "acc-1").unwrap();
        assert_eq!(take(&config), ["acc-1"]);
        assert!(!config.join(LOGOUT_MARKER).exists());
        assert!(take(&config).is_empty());
    }

    #[test]
    fn two_logouts_before_a_launch_keep_both_accounts() {
        let dir = tempfile::tempdir().unwrap();
        for id in ["acc-1", "acc-2", "acc-1"] {
            write(dir.path(), id).unwrap();
        }
        assert_eq!(take(dir.path()), ["acc-1", "acc-2"]);
    }

    #[test]
    fn an_unreadable_marker_is_removed_and_ignored() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(LOGOUT_MARKER), "{nope").unwrap();
        assert!(take(dir.path()).is_empty());
        assert!(!dir.path().join(LOGOUT_MARKER).exists());
        write(dir.path(), "acc-3").unwrap();
        std::fs::write(dir.path().join(LOGOUT_MARKER), "{nope").unwrap();
        write(dir.path(), "acc-4").unwrap();
        assert_eq!(take(dir.path()), ["acc-4"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_marker_that_cannot_be_removed_does_not_fire() {
        use std::os::unix::fs::PermissionsExt;
        if crate::cli::user::is_system_account() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "acc-1").unwrap();
        let mode = |m| std::fs::Permissions::from_mode(m);
        std::fs::set_permissions(dir.path(), mode(0o555)).unwrap();
        let taken = take(dir.path());
        std::fs::set_permissions(dir.path(), mode(0o755)).unwrap();
        assert!(taken.is_empty(), "{taken:?}");
        assert!(dir.path().join(LOGOUT_MARKER).exists());
    }
}
