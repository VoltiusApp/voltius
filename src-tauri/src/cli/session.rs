use super::CliError;
use crate::commands::{keychain, vault_secret};
use crate::storage::config::APP_IDENTIFIER;

pub(crate) const KEYCHAIN_UNREACHABLE: &str = "Can't reach this user's keychain. Run voltius-cli login in a terminal on the desktop, or sign in from the app.";
const APP_RUNNING: &str = "Quit Voltius first; it holds this account's keys.";
const ACCOUNT_ID: &str = "account_id";

pub(crate) trait Keys {
    fn get(&self, k: &str) -> Result<Option<String>, CliError>;
    fn set(&self, k: &str, v: &str) -> Result<(), CliError>;
    fn delete(&self, k: &str) -> Result<(), CliError>;
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SessionInfo {
    pub mode: String,
    pub email: Option<String>,
    pub server: Option<String>,
    pub account_id: String,
}

pub(crate) struct OsKeys;

fn keychain_error(e: keyring_core::Error) -> CliError {
    CliError::Io(std::io::Error::other(format!("Keychain: {e}")))
}

impl Keys for OsKeys {
    fn get(&self, k: &str) -> Result<Option<String>, CliError> {
        keychain::read(k).map_err(keychain_error)
    }
    fn set(&self, k: &str, v: &str) -> Result<(), CliError> {
        keychain::write(k, v).map_err(keychain_error)
    }
    fn delete(&self, k: &str) -> Result<(), CliError> {
        keychain::remove(k).map_err(keychain_error)
    }
}

pub(crate) struct SecretStore<'a>(pub(crate) &'a dyn Keys);

impl vault_secret::Store for SecretStore<'_> {
    fn get(&self, k: &str) -> Result<Option<String>, String> {
        self.0.get(k).map_err(|e| e.to_string())
    }
    fn set(&self, k: &str, v: &str) -> Result<(), String> {
        self.0.set(k, v).map_err(|e| e.to_string())
    }
    fn delete(&self, k: &str) -> Result<(), String> {
        self.0.delete(k).map_err(|e| e.to_string())
    }
}

pub(crate) fn open_keychain() -> Result<(), CliError> {
    let allow_volatile =
        cfg!(debug_assertions) && std::env::var_os("VOLTIUS_KEYCHAIN_NS").is_some();
    open_with(|| crate::desktop_keychain_store(allow_volatile), &OsKeys)
}

fn open_with(
    register: impl FnOnce() -> keyring_core::Result<()>,
    probe: &dyn Keys,
) -> Result<(), CliError> {
    if register().is_ok() && probe.get(ACCOUNT_ID).is_ok() {
        Ok(())
    } else {
        Err(CliError::Denied(KEYCHAIN_UNREACHABLE.into()))
    }
}

pub(crate) fn current_session(keys: &dyn Keys) -> Result<Option<SessionInfo>, CliError> {
    let Some(account_id) = keys.get(ACCOUNT_ID)? else {
        return Ok(None);
    };
    Ok(Some(SessionInfo {
        mode: keys.get("mode")?.unwrap_or_else(|| "local".into()),
        email: keys.get("email")?,
        server: keys.get("server_url")?,
        account_id,
    }))
}

pub(crate) fn app_running() -> bool {
    instance_lock_held() || answers(&crate::mcp::transport::socket_path())
}

pub(crate) fn refuse_while_running(running: &dyn Fn() -> bool) -> Result<(), CliError> {
    if running() {
        Err(CliError::Refused(APP_RUNNING.into()))
    } else {
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn instance_lock_held() -> bool {
    use gio::glib::VariantTy;
    use gio::prelude::*;
    let Ok(bus) = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE) else {
        return false;
    };
    let name = format!("{APP_IDENTIFIER}.SingleInstance");
    bus.call_sync(
        Some("org.freedesktop.DBus"),
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "NameHasOwner",
        Some(&(name,).to_variant()),
        VariantTy::new("(b)").ok(),
        gio::DBusCallFlags::NONE,
        2_000,
        gio::Cancellable::NONE,
    )
    .ok()
    .and_then(|reply| reply.child_value(0).get::<bool>())
    .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn instance_lock_held() -> bool {
    let id = APP_IDENTIFIER.replace(['.', '-'], "_");
    answers(std::path::Path::new(&format!("/tmp/{id}_si.sock")))
}

#[cfg(windows)]
fn instance_lock_held() -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenMutexW, SYNCHRONIZATION_SYNCHRONIZE};
    let name = crate::win_security::wide(format!("{APP_IDENTIFIER}-sim"));
    let handle = unsafe { OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, 0, name.as_ptr()) };
    if handle.is_null() {
        return false;
    }
    unsafe { CloseHandle(handle) };
    true
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn instance_lock_held() -> bool {
    false
}

#[cfg(unix)]
fn answers(path: &std::path::Path) -> bool {
    std::os::unix::net::UnixStream::connect(path).is_ok()
}

#[cfg(windows)]
fn answers(path: &std::path::Path) -> bool {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .is_ok()
}

#[cfg(test)]
pub(crate) use mem::MemKeys;

#[cfg(test)]
mod mem {
    use super::{CliError, Keys};
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    #[derive(Default)]
    pub(crate) struct MemKeys {
        pub(crate) map: RefCell<BTreeMap<String, String>>,
        broken: RefCell<Option<String>>,
    }

    impl MemKeys {
        pub(crate) fn with(pairs: &[(&str, &str)]) -> Self {
            let keys = Self::default();
            for (k, v) in pairs {
                keys.map.borrow_mut().insert(k.to_string(), v.to_string());
            }
            keys
        }

