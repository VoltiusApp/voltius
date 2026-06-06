// Extracts and decrypts locally-stored MobaXterm sessions (no first-party export
// covers passwords). MobaXterm ≥25.0 (v26) fixed CVE-2025-0714 by switching from a
// fixed IV to a random per-password IV stored inline; this handles both formats.
//
// Where things live (HKCU\Software\Mobatek\MobaXterm):
//   • Session bookmarks (host/port/user/folders) — registry `Bookmarks*` subkeys
//     for the Installer Edition, or %APPDATA%\MobaXterm\MobaXterm.ini for Portable.
//   • Session passwords — `P` subkey, keyed by `username@host`.
//   • Saved credentials — `C` subkey, value = `username:<encrypted>`.
//   • Master-password hash — `M\<user>@<host>`, DPAPI-protected with entropy =
//     the `SessionP` value. base64(CryptUnprotectData(...))[:32] is the AES-256 key,
//     so no master password needs to be typed.
//
// Stored value format (v25+):  "_@" + IV(16 ASCII chars) + base64(ciphertext)
//   key  = base64(DPAPI master hash)[:32]   (or SHA512(master_password)[:32])
//   IV   = the 16 chars right after "_@", used directly as the 16 IV bytes
//   body = base64-decode the FULL string (alphabet @->+, _->/), drop first 15 bytes
//   password = AES-256-CFB8(key, IV).decrypt(body)
// Legacy (≤v24) values have no "_@": the whole string is the base64 ciphertext and
// IV = AES-ECB(key).encrypt([0;16]).
//
// Crypto + format parsing here are cross-platform (and unit-tested); only the
// registry read + DPAPI unprotect are Windows-gated.

use base64::alphabet::Alphabet;
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig};
use base64::engine::DecodePaddingMode;
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;

#[cfg(target_os = "windows")]
use base64::engine::general_purpose::STANDARD;

#[cfg(target_os = "windows")]
use windows_registry::{Key, CURRENT_USER};

#[derive(Serialize)]
pub struct MobaCredential {
    pub name: String,
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct MobaSnapshot {
    /// Bookmark sections as INI text (reconstructed from the registry, or read from
    /// MobaXterm.ini). None if neither source was found. Parsed by the TS importer.
    pub ini: Option<String>,
    /// `P` subkey: decrypted session passwords keyed by registry value name.
    pub passwords: HashMap<String, String>,
    /// `C` subkey: decrypted saved credentials.
    pub credentials: Vec<MobaCredential>,
    /// False when DPAPI key derivation failed — sessions still import, passwordless.
    pub key_derived: bool,
}

// ─── base64 (MobaXterm variant alphabet: + -> @, / -> _) ────────────────────────
// These crypto/format helpers are only called from the Windows-gated registry code
// (and the tests), so off-Windows non-test builds see them as unused.

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn moba_b64() -> GeneralPurpose {
    // Standard base64 alphabet with the last two symbols swapped to @ and _.
    let alphabet =
        Alphabet::new("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@_")
            .expect("valid base64 alphabet");
    let cfg = GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true);
    GeneralPurpose::new(&alphabet, cfg)
}

// ─── AES-256-CFB8 (segment_size = 8) ────────────────────────────────────────────

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn cfb8_decrypt(key: &[u8; 32], iv: &[u8; 16], data: &[u8]) -> Vec<u8> {
    use aes::cipher::KeyIvInit;
    type Dec = cfb8::Decryptor<aes::Aes256>;
    let mut buf = data.to_vec();
    Dec::new(key.into(), iv.into()).decrypt(&mut buf);
    buf
}

/// Legacy (≤v24) IV: a single AES-ECB encryption of a zero block.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn aes_ecb_zero(key: &[u8; 32]) -> [u8; 16] {
    use aes::cipher::{BlockCipherEncrypt, KeyInit};
    let cipher = aes::Aes256::new(key.into());
    let mut block = aes::cipher::Array::from([0u8; 16]);
    cipher.encrypt_block(&mut block);
    block.into()
}

/// Decrypt one stored MobaXterm value (handles both v25+ and legacy formats).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn decrypt_value(key: &[u8; 32], stored: &str) -> Result<Vec<u8>, String> {
    let engine = moba_b64();
    if let Some(rest) = stored.strip_prefix("_@") {
        // v25+: the 16 chars after "_@" are the IV (used as raw bytes).
        let iv_chars: Vec<u8> = rest.chars().take(16).map(|c| c as u8).collect();
        if iv_chars.len() < 16 {
            return Err("value too short for inline IV".into());
        }
        let mut iv = [0u8; 16];
        iv.copy_from_slice(&iv_chars[..16]);
        // Decode the FULL stored string, then drop the first 15 bytes -> ciphertext.
        let full = engine
            .decode(stored)
            .map_err(|e| format!("base64 decode failed: {e}"))?;
        if full.len() < 15 {
            return Err("value too short for body".into());
        }
        Ok(cfb8_decrypt(key, &iv, &full[15..]))
    } else {
        let ct = engine
            .decode(stored)
            .map_err(|e| format!("base64 decode failed: {e}"))?;
        let iv = aes_ecb_zero(key);
        Ok(cfb8_decrypt(key, &iv, &ct))
    }
}

