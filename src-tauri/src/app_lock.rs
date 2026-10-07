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
        // A marker that exists but can't be parsed fails closed.
        let state = std::fs::read_to_string(&path)
            .ok()
            .map(|s| LockKind::parse(&s).unwrap_or(LockKind::Screen));
        Self {
            path,
            state: Mutex::new(state),
        }
    }

    pub fn get(&self) -> Option<LockKind> {
        *self.state.lock().unwrap()
    }

    pub fn set(&self, kind: Option<LockKind>) -> std::io::Result<()> {
        match kind {
            Some(k) => std::fs::write(&self.path, k.as_str())?,
            None => match std::fs::remove_file(&self.path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
                _ => {}
            },
        }
        *self.state.lock().unwrap() = kind;
        Ok(())
    }
}

pub fn is_locked(app: &tauri::AppHandle) -> bool {
    app.try_state::<AppLock>()
        .is_some_and(|l| l.get().is_some())
}

#[tauri::command]
pub fn app_lock_get(lock: tauri::State<'_, AppLock>) -> Option<String> {
    lock.get().map(|k| k.as_str().to_string())
}

#[tauri::command]
pub fn app_lock_set(lock: tauri::State<'_, AppLock>, kind: Option<String>) -> Result<(), String> {
    let kind = match kind.as_deref() {
        None => None,
        Some(s) => Some(LockKind::parse(s).ok_or_else(|| format!("unknown lock kind: {s}"))?),
    };
    lock.set(kind)
        .map_err(|e| format!("could not persist the app lock: {e}"))?;
    #[cfg(target_os = "android")]
    crate::system_auth::android::set_secure(kind == Some(LockKind::Screen));
    Ok(())
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
}
