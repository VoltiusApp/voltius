use keyring_core::Entry;

/// Base service name. If VOLTIUS_KEYCHAIN_NS is set, it is appended
/// (e.g. "voltius-2") so multiple simultaneous instances (dev:2) each
/// get an isolated keychain namespace without interfering with each other.
pub(crate) fn service() -> String {
    match std::env::var("VOLTIUS_KEYCHAIN_NS") {
        Ok(ns) if !ns.is_empty() => format!("voltius-{ns}"),
        _ => "voltius".to_string(),
    }
}

pub(crate) fn entry(key: &str) -> keyring_core::Result<Entry> {
    Entry::new(&service(), key)
}

/// `Ok(None)` = no such entry, `Err` = the store failed, so callers can fail closed.
pub(crate) fn read(key: &str) -> keyring_core::Result<Option<String>> {
    match entry(key)?.get_password() {
        Ok(val) => Ok(Some(val)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(err) => Err(err),
    }
}

pub(crate) fn guard(key: &str) -> Result<(), String> {
    use crate::commands::vault_secret::{PLAIN, SEALED};
    if key == PLAIN || key == SEALED {
        return Err(format!("{key} is only reachable through vault_secret_*"));
    }
    Ok(())
}

/// A keychain call can block on an OS prompt; off the main thread the window keeps painting.
async fn off_main<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("Keychain task failed: {e}"))?
}

#[tauri::command]
pub async fn keychain_get(key: String) -> Result<Option<String>, String> {
    guard(&key)?;
    off_main(move || read(&key).map_err(|err| format!("Keychain read error: {err}"))).await
}

#[tauri::command]
pub async fn keychain_set(key: String, value: String) -> Result<(), String> {
    guard(&key)?;
    off_main(move || {
        entry(&key)
            .and_then(|e| e.set_password(&value))
            .map_err(|e| format!("Keychain write error: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn keychain_delete(key: String) -> Result<(), String> {
    guard(&key)?;
    off_main(
        move || match entry(&key).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("Keychain delete error: {err}")),
        },
    )
    .await
}
