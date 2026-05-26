// Extracts and decrypts the local Termius database (no first-party export exists).
//
// Termius is an Electron app that stores its data in Chromium's IndexedDB,
// which is itself a LevelDB on disk. Each Termius "table" (hosts, keys,
// ssh_identities, groups, host_chains, pf_rules, ...) is a separate IndexedDB
// *database* with one object store at id 1. Inside each object store, every row
// is V8-Structured-Clone-serialized; foreign keys to other entities sit in the
// envelope as plaintext (e.g. `ssh_config: { id: 7671863 }`), while user-visible
// fields like address/label/password are each separately encrypted with
// XSalsa20-Poly1305 (libsodium crypto_secretbox). The 32-byte master key lives
// in the OS keychain under (service="Termius", account="localKey").
//
// On-disk encrypted blob layout (base64 inside the V8 string values):
//   byte 0     : version tag (must be 0x04)  → base64 always starts "BA"
//   byte 1     : options byte (ignored)
//   bytes 2..26: 24-byte nonce
//   bytes 26.. : ciphertext || 16-byte Poly1305 tag
//
// Original reverse-engineering credit: github.com/ZacharyZcR/termius-exporter.
// The leveldb-aware extraction here is voltius-specific.

use base64::{engine::general_purpose::STANDARD, Engine};
use crypto_secretbox::{aead::Aead, KeyInit, XSalsa20Poly1305};
#[cfg(not(target_os = "windows"))]
use keyring::Entry;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

const TERMIUS_DB_SUBPATH: &str = "Termius/IndexedDB/file__0.indexeddb.leveldb";
const VERSION_TAG: u8 = 0x04;
const NONCE_LEN: usize = 24;
const HEADER_LEN: usize = 2 + NONCE_LEN;
const MIN_BLOB_LEN: usize = HEADER_LEN + 16;

#[derive(Clone, Serialize)]
pub struct TermiusRecord {
    /// IndexedDB store name (e.g. "hosts", "keys", "ssh_identities",
    /// "ssh_config_identities", "host_chains", "pf_rules", "groups",
    /// "snippets", "known_hosts", ...). The TS parser classifies by this.
    pub db_name: String,
    /// Primary key from the V8 envelope's top-level `id`.
    pub termius_id: i64,
    pub local_id: Option<i64>,
    pub updated_at: Option<String>,
    pub status: Option<String>,
    /// Foreign keys discovered as nested `{ "id": N }` objects in the envelope.
    /// Keyed by the parent field name (e.g. `ssh_config`, `group`, `ssh_key`,
    /// `identity`). The numeric value is the referenced entity's id.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub foreign_keys: BTreeMap<String, i64>,
    /// Array-typed foreign keys (for relation arrays like host_chains.hosts_chain).
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub foreign_key_arrays: BTreeMap<String, Vec<i64>>,
    /// Merged decrypted view: envelope plaintext scalars (os_name, backspace,
    /// interaction_date, is_visible, …) merged with decrypted blobs (the main
    /// `content` field plus per-field blobs like address, label, password,
    /// username). The TS parser treats this as the entity's body.
    pub decrypted: Value,
}

#[derive(Serialize)]
pub struct TermiusSnapshot {
    pub version: u8,
    pub records: Vec<TermiusRecord>,
}

// ─── DB location ──────────────────────────────────────────────────────────────

/// Returns all plausible Termius database locations for this platform. Termius
/// ships through several channels — classic installer, Microsoft Store (which
/// sandboxes the app under Packages/), and standalone — each with a different
/// data directory.
fn termius_db_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            out.push(PathBuf::from(&appdata).join(TERMIUS_DB_SUBPATH));
        }
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
            out.push(home.join("Library/Application Support").join(TERMIUS_DB_SUBPATH));
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
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n  ")
    ))
}

