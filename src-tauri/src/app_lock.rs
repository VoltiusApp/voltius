use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockKind {
    Screen,
    Vault,
}

impl LockKind {
    fn as_str(self) -> &'static str {
        match self {
            LockKind::Screen => "screen",
            LockKind::Vault => "vault",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "screen" => Some(LockKind::Screen),
            "vault" => Some(LockKind::Vault),
            _ => None,
        }
    }
}

pub struct AppLock {
    path: PathBuf,
    state: Mutex<Option<LockKind>>,
}

impl AppLock {
    pub fn load() -> Self {
        Self::load_from(crate::storage::config::config_dir().join("app-lock"))
    }

    pub fn load_from(path: PathBuf) -> Self {
        // Only a missing marker means unlocked; one that can't be read or parsed fails closed.
        let state = match std::fs::read_to_string(&path) {
            Ok(s) => Some(LockKind::parse(&s).unwrap_or(LockKind::Screen)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => Some(LockKind::Screen),
        };
        Self {
            path,
            state: Mutex::new(state),
        }
    }

    pub fn get(&self) -> Option<LockKind> {
        *self.state.lock().unwrap()
    }

    /// The in-memory state always takes `kind`; an error only means the next launch may disagree.
    pub fn set(&self, kind: Option<LockKind>) -> std::io::Result<()> {
        *self.state.lock().unwrap() = kind;
        match kind {
            Some(k) => std::fs::write(&self.path, k.as_str()),
            None => match std::fs::remove_file(&self.path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                r => r,
            },
        }
    }
}

pub fn is_locked(app: &tauri::AppHandle) -> bool {
    app.try_state::<AppLock>()
        .is_some_and(|l| l.get().is_some())
}

#[cfg(target_os = "android")]
fn sync_secure_flag(kind: Option<LockKind>) {
    crate::system_auth::android::set_secure(kind == Some(LockKind::Screen));
}

#[cfg(not(target_os = "android"))]
fn sync_secure_flag(_kind: Option<LockKind>) {}

#[tauri::command]
pub fn app_lock_get(lock: tauri::State<'_, AppLock>) -> Option<String> {
    let kind = lock.get();
    // The webview reads the lock at startup, which is how a lock restored from disk reaches the activity.
    sync_secure_flag(kind);
    kind.map(|k| k.as_str().to_string())
}

#[tauri::command]
pub fn app_lock_set(lock: tauri::State<'_, AppLock>, kind: Option<String>) -> Result<(), String> {
    let kind = match kind.as_deref() {
        None => None,
        Some(s) => Some(LockKind::parse(s).ok_or_else(|| format!("unknown lock kind: {s}"))?),
    };
    let persisted = lock.set(kind);
    sync_secure_flag(kind);
    persisted.map_err(|e| format!("could not persist the app lock: {e}"))
}

#[tauri::command]
pub fn app_lock_hide_in_recents(on: bool) {
    #[cfg(target_os = "android")]
    crate::system_auth::android::set_hide_in_recents(on);
    #[cfg(not(target_os = "android"))]
    let _ = on;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_store_is_unlocked() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(AppLock::load_from(dir.path().join("app-lock")).get(), None);
    }

    #[test]
    fn a_lock_survives_a_reload_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-lock");
        AppLock::load_from(path.clone())
            .set(Some(LockKind::Screen))
            .unwrap();
        assert_eq!(AppLock::load_from(path).get(), Some(LockKind::Screen));
    }

    #[test]
    fn unlocking_removes_the_marker() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-lock");
        let lock = AppLock::load_from(path.clone());
        lock.set(Some(LockKind::Vault)).unwrap();
        lock.set(None).unwrap();
        assert!(!path.exists());
        assert_eq!(AppLock::load_from(path).get(), None);
    }

    #[test]
    fn an_unknown_marker_reads_as_locked_screen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-lock");
        std::fs::write(&path, "garbage").unwrap();
        assert_eq!(AppLock::load_from(path).get(), Some(LockKind::Screen));
    }

    #[test]
    fn a_marker_that_is_not_utf8_reads_as_locked_screen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-lock");
        std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(AppLock::load_from(path).get(), Some(LockKind::Screen));
    }

    #[test]
    fn a_marker_that_cannot_be_read_reads_as_locked_screen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-lock");
        std::fs::create_dir(&path).unwrap();
        assert_eq!(AppLock::load_from(path).get(), Some(LockKind::Screen));
    }

    #[test]
    fn a_lock_whose_marker_cannot_be_written_still_locks() {
        let dir = tempfile::tempdir().unwrap();
        let lock = AppLock::load_from(dir.path().join("missing").join("app-lock"));
        assert!(lock.set(Some(LockKind::Screen)).is_err());
        assert_eq!(lock.get(), Some(LockKind::Screen));
    }

    #[test]
    fn an_unlock_whose_marker_cannot_be_removed_still_unlocks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-lock");
        let lock = AppLock::load_from(path.clone());
        lock.set(Some(LockKind::Vault)).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("x"), "").unwrap();
        assert!(lock.set(None).is_err());
        assert_eq!(lock.get(), None);
    }
}
