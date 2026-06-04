// ─── OS keychain ──────────────────────────────────────────────────────────────
//
// Termius writes its key via Node's `keytar`. The blob format differs from what
// the `keyring` crate expects:
//   * Windows: keytar uses target "<service>/<account>" and stores the password
//     as raw UTF-8 bytes in CredentialBlob — we call CredReadW directly because
//     `keyring`'s target name doesn't match.
//   * macOS: keytar's keychain item matches `keyring`'s default lookup.
//   * Linux: keytar uses its own libsecret schema; not yet handled here.

use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(not(target_os = "windows"))]
use keyring::Entry;

pub(super) fn fetch_master_key() -> Result<[u8; 32], String> {
    let b64 = read_termius_localkey()?;
    let bytes = STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Master key is not valid base64: {e}"))?;
    bytes
        .try_into()
        .map_err(|_| "Master key must be 32 bytes".to_string())
}

#[cfg(not(target_os = "windows"))]
fn read_termius_localkey() -> Result<String, String> {
    let entry =
        Entry::new("Termius", "localKey").map_err(|e| format!("Keychain unavailable: {e}"))?;
    entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => {
            "Termius key not found in OS keychain — is Termius installed and logged in on this machine?".to_string()
        }
        other => format!("Keychain error: {other}"),
    })
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
