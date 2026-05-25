// Extracts and decrypts the local Termius database (no first-party export exists).
//
// Termius is an Electron app that stores its data in an IndexedDB LevelDB,
// encrypted with XSalsa20-Poly1305 (libsodium's crypto_secretbox). The 32-byte
// key lives in the OS keychain under (service="Termius", account="localKey").
//
// On-disk blob layout (base64-encoded inside the leveldb values):
//   byte 0     : version tag (must be 0x04)
//   byte 1     : options byte (ignored)
//   bytes 2..26: 24-byte nonce
//   bytes 26.. : ciphertext || 16-byte Poly1305 tag
//
// Since v4 blobs always start with bytes 0x04, 0x?? their base64 always begins
// with "BA" — we scan the raw leveldb bytes for that prefix to locate candidates.
//
// Mirrors the extraction half of github.com/ZacharyZcR/termius-exporter.

use base64::{engine::general_purpose::STANDARD, Engine};
use crypto_secretbox::{aead::Aead, KeyInit, XSalsa20Poly1305};
#[cfg(not(target_os = "windows"))]
use keyring::Entry;
use std::collections::HashSet;
use std::path::PathBuf;

const TERMIUS_DB_SUBPATH: &str = "Termius/IndexedDB/file__0.indexeddb.leveldb";
const VERSION_TAG: u8 = 0x04;
const NONCE_LEN: usize = 24;
const HEADER_LEN: usize = 2 + NONCE_LEN; // version + options + nonce
const MIN_BLOB_LEN: usize = HEADER_LEN + 16; // + Poly1305 tag

/// Returns all plausible Termius database locations for this platform. Termius
/// ships through several channels — classic installer, Microsoft Store (which
/// sandboxes the app under Packages/), and standalone — each with a different
/// data directory. We probe them in order and use the first that exists.
fn termius_db_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // 1. Classic Win32 installer: %APPDATA%\Termius\…
        if let Ok(appdata) = std::env::var("APPDATA") {
            out.push(PathBuf::from(&appdata).join(TERMIUS_DB_SUBPATH));
        }
        // 2. Microsoft Store install: %LOCALAPPDATA%\Packages\Crystalnix.Termius_<hash>\
        //    LocalCache\Roaming\Termius\…  (the <hash> suffix varies per install)
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let pkgs = PathBuf::from(&local).join("Packages");
            if let Ok(entries) = std::fs::read_dir(&pkgs) {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("Crystalnix.Termius_")
                    {
                        out.push(
                            entry
                                .path()
                                .join("LocalCache/Roaming")
                                .join(TERMIUS_DB_SUBPATH),
                        );
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            out.push(
                home.join("Library/Application Support")
                    .join(TERMIUS_DB_SUBPATH),
            );
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(config) = dirs::config_dir() {
            out.push(config.join(TERMIUS_DB_SUBPATH));
        }
    }

    out
}

fn termius_db_dir() -> Result<PathBuf, String> {
    let candidates = termius_db_candidates();
    for path in &candidates {
        if path.is_dir() {
            return Ok(path.clone());
        }
    }
    Err(format!(
        "Termius database not found. Looked in:\n  {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join("\n  ")
    ))
}

