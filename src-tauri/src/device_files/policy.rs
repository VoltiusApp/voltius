use crate::lan_sync::protocol::{FilesRequest, Refusal};
use crate::lan_sync::route::Route;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::time::Instant;

pub const GRANT_IDLE: Duration = Duration::from_secs(10 * 60);
pub const APPROVAL_WAIT: Duration = Duration::from_secs(60);
const MAX_SESSIONS_PER_KEY: usize = 4;

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AllowedDevice {
    pub device_key: String,
    pub name: String,
    pub always: bool,
    pub last_opened: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileAccessConfig {
    pub enabled: bool,
    pub folders: Vec<String>,
    pub read_only: bool,
    pub allowed: Vec<AllowedDevice>,
    pub seen_keys: Vec<String>,
}

impl FileAccessConfig {
    pub fn always_allows(&self, key: &str) -> bool {
        self.allowed.iter().any(|d| d.always && d.device_key == key)
    }

    pub fn keep_seen_from(&mut self, old: &FileAccessConfig) {
        for key in &old.seen_keys {
            if !self.seen_keys.contains(key) {
                self.seen_keys.push(key.clone());
            }
        }
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn random_hex(len: usize) -> String {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    hex(&buf)
}

fn config_path(dir: &Path, account_id: &str) -> PathBuf {
    dir.join("device-files").join(format!(
        "{}.json",
        hex(&Sha256::digest(account_id.as_bytes()))
    ))
}

pub fn load(dir: &Path, account_id: &str) -> FileAccessConfig {
    std::fs::read(config_path(dir, account_id))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, account_id: &str, cfg: &FileAccessConfig) -> Result<(), String> {
    let path = config_path(dir, account_id);
    let parent = path.parent().ok_or("no parent directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("json.{}.tmp", random_hex(4)));
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[derive(Default)]
pub struct Grants {
    by_token: HashMap<String, (String, Instant)>,
}

impl Grants {
    pub fn issue(&mut self, key: &str) -> String {
        let token = random_hex(32);
        self.by_token
            .insert(token.clone(), (key.to_string(), Instant::now()));
        token
    }

    pub fn valid(&self, token: &str, key: &str, now: Instant) -> bool {
        self.by_token
            .get(token)
            .is_some_and(|(k, last)| k == key && now.saturating_duration_since(*last) < GRANT_IDLE)
    }

    pub fn touch(&mut self, token: &str, now: Instant) {
        if let Some((_, last)) = self.by_token.get_mut(token) {
            *last = now;
        }
    }

    pub fn revoke_key(&mut self, key: &str) {
        self.by_token.retain(|_, (k, _)| k != key);
    }

    pub fn clear(&mut self) {
        self.by_token.clear();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Accept {
        read_only: bool,
        grant: Option<String>,
    },
    Refuse(Refusal),
    Ask {
        new_device: bool,
    },
}

pub fn decide(
    cfg: &FileAccessConfig,
    grants: &Grants,
    key: &str,
    req: &FilesRequest,
    open_for_key: usize,
    now: Instant,
) -> Decision {
    if !cfg.enabled || cfg.folders.is_empty() {
        return Decision::Refuse(Refusal::Off);
    }
    if open_for_key >= MAX_SESSIONS_PER_KEY {
        return Decision::Refuse(Refusal::Busy);
    }
    let read_only = cfg.read_only;
    if cfg.always_allows(key) {
        return Decision::Accept {
            read_only,
            grant: None,
        };
    }
    if let Some(token) = req.grant.as_ref().filter(|t| grants.valid(t, key, now)) {
        return Decision::Accept {
            read_only,
            grant: Some(token.clone()),
        };
    }
    if req.reopen {
        return Decision::Refuse(Refusal::Expired);
    }
    Decision::Ask {
        new_device: !cfg.seen_keys.iter().any(|k| k == key),
    }
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Answer {
    Deny,
    Once,
    Always,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPrompt {
    pub request_id: String,
    pub device_key: String,
    pub device_name: String,
    pub platform: String,
    pub route: Route,
    pub new_device: bool,
}

#[derive(Default)]
pub struct Broker {
    pending: Mutex<HashMap<String, (ApprovalPrompt, oneshot::Sender<Answer>)>>,
}

pub fn new_request_id() -> String {
    random_hex(16)
}

impl Broker {
    pub fn register(&self, prompt: ApprovalPrompt) -> PendingApproval<'_> {
        let id = prompt.request_id.clone();
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap()
            .insert(id.clone(), (prompt, tx));
        PendingApproval {
            _cleanup: Cleanup { broker: self, id },
            rx,
        }
    }

    pub fn answer(&self, request_id: &str, a: Answer) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some((_, tx)) => tx.send(a).is_ok(),
            None => false,
        }
    }

    pub fn pending(&self) -> Vec<ApprovalPrompt> {
        self.pending
            .lock()
            .unwrap()
            .values()
            .map(|(p, _)| p.clone())
            .collect()
    }
}

pub struct PendingApproval<'a> {
    _cleanup: Cleanup<'a>,
    rx: oneshot::Receiver<Answer>,
}

impl PendingApproval<'_> {
    pub async fn wait(self, wait: Duration) -> Option<Answer> {
        tokio::time::timeout(wait, self.rx).await.ok()?.ok()
    }
}

struct Cleanup<'a> {
    broker: &'a Broker,
    id: String,
}

impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        self.broker.pending.lock().unwrap().remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn cfg_with(always: &[&str]) -> FileAccessConfig {
        FileAccessConfig {
            enabled: true,
            folders: vec!["/srv".into()],
            read_only: true,
            allowed: always
                .iter()
                .map(|k| AllowedDevice {
                    device_key: (*k).into(),
                    name: "Desktop-PC".into(),
                    always: true,
                    last_opened: None,
                })
                .collect(),
            seen_keys: vec![],
        }
    }

    fn req(grant: Option<String>) -> FilesRequest {
        FilesRequest {
            grant,
            reopen: false,
        }
    }

    #[test]
    fn off_refuses_before_anything() {
        let mut cfg = cfg_with(&["aa"]);
        cfg.enabled = false;
        let mut grants = Grants::default();
        let t = grants.issue("aa");
        let d = decide(&cfg, &grants, "aa", &req(Some(t)), 9, Instant::now());
        assert_eq!(d, Decision::Refuse(Refusal::Off));
    }

    #[test]
    fn no_folders_counts_as_off() {
        let mut cfg = cfg_with(&["aa"]);
        cfg.folders.clear();
        let d = decide(
            &cfg,
            &Grants::default(),
            "aa",
            &req(None),
            0,
            Instant::now(),
        );
        assert_eq!(d, Decision::Refuse(Refusal::Off));
    }

    #[test]
    fn always_allowed_key_is_accepted() {
        let cfg = cfg_with(&["aa"]);
        let d = decide(
            &cfg,
            &Grants::default(),
            "aa",
            &req(None),
            0,
            Instant::now(),
        );
        assert_eq!(
            d,
            Decision::Accept {
                read_only: true,
                grant: None
            }
        );
    }

    #[test]
    fn impostor_name_with_new_key_is_asked_and_marked_new() {
        let cfg = cfg_with(&["aa"]);
        let d = decide(
            &cfg,
            &Grants::default(),
            "bb",
            &req(None),
            0,
            Instant::now(),
        );
        assert_eq!(d, Decision::Ask { new_device: true });
    }

    #[test]
    fn seen_key_is_asked_without_new_flag() {
        let mut cfg = cfg_with(&[]);
        cfg.seen_keys.push("bb".into());
        let d = decide(
            &cfg,
            &Grants::default(),
            "bb",
            &req(None),
            0,
            Instant::now(),
        );
        assert_eq!(d, Decision::Ask { new_device: false });
    }

    #[test]
    fn grant_is_bound_to_its_key() {
        let cfg = cfg_with(&[]);
        let mut grants = Grants::default();
        let t = grants.issue("aa");
        let now = Instant::now();
        assert_eq!(
            decide(&cfg, &grants, "aa", &req(Some(t.clone())), 0, now),
            Decision::Accept {
                read_only: true,
                grant: Some(t.clone())
            }
        );
        assert_eq!(
            decide(&cfg, &grants, "bb", &req(Some(t)), 0, now),
            Decision::Ask { new_device: true }
        );
    }

    #[tokio::test(start_paused = true)]
    async fn grant_expires_after_idle() {
        let mut grants = Grants::default();
        let t = grants.issue("aa");
        tokio::time::advance(GRANT_IDLE - Duration::from_secs(1)).await;
        assert!(grants.valid(&t, "aa", Instant::now()));
        grants.touch(&t, Instant::now());
        tokio::time::advance(GRANT_IDLE - Duration::from_secs(1)).await;
        assert!(grants.valid(&t, "aa", Instant::now()));
        tokio::time::advance(Duration::from_secs(1)).await;
        assert!(!grants.valid(&t, "aa", Instant::now()));
    }

    #[test]
    fn revoke_and_clear_drop_grants() {
        let mut grants = Grants::default();
        let a = grants.issue("aa");
        let b = grants.issue("bb");
        grants.revoke_key("aa");
        let now = Instant::now();
        assert!(!grants.valid(&a, "aa", now));
        assert!(grants.valid(&b, "bb", now));
        grants.clear();
        assert!(!grants.valid(&b, "bb", now));
    }

    #[test]
    fn reopen_never_asks() {
        let cfg = cfg_with(&[]);
        let mut grants = Grants::default();
        let t = grants.issue("aa");
        let now = Instant::now();
        let reopen = |grant| FilesRequest {
            grant,
            reopen: true,
        };
        assert_eq!(
            decide(&cfg, &grants, "aa", &reopen(None), 0, now),
            Decision::Refuse(Refusal::Expired)
        );
        assert_eq!(
            decide(&cfg, &grants, "bb", &reopen(Some(t.clone())), 0, now),
            Decision::Refuse(Refusal::Expired)
        );
        assert_eq!(
            decide(&cfg, &grants, "aa", &reopen(Some(t.clone())), 0, now),
            Decision::Accept {
                read_only: true,
                grant: Some(t)
            }
        );
    }

    #[test]
    fn fifth_session_is_busy() {
        let cfg = cfg_with(&["aa"]);
        let now = Instant::now();
        let g = Grants::default();
        assert_eq!(
            decide(&cfg, &g, "aa", &req(None), 3, now),
            Decision::Accept {
                read_only: true,
                grant: None
            }
        );
        assert_eq!(
            decide(&cfg, &g, "aa", &req(None), 4, now),
            Decision::Refuse(Refusal::Busy)
        );
    }

    fn prompt(id: &str) -> ApprovalPrompt {
        ApprovalPrompt {
            request_id: id.into(),
            device_key: "aa".into(),
            device_name: "Phone".into(),
            platform: "android".into(),
            route: Route::Lan,
            new_device: true,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn broker_times_out_to_none() {
        let broker = Broker::default();
        let r = broker
            .register(prompt("x"))
            .wait(Duration::from_secs(60))
            .await;
        assert_eq!(r, None);
        assert!(broker.pending().is_empty());
    }

    #[test]
    fn register_is_visible_before_wait() {
        let broker = Broker::default();
        let _p = broker.register(prompt("my-id"));
        let pending = broker.pending();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].request_id, "my-id");
    }

    #[tokio::test]
    async fn broker_answer_resolves_once() {
        let broker = Broker::default();
        let p = broker.register(prompt("x"));
        assert!(broker.answer("x", Answer::Once));
        assert!(!broker.answer("x", Answer::Always));
        assert_eq!(p.wait(APPROVAL_WAIT).await, Some(Answer::Once));
        assert!(!broker.answer("nope", Answer::Deny));
        assert!(broker.pending().is_empty());
    }

    #[test]
    fn corrupt_config_loads_off() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = cfg_with(&["aa"]);
        save(dir.path(), "acct", &c).unwrap();
        std::fs::write(config_path(dir.path(), "acct"), b"{not json").unwrap();
        c = load(dir.path(), "acct");
        assert_eq!(c, FileAccessConfig::default());
        assert!(!c.enabled);
    }

    #[test]
    fn config_roundtrips_per_account() {
        let dir = tempfile::tempdir().unwrap();
        let a = cfg_with(&["aa"]);
        let b = FileAccessConfig {
            enabled: true,
            folders: vec!["/b".into()],
            ..Default::default()
        };
        save(dir.path(), "one", &a).unwrap();
        save(dir.path(), "two", &b).unwrap();
        assert_eq!(load(dir.path(), "one"), a);
        assert_eq!(load(dir.path(), "two"), b);
        assert_eq!(load(dir.path(), "three"), FileAccessConfig::default());
        let json = serde_json::to_string(&a).unwrap();
        assert!(
            json.contains("readOnly") && json.contains("deviceKey") && json.contains("seenKeys")
        );
    }
}
