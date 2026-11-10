use crate::policy::write_text_atomic;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;

const LOGOUT_MARKER: &str = "cli-logout.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker {
    account_id: String,
}

pub fn write(dir: &Path, account_id: &str) -> io::Result<()> {
    let marker = Marker {
        account_id: account_id.into(),
    };
    let text = serde_json::to_string(&marker).map_err(io::Error::other)?;
    write_text_atomic(&dir.join(LOGOUT_MARKER), &text)
}

pub fn take(dir: &Path) -> Option<String> {
    let path = dir.join(LOGOUT_MARKER);
    let text = std::fs::read_to_string(&path).ok()?;
    if let Err(e) = std::fs::remove_file(&path) {
        log::warn!("cannot remove {}: {e}", path.display());
    }
    serde_json::from_str::<Marker>(&text)
        .ok()
        .map(|m| m.account_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_take_once() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("voltius");
        write(&config, "acc-1").unwrap();
        assert_eq!(take(&config).as_deref(), Some("acc-1"));
        assert!(!config.join(LOGOUT_MARKER).exists());
        assert_eq!(take(&config), None);
    }

    #[test]
    fn an_unreadable_marker_is_removed_and_ignored() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(LOGOUT_MARKER), "{nope").unwrap();
        assert_eq!(take(dir.path()), None);
        assert!(!dir.path().join(LOGOUT_MARKER).exists());
    }
}
