use super::keys::fetch_master_key;
use super::leveldb::{build_db_name_map, decode_idb_key, read_all_entries};
use super::paths::{copy_db_to_temp, termius_db_dir};
use super::v8;
use base64::{engine::general_purpose::STANDARD, Engine};
use crypto_secretbox::{aead::Aead, KeyInit, XSalsa20Poly1305};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

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
    v.as_object()
        .and_then(|m| m.get("id"))
        .and_then(|x| x.as_i64())
}

fn extract_record(envelope: Value, cipher: &XSalsa20Poly1305) -> Option<ExtractedRecord> {
    let obj = envelope.as_object()?.clone();

    let termius_id = obj.get("id").and_then(|v| v.as_i64())?;
    let local_id = obj.get("local_id").and_then(|v| v.as_i64());
    let updated_at = obj
        .get("updated_at")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let status = obj
        .get("status")
        .and_then(|v| v.as_str())
        .map(str::to_string);

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
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
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

// ─── Public commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn termius_extract() -> Result<TermiusSnapshot, String> {
    // Wrap in catch_unwind so any panic in the V8 SSV decoder or leveldb reader
    // surfaces as a clean error string instead of aborting the Tauri app.
    std::panic::catch_unwind(termius_extract_inner).map_err(|panic| {
        let msg = panic
            .downcast_ref::<&'static str>()
            .copied()
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
        let Some(idb) = decode_idb_key(k) else {
            continue;
        };
        // Object-store DATA entries only. Index id 1 is the primary store;
        // anything else (2 = exists, 0x1f/0x20/0x21/0x22/0x23 = indexes) is
        // either internal or a denormalised index, which we don't need
        // because we read the full value.
        if idb.index_id != 0x01 || idb.object_store_id != 0x01 {
            continue;
        }

        let Some(db_name) = db_names.get(&idb.db_id) else {
            continue;
        };
        let Some(envelope) = v8::decode_envelope(v) else {
            continue;
        };
        let Some(rec) = extract_record(envelope, &cipher) else {
            continue;
        };
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
    records.sort_by(|a, b| {
        (a.db_name.as_str(), a.termius_id).cmp(&(b.db_name.as_str(), b.termius_id))
    });

    Ok(TermiusSnapshot {
        version: 2,
        records,
    })
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
    const FULL_VALUE_DBS: &[u8] = &[0x10, 0x16, 0x09, 0x14, 0x0f, 0x04, 0x0c, 0x12, 0x13];

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
    let pretty =
        serde_json::to_string_pretty(&json).map_err(|e| format!("Failed to serialize: {e}"))?;
    std::fs::write(&path, pretty).map_err(|e| format!("Failed to write {path}: {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::super::v8::build::*;
    use super::super::v8::decode_envelope;
    use super::*;
    // (`super` here is the `extract` module; `super::super` is `termius`.)

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

        let envelope = decode_envelope(&bytes).unwrap();
        // Use a dummy key — no encrypted blobs in this fixture.
        let cipher = XSalsa20Poly1305::new(&[0u8; 32].into());
        let rec = extract_record(envelope, &cipher).unwrap();

        assert_eq!(rec.termius_id, 45716684);
        assert_eq!(rec.local_id, Some(16));
        assert_eq!(rec.updated_at.as_deref(), Some("2026-05-25T10:07:45"));
        assert_eq!(rec.status.as_deref(), Some("SYNCHRONIZED"));
        assert_eq!(rec.foreign_keys.get("ssh_config"), Some(&45672876));
        assert_eq!(
            rec.body.get("backspace").and_then(|v| v.as_str()),
            Some("default")
        );
        // `group: null` is plaintext (not a FK), so it lands in the body.
        assert!(rec.body.get("group").map(|v| v.is_null()).unwrap_or(false));
    }
}