// ─── Tauri command ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn mobaxterm_extract() -> Result<MobaSnapshot, String> {
    #[cfg(target_os = "windows")]
    {
        extract_windows()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err(
            "MobaXterm automatic import is only available on Windows. Use the file \
             upload below to import a MobaXterm.ini / .mxtsessions file instead."
                .into(),
        )
    }
}

// ─── Windows: registry + DPAPI ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
const REG_BASE: &str = r"Software\Mobatek\MobaXterm";

/// Standard DPAPI blob header (MobaXterm stores the M value without it).
#[cfg(target_os = "windows")]
const DPAPI_HEADER: [u8; 20] = [
    0x01, 0x00, 0x00, 0x00, 0xd0, 0x8c, 0x9d, 0xdf, 0x01, 0x15, 0xd1, 0x11, 0x8c, 0x7a, 0x00, 0xc0,
    0x4f, 0xc2, 0x97, 0xeb,
];

#[cfg(target_os = "windows")]
fn extract_windows() -> Result<MobaSnapshot, String> {
    let base = CURRENT_USER.open(REG_BASE).map_err(|e| {
        format!("MobaXterm not found in the registry ({e}). Is MobaXterm installed for this user?")
    })?;

    // Session structure: prefer registry bookmarks (Installer Edition), fall back to
    // the MobaXterm.ini file (Portable Edition).
    let ini = bookmarks_to_ini(&base).or_else(read_ini_file);

    // Passwords/credentials require the DPAPI-derived key. If derivation fails, keep
    // sessions but import passwordless (no master-password prompt, by design).
    let (passwords, credentials, key_derived) = match derive_key_from_registry(&base) {
        Ok(key) => (
            read_subkey_passwords(&base, &key, "P"),
            read_credentials(&base, &key),
            true,
        ),
        Err(_) => (HashMap::new(), Vec::new(), false),
    };

    Ok(MobaSnapshot {
        ini,
        passwords,
        credentials,
        key_derived,
    })
}

#[cfg(target_os = "windows")]
fn derive_key_from_registry(base: &Key) -> Result<[u8; 32], String> {
    let session_p = base
        .get_string("SessionP")
        .map_err(|e| format!("SessionP value missing: {e}"))?;

    let user = std::env::var("USERNAME").map_err(|_| "USERNAME not set".to_string())?;
    let host = std::env::var("COMPUTERNAME").map_err(|_| "COMPUTERNAME not set".to_string())?;

    let m = base
        .open("M")
        .map_err(|e| format!("M subkey missing: {e}"))?;
    let stored = m
        .get_string(format!("{user}@{host}"))
        .map_err(|e| format!("master hash for {user}@{host} missing: {e}"))?;

    let mut blob = DPAPI_HEADER.to_vec();
    blob.extend_from_slice(
        &STANDARD
            .decode(stored.trim())
            .map_err(|e| format!("M value not base64: {e}"))?,
    );

    // entropy = the SessionP value (UTF-8 bytes), exactly as MobaXterm passes it.
    let master_hash = dpapi_unprotect(&blob, session_p.as_bytes())?;
    let key = STANDARD
        .decode(&master_hash)
        .map_err(|e| format!("master hash not base64: {e}"))?;
    if key.len() < 32 {
        return Err("derived key shorter than 32 bytes".into());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&key[..32]);
    Ok(out)
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let ent_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // SAFETY: in/ent blobs point to valid slices for the call; out_blob is a valid
    // out-param that DPAPI fills with a LocalAlloc'd buffer we free below.
    let ok = unsafe {
        CryptUnprotectData(
            &in_blob,
            std::ptr::null_mut(),
            &ent_blob,
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut out_blob,
        )
    };
    if ok == 0 {
        let err = unsafe { GetLastError() };
        return Err(format!("CryptUnprotectData failed (error {err})"));
    }

    let out =
        unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec() };
    unsafe { LocalFree(out_blob.pbData as *mut _) };
    Ok(out)
}

