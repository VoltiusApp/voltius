use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_PEERS: usize = 64;
pub const MAX_ADDRS: usize = 8;
pub const MAX_BLOCKED: usize = 256;
pub const MAX_FILE: usize = 256 * 1024;
const VERSION: u32 = 1;
const SCOPE_DOMAIN: &[u8] = b"voltius-lan-sync-scope-v1";

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

mod hex32 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn encode(key: &[u8; 32]) -> String {
        super::to_hex(key)
    }

    pub fn serialize<S: Serializer>(key: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&encode(key))
    }

    pub fn parse(text: &str) -> Option<[u8; 32]> {
        if text.len() != 64 || !text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return None;
        }
        let mut out = [0u8; 32];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok()?;
        }
        Some(out)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        parse(&String::deserialize(d)?)
            .ok_or_else(|| serde::de::Error::custom("device_key must be 64 lowercase hex chars"))
    }
}

pub fn parse_hex32(text: &str) -> Option<[u8; 32]> {
    hex32::parse(text)
}

pub fn encode_hex32(key: &[u8; 32]) -> String {
    hex32::encode(key)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SeenAddr {
    pub addr: SocketAddr,
    pub last_seen: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PeerRecord {
    #[serde(with = "hex32")]
    pub device_key: [u8; 32],
    #[serde(default)]
    pub addrs: Vec<SeenAddr>,
    #[serde(default)]
    pub group: Option<String>,
    pub first_seen: u64,
    pub last_seen: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Blocked {
    pub device_id: String,
    pub blocked_at: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Rejection {
    Blocked,
    KeyChanged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PinDecision {
    Known,
    Pinned,
    Repinned,
    Rejected(Rejection),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PinPolicy {
    Repin,
    Refuse,
}

#[derive(Serialize, Deserialize)]
struct FileShape {
    v: u32,
    peers: BTreeMap<String, PeerRecord>,
    blocked: BTreeMap<String, Blocked>,
}

pub struct PeerStore {
    path: Option<PathBuf>,
    peers: BTreeMap<String, PeerRecord>,
    blocked: BTreeMap<String, Blocked>,
}

fn evict_oldest<V>(
    map: &mut BTreeMap<String, V>,
    cap: usize,
    stamp: impl Fn(&V) -> u64,
    keep: &str,
) {
    while map.len() > cap {
        let oldest = map
            .iter()
            .filter(|(k, _)| k.as_str() != keep)
            .min_by_key(|(_, v)| stamp(v))
            .map(|(k, _)| k.clone());
        match oldest {
            Some(k) => map.remove(&k),
            None => break,
        };
    }
}

fn trim_addrs(addrs: &mut Vec<SeenAddr>) {
    addrs.sort_by_key(|s| std::cmp::Reverse(s.last_seen));
    addrs.truncate(MAX_ADDRS);
}

fn within_cap(len: u64) -> Result<(), String> {
    if len > MAX_FILE as u64 {
        return Err(format!("{len} bytes exceeds {MAX_FILE}"));
    }
    Ok(())
}

fn read_file(path: &Path) -> Result<FileShape, String> {
    within_cap(std::fs::metadata(path).map_err(|e| e.to_string())?.len())?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let file: FileShape = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if file.v != VERSION {
        return Err(format!("unsupported version {}", file.v));
    }
    Ok(file)
}

impl PeerStore {
    pub fn memory() -> Self {
        Self {
            path: None,
            peers: BTreeMap::new(),
            blocked: BTreeMap::new(),
        }
    }

    pub fn open(dir: &Path, scope: &str) -> Self {
        let path = Self::path_for(dir, scope);
        let (mut peers, mut blocked) = match read_file(&path) {
            Ok(file) => (file.peers, file.blocked),
            Err(e) => {
                if path.exists() {
                    log::warn!("lan sync peers file ignored: {e}");
                }
                Default::default()
            }
        };
        evict_oldest(&mut peers, MAX_PEERS, |r| r.last_seen, "");
        evict_oldest(&mut blocked, MAX_BLOCKED, |b| b.blocked_at, "");
        for record in peers.values_mut() {
            trim_addrs(&mut record.addrs);
        }
        Self {
            path: Some(path),
            peers,
            blocked,
        }
    }

    pub fn path_for(dir: &Path, scope: &str) -> PathBuf {
        let digest = Sha256::new()
            .chain_update(SCOPE_DOMAIN)
            .chain_update(scope.as_bytes())
            .finalize();
        let tag = to_hex(&digest[..8]);
        dir.join("lan_sync").join(format!("peers-{tag}.json"))
    }

    pub fn decide(
        &mut self,
        device_id: &str,
        key: &[u8; 32],
        now: u64,
        policy: PinPolicy,
    ) -> PinDecision {
        if self.blocked.contains_key(&hex32::encode(key)) {
            return PinDecision::Rejected(Rejection::Blocked);
        }
        if let Some(record) = self.peers.get_mut(device_id) {
            let decision = match (record.device_key == *key, policy) {
                (true, _) => PinDecision::Known,
                (false, PinPolicy::Refuse) => return PinDecision::Rejected(Rejection::KeyChanged),
                (false, PinPolicy::Repin) => {
                    record.device_key = *key;
                    PinDecision::Repinned
                }
            };
            record.last_seen = now;
            return decision;
        }
        self.peers.insert(
            device_id.to_string(),
            PeerRecord {
                device_key: *key,
                addrs: Vec::new(),
                group: None,
                first_seen: now,
                last_seen: now,
            },
        );
        evict_oldest(&mut self.peers, MAX_PEERS, |r| r.last_seen, device_id);
        PinDecision::Pinned
    }

    pub fn vouch(&mut self, device_id: &str, key: &[u8; 32]) -> bool {
        let unblocked = self.blocked.remove(&hex32::encode(key)).is_some();
        let repinned = match self.peers.get_mut(device_id) {
            Some(record) if record.device_key != *key => {
                record.device_key = *key;
                true
            }
            _ => false,
        };
        unblocked || repinned
    }

    pub fn record_addrs(&mut self, device_id: &str, addrs: &[SocketAddr], now: u64) {
        let Some(record) = self.peers.get_mut(device_id) else {
            return;
        };
        for &addr in addrs {
            match record.addrs.iter_mut().find(|s| s.addr == addr) {
                Some(seen) => seen.last_seen = now,
                None => record.addrs.push(SeenAddr {
                    addr,
                    last_seen: now,
                }),
            }
        }
        trim_addrs(&mut record.addrs);
    }

    pub fn forget(&mut self, device_id: &str, now: u64) -> Option<[u8; 32]> {
        let record = self.peers.remove(device_id)?;
        let key = hex32::encode(&record.device_key);
        self.blocked.insert(
            key.clone(),
            Blocked {
                device_id: device_id.to_string(),
                blocked_at: now,
            },
        );
        evict_oldest(&mut self.blocked, MAX_BLOCKED, |b| b.blocked_at, &key);
        Some(record.device_key)
    }

    pub fn get(&self, device_id: &str) -> Option<&PeerRecord> {
        self.peers.get(device_id)
    }

    pub fn records(&self) -> impl Iterator<Item = (&String, &PeerRecord)> {
        self.peers.iter()
    }

    pub fn snapshot(&self) -> Option<(PathBuf, Vec<u8>)> {
        let path = self.path.clone()?;
        let file = FileShape {
            v: VERSION,
            peers: self.peers.clone(),
            blocked: self.blocked.clone(),
        };
        serde_json::to_vec(&file).ok().map(|bytes| (path, bytes))
    }
}

pub fn write_snapshot(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    within_cap(bytes.len() as u64).map_err(std::io::Error::other)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    crate::storage::secrets::write_atomic(path, bytes).map_err(std::io::Error::other)
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const K1: [u8; 32] = [1; 32];
    const K2: [u8; 32] = [2; 32];
    const REPIN: PinPolicy = PinPolicy::Repin;

    fn addr(port: u16) -> SocketAddr {
        SocketAddr::from(([192, 168, 1, 2], port))
    }

    fn key_for(i: u64) -> [u8; 32] {
        let mut k = [0u8; 32];
        k[..8].copy_from_slice(&i.to_be_bytes());
        k
    }

    fn open_with(contents: &[u8]) -> usize {
        let dir = tempfile::tempdir().unwrap();
        let path = PeerStore::path_for(dir.path(), "acct");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, contents).unwrap();
        PeerStore::open(dir.path(), "acct").records().count()
    }

    #[test]
    fn first_contact_pins_then_known() {
        let mut s = PeerStore::memory();
        assert_eq!(s.decide("a", &K1, 10, REPIN), PinDecision::Pinned);
        assert_eq!(s.decide("a", &K1, 20, REPIN), PinDecision::Known);
        let r = s.get("a").unwrap();
        assert_eq!((r.first_seen, r.last_seen), (10, 20));
    }

    #[test]
    fn different_key_for_pinned_id_is_key_changed_under_refuse() {
        let mut s = PeerStore::memory();
        s.decide("a", &K1, 10, PinPolicy::Refuse);
        assert_eq!(
            s.decide("a", &K2, 11, PinPolicy::Refuse),
            PinDecision::Rejected(Rejection::KeyChanged)
        );
        assert_eq!(s.get("a").unwrap().device_key, K1);
    }

    #[test]
    fn different_key_for_pinned_id_repins_under_repin() {
        let mut s = PeerStore::memory();
        s.decide("a", &K1, 10, REPIN);
        s.record_addrs("a", &[addr(1)], 10);
        assert_eq!(s.decide("a", &K2, 11, REPIN), PinDecision::Repinned);
        let r = s.get("a").unwrap();
        assert_eq!(r.device_key, K2);
        assert_eq!((r.first_seen, r.last_seen), (10, 11));
        assert_eq!(r.addrs.len(), 1);
        assert_eq!(s.decide("a", &K2, 12, REPIN), PinDecision::Known);
        assert_eq!(s.decide("a", &K1, 13, REPIN), PinDecision::Repinned);
    }

    #[test]
    fn blocked_key_is_refused_under_both_policies() {
        for policy in [PinPolicy::Repin, PinPolicy::Refuse] {
            let mut s = PeerStore::memory();
            s.decide("a", &K1, 1, policy);
            s.decide("b", &K2, 1, policy);
            s.forget("b", 2);
            let blocked = PinDecision::Rejected(Rejection::Blocked);
            assert_eq!(s.decide("a", &K2, 3, policy), blocked, "{policy:?}");
            assert_eq!(s.get("a").unwrap().device_key, K1);
        }
    }

    #[test]
    fn forget_blocks_key_and_frees_id() {
        let mut s = PeerStore::memory();
        s.decide("a", &K1, 1, REPIN);
        assert_eq!(s.forget("a", 5), Some(K1));
        let blocked = PinDecision::Rejected(Rejection::Blocked);
        assert_eq!(s.decide("a", &K1, 6, REPIN), blocked);
        assert_eq!(s.decide("b", &K1, 6, REPIN), blocked);
        assert_eq!(s.decide("a", &K2, 7, REPIN), PinDecision::Pinned);
        assert_eq!(s.forget("zzz", 8), None);
    }

    #[test]
    fn caps_evict_least_recent() {
        let mut s = PeerStore::memory();
        for i in 0..=MAX_PEERS as u64 {
            s.decide(&format!("p{i}"), &key_for(i), i, REPIN);
        }
        assert_eq!(s.records().count(), MAX_PEERS);
        assert!(s.get("p0").is_none());

        s.decide("host", &K1, 100, REPIN);
        for i in 0..=MAX_ADDRS as u64 {
            s.record_addrs("host", &[addr(1000 + i as u16)], i);
        }
        let addrs = &s.get("host").unwrap().addrs;
        assert_eq!(addrs.len(), MAX_ADDRS);
        assert!(addrs.iter().all(|a| a.addr != addr(1000)));

        let mut s = PeerStore::memory();
        for i in 0..=MAX_BLOCKED as u64 {
            s.decide(&format!("p{i}"), &key_for(i), i, REPIN);
            s.forget(&format!("p{i}"), i);
        }
        assert_eq!(s.blocked.len(), MAX_BLOCKED);
        assert_eq!(s.decide("x", &key_for(0), 999, REPIN), PinDecision::Pinned);
        assert_eq!(
            s.decide("y", &key_for(1), 999, REPIN),
            PinDecision::Rejected(Rejection::Blocked)
        );
    }

    #[test]
    fn record_addrs_merges_and_ignores_unknown() {
        let mut s = PeerStore::memory();
        s.decide("a", &K1, 1, REPIN);
        s.record_addrs("a", &[addr(1)], 2);
        s.record_addrs("a", &[addr(1)], 9);
        assert_eq!(
            s.get("a").unwrap().addrs,
            vec![SeenAddr {
                addr: addr(1),
                last_seen: 9
            }]
        );
        s.record_addrs("nobody", &[addr(1)], 3);
        assert_eq!(s.records().count(), 1);
    }

    #[test]
    fn roundtrip_through_file() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = PeerStore::open(dir.path(), "acct");
        s.decide("a", &K1, 1, REPIN);
        s.record_addrs("a", &[addr(7)], 2);
        s.decide("b", &K2, 3, REPIN);
        s.forget("b", 4);
        let (path, bytes) = s.snapshot().unwrap();
        write_snapshot(&path, &bytes).unwrap();

        let mut re = PeerStore::open(dir.path(), "acct");
        assert!(re.records().eq(s.records()));
        assert_eq!(
            re.decide("c", &K2, 5, REPIN),
            PinDecision::Rejected(Rejection::Blocked)
        );
    }

    #[test]
    fn corrupt_or_oversized_file_opens_empty() {
        let good = |key: &str, v: u32| {
            format!(
                r#"{{"v":{v},"peers":{{"a":{{"device_key":"{key}","first_seen":1,"last_seen":1}}}},"blocked":{{}}}}"#
            )
        };
        let key = "01".repeat(32);
        assert_eq!(open_with(good(&key, 1).as_bytes()), 1);
        assert_eq!(open_with(b"{not json"), 0);
        assert_eq!(open_with(good(&key, 2).as_bytes()), 0);
        assert_eq!(open_with(&vec![b' '; MAX_FILE + 1]), 0);
        assert_eq!(open_with(good(&key[..63], 1).as_bytes()), 0);
    }

    #[test]
    fn scopes_do_not_share_files() {
        let dir = Path::new("/x");
        let name_of = |scope| {
            let p = PeerStore::path_for(dir, scope);
            p.file_name().unwrap().to_str().unwrap().to_string()
        };
        let (a, b) = (name_of("acct-zeta"), name_of("acct-omega"));
        assert_ne!(a, b);
        assert!(!a.contains("zeta") && !b.contains("omega"));
        let tag = a
            .strip_prefix("peers-")
            .and_then(|n| n.strip_suffix(".json"))
            .unwrap();
        assert_eq!(tag.len(), 16);
        assert!(tag.bytes().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn scope_tag_is_domain_separated_sha256() {
        let p = PeerStore::path_for(Path::new("/x"), "acct-1");
        assert_eq!(p.file_name().unwrap(), "peers-a8f02f3c85d0444b.json");
    }

    #[test]
    fn open_reapplies_caps() {
        let dir = tempfile::tempdir().unwrap();
        let mut file = FileShape {
            v: VERSION,
            peers: BTreeMap::new(),
            blocked: BTreeMap::new(),
        };
        for i in 0..(MAX_PEERS as u64 + 5) {
            file.peers.insert(
                format!("p{i}"),
                PeerRecord {
                    device_key: key_for(i),
                    addrs: (0..MAX_ADDRS as u64 + 3)
                        .map(|n| SeenAddr {
                            addr: addr(n as u16 + 1),
                            last_seen: n,
                        })
                        .collect(),
                    group: None,
                    first_seen: i,
                    last_seen: i,
                },
            );
        }
        for i in 0..(MAX_BLOCKED as u64 + 5) {
            file.blocked.insert(
                to_hex(&key_for(i)),
                Blocked {
                    device_id: format!("p{i}"),
                    blocked_at: i,
                },
            );
        }
        let path = PeerStore::path_for(dir.path(), "acct");
        write_snapshot(&path, &serde_json::to_vec(&file).unwrap()).unwrap();

        let s = PeerStore::open(dir.path(), "acct");
        assert_eq!(s.records().count(), MAX_PEERS);
        assert!(s.get("p0").is_none() && s.get("p5").is_some());
        assert!(s.records().all(|(_, r)| r.addrs.len() == MAX_ADDRS));
        assert_eq!(s.blocked.len(), MAX_BLOCKED);
        assert!(!s.blocked.contains_key(&to_hex(&key_for(0))));
    }

    #[test]
    fn oversized_snapshot_is_not_written() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = PeerStore::open(dir.path(), "acct");
        s.decide("a", &K1, 1, REPIN);
        let (path, bytes) = s.snapshot().unwrap();
        write_snapshot(&path, &bytes).unwrap();
        assert!(write_snapshot(&path, &vec![b' '; MAX_FILE + 1]).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn memory_store_has_no_snapshot() {
        assert!(PeerStore::memory().snapshot().is_none());
    }
}