// ─── OS keychain ──────────────────────────────────────────────────────────────
//
// Termius writes its key via Node's `keytar`. The blob format differs from what
// the `keyring` crate expects:
//   * Windows: keytar uses target "<service>/<account>" and stores the password
//     as raw UTF-8 bytes in CredentialBlob — we call CredReadW directly because
//     `keyring`'s target name doesn't match.
//   * macOS: keytar's keychain item matches `keyring`'s default lookup.
//   * Linux: keytar uses its own libsecret schema; not yet handled here.

fn fetch_master_key() -> Result<[u8; 32], String> {
    let b64 = read_termius_localkey()?;
    let bytes = STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Master key is not valid base64: {e}"))?;
    bytes.try_into().map_err(|_| "Master key must be 32 bytes".to_string())
}

#[cfg(not(target_os = "windows"))]
fn read_termius_localkey() -> Result<String, String> {
    let entry = Entry::new("Termius", "localKey").map_err(|e| format!("Keychain unavailable: {e}"))?;
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
        let blob = std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
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
        let u16: Vec<u16> = blob.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        if let Ok(s) = String::from_utf16(&u16) {
            return Ok(s);
        }
    }
    Err("Credential blob is neither valid UTF-8 nor UTF-16LE".to_string())
}

// ─── V8 SSV decoder ───────────────────────────────────────────────────────────
//
// Chromium serializes IndexedDB values with V8's structured-clone format. Only
// the subset of tags Termius actually emits is handled here. Unknown tags abort
// the current container — preferable to silently producing wrong data.

mod v8 {
    use serde_json::{Map, Number, Value};

    pub fn decode_envelope(bytes: &[u8]) -> Option<Value> {
        let mut p = Parser { bytes, pos: 0 };
        // Skip leading version/header bytes until the first 'o' (object start).
        while p.pos < p.bytes.len() && p.bytes[p.pos] != b'o' {
            p.pos += 1;
        }
        if p.pos >= p.bytes.len() {
            return None;
        }
        p.pos += 1; // consume 'o'
        p.read_object()
    }