        pub(crate) fn break_key(&self, k: &str) {
            *self.broken.borrow_mut() = Some(k.to_string());
        }

        fn check(&self, k: &str) -> Result<(), CliError> {
            if self.broken.borrow().as_deref() == Some(k) {
                return Err(CliError::Io(std::io::Error::other("keychain busy")));
            }
            Ok(())
        }
    }

    impl Keys for MemKeys {
        fn get(&self, k: &str) -> Result<Option<String>, CliError> {
            self.check(k)?;
            Ok(self.map.borrow().get(k).cloned())
        }
        fn set(&self, k: &str, v: &str) -> Result<(), CliError> {
            self.check(k)?;
            self.map.borrow_mut().insert(k.into(), v.into());
            Ok(())
        }
        fn delete(&self, k: &str) -> Result<(), CliError> {
            self.check(k)?;
            self.map.borrow_mut().remove(k);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::vault_secret::{self, State};

    fn denied_unreachable(r: Result<(), CliError>) {
        let err = r.unwrap_err();
        assert_eq!(err.exit_code(), 4);
        assert_eq!(err.to_string(), KEYCHAIN_UNREACHABLE);
    }

    #[test]
    fn memkeys_roundtrip() {
        let keys = MemKeys::default();
        assert_eq!(keys.get("jwt").unwrap(), None);
        keys.set("jwt", "t").unwrap();
        assert_eq!(keys.get("jwt").unwrap().as_deref(), Some("t"));
        keys.delete("jwt").unwrap();
        keys.delete("jwt").unwrap();
        assert_eq!(keys.get("jwt").unwrap(), None);
    }

    #[test]
    fn a_broken_memkey_fails_every_call() {
        let keys = MemKeys::with(&[("jwt", "t")]);
        keys.break_key("jwt");
        assert!(keys.get("jwt").is_err());
        assert!(keys.set("jwt", "u").is_err());
        assert!(keys.delete("jwt").is_err());
        assert!(keys.get("email").is_ok());
    }

    #[test]
    fn vault_secret_runs_on_keys_without_a_runtime() {
        let keys = MemKeys::default();
        let store = SecretStore(&keys);
        vault_secret::import(&store, State::Plain, "pw").unwrap();
        assert_eq!(
            keys.get(vault_secret::PLAIN).unwrap().as_deref(),
            Some("pw")
        );
        assert!(vault_secret::remembers(&store).unwrap());
        vault_secret::clear(&store).unwrap();
        assert_eq!(vault_secret::state(&store), Ok(State::None));
    }

    #[test]
    fn current_session_reads_server_and_local() {
        let server = MemKeys::with(&[
            ("account_id", "acc"),
            ("mode", "server"),
            ("email", "a@b.c"),
            ("server_url", "https://sync.example"),
            ("jwt", "secret"),
        ]);
        assert_eq!(
            current_session(&server).unwrap(),
            Some(SessionInfo {
                mode: "server".into(),
                email: Some("a@b.c".into()),
                server: Some("https://sync.example".into()),
                account_id: "acc".into(),
            })
        );
        let local = MemKeys::with(&[("account_id", "loc"), ("mode", "local")]);
        let info = current_session(&local).unwrap().unwrap();
        assert_eq!(
            (info.mode.as_str(), info.email, info.server),
            ("local", None, None)
        );
    }

    #[test]
    fn a_session_without_a_mode_reads_as_local() {
        let keys = MemKeys::with(&[("account_id", "old")]);
        assert_eq!(current_session(&keys).unwrap().unwrap().mode, "local");
    }

    #[test]
    fn no_account_is_none() {
        let keys = MemKeys::with(&[("mode", "server"), ("email", "a@b.c")]);
        assert_eq!(current_session(&keys).unwrap(), None);
    }

    #[test]
    fn an_unreadable_account_is_an_error_not_signed_out() {
        let keys = MemKeys::with(&[("account_id", "acc")]);
        keys.break_key("account_id");
        assert!(current_session(&keys).is_err());
    }

    #[test]
    fn open_keychain_maps_no_backend_to_exit_4() {
        let keys = MemKeys::default();
        denied_unreachable(open_with(
            || {
                Err(keyring_core::Error::NoStorageAccess(
                    "no secret service".into(),
                ))
            },
            &keys,
        ));
    }

    #[test]
    fn open_keychain_maps_a_locked_keychain_to_exit_4() {
        let keys = MemKeys::default();
        keys.break_key("account_id");
        denied_unreachable(open_with(|| Ok(()), &keys));
    }

    #[test]
    fn open_keychain_passes_a_reachable_keychain() {
        assert!(open_with(|| Ok(()), &MemKeys::default()).is_ok());
    }

    #[test]
    fn a_running_app_is_refused_with_exit_3() {
        let err = refuse_while_running(&|| true).unwrap_err();
        assert_eq!(err.exit_code(), 3);
        assert_eq!(err.to_string(), APP_RUNNING);
        assert!(refuse_while_running(&|| false).is_ok());
    }

    #[test]
    fn new_exit_codes() {
        assert_eq!(CliError::NotSignedIn.exit_code(), 1);
        assert_eq!(CliError::Refused("x".into()).exit_code(), 3);
    }

    #[cfg(unix)]
    #[test]
    fn a_listening_socket_answers_and_a_stale_one_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.sock");
        assert!(!answers(&path));
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        assert!(answers(&path));
        drop(listener);
        assert!(path.exists());
        assert!(!answers(&path));
    }
}
