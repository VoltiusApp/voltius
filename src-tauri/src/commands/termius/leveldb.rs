use std::collections::HashMap;
use std::path::Path;

// ─── IndexedDB key decoder ────────────────────────────────────────────────────

/// A Chromium IndexedDB key. We only care about a subset:
///   `0x00 <db_id> <store_id> <index_id> <user_key…>`
/// Index id 1 is the primary object-store data; 2 is the "exists" sidecar.
pub(super) struct IdbKey {
    pub(super) db_id: u8,
    pub(super) object_store_id: u8,
    pub(super) index_id: u8,
}

pub(super) fn decode_idb_key(key: &[u8]) -> Option<IdbKey> {
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

pub(super) fn build_db_name_map(entries: &[(Vec<u8>, Vec<u8>)]) -> HashMap<u8, String> {
    let mut out = HashMap::new();
    for (k, v) in entries {
        // We're looking for keys starting `00 <db_id> 00 00 32 01 00`.
        if k.len() < 7
            || k[0] != 0x00
            || k[2] != 0x00
            || k[3] != 0x00
            || k[4] != 0x32
            || k[5] != 0x01
            || k[6] != 0x00
        {
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

// ─── Leveldb iteration ────────────────────────────────────────────────────────

/// Raw `(key, value)` byte pairs read straight out of a LevelDB.
pub(super) type RawLevelDbEntries = Vec<(Vec<u8>, Vec<u8>)>;

pub(super) fn read_all_entries(dir: &Path) -> Result<RawLevelDbEntries, String> {
    use rusty_leveldb::{LdbIterator, Options, DB};
    let opts = Options {
        create_if_missing: false,
        ..Options::default()
    };
    let mut db = DB::open(dir, opts).map_err(|e| format!("Failed to open leveldb: {e}"))?;
    let mut iter = db
        .new_iter()
        .map_err(|e| format!("Failed to iterate leveldb: {e}"))?;
    let mut out = Vec::new();
    while let Some((k, v)) = iter.next() {
        out.push((k, v));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

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