    struct Parser<'a> {
        bytes: &'a [u8],
        pos: usize,
    }

    impl<'a> Parser<'a> {
        fn peek(&self) -> Option<u8> { self.bytes.get(self.pos).copied() }

        fn advance(&mut self) -> Option<u8> {
            let b = self.peek()?;
            self.pos += 1;
            Some(b)
        }

        fn varint(&mut self) -> Option<u64> {
            let mut v = 0u64;
            let mut s = 0u32;
            while s < 64 {
                let b = self.advance()?;
                v |= ((b & 0x7f) as u64) << s;
                if b & 0x80 == 0 {
                    return Some(v);
                }
                s += 7;
            }
            None
        }

        /// Skip alignment padding (V8 aligns 2-byte strings to even byte
        /// offsets with 0x00 padding bytes) and stray header markers.
        fn skip_padding(&mut self) {
            while let Some(b) = self.peek() {
                if b == 0x00 || b == 0xff {
                    self.pos += 1;
                } else {
                    break;
                }
            }
        }

        fn read_string(&mut self, tag: u8) -> Option<String> {
            let len = self.varint()? as usize;
            if self.pos + len > self.bytes.len() {
                return None;
            }
            let bytes = &self.bytes[self.pos..self.pos + len];
            self.pos += len;
            match tag {
                b'"' => {
                    // V8 "OneByteString": each byte is a Latin-1 code point. For
                    // ASCII data (the common case) this is identical to UTF-8.
                    Some(bytes.iter().map(|&b| b as char).collect())
                }
                b'c' => {
                    if len % 2 != 0 {
                        return None;
                    }
                    let u16s: Vec<u16> = bytes
                        .chunks_exact(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .collect();
                    Some(String::from_utf16_lossy(&u16s))
                }
                b'S' => Some(String::from_utf8_lossy(bytes).into_owned()),
                _ => None,
            }
        }

        fn read_value(&mut self) -> Option<Value> {
            self.skip_padding();
            let tag = self.advance()?;
            match tag {
                b'"' | b'c' | b'S' => self.read_string(tag).map(Value::String),
                b'I' => {
                    let v = self.varint()?;
                    let zz = ((v >> 1) as i64) ^ -((v & 1) as i64);
                    Some(Value::Number(zz.into()))
                }
                b'U' => {
                    let v = self.varint()?;
                    Some(Value::Number(v.into()))
                }
                b'N' => {
                    if self.pos + 8 > self.bytes.len() {
                        return None;
                    }
                    let mut buf = [0u8; 8];
                    buf.copy_from_slice(&self.bytes[self.pos..self.pos + 8]);
                    self.pos += 8;
                    let d = f64::from_le_bytes(buf);
                    Number::from_f64(d).map(Value::Number).or(Some(Value::Null))
                }
                b'0' | b'_' => Some(Value::Null),
                b'T' => Some(Value::Bool(true)),
                b'F' => Some(Value::Bool(false)),
                b'o' => self.read_object(),
                b'A' => self.read_array(b'$'),
                b'a' => self.read_array(b'@'),
                _ => None,
            }
        }

        fn read_object(&mut self) -> Option<Value> {
            let mut map = Map::new();
            loop {
                self.skip_padding();
                match self.peek()? {
                    b'{' => {
                        self.pos += 1;
                        let _properties = self.varint()?;
                        return Some(Value::Object(map));
                    }
                    _ => {}
                }
                let key_tag = self.advance()?;
                let key = match key_tag {
                    b'"' | b'c' | b'S' => self.read_string(key_tag)?,
                    _ => {
                        // Unexpected — bail out, returning what we've got.
                        return Some(Value::Object(map));
                    }
                };
                let value = self.read_value()?;
                map.insert(key, value);
            }
        }

        fn read_array(&mut self, terminator: u8) -> Option<Value> {
            let _length = self.varint()?;
            let mut arr = Vec::new();
            loop {
                self.skip_padding();
                if self.peek()? == terminator {
                    self.pos += 1;
                    let _length2 = self.varint()?;
                    let _props = self.varint()?;
                    return Some(Value::Array(arr));
                }
                arr.push(self.read_value()?);
            }
        }
    }
}

// ─── IndexedDB key decoder ────────────────────────────────────────────────────

/// A Chromium IndexedDB key. We only care about a subset:
///   `0x00 <db_id> <store_id> <index_id> <user_key…>`
/// Index id 1 is the primary object-store data; 2 is the "exists" sidecar.
struct IdbKey {
    db_id: u8,
    object_store_id: u8,
    index_id: u8,
}

fn decode_idb_key(key: &[u8]) -> Option<IdbKey> {
    if key.len() < 4 || key[0] != 0x00 {
        return None;
    }
    Some(IdbKey {
        db_id: key[1],
        object_store_id: key[2],
        index_id: key[3],
    })
}

// ─── Database name map ────────────────────────────────────────────────────────
//
// Per-database metadata lives under keys of the form
//   `0x00 <db_id> 0x00 0x00 0x32 <object_store_id> <field>`
// Within that, field `0x00` is the store's display name (UTF-16LE with a
// 1-byte length prefix and 1-byte padding). We walk *every* db_id at object
// store id 1 and pull the name.

fn build_db_name_map(entries: &[(Vec<u8>, Vec<u8>)]) -> HashMap<u8, String> {
    let mut out = HashMap::new();
    for (k, v) in entries {
        // We're looking for keys starting `00 <db_id> 00 00 32 01 00`.
        if k.len() < 7 || k[0] != 0x00 || k[2] != 0x00 || k[3] != 0x00 || k[4] != 0x32 || k[5] != 0x01 || k[6] != 0x00 {
            continue;
        }
        let db_id = k[1];
        // Value is UTF-16-BE encoded store name with no length prefix. Chromium's
        // IndexedDB uses big-endian for keys it expects to compare byte-wise across
        // platforms (so sort order is consistent regardless of native endianness).
        if v.is_empty() || v.len() % 2 != 0 {
            continue;
        }
        let u16s: Vec<u16> = v
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        if let Ok(name) = String::from_utf16(&u16s) {
            out.insert(db_id, name);
        }
    }
    out
}

