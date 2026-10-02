use super::IdbRecord;
use rusty_leveldb::compressor::{Compressor, SnappyCompressor};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

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
//
// Chromium sorts IndexedDB keys with its own `idb_cmp1`, which a bytewise DB::open trips over,
// so the live files are read directly and the newest sequence number wins per key.

/// Raw `(key, value)` byte pairs read straight out of a LevelDB.
pub(super) type RawLevelDbEntries = Vec<(Vec<u8>, Vec<u8>)>;

const TYPE_DELETION: u8 = 0;
const TYPE_VALUE: u8 = 1;
const TABLE_MAGIC: u64 = 0xdb47_7524_8b80_fb57;
const TABLE_FOOTER_LEN: usize = 48;
const LOG_BLOCK_LEN: usize = 32 << 10;
const LOG_HEADER_LEN: usize = 7;

struct ByteReader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> ByteReader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn done(&self) -> bool {
        self.pos >= self.buf.len()
    }

    fn bytes(&mut self, n: usize) -> Option<&'a [u8]> {
        let out = self.buf.get(self.pos..self.pos.checked_add(n)?)?;
        self.pos += n;
        Some(out)
    }

    fn u8(&mut self) -> Option<u8> {
        self.bytes(1).map(|b| b[0])
    }

    fn fixed64(&mut self) -> Option<u64> {
        self.bytes(8)?.try_into().ok().map(u64::from_le_bytes)
    }

    fn varint(&mut self) -> Option<u64> {
        super::read_varint(self.buf, &mut self.pos)
    }

    fn len(&mut self) -> Option<usize> {
        usize::try_from(self.varint()?).ok()
    }

    fn len_prefixed(&mut self) -> Option<&'a [u8]> {
        let n = self.len()?;
        self.bytes(n)
    }
}

#[derive(Default)]
struct NewestBySequence(HashMap<Vec<u8>, (u64, Option<Vec<u8>>)>);

impl NewestBySequence {
    fn apply(&mut self, key: &[u8], seq: u64, value: Option<&[u8]>) {
        if self.0.get(key).is_some_and(|(newest, _)| *newest >= seq) {
            return;
        }
        self.0
            .insert(key.to_vec(), (seq, value.map(<[u8]>::to_vec)));
    }

    fn into_entries(self) -> RawLevelDbEntries {
        let mut out: RawLevelDbEntries = self
            .0
            .into_iter()
            .filter_map(|(k, (_, v))| Some((k, v?)))
            .collect();
        out.sort();
        out
    }
}

#[derive(Default)]
struct LiveFiles {
    tables: HashSet<(u64, u64)>,
    log_number: u64,
    prev_log_number: u64,
}

impl LiveFiles {
    fn apply_version_edit(&mut self, edit: &[u8]) -> Option<()> {
        let mut r = ByteReader::new(edit);
        while !r.done() {
            match r.varint()? {
                1 => {
                    r.len_prefixed()?;
                }
                2 => self.log_number = r.varint()?,
                3 | 4 => {
                    r.varint()?;
                }
                5 => {
                    r.varint()?;
                    r.len_prefixed()?;
                }
                6 => {
                    let level_and_number = (r.varint()?, r.varint()?);
                    self.tables.remove(&level_and_number);
                }
                7 => {
                    let level_and_number = (r.varint()?, r.varint()?);
                    r.varint()?;
                    r.len_prefixed()?;
                    r.len_prefixed()?;
                    self.tables.insert(level_and_number);
                }
                9 => self.prev_log_number = r.varint()?,
                _ => return None,
            }
        }
        Some(())
    }

    fn is_live_log(&self, number: u64) -> bool {
        number >= self.log_number || (number != 0 && number == self.prev_log_number)
    }
}

fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))
}

fn read_live_files(dir: &Path) -> Result<LiveFiles, String> {
    let current = read_file(&dir.join("CURRENT"))?;
    let manifest_name = String::from_utf8_lossy(&current).trim().to_string();
    let manifest = read_file(&dir.join(&manifest_name))?;
    let mut live = LiveFiles::default();
    for edit in log_records(&manifest) {
        live.apply_version_edit(&edit)
            .ok_or_else(|| format!("Malformed leveldb manifest {manifest_name}"))?;
    }
    Ok(live)
}

