// Extracts and decrypts the local Termius database (no first-party export exists).
//
// Termius is an Electron app that stores its data in Chromium's IndexedDB:
// a LevelDB, or SQLite files on newer Chromium. Each Termius "table" (hosts, keys,
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
// The IndexedDB-aware extraction here is voltius-specific.

mod extract;
mod keys;
mod leveldb;
mod paths;
mod sqlite;
mod v8;

pub use extract::*;

/// A value from a Termius database's primary object store, with the backend's framing removed.
struct IdbRecord {
    db_name: String,
    value: Vec<u8>,
}

fn read_varint(bytes: &[u8], pos: &mut usize) -> Option<u64> {
    let mut out = 0u64;
    for shift in (0..64).step_by(7) {
        let b = *bytes.get(*pos)?;
        *pos += 1;
        out |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Some(out);
        }
    }
    None
}

#[cfg(test)]
fn hex_to_bytes(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}