/// Reconstruct INI text from registry `Bookmarks*` subkeys so the existing TS
/// bookmark parser can consume it unchanged. Each subkey becomes a `[section]`,
/// each value a `name=data` line (sessions are `SessionName=#109#…`).
#[cfg(target_os = "windows")]
fn bookmarks_to_ini(base: &Key) -> Option<String> {
    let mut out = String::new();
    let mut found = false;
    for name in base.keys().ok()? {
        if !name.starts_with("Bookmarks") {
            continue;
        }
        let Ok(sub) = base.open(&name) else {
            continue;
        };
        out.push('[');
        out.push_str(&name);
        out.push_str("]\r\n");
        let Ok(values) = sub.values() else {
            continue;
        };
        for (vname, val) in values {
            if let Ok(s) = String::try_from(val) {
                out.push_str(&vname);
                out.push('=');
                out.push_str(&s);
                out.push_str("\r\n");
            }
        }
        found = true;
    }
    if found {
        Some(out)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn read_ini_file() -> Option<String> {
    let appdata = std::env::var("APPDATA").ok()?;
    let path = std::path::Path::new(&appdata)
        .join("MobaXterm")
        .join("MobaXterm.ini");
    std::fs::read_to_string(path).ok()
}

#[cfg(target_os = "windows")]
fn read_subkey_passwords(base: &Key, key: &[u8; 32], sub: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(k) = base.open(sub) else {
        return out;
    };
    let Ok(values) = k.values() else {
        return out;
    };
    for (name, val) in values {
        let Ok(enc) = String::try_from(val) else {
            continue;
        };
        if let Ok(plain) = decrypt_value(key, &enc) {
            out.insert(name, String::from_utf8_lossy(&plain).into_owned());
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn read_credentials(base: &Key, key: &[u8; 32]) -> Vec<MobaCredential> {
    let mut out = Vec::new();
    let Ok(k) = base.open("C") else {
        return out;
    };
    let Ok(values) = k.values() else {
        return out;
    };
    for (name, val) in values {
        let Ok(raw) = String::try_from(val) else {
            continue;
        };
        // value = "username:<encrypted>"
        let (user, enc) = raw.split_once(':').unwrap_or(("", raw.as_str()));
        if let Ok(plain) = decrypt_value(key, enc) {
            out.push(MobaCredential {
                name,
                username: user.to_string(),
                password: String::from_utf8_lossy(&plain).into_owned(),
            });
        }
    }
    out
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn cfb8_encrypt(key: &[u8; 32], iv: &[u8; 16], data: &[u8]) -> Vec<u8> {
        use aes::cipher::KeyIvInit;
        type Enc = cfb8::Encryptor<aes::Aes256>;
        let mut buf = data.to_vec();
        Enc::new(key.into(), iv.into()).encrypt(&mut buf);
        buf
    }

    #[test]
    fn decrypt_value_handles_v25_inline_iv() {
        // Build a "_@" + IV(16) + base64(ciphertext) value matching the documented
        // wire format and confirm decrypt_value recovers the plaintext.
        //
        // Layout trick: decrypt_value base64-decodes the FULL string and drops the
        // first 15 bytes. 20 base64 chars decode to exactly 15 bytes, so a 20-char
        // prefix ("_@" + 16 IV chars + 2 filler) keeps the boundary aligned — the
        // ciphertext segment then decodes independently as the body.
        let key = [7u8; 32];
        let iv_str = "abcdEFGH12345678"; // 16 ASCII chars, all valid base64 symbols
        let mut iv = [0u8; 16];
        iv.copy_from_slice(iv_str.as_bytes());
        let plaintext = b"Sup3rSecret!";

        let ct = cfb8_encrypt(&key, &iv, plaintext);
        // "_@" (2) + iv_str (16) + "AA" (2) = 20 chars => 15 bytes that get dropped.
        let stored = format!("_@{iv_str}AA{}", moba_b64().encode(&ct));

        let got = decrypt_value(&key, &stored).unwrap();
        assert_eq!(&got, plaintext);
    }

    #[test]
    fn decrypt_value_handles_legacy_ecb_iv() {
        // Legacy (≤v24): whole string is base64 ciphertext, IV = AES-ECB(key, 0).
        let key = [0x42u8; 32];
        let iv = aes_ecb_zero(&key);
        let plaintext = b"legacy-password";

        let ct = cfb8_encrypt(&key, &iv, plaintext);
        let stored = moba_b64().encode(&ct);

        let got = decrypt_value(&key, &stored).unwrap();
        assert_eq!(&got, plaintext);
    }

    #[test]
    fn moba_b64_uses_variant_alphabet() {
        // The variant maps + -> @ and / -> _, so bytes that yield +/ in standard
        // base64 must round-trip through the @_ alphabet.
        let data = [0xfbu8, 0xff, 0xbf];
        let encoded = moba_b64().encode(data);
        assert!(encoded.contains('@') || encoded.contains('_'));
        assert_eq!(moba_b64().decode(&encoded).unwrap(), data);
    }

    #[test]
    fn decrypt_value_rejects_short_inline_iv() {
        // "_@" present but fewer than 16 IV chars follow.
        let err = decrypt_value(&[0u8; 32], "_@abc").unwrap_err();
        assert!(err.contains("too short for inline IV"), "got: {err}");
    }

    #[test]
    fn decrypt_value_rejects_invalid_base64() {
        // '!' is outside the @_ variant alphabet, so the legacy branch fails to decode.
        let err = decrypt_value(&[0u8; 32], "!!!!").unwrap_err();
        assert!(err.contains("base64 decode failed"), "got: {err}");
    }
}