// ─── Per-record assembly ──────────────────────────────────────────────────────

/// Walk a decoded V8 envelope object, splitting it into:
///   - the primary key (`id`)
///   - common metadata (`local_id`, `updated_at`, `status`)
///   - foreign keys: every value that is a `{ id: N, … }` object becomes
///     `foreign_keys[parent_field] = N`. Arrays of such objects become
///     `foreign_key_arrays[parent_field] = [N, …]`.
///   - plaintext scalars: everything else carried inline
///   - encrypted blob fields: strings starting with "BA…" that look like
///     XSalsa20-Poly1305 ciphertext. The "content" field is the primary blob
///     and its decrypted JSON is merged into the body; other blob fields
///     (label, address, username, password, private_key, …) are decrypted in
///     place under their original key.
struct ExtractedRecord {
    termius_id: i64,
    local_id: Option<i64>,
    updated_at: Option<String>,
    status: Option<String>,
    foreign_keys: BTreeMap<String, i64>,
    foreign_key_arrays: BTreeMap<String, Vec<i64>>,
    body: Map<String, Value>,
}

fn id_from_object(v: &Value) -> Option<i64> {
    v.as_object().and_then(|m| m.get("id")).and_then(|x| x.as_i64())
}

fn extract_record(envelope: Value, cipher: &XSalsa20Poly1305) -> Option<ExtractedRecord> {
    let obj = envelope.as_object()?.clone();

    let termius_id = obj.get("id").and_then(|v| v.as_i64())?;
    let local_id = obj.get("local_id").and_then(|v| v.as_i64());
    let updated_at = obj.get("updated_at").and_then(|v| v.as_str()).map(str::to_string);
    let status = obj.get("status").and_then(|v| v.as_str()).map(str::to_string);

    let mut foreign_keys: BTreeMap<String, i64> = BTreeMap::new();
    let mut foreign_key_arrays: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    let mut body: Map<String, Value> = Map::new();

    for (key, value) in obj.into_iter() {
        match key.as_str() {
            "id" | "local_id" | "updated_at" | "status" => continue,
            _ => {}
        }

        // FK case: nested object with `id`.
        if let Some(fk) = id_from_object(&value) {
            foreign_keys.insert(key, fk);
            continue;
        }

        // FK array case: array of `{ id }` objects (or plain ints).
        if let Some(arr) = value.as_array() {
            let mut ids = Vec::new();
            let mut all_ids = true;
            for elt in arr {
                if let Some(id) = id_from_object(elt) {
                    ids.push(id);
                } else if let Some(id) = elt.as_i64() {
                    ids.push(id);
                } else {
                    all_ids = false;
                    break;
                }
            }
            if all_ids && !ids.is_empty() {
                foreign_key_arrays.insert(key, ids);
                continue;
            }
        }

        // Encrypted blob (string starting with "BA…").
        if let Some(s) = value.as_str() {
            if looks_encrypted(s) {
                if let Some(plain) = decrypt_blob(cipher, s) {
                    if key == "content" {
                        // Main payload — merge its fields into the body.
                        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&plain) {
                            for (k, v) in map {
                                body.entry(k).or_insert(v);
                            }
                            continue;
                        }
                    }
                    // Other blob fields are scalar strings (label, address,
                    // username, password, private_key, public_key, …).
                    body.insert(key, Value::String(plain));
                    continue;
                }
                // Decryption failed — drop the blob string entirely; it's
                // unreadable noise.
                continue;
            }
        }

        // Plaintext scalar (or non-id object/array) — carry through.
        body.insert(key, value);
    }

    Some(ExtractedRecord {
        termius_id,
        local_id,
        updated_at,
        status,
        foreign_keys,
        foreign_key_arrays,
        body,
    })
}

