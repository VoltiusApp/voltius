// ─── OS keychain ──────────────────────────────────────────────────────────────
//
// Termius writes its key via Node's `keytar`. The blob format differs from what
// the `keyring` crate expects:
//   * Windows: keytar uses target "<service>/<account>" and stores the password
//     as raw UTF-8 bytes in CredentialBlob — we call CredReadW directly because
//     `keyring`'s target name doesn't match.
//   * macOS: keytar's keychain item matches `keyring`'s default lookup.
//   * Linux: keytar stores the key in the Secret Service (libsecret) under
//     schema "org.freedesktop.Secret.Generic" with attributes service/account.
//     Two gotchas: (1) this is a *different* store from the kernel keyutils one
//     we register as keyring-core's default (see `init_keychain_store` in
//     lib.rs); and (2) Termius's `service` attribute is the basename of its
//     executable, which is "termius-app" on the Linux .deb/AppImage (only
//     "Termius" on macOS/Windows). So we query the Secret Service directly with
//     the right service name rather than via `keyring_core::Entry`.

use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
use keyring_core::Entry;

pub(super) fn fetch_master_key() -> Result<[u8; 32], String> {
    let b64 = read_termius_localkey()?;
    let bytes = STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Master key is not valid base64: {e}"))?;
    bytes
        .try_into()
        .map_err(|_| "Master key must be 32 bytes".to_string())
}

// macOS (and any other unix that isn't Linux): keytar's keychain item matches
// keyring-core's default Keychain lookup.
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn read_termius_localkey() -> Result<String, String> {
    let entry =
        Entry::new("Termius", "localKey").map_err(|e| format!("Keychain unavailable: {e}"))?;
    entry.get_password().map_err(|e| match e {
        keyring_core::Error::NoEntry => {
            "Termius key not found in OS keychain — is Termius installed and logged in on this machine?".to_string()
        }
        other => format!("Keychain error: {other}"),
    })
}

#[cfg(target_os = "linux")]
fn read_termius_localkey() -> Result<String, String> {
    use secret_service::blocking::SecretService;
    use secret_service::EncryptionType;
    use std::collections::HashMap;

    // keytar writes to the Secret Service (gnome-keyring/KWallet via libsecret),
    // matching by attributes service/account — which differ from keyring-core's
    // defaults — so we search the Secret Service directly with keytar's schema.
    let ss = SecretService::connect(EncryptionType::Dh)
        .map_err(|e| format!("Secret Service (gnome-keyring/KWallet) unavailable: {e}"))?;

    // The `service` attribute is the basename of Termius's executable, NOT a
    // fixed "Termius" string. On macOS/Windows that basename happens to be
    // "Termius", but the Linux packages run `termius-app` (the .deb/AppImage
    // exe), so the key is stored under service="termius-app". Try the Linux
    // name first, then the macOS/Windows name, then fall back to matching the
    // account alone (any keytar service) as a last resort.
    for service in ["termius-app", "Termius"] {
        let attrs = HashMap::from([("service", service), ("account", "localKey")]);
        if let Some(secret) = lookup_secret(&ss, attrs)? {
            return decode_secret(secret);
        }
    }
    if let Some(secret) = lookup_secret(&ss, HashMap::from([("account", "localKey")]))? {
        return decode_secret(secret);
    }

    Err("Termius key not found in OS keychain — is Termius installed and logged in on this machine?".to_string())
}

#[cfg(target_os = "linux")]
fn lookup_secret(
    ss: &secret_service::blocking::SecretService,
    attributes: std::collections::HashMap<&str, &str>,
) -> Result<Option<Vec<u8>>, String> {
    let found = ss
        .search_items(attributes)
        .map_err(|e| format!("Secret Service search failed: {e}"))?;
    let Some(item) = found
        .unlocked
        .into_iter()
        .next()
        .or_else(|| found.locked.into_iter().next())
    else {
        return Ok(None);
    };
    item.unlock()
        .map_err(|e| format!("Failed to unlock keyring item: {e}"))?;
    let secret = item
        .get_secret()
        .map_err(|e| format!("Failed to read Termius key from keyring: {e}"))?;
    Ok(Some(secret))
}

#[cfg(target_os = "linux")]
fn decode_secret(secret: Vec<u8>) -> Result<String, String> {
    // keytar stores the value as a UTF-8 string (the base64 master key);
    // fetch_master_key() base64-decodes it, so hand it back as a string.
    String::from_utf8(secret).map_err(|e| format!("Termius key is not valid UTF-8: {e}"))
}

#[cfg(target_os = "windows")]
fn read_termius_localkey() -> Result<String, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target: Vec<u16> = std::ffi::OsStr::new("Termius/localKey")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut cred_ptr: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: target is null-terminated UTF-16; cred_ptr is a valid out-param.
    let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred_ptr) };
    if ok == 0 || cred_ptr.is_null() {
        let err = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        return Err(if err == ERROR_NOT_FOUND {
            "Termius key not found in Credential Manager — is Termius installed and logged in on this machine?".to_string()
        } else {
            format!("CredReadW failed (error {err})")
        });
    }

    // SAFETY: CredReadW returned success, so cred_ptr points to a valid CREDENTIALW.
    let result = unsafe {
        let cred = &*cred_ptr;
        let blob =
            std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
        decode_keytar_blob(blob)
    };
    unsafe { CredFree(cred_ptr as *mut _) };
    result
}

#[cfg(target_os = "windows")]
fn decode_keytar_blob(blob: &[u8]) -> Result<String, String> {
    // keytar writes JS strings as raw UTF-8 bytes. Try UTF-8 first; fall back
    // to UTF-16LE for non-keytar writers.
    if let Ok(s) = std::str::from_utf8(blob) {
        return Ok(s.to_string());
    }
    if blob.len() % 2 == 0 {
        let u16: Vec<u16> = blob
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        if let Ok(s) = String::from_utf16(&u16) {
            return Ok(s);
        }
    }
    Err("Credential blob is neither valid UTF-8 nor UTF-16LE".to_string())
}