fn log_records(data: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut pending: Option<Vec<u8>> = None;
    let mut pos = 0;
    while pos + LOG_HEADER_LEN <= data.len() {
        let left_in_block = LOG_BLOCK_LEN - pos % LOG_BLOCK_LEN;
        if left_in_block < LOG_HEADER_LEN {
            pos += left_in_block;
            continue;
        }
        let len = usize::from(u16::from_le_bytes([data[pos + 4], data[pos + 5]]));
        let kind = data[pos + 6];
        let start = pos + LOG_HEADER_LEN;
        let Some(fragment) = data.get(start..start + len) else {
            break;
        };
        pos = start + len;
        match kind {
            1 => {
                pending = None;
                out.push(fragment.to_vec());
            }
            2 => pending = Some(fragment.to_vec()),
            3 => {
                if let Some(record) = pending.as_mut() {
                    record.extend_from_slice(fragment);
                }
            }
            4 => {
                if let Some(mut record) = pending.take() {
                    record.extend_from_slice(fragment);
                    out.push(record);
                }
            }
            _ => {}
        }
    }
    out
}

fn apply_write_batch(batch: &[u8], newest: &mut NewestBySequence) -> Option<()> {
    let mut r = ByteReader::new(batch);
    let mut seq = r.fixed64()?;
    r.bytes(4)?;
    while !r.done() {
        match r.u8()? {
            TYPE_DELETION => newest.apply(r.len_prefixed()?, seq, None),
            TYPE_VALUE => {
                let key = r.len_prefixed()?;
                newest.apply(key, seq, Some(r.len_prefixed()?));
            }
            _ => return None,
        }
        seq += 1;
    }
    Some(())
}

fn read_block(table: &[u8], handle: &mut ByteReader) -> Option<Vec<u8>> {
    let start = usize::try_from(handle.varint()?).ok()?;
    let end = start.checked_add(handle.len()?)?;
    let raw = table.get(start..end)?.to_vec();
    match *table.get(end)? {
        0 => Some(raw),
        1 => SnappyCompressor.decode(raw).ok(),
        _ => None,
    }
}

fn block_entries(block: &[u8]) -> Option<Vec<(Vec<u8>, &[u8])>> {
    let restarts_at = block.len().checked_sub(4)?;
    let restarts = u32::from_le_bytes(block[restarts_at..].try_into().ok()?);
    let entries_end = restarts_at.checked_sub(usize::try_from(restarts).ok()?.checked_mul(4)?)?;
    let mut r = ByteReader::new(&block[..entries_end]);
    let mut key = Vec::new();
    let mut out = Vec::new();
    while !r.done() {
        let shared = r.len()?;
        let non_shared = r.len()?;
        let value_len = r.len()?;
        if shared > key.len() {
            return None;
        }
        key.truncate(shared);
        key.extend_from_slice(r.bytes(non_shared)?);
        out.push((key.clone(), r.bytes(value_len)?));
    }
    Some(out)
}

fn apply_table(table: &[u8], newest: &mut NewestBySequence) -> Option<()> {
    let footer = table.get(table.len().checked_sub(TABLE_FOOTER_LEN)?..)?;
    if u64::from_le_bytes(footer[TABLE_FOOTER_LEN - 8..].try_into().ok()?) != TABLE_MAGIC {
        return None;
    }
    let mut handles = ByteReader::new(footer);
    handles.varint()?;
    handles.varint()?;
    let index = read_block(table, &mut handles)?;
    for (_, data_handle) in block_entries(&index)? {
        let data = read_block(table, &mut ByteReader::new(data_handle))?;
        for (internal_key, value) in block_entries(&data)? {
            let split = internal_key.len().checked_sub(8)?;
            let tag = u64::from_le_bytes(internal_key[split..].try_into().ok()?);
            let value = (tag & 0xff != u64::from(TYPE_DELETION)).then_some(value);
            newest.apply(&internal_key[..split], tag >> 8, value);
        }
    }
    Some(())
}

fn table_path(dir: &Path, number: u64) -> PathBuf {
    let ldb = dir.join(format!("{number:06}.ldb"));
    if ldb.exists() {
        ldb
    } else {
        dir.join(format!("{number:06}.sst"))
    }
}

fn live_log_paths(dir: &Path, live: &LiveFiles) -> Result<Vec<PathBuf>, String> {
    let mut logs: Vec<(u64, PathBuf)> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to list {}: {e}", dir.display()))?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let number = name.to_str()?.strip_suffix(".log")?.parse().ok()?;
            live.is_live_log(number).then(|| (number, entry.path()))
        })
        .collect();
    logs.sort();
    Ok(logs.into_iter().map(|(_, path)| path).collect())
}