fn looks_encrypted(s: &str) -> bool {
    s.len() >= 32
        && s.starts_with("BA")
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

fn decrypt_blob(cipher: &XSalsa20Poly1305, blob_b64: &str) -> Option<String> {
    let data = STANDARD.decode(blob_b64).ok()?;
    if data.len() < MIN_BLOB_LEN || data[0] != VERSION_TAG {
        return None;
    }
    let nonce = <&[u8; NONCE_LEN]>::try_from(&data[2..HEADER_LEN]).ok()?;
    let plaintext = cipher.decrypt(nonce.into(), &data[HEADER_LEN..]).ok()?;
    String::from_utf8(plaintext)
        .ok()
        // Some blobs decrypt to plain strings; trim NULs at the end (rare).
        .map(|s| s.trim_end_matches('\0').to_string())
}

fn is_inactive_status(status: Option<&str>) -> bool {
    let Some(status) = status.map(|s| s.to_ascii_lowercase()) else {
        return false;
    };
    status == "deleted" || status == "removed" || status == "delete" || status.ends_with("_failed")
}

// ─── Leveldb iteration ────────────────────────────────────────────────────────

fn copy_db_to_temp(src: &Path) -> Result<PathBuf, String> {
    let temp = std::env::temp_dir().join(format!("voltius-termius-ldb-{}", std::process::id()));
    if temp.exists() {
        let _ = std::fs::remove_dir_all(&temp);
    }
    std::fs::create_dir_all(&temp).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let entries = std::fs::read_dir(src).map_err(|e| format!("Cannot read Termius db: {e}"))?;
    let mut copied = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        // Skip the LOCK file; copying it would just recreate the lock semantics
        // in our temp copy and break opens.
        if name.to_string_lossy() == "LOCK" {
            continue;
        }
        if std::fs::copy(entry.path(), temp.join(&name)).is_ok() {
            copied += 1;
        }
    }
    if copied == 0 {
        return Err("No files copied from Termius db dir".to_string());
    }
    Ok(temp)
}

fn read_all_entries(dir: &Path) -> Result<Vec<(Vec<u8>, Vec<u8>)>, String> {
    use rusty_leveldb::{LdbIterator, Options, DB};
    let mut opts = Options::default();
    opts.create_if_missing = false;
    let mut db = DB::open(dir, opts).map_err(|e| format!("Failed to open leveldb: {e}"))?;
    let mut iter = db.new_iter().map_err(|e| format!("Failed to iterate leveldb: {e}"))?;
    let mut out = Vec::new();
    while let Some((k, v)) = iter.next() {
        out.push((k, v));
    }
    Ok(out)
}

// ─── Public commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn termius_extract() -> Result<TermiusSnapshot, String> {
    // Wrap in catch_unwind so any panic in the V8 SSV decoder or leveldb reader
    // surfaces as a clean error string instead of aborting the Tauri app.
    std::panic::catch_unwind(termius_extract_inner)
        .map_err(|panic| {
            let msg = panic
                .downcast_ref::<&'static str>().copied()
                .or_else(|| panic.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("unknown panic");
            format!("Termius extraction panicked: {msg}")
        })?
}

