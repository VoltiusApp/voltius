use keyring::Entry;

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

#[tauri::command]
pub fn keychain_get(key: String) -> Result<Option<String>, String> {
    let e = entry(&key)?;
    match e.get_password() {
        Ok(val) => Ok(Some(val)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("Keychain read error: {err}")),
    }
}

#[tauri::command]
pub fn keychain_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|e| format!("Keychain write error: {e}"))
}

#[tauri::command]
pub fn keychain_delete(key: String) -> Result<(), String> {
    let e = entry(&key)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone
        Err(err) => Err(format!("Keychain delete error: {err}")),
    }
}