// Termius is an Electron app and writes its key via Node's `keytar`. The blob
// format differs from what the `keyring` crate expects:
//
//   * Windows: keytar uses target name "<service>/<account>" and stores the
//     password as raw UTF-8 bytes in the CredentialBlob (not as UTF-16LE — it
//     bypasses Windows' native wide-string convention). The `keyring` crate
//     uses a different target name, so we read via CredReadW directly.
//   * macOS: keytar maps to kSecAttrService/kSecAttrAccount, which matches
//     keyring's default — no special handling needed.
//   * Linux: keytar uses its own libsecret schema; keyring's default lookup
//     may miss. Fixed if/when someone hits it.
fn fetch_master_key() -> Result<[u8; 32], String> {
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
    let entry = Entry::new("Termius", "localKey")
        .map_err(|e| format!("Keychain unavailable: {e}"))?;
    entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => {
            "Termius key not found in OS keychain — is Termius installed and logged in on this machine?"
                .to_string()
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
    // SAFETY: target is a null-terminated UTF-16 string; cred_ptr is a valid out-param.
    let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred_ptr) };
    if ok == 0 || cred_ptr.is_null() {
        // SAFETY: GetLastError is always safe to call.
        let err = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        return Err(if err == ERROR_NOT_FOUND {
            "Termius key not found in Credential Manager — is Termius installed and logged in on this machine?".to_string()
        } else {
            format!("CredReadW failed (error {err})")
        });
    }

    // SAFETY: CredReadW returned success, so cred_ptr points to a valid CREDENTIALW.
    // We free it before returning.
    let result = unsafe {
        let cred = &*cred_ptr;
        let blob = std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
        decode_keytar_blob(blob)
    };
    // SAFETY: cred_ptr was returned by CredReadW.
    unsafe { CredFree(cred_ptr as *mut _) };
    result
}

#[cfg(target_os = "windows")]
fn decode_keytar_blob(blob: &[u8]) -> Result<String, String> {
    // keytar writes JS strings as raw UTF-8 bytes. Try that first. If the blob
    // is even-length and not valid UTF-8 (some other Credential Manager writer),
    // fall back to UTF-16LE — that's what Windows-native tools would use.
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

fn read_db_bytes(dir: &PathBuf) -> Result<Vec<u8>, String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read Termius database at {}: {e}", dir.display()))?;
    let mut buf = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        match path.extension().and_then(|s| s.to_str()) {
            Some("log") | Some("ldb") => {
                if let Ok(bytes) = std::fs::read(&path) {
                    buf.extend_from_slice(&bytes);
                }
            }
            _ => {}
        }
    }
    if buf.is_empty() {
        return Err(format!("No .log/.ldb files in {}", dir.display()));
    }
    Ok(buf)
}

/// Scan raw leveldb bytes for base64 blobs starting with "BA" (the v4 secretbox
/// version tag). Returns unique candidate strings.
fn extract_blob_candidates(data: &[u8]) -> Vec<&str> {
    fn is_b64(b: u8) -> bool {
        b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'='
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 2 < data.len() {
        if data[i] == b'B' && data[i + 1] == b'A' {
            let mut j = i + 2;
            while j < data.len() && is_b64(data[j]) {
                j += 1;
            }
            // Minimum: "BA" + 30 base64 chars (≈ matches the original script's threshold).
            if j - i >= 32 {
                // SAFETY: every byte in the slice is ASCII (validated by is_b64 above
                // plus the literal 'B','A'), so the slice is valid UTF-8.
                let candidate = unsafe { std::str::from_utf8_unchecked(&data[i..j]) };
                if seen.insert(candidate) {
                    out.push(candidate);
                }
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    out
}

fn try_decrypt(cipher: &XSalsa20Poly1305, blob_b64: &str) -> Option<String> {
    let data = STANDARD.decode(blob_b64).ok()?;
    if data.len() < MIN_BLOB_LEN || data[0] != VERSION_TAG {
        return None;
    }
    let nonce = <&[u8; NONCE_LEN]>::try_from(&data[2..HEADER_LEN]).ok()?;
    let plaintext = cipher.decrypt(nonce.into(), &data[HEADER_LEN..]).ok()?;
    String::from_utf8(plaintext).ok()
}

/// Decrypt the local Termius database and return the recovered JSON entity
/// strings. The caller parses them into a Voltius ExportBundle.
#[tauri::command]
pub fn termius_extract() -> Result<Vec<String>, String> {
    let dir = termius_db_dir()?;
    let key = fetch_master_key()?;
    let db = read_db_bytes(&dir)?;
    let cipher = XSalsa20Poly1305::new(&key.into());
    Ok(extract_blob_candidates(&db)
        .into_iter()
        .filter_map(|b| try_decrypt(&cipher, b))
        .collect())
}