fn termius_extract_inner() -> Result<TermiusSnapshot, String> {
    let dir = termius_db_dir()?;
    let key = fetch_master_key()?;
    let cipher = XSalsa20Poly1305::new(&key.into());

    let temp = copy_db_to_temp(&dir)?;
    let entries = read_all_entries(&temp);
    let _ = std::fs::remove_dir_all(&temp);
    let entries = entries?;

    let db_names = build_db_name_map(&entries);

    let mut records: Vec<TermiusRecord> = Vec::new();
    let mut decoded_count = 0usize;
    for (k, v) in &entries {
        let Some(idb) = decode_idb_key(k) else { continue };
        // Object-store DATA entries only. Index id 1 is the primary store;
        // anything else (2 = exists, 0x1f/0x20/0x21/0x22/0x23 = indexes) is
        // either internal or a denormalised index, which we don't need
        // because we read the full value.
        if idb.index_id != 0x01 || idb.object_store_id != 0x01 {
            continue;
        }

        let Some(db_name) = db_names.get(&idb.db_id) else { continue };
        let Some(envelope) = v8::decode_envelope(v) else { continue };
        let Some(rec) = extract_record(envelope, &cipher) else { continue };
        decoded_count += 1;

        if is_inactive_status(rec.status.as_deref()) {
            continue;
        }

        records.push(TermiusRecord {
            db_name: db_name.clone(),
            termius_id: rec.termius_id,
            local_id: rec.local_id,
            updated_at: rec.updated_at,
            status: rec.status,
            foreign_keys: rec.foreign_keys,
            foreign_key_arrays: rec.foreign_key_arrays,
            decrypted: Value::Object(rec.body),
        });
    }

    // If no records came through at all, give a clearer error than "no items".
    // This usually means the schema-detection (db name map) misfired.
    if records.is_empty() {
        return Err(format!(
            "Extracted 0 records from {} leveldb entries (decoded {}, db_name map has {} entries). Termius's IndexedDB schema may have changed.",
            entries.len(),
            decoded_count,
            db_names.len(),
        ));
    }

    // Stable ordering: by db_name then termius_id.
    records.sort_by(|a, b| (a.db_name.as_str(), a.termius_id).cmp(&(b.db_name.as_str(), b.termius_id)));

    Ok(TermiusSnapshot { version: 2, records })
}

/// Diagnostic: redact secrets in a snapshot and write it to the given path.
/// Used by the import UI's "Save snapshot" button.
#[tauri::command]
pub fn termius_extract_debug(path: String) -> Result<String, String> {
    let snapshot = termius_extract()?;
    let mut json = serde_json::to_value(&snapshot)
        .map_err(|e| format!("Failed to serialize snapshot: {e}"))?;
    if let Some(records) = json.get_mut("records").and_then(|v| v.as_array_mut()) {
        for record in records.iter_mut() {
            if let Some(decrypted) = record.get_mut("decrypted").and_then(|v| v.as_object_mut()) {
                redact_secret(decrypted, "private_key", "priv");
                redact_secret(decrypted, "password", "pwd");
                redact_secret(decrypted, "passphrase", "passphrase");
                redact_secret(decrypted, "public_key", "pub");
                redact_secret(decrypted, "key", "hostkey");
            }
        }
    }
    let pretty = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to format snapshot: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("Failed to write {path}: {e}"))?;
    Ok(path)
}

fn redact_secret(obj: &mut Map<String, Value>, field: &str, tag: &str) {
    if let Some(v) = obj.get(field) {
        if let Some(s) = v.as_str() {
            let placeholder = format!("<{tag}:{}b>", s.len());
            obj.insert(field.to_string(), Value::String(placeholder));
        }
    }
}