pub(super) fn read_all_entries(dir: &Path) -> Result<RawLevelDbEntries, String> {
    let live = read_live_files(dir)?;
    let mut newest = NewestBySequence::default();
    for &(_, number) in &live.tables {
        let path = table_path(dir, number);
        apply_table(&read_file(&path)?, &mut newest)
            .ok_or_else(|| format!("Malformed leveldb table {}", path.display()))?;
    }
    for path in live_log_paths(dir, &live)? {
        for batch in log_records(&read_file(&path)?) {
            apply_write_batch(&batch, &mut newest);
        }
    }
    Ok(newest.into_entries())
}

// Index id 1 of object store 1 holds the records; other ids are internal or index sidecars.
pub(super) fn read_records(dir: &Path) -> Result<Vec<IdbRecord>, String> {
    let entries = read_all_entries(dir)?;
    let db_names = build_db_name_map(&entries);
    Ok(entries
        .iter()
        .filter_map(|(k, v)| {
            let idb = decode_idb_key(k)?;
            if idb.index_id != 0x01 || idb.object_store_id != 0x01 {
                return None;
            }
            Some(IdbRecord {
                db_name: db_names.get(&idb.db_id)?.clone(),
                value: strip_idb_version(v)?.to_vec(),
            })
        })
        .collect())
}

fn strip_idb_version(value: &[u8]) -> Option<&[u8]> {
    let mut pos = 0;
    super::read_varint(value, &mut pos)?;
    value.get(pos..)
}

#[cfg(test)]
mod tests {
    use super::super::hex_to_bytes;
    use super::*;
    use rusty_leveldb::CompressorId;

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

    #[test]
    fn strips_a_version_varint_that_contains_0x6f() {
        assert_eq!(
            strip_idb_version(&[0x80, 0x6f, 0xff, 0x15]),
            Some(&[0xff, 0x15][..])
        );
    }

    struct BackToFrontCmp;

    impl rusty_leveldb::Cmp for BackToFrontCmp {
        fn cmp(&self, a: &[u8], b: &[u8]) -> std::cmp::Ordering {
            a.iter().rev().cmp(b.iter().rev())
        }
        fn find_shortest_sep(&self, from: &[u8], _to: &[u8]) -> Vec<u8> {
            from.to_vec()
        }
        fn find_short_succ(&self, key: &[u8]) -> Vec<u8> {
            key.to_vec()
        }
        fn id(&self) -> &'static str {
            "test.BackToFrontComparator"
        }
    }

    fn fixture_options(cmp: Box<dyn rusty_leveldb::Cmp>) -> rusty_leveldb::Options {
        rusty_leveldb::Options {
            cmp: std::rc::Rc::new(cmp),
            write_buffer_size: 32 << 10,
            max_file_size: 16 << 10,
            compressor: rusty_leveldb::compressor::SnappyCompressor::ID,
            ..rusty_leveldb::Options::default()
        }
    }

    #[test]
    fn reads_db_written_with_a_foreign_comparator() {
        use std::collections::BTreeMap;

        let dir = tempfile::tempdir().unwrap();
        let key = |i: usize| format!("key{i:05}").into_bytes();
        let mut expected = BTreeMap::new();
        {
            let mut db =
                rusty_leveldb::DB::open(dir.path(), fixture_options(Box::new(BackToFrontCmp)))
                    .unwrap();
            for i in 0..3000 {
                let value = format!("value-{i}-{}", "x".repeat(100)).into_bytes();
                db.put(&key(i), &value).unwrap();
                expected.insert(key(i), value);
            }
            db.compact_range(b"\x00", b"\xff").unwrap();
            for i in 0..100 {
                db.put(&key(i), b"rewritten").unwrap();
                expected.insert(key(i), b"rewritten".to_vec());
            }
            for i in 100..200 {
                db.delete(&key(i)).unwrap();
                expected.remove(&key(i));
            }
            db.flush().unwrap();
        }

        let entries: BTreeMap<_, _> = read_all_entries(dir.path()).unwrap().into_iter().collect();
        assert!(
            entries == expected,
            "read {} entries, expected {}",
            entries.len(),
            expected.len()
        );

        let bytewise_open = std::panic::catch_unwind(|| {
            rusty_leveldb::DB::open(
                dir.path(),
                fixture_options(Box::new(rusty_leveldb::DefaultCmp)),
            )
            .map(|_| ())
        });
        assert!(
            bytewise_open.is_err(),
            "fixture must reproduce the comparator mismatch"
        );
    }
}
