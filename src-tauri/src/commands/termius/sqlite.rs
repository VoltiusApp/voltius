use super::IdbRecord;
use rusqlite::Connection;
use rusty_leveldb::compressor::{Compressor, SnappyCompressor};
use std::io::Read;
use std::path::Path;

const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";
const PRIMARY_OBJECT_STORE_ID: i64 = 1;
const COMPRESSION_NONE: i64 = 0;
const COMPRESSION_ZSTD: i64 = 1;
const COMPRESSION_SNAPPY: i64 = 2;

pub(super) fn read_records(dir: &Path) -> Result<Vec<IdbRecord>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Cannot read Termius db: {e}"))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_sqlite_file(&path) {
            continue;
        }
        read_database(&path, &mut out)
            .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    }
    Ok(out)
}

fn is_sqlite_file(path: &Path) -> bool {
    let mut header = [0u8; SQLITE_HEADER.len()];
    std::fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut header))
        .is_ok_and(|()| &header == SQLITE_HEADER)
}

// Opened read-write: Chromium keeps the WAL index in memory, so replaying the copied `-wal`
// needs a writable `-shm`. The connection only ever sees the temp copy.
fn read_database(path: &Path, out: &mut Vec<IdbRecord>) -> rusqlite::Result<()> {
    let conn = Connection::open(path)?;
    let name: Vec<u8> =
        conn.query_row("SELECT name FROM indexed_db_metadata", [], |row| row.get(0))?;
    let db_name = utf16le(&name);
    let mut stmt =
        conn.prepare("SELECT compression_type, value FROM records WHERE object_store_id = ?1")?;
    let rows = stmt.query_map([PRIMARY_OBJECT_STORE_ID], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
    })?;
    for row in rows {
        let (compression, value) = row?;
        if let Some(value) = decompress(compression, value) {
            out.push(IdbRecord {
                db_name: db_name.clone(),
                value,
            });
        }
    }
    Ok(())
}

fn utf16le(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

fn decompress(compression: i64, value: Vec<u8>) -> Option<Vec<u8>> {
    match compression {
        COMPRESSION_NONE => Some(value),
        COMPRESSION_ZSTD => {
            let mut out = Vec::new();
            ruzstd::decoding::StreamingDecoder::new(value.as_slice())
                .ok()?
                .read_to_end(&mut out)
                .ok()?;
            Some(out)
        }
        COMPRESSION_SNAPPY => SnappyCompressor.decode(value).ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::hex_to_bytes;
    use super::super::v8::decode_envelope;
    use super::*;
    use serde_json::Value;

    // Records written by Chromium 153's SQLite IndexedDB backend: a small uncompressed host,
    // and an identity over 450 bytes that Chromium stored zstd-compressed.
    const HOST_VALUE: &str = "ff15fe000000000000000000000000ff106f220269644998d3cc2b22086c6f63616c5f696449202206737461747573220c53594e4348524f4e495a4544220a7373685f636f6e6669676f2202696449d8a6c72b7b01220567726f7570307b05";
    const ZSTD_IDENTITY_VALUE: &str = "28b52ffd6081059502007404ff15fe0000ff106f22026964498af680072206737461747573220c53594e4348524f4e495a45442207636f6e74656e7422c20c4241616263646566676861626364656667687b030200408b337f848116";

    fn utf16le_bytes(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    fn write_database(path: &Path, name: &str, rows: &[(i64, i64, &str)]) {
        fill_database(&Connection::open(path).unwrap(), name, rows);
    }

    fn fill_database(conn: &Connection, name: &str, rows: &[(i64, i64, &str)]) {
        conn.execute_batch(
            "CREATE TABLE indexed_db_metadata (name BLOB NOT NULL, version INTEGER NOT NULL);
             CREATE TABLE records (row_id INTEGER PRIMARY KEY, object_store_id INTEGER NOT NULL,
               compression_type INTEGER NOT NULL, key BLOB NOT NULL, value BLOB NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO indexed_db_metadata VALUES (?1, 1)",
            [utf16le_bytes(name)],
        )
        .unwrap();
        for (i, (store, compression, hex)) in rows.iter().enumerate() {
            conn.execute(
                "INSERT INTO records (object_store_id, compression_type, key, value) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![store, compression, vec![i as u8], hex_to_bytes(hex)],
            )
            .unwrap();
        }
    }

    fn envelope_id(record: &IdbRecord) -> Option<i64> {
        decode_envelope(&record.value)?
            .get("id")
            .and_then(Value::as_i64)
    }

    #[test]
    fn reads_chromium_records_from_every_database() {
        let dir = tempfile::tempdir().unwrap();
        write_database(
            &dir.path().join("CU6EKJOTFGGV7JIE47WEYME6A7TWQTJD"),
            "hosts",
            &[
                (1, COMPRESSION_NONE, HOST_VALUE),
                (2, COMPRESSION_NONE, HOST_VALUE),
            ],
        );
        write_database(
            &dir.path().join("MFBMWLETPYVBEI3F77ZKLSAN5VOBZY4L"),
            "ssh_identities",
            &[(1, COMPRESSION_ZSTD, ZSTD_IDENTITY_VALUE)],
        );
        std::fs::write(
            dir.path().join("MFBMWLETPYVBEI3F77ZKLSAN5VOBZY4L-shm"),
            [0x18, 0xe2, 0x2d, 0x00],
        )
        .unwrap();

        let mut records = read_records(dir.path()).unwrap();
        records.sort_by(|a, b| a.db_name.cmp(&b.db_name));

        let summary: Vec<(&str, Option<i64>)> = records
            .iter()
            .map(|r| (r.db_name.as_str(), envelope_id(r)))
            .collect();
        assert_eq!(
            summary,
            [("hosts", Some(45716684)), ("ssh_identities", Some(7347589))]
        );
        let identity = decode_envelope(&records[1].value).unwrap();
        assert_eq!(
            identity
                .get("content")
                .and_then(Value::as_str)
                .map(str::len),
            Some(2 + 8 * 200)
        );
    }

    #[test]
    fn replays_a_wal_that_chromium_never_checkpointed() {
        let live = tempfile::tempdir().unwrap();
        let conn = Connection::open(live.path().join("HOSTS")).unwrap();
        conn.execute_batch("PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL;")
            .unwrap();
        fill_database(&conn, "hosts", &[(1, COMPRESSION_NONE, HOST_VALUE)]);
        assert!(!live.path().join("HOSTS-shm").exists());

        let copy = tempfile::tempdir().unwrap();
        for name in ["HOSTS", "HOSTS-wal"] {
            std::fs::copy(live.path().join(name), copy.path().join(name)).unwrap();
        }
        let records = read_records(copy.path()).unwrap();
        drop(conn);

        let summary: Vec<(&str, Option<i64>)> = records
            .iter()
            .map(|r| (r.db_name.as_str(), envelope_id(r)))
            .collect();
        assert_eq!(summary, [("hosts", Some(45716684))]);
    }

    #[test]
    fn unknown_compression_is_skipped() {
        assert_eq!(decompress(9, vec![1, 2, 3]), None);
    }
}