/// Diagnostic: enumerate every leveldb key/value pair. Used to reverse-engineer
/// the IndexedDB schema. Writes hex-encoded keys + value sha256 prefixes + value
/// heads (no plaintext secrets).
#[tauri::command]
pub fn termius_extract_leveldb_keys(path: String) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let dir = termius_db_dir()?;
    let temp = copy_db_to_temp(&dir)?;
    let entries = read_all_entries(&temp);
    let _ = std::fs::remove_dir_all(&temp);
    let entries = entries?;

    #[derive(Serialize)]
    struct Entry {
        key_hex: String,
        key_len: usize,
        key_lossy: String,
        value_len: usize,
        value_sha256_8: String,
        value_head_hex: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        value_full_hex: Option<String>,
    }

    // Linkage-relevant DBs we capture full value bytes for.
    const FULL_VALUE_DBS: &[u8] = &[
        0x10, 0x16, 0x09, 0x14, 0x0f, 0x04, 0x0c, 0x12, 0x13,
    ];

    let mut out: Vec<Entry> = Vec::new();
    for (k, v) in &entries {
        let key_hex = k.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let key_lossy = String::from_utf8_lossy(k).into_owned();
        let mut hasher = Sha256::new();
        hasher.update(v);
        let digest = hasher.finalize();
        let value_sha256_8 = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
        let head = &v[..v.len().min(64)];
        let value_head_hex = head.iter().map(|b| format!("{b:02x}")).collect();
        let value_full_hex = if k.len() >= 4
            && k[0] == 0x00
            && FULL_VALUE_DBS.contains(&k[1])
            && k[3] == 0x01
            && v.len() <= 4096
        {
            Some(v.iter().map(|b| format!("{b:02x}")).collect())
        } else {
            None
        };
        out.push(Entry {
            key_hex,
            key_len: k.len(),
            key_lossy,
            value_len: v.len(),
            value_sha256_8,
            value_head_hex,
            value_full_hex,
        });
    }

    let json = serde_json::json!({
        "version": 2,
        "source_dir": dir.display().to_string(),
        "entry_count": out.len(),
        "entries": out,
    });
    let pretty = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("Failed to write {path}: {e}"))?;
    Ok(path)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // V8 SSV helpers — build envelope bytes the way Chromium does.

    fn push_varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let mut b = (v & 0x7f) as u8;
            v >>= 7;
            if v != 0 {
                b |= 0x80;
            }
            out.push(b);
            if v == 0 {
                break;
            }
        }
    }

    fn push_str(s: &str, out: &mut Vec<u8>) {
        out.push(b'"');
        push_varint(s.len() as u64, out);
        out.extend_from_slice(s.as_bytes());
    }

    fn push_int(value: i64, out: &mut Vec<u8>) {
        out.push(b'I');
        let zz = ((value << 1) ^ (value >> 63)) as u64;
        push_varint(zz, out);
    }

    fn push_key_int(key: &str, value: i64, out: &mut Vec<u8>) {
        push_str(key, out);
        push_int(value, out);
    }

    fn push_key_str(key: &str, value: &str, out: &mut Vec<u8>) {
        push_str(key, out);
        push_str(value, out);
    }

    fn push_key_null(key: &str, out: &mut Vec<u8>) {
        push_str(key, out);
        out.push(b'0');
    }

    fn push_key_obj_id(key: &str, id: i64, out: &mut Vec<u8>) {
        push_str(key, out);
        out.push(b'o');
        push_key_int("id", id, out);
        out.push(b'{');
        push_varint(1, out);
    }

    fn close_obj(props: u64, out: &mut Vec<u8>) {
        out.push(b'{');
        push_varint(props, out);
    }

    #[test]
    fn v8_decodes_flat_object() {
        let mut bytes = vec![b'o'];
        push_key_int("id", 7347589, &mut bytes);
        push_key_str("updated_at", "2026-04-08T16:37:59", &mut bytes);
        push_key_str("status", "SYNCHRONIZED", &mut bytes);
        close_obj(3, &mut bytes);
        let v = v8::decode_envelope(&bytes).unwrap();
        let obj = v.as_object().unwrap();
        assert_eq!(obj.get("id").and_then(|v| v.as_i64()), Some(7347589));
        assert_eq!(obj.get("updated_at").and_then(|v| v.as_str()), Some("2026-04-08T16:37:59"));
        assert_eq!(obj.get("status").and_then(|v| v.as_str()), Some("SYNCHRONIZED"));
    }

    #[test]
    fn v8_decodes_nested_object_for_foreign_keys() {
        let mut bytes = vec![b'o'];
        push_key_int("id", 45716684, &mut bytes);
        push_key_obj_id("ssh_config", 45672876, &mut bytes);
        push_key_null("group", &mut bytes);
        close_obj(3, &mut bytes);
        let v = v8::decode_envelope(&bytes).unwrap();
        let obj = v.as_object().unwrap();
        assert_eq!(obj.get("id").and_then(|v| v.as_i64()), Some(45716684));
        let sc = obj.get("ssh_config").and_then(|v| v.as_object()).unwrap();
        assert_eq!(sc.get("id").and_then(|v| v.as_i64()), Some(45672876));
        assert!(obj.get("group").map(|v| v.is_null()).unwrap_or(false));
    }

    #[test]
    fn extract_record_separates_foreign_keys_from_plaintext() {
        let mut bytes = vec![b'o'];
        push_key_int("id", 45716684, &mut bytes);
        push_key_str("updated_at", "2026-05-25T10:07:45", &mut bytes);
        push_key_str("status", "SYNCHRONIZED", &mut bytes);
        push_key_obj_id("ssh_config", 45672876, &mut bytes);
        push_key_null("group", &mut bytes);
        push_key_str("backspace", "default", &mut bytes);
        push_key_int("local_id", 16, &mut bytes);
        close_obj(7, &mut bytes);

        let envelope = v8::decode_envelope(&bytes).unwrap();
        // Use a dummy key — no encrypted blobs in this fixture.
        let cipher = XSalsa20Poly1305::new(&[0u8; 32].into());
        let rec = extract_record(envelope, &cipher).unwrap();

        assert_eq!(rec.termius_id, 45716684);
        assert_eq!(rec.local_id, Some(16));
        assert_eq!(rec.updated_at.as_deref(), Some("2026-05-25T10:07:45"));
        assert_eq!(rec.status.as_deref(), Some("SYNCHRONIZED"));
        assert_eq!(rec.foreign_keys.get("ssh_config"), Some(&45672876));
        assert_eq!(rec.body.get("backspace").and_then(|v| v.as_str()), Some("default"));
        // `group: null` is plaintext (not a FK), so it lands in the body.
        assert!(rec.body.get("group").map(|v| v.is_null()).unwrap_or(false));
    }

    #[test]
    fn idb_key_decoder_extracts_db_store_index() {
        // 00 10 01 01 <user_key>  → db=hosts, store=1, index=1
        let key = hex_to_bytes("0010010103000000000000f03f");
        let k = decode_idb_key(&key).unwrap();
        assert_eq!(k.db_id, 0x10);
        assert_eq!(k.object_store_id, 0x01);
        assert_eq!(k.index_id, 0x01);
    }

    #[test]
    fn db_name_map_decodes_utf16be_store_names() {
        // Per-db store-name metadata entry: key = 00 10 00 00 32 01 00, value is
        // just UTF-16-BE bytes of the store name (no length prefix).
        let key = vec![0x00, 0x10, 0x00, 0x00, 0x32, 0x01, 0x00];
        let mut val = Vec::new();
        for ch in "hosts".chars() {
            val.extend_from_slice(&(ch as u16).to_be_bytes());
        }
        let entries = vec![(key, val)];
        let map = build_db_name_map(&entries);
        assert_eq!(map.get(&0x10).map(String::as_str), Some("hosts"));
    }

    fn hex_to_bytes(hex: &str) -> Vec<u8> {
        let mut out = Vec::with_capacity(hex.len() / 2);
        let bytes = hex.as_bytes();
        let mut i = 0;
        while i + 1 < bytes.len() {
            let hi = char_to_nibble(bytes[i]);
            let lo = char_to_nibble(bytes[i + 1]);
            out.push((hi << 4) | lo);
            i += 2;
        }
        out
    }

    fn char_to_nibble(b: u8) -> u8 {
        match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'f' => 10 + b - b'a',
            b'A'..=b'F' => 10 + b - b'A',
            _ => 0,
        }
    }
}
