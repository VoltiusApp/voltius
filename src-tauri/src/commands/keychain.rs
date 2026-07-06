use keyring_core::Entry;

/// Base service name. If VOLTIUS_KEYCHAIN_NS is set, it is appended
/// (e.g. "voltius-2") so multiple simultaneous instances (dev:2) each
/// get an isolated keychain namespace without interfering with each other.
fn service() -> String {
    match std::env::var("VOLTIUS_KEYCHAIN_NS") {
        Ok(ns) if !ns.is_empty() => format!("voltius-{ns}"),
        _ => "voltius".to_string(),
    }
}

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(&service(), key).map_err(|e| format!("Keyring error: {e}"))
}

// The OS credential store (Windows Credential Manager, macOS Keychain, libsecret)
// is blocking I/O and can stall for a long time — e.g. Windows "Enterprise"
// persistence may do a domain/roaming lookup that hangs for over a minute. These
// commands are therefore `async` and run the blocking call on the blocking pool,
// so a slow credential store never freezes the UI thread (a sync `#[tauri::command]`
// runs on the main thread and would).

async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Keychain task error: {e}"))?
}

#[tauri::command]
pub async fn keychain_get(key: String) -> Result<Option<String>, String> {
    run_blocking(move || {
        let e = entry(&key)?;
        match e.get_password() {
            Ok(val) => Ok(Some(val)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(err) => Err(format!("Keychain read error: {err}")),
        }
    })
    .await
}

#[tauri::command]
pub async fn keychain_set(key: String, value: String) -> Result<(), String> {
    run_blocking(move || {
        entry(&key)?
            .set_password(&value)
            .map_err(|e| format!("Keychain write error: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn keychain_delete(key: String) -> Result<(), String> {
    run_blocking(move || {
        let e = entry(&key)?;
        match e.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring_core::Error::NoEntry) => Ok(()), // already gone
            Err(err) => Err(format!("Keychain delete error: {err}")),
        }
    })
    .await
}
