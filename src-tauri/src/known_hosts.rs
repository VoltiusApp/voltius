use crate::storage::config::{config_dir, load_known_hosts, save_known_hosts, KnownHost};
use chrono::Utc;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

// ─── Conflict resolution types ───────────────────────────────────────────────

pub enum ConflictAction {
    AddNew,
    Replace,
    Abort,
}

#[derive(Default)]
struct Slots {
    waiting: HashMap<String, oneshot::Sender<ConflictAction>>,
    aborted: VecDeque<String>,
}

const MAX_EARLY_ABORTS: usize = 32;
const ABORTED_BY_USER: &str = "Connection aborted by user.";

pub struct PendingConflicts(Mutex<Slots>);

impl PendingConflicts {
    pub fn new() -> Self {
        Self(Mutex::new(Slots::default()))
    }

    pub async fn resolve(&self, session_id: &str, action: ConflictAction) {
        if let Some(tx) = self.0.lock().await.waiting.remove(session_id) {
            let _ = tx.send(action);
        }
    }

    /// Aborts the session's prompt, or refuses it in advance if it has not been shown yet.
    pub async fn cancel(&self, session_id: &str) {
        let mut slots = self.0.lock().await;
        if let Some(tx) = slots.waiting.remove(session_id) {
            let _ = tx.send(ConflictAction::Abort);
            return;
        }
        if slots.aborted.len() >= MAX_EARLY_ABORTS {
            slots.aborted.pop_front();
        }
        slots.aborted.push_back(session_id.to_string());
    }

    /// None when the session was cancelled before its prompt was shown.
    async fn wait(&self, session_id: &str) -> Option<oneshot::Receiver<ConflictAction>> {
        let mut slots = self.0.lock().await;
        if let Some(i) = slots.aborted.iter().position(|id| id == session_id) {
            slots.aborted.remove(i);
            return None;
        }
        let (tx, rx) = oneshot::channel();
        slots.waiting.insert(session_id.to_string(), tx);
        Some(rx)
    }
}

// ─── Host key status ─────────────────────────────────────────────────────────

pub enum HostKeyStatus {
    /// Fingerprint matches a stored entry.
    Known,
    /// No entries for this host:port — TOFU.
    Unknown,
    /// Entries exist but none match the presented fingerprint.
    Changed { stored: Vec<KnownHost> },
}

// ─── Event payload ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct HostKeyConflictEvent {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub stored_entries: Vec<KnownHost>,
    pub new_fingerprint: String,
}

pub struct ConflictPrompt {
    pub session_id: String,
    pub pending: Arc<PendingConflicts>,
    pub emit: Box<dyn Fn(HostKeyConflictEvent) + Send + Sync>,
}

impl ConflictPrompt {
    pub fn via_app(
        app: AppHandle,
        event_prefix: &str,
        session_id: String,
        pending: Arc<PendingConflicts>,
    ) -> Self {
        let event = format!("{event_prefix}-{session_id}");
        Self {
            session_id,
            pending,
            emit: Box::new(move |payload| {
                let _ = app.emit(&event, payload);
            }),
        }
    }
}

fn changed_warning(host: &str, port: u16, stored: &[KnownHost], received: &str) -> String {
    let stored_fps: Vec<&str> = stored.iter().map(|e| e.fingerprint.as_str()).collect();
    format!(
        "WARNING: Host key changed for {host}:{port}!\n\
         Stored   : {}\n\
         Received : {received}\n\n\
         This may indicate a MITM attack. \
         Remove the host from Known Hosts to reconnect.",
        stored_fps.join(", "),
    )
}

// ─── Store ────────────────────────────────────────────────────────────────────

fn new_entry(host: &str, port: u16, fingerprint: String, vault_id: &str) -> KnownHost {
    let now = Utc::now().to_rfc3339();
    KnownHost {
        id: Uuid::new_v4().to_string(),
        host: host.to_string(),
        port,
        fingerprint,
        name: None,
        vault_id: vault_id.to_string(),
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
        clocks: HashMap::new(),
    }
}

fn live_for(e: &KnownHost, host: &str, port: u16) -> bool {
    e.deleted_at.is_none() && e.host == host && e.port == port
}

pub struct KnownHostsStore {
    entries: Mutex<Vec<KnownHost>>,
}

impl KnownHostsStore {
    /// An empty in-memory store, no disk I/O. For tests.
    #[cfg(test)]
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
        }
    }

    /// An in-memory store already trusting each `(host, port, fingerprint)`. For tests.
    #[cfg(test)]
    pub fn pinned(keys: &[(&str, u16, &str)]) -> Self {
        let entries = keys
            .iter()
            .map(|&(host, port, fingerprint)| {
                new_entry(host, port, fingerprint.to_string(), "personal")
            })
            .collect();
        Self {
            entries: Mutex::new(entries),
        }
    }

    /// Load from disk, migrating the old HashMap-based format if present.
    pub fn load() -> Arc<Self> {
        // A corrupt file is already renamed aside by load_json, so this fallback loses nothing.
        let mut entries = load_known_hosts().unwrap_or_else(|e| {
            eprintln!("known_hosts: {e}");
            Vec::new()
        });

        // Migrate old app_data_dir-based key-value JSON (HashMap<"host:port", fingerprint>)
        let old_paths: Vec<std::path::PathBuf> = {
            let mut paths = Vec::new();
            // Old Tauri app_data_dir location
            if let Some(data_dir) = dirs::data_dir() {
                paths.push(data_dir.join("voltius").join("known_hosts.json"));
            }
            // Hidden file in config dir (original format)
            paths.push(config_dir().join(".known_hosts"));
            paths
        };

        for old_path in old_paths {
            if old_path.exists() {
                if let Ok(data) = std::fs::read_to_string(&old_path) {
                    if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&data) {
                        for (key, fingerprint) in map {
                            let mut parts = key.splitn(2, ':');
                            let host = parts.next().unwrap_or("").to_string();
                            let port: u16 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(22);
                            if !entries.iter().any(|e| {
                                e.host == host && e.port == port && e.fingerprint == fingerprint
                            }) {
                                entries.push(new_entry(&host, port, fingerprint, "personal"));
                            }
                        }
                        save_known_hosts(&entries).ok();
                        std::fs::remove_file(&old_path).ok();
                    }
                }
            }
        }

        Arc::new(Self {
            entries: Mutex::new(entries),
        })
    }

    /// Check whether `fingerprint` matches any stored entry for `host:port`.
    pub async fn check(&self, host: &str, port: u16, fingerprint: &str) -> HostKeyStatus {
        let entries = self.entries.lock().await;
        let matching: Vec<&KnownHost> =
            entries.iter().filter(|e| live_for(e, host, port)).collect();

        if matching.is_empty() {
            return HostKeyStatus::Unknown;
        }
        if matching.iter().any(|e| e.fingerprint == fingerprint) {
            return HostKeyStatus::Known;
        }
        HostKeyStatus::Changed {
            stored: matching.into_iter().cloned().collect(),
        }
    }

    /// Ok when `fingerprint` is trusted for host:port; a first sight is pinned silently.
    pub async fn verify_or_prompt(
        &self,
        host: &str,
        port: u16,
        fingerprint: String,
        prompt: Option<&ConflictPrompt>,
    ) -> Result<(), String> {
        match self.check(host, port, &fingerprint).await {
            HostKeyStatus::Known => Ok(()),
            HostKeyStatus::Unknown => {
                self.add_new(host, port, fingerprint, "personal").await;
                Ok(())
            }
            HostKeyStatus::Changed { stored } => {
                let Some(prompt) = prompt else {
                    return Err(changed_warning(host, port, &stored, &fingerprint));
                };
                let Some(rx) = prompt.pending.wait(&prompt.session_id).await else {
                    return Err(ABORTED_BY_USER.into());
                };
                (prompt.emit)(HostKeyConflictEvent {
                    session_id: prompt.session_id.clone(),
                    host: host.to_string(),
                    port,
                    stored_entries: stored,
                    new_fingerprint: fingerprint.clone(),
                });
                match rx.await {
                    Ok(ConflictAction::AddNew) => {
                        self.add_new(host, port, fingerprint, "personal").await;
                        Ok(())
                    }
                    Ok(ConflictAction::Replace) => {
                        self.replace_all(host, port, fingerprint, "personal").await;
                        Ok(())
                    }
                    _ => Err(ABORTED_BY_USER.into()),
                }
            }
        }
    }

    /// Add a new entry (TOFU or "Add as new" conflict resolution).
    pub async fn add_new(
        &self,
        host: &str,
        port: u16,
        fingerprint: String,
        vault_id: &str,
    ) -> KnownHost {
        let entry = new_entry(host, port, fingerprint, vault_id);
        let mut entries = self.entries.lock().await;
        entries.push(entry.clone());
        save_known_hosts(&entries).ok();
        entry
    }

    /// Adds `fingerprint` for host:port unless a live entry already holds it.
    pub async fn add_once(&self, host: &str, port: u16, fingerprint: &str) {
        let mut entries = self.entries.lock().await;
        if entries
            .iter()
            .any(|e| live_for(e, host, port) && e.fingerprint == fingerprint)
        {
            return;
        }
        entries.push(new_entry(host, port, fingerprint.to_string(), "personal"));
        save_known_hosts(&entries).ok();
    }

    /// Soft-delete all entries for host:port and add a new one ("Replace" resolution).
    pub async fn replace_all(
        &self,
        host: &str,
        port: u16,
        fingerprint: String,
        vault_id: &str,
    ) -> KnownHost {
        let now = Utc::now().to_rfc3339();
        {
            let mut entries = self.entries.lock().await;
            for e in entries.iter_mut() {
                if live_for(e, host, port) {
                    e.deleted_at = Some(now.clone());
                    e.updated_at = now.clone();
                }
            }
            save_known_hosts(&entries).ok();
        }
        self.add_new(host, port, fingerprint, vault_id).await
    }

    /// Trust `fingerprint` for host:port.
    ///
    /// Without `replace`, a host that already has live entries is refused:
    /// `check` returns `Known` on ANY matching entry, so adding a second key
    /// leaves the old one accepted too and the host authenticates with either.
    pub async fn trust(
        &self,
        host: &str,
        port: u16,
        fingerprint: String,
        vault_id: &str,
        replace: bool,
    ) -> Result<(KnownHost, Vec<KnownHost>), String> {
        let existing = self.entries_for(host, port).await;
        if replace {
            let entry = self.replace_all(host, port, fingerprint, vault_id).await;
            return Ok((entry, existing));
        }
        if !existing.is_empty() {
            let stored = existing
                .iter()
                .map(|e| e.fingerprint.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "{}:{} already trusts {}. Superseding a stored key requires replace: true.",
                host, port, stored
            ));
        }
        Ok((
            self.add_new(host, port, fingerprint, vault_id).await,
            vec![],
        ))
    }

    /// Soft-delete an entry by id.
    pub async fn delete(&self, id: &str) {
        let now = Utc::now().to_rfc3339();
        let mut entries = self.entries.lock().await;
        if let Some(e) = entries.iter_mut().find(|e| e.id == id) {
            e.deleted_at = Some(now.clone());
            e.updated_at = now;
        }
        save_known_hosts(&entries).ok();
    }

    /// List all non-deleted entries.
    pub async fn list(&self) -> Vec<KnownHost> {
        self.entries
            .lock()
            .await
            .iter()
            .filter(|e| e.deleted_at.is_none())
            .cloned()
            .collect()
    }

    /// Live (not soft-deleted) entries for one host:port.
    pub async fn entries_for(&self, host: &str, port: u16) -> Vec<KnownHost> {
        self.entries
            .lock()
            .await
            .iter()
            .filter(|e| live_for(e, host, port))
            .cloned()
            .collect()
    }

    pub async fn fingerprints_for(&self, host: &str, port: u16) -> Vec<String> {
        self.entries_for(host, port)
            .await
            .into_iter()
            .map(|e| e.fingerprint)
            .collect()
    }

    /// Move an entry to a different vault.
    pub async fn move_vault(&self, id: &str, vault_id: &str) {
        let now = Utc::now().to_rfc3339();
        let mut entries = self.entries.lock().await;
        if let Some(e) = entries.iter_mut().find(|e| e.id == id) {
            e.vault_id = vault_id.to_string();
            e.updated_at = now;
        }
        save_known_hosts(&entries).ok();
    }

    /// Copy an entry to a different vault, returning the new copy.
    pub async fn copy_to_vault(&self, id: &str, vault_id: &str) -> Option<KnownHost> {
        let source = {
            let entries = self.entries.lock().await;
            entries.iter().find(|e| e.id == id).cloned()
        }?;
        let now = Utc::now().to_rfc3339();
        let copy = KnownHost {
            id: Uuid::new_v4().to_string(),
            vault_id: vault_id.to_string(),
            created_at: now.clone(),
            updated_at: now,
            deleted_at: None,
            clocks: HashMap::new(),
            ..source
        };
        let mut entries = self.entries.lock().await;
        entries.push(copy.clone());
        save_known_hosts(&entries).ok();
        Some(copy)
    }
}

#[cfg(test)]
mod trust_tests {
    use super::*;

    #[tokio::test]
    async fn replace_supersedes_the_previous_entry_for_the_same_host_port() {
        let store = KnownHostsStore::new();
        store
            .add_new("h1", 22, "SHA256:old".into(), "personal")
            .await;

        let superseded = store.entries_for("h1", 22).await;
        assert_eq!(superseded.len(), 1);
        assert_eq!(superseded[0].fingerprint, "SHA256:old");

        store
            .replace_all("h1", 22, "SHA256:new".into(), "personal")
            .await;

        let live = store.entries_for("h1", 22).await;
        assert_eq!(
            live.len(),
            1,
            "the old entry must be soft-deleted, not left alongside"
        );
        assert_eq!(live[0].fingerprint, "SHA256:new");
    }

    #[tokio::test]
    async fn trust_without_replace_refuses_a_host_that_already_has_a_key() {
        let store = KnownHostsStore::new();
        store
            .add_new("h1", 22, "SHA256:old".into(), "personal")
            .await;

        let err = store
            .trust("h1", 22, "SHA256:evil".into(), "personal", false)
            .await
            .expect_err("a second accepted key must not be added silently");
        assert!(
            err.contains("SHA256:old"),
            "the error names the stored key: {}",
            err
        );
        assert!(
            err.contains("replace"),
            "the error names the way forward: {}",
            err
        );

        let live = store.entries_for("h1", 22).await;
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].fingerprint, "SHA256:old");
        assert!(matches!(
            store.check("h1", 22, "SHA256:evil").await,
            HostKeyStatus::Changed { .. }
        ));
    }

    #[tokio::test]
    async fn trust_without_replace_adds_when_the_host_has_none() {
        let store = KnownHostsStore::new();
        let (entry, superseded) = store
            .trust("h1", 22, "SHA256:new".into(), "personal", false)
            .await
            .expect("a host with no stored key is trust-on-first-use");
        assert_eq!(entry.fingerprint, "SHA256:new");
        assert!(superseded.is_empty());
    }

    #[tokio::test]
    async fn trust_with_replace_reports_what_it_superseded() {
        let store = KnownHostsStore::new();
        store
            .add_new("h1", 22, "SHA256:old".into(), "personal")
            .await;
        let (entry, superseded) = store
            .trust("h1", 22, "SHA256:new".into(), "personal", true)
            .await
            .expect("replace supersedes");
        assert_eq!(entry.fingerprint, "SHA256:new");
        assert_eq!(superseded.len(), 1);
        assert_eq!(superseded[0].fingerprint, "SHA256:old");
    }
}

/// A prompt that answers every conflict with `action` and records what it was shown.
#[cfg(test)]
pub(crate) fn answering(
    action: fn() -> ConflictAction,
    seen: Arc<std::sync::Mutex<Vec<HostKeyConflictEvent>>>,
) -> ConflictPrompt {
    let pending = Arc::new(PendingConflicts::new());
    let answer = Arc::clone(&pending);
    ConflictPrompt {
        session_id: "s1".into(),
        pending,
        emit: Box::new(move |event| {
            let tx = answer
                .0
                .try_lock()
                .unwrap()
                .waiting
                .remove(&event.session_id)
                .unwrap();
            seen.lock().unwrap().push(event);
            let _ = tx.send(action());
        }),
    }
}

#[cfg(test)]
mod verify_tests {
    use super::*;

    #[tokio::test]
    async fn an_unknown_fingerprint_is_pinned_without_asking() {
        let store = KnownHostsStore::new();
        store
            .verify_or_prompt("h", 443, "tls-sha256:aa".into(), None)
            .await
            .unwrap();
        let pinned = store.entries_for("h", 443).await;
        assert_eq!(pinned.len(), 1);
        assert_eq!(pinned[0].fingerprint, "tls-sha256:aa");
    }

    #[tokio::test]
    async fn a_known_fingerprint_passes() {
        let store = KnownHostsStore::pinned(&[("h", 443, "tls-sha256:aa")]);
        store
            .verify_or_prompt("h", 443, "tls-sha256:aa".into(), None)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_changed_fingerprint_without_a_prompt_is_refused() {
        let store = KnownHostsStore::pinned(&[("h", 443, "tls-sha256:aa")]);
        let err = store
            .verify_or_prompt("h", 443, "tls-sha256:bb".into(), None)
            .await
            .unwrap_err();
        assert!(err.contains("changed"), "{err}");
        assert_eq!(store.fingerprints_for("h", 443).await, ["tls-sha256:aa"]);
    }

    #[tokio::test]
    async fn replace_supersedes_the_old_pin_after_asking() {
        let store = KnownHostsStore::pinned(&[("h", 443, "tls-sha256:aa")]);
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let prompt = answering(|| ConflictAction::Replace, Arc::clone(&seen));
        store
            .verify_or_prompt("h", 443, "tls-sha256:bb".into(), Some(&prompt))
            .await
            .unwrap();
        assert_eq!(store.fingerprints_for("h", 443).await, ["tls-sha256:bb"]);
        assert_eq!(seen.lock().unwrap()[0].new_fingerprint, "tls-sha256:bb");
    }

    #[tokio::test]
    async fn abort_refuses() {
        let store = KnownHostsStore::pinned(&[("h", 443, "tls-sha256:aa")]);
        let prompt = answering(|| ConflictAction::Abort, Arc::default());
        let err = store
            .verify_or_prompt("h", 443, "tls-sha256:bb".into(), Some(&prompt))
            .await
            .unwrap_err();
        assert!(err.contains("aborted"), "{err}");
        assert_eq!(store.fingerprints_for("h", 443).await, ["tls-sha256:aa"]);
    }

    #[tokio::test]
    async fn a_cancel_sent_before_the_prompt_refuses_it_without_asking() {
        let store = KnownHostsStore::pinned(&[("h", 443, "tls-sha256:aa")]);
        let seen = Arc::default();
        let prompt = answering(|| ConflictAction::Replace, Arc::clone(&seen));
        prompt.pending.cancel("s1").await;
        let err = store
            .verify_or_prompt("h", 443, "tls-sha256:bb".into(), Some(&prompt))
            .await
            .unwrap_err();
        assert!(err.contains("aborted"), "{err}");
        assert!(seen.lock().unwrap().is_empty());

        store
            .verify_or_prompt("h", 443, "tls-sha256:bb".into(), Some(&prompt))
            .await
            .expect("the early cancel is used up by the first prompt");
    }

    #[tokio::test]
    async fn an_answer_without_a_prompt_is_not_kept() {
        let pending = PendingConflicts::new();
        pending.resolve("s1", ConflictAction::Abort).await;
        assert!(pending.wait("s1").await.is_some());
    }

    #[tokio::test]
    async fn early_cancels_beyond_the_cap_drop_the_oldest() {
        let pending = PendingConflicts::new();
        for i in 0..=MAX_EARLY_ABORTS {
            pending.cancel(&i.to_string()).await;
        }
        assert!(pending.wait("0").await.is_some());
        assert!(pending.wait("1").await.is_none());
        assert!(pending.wait(&MAX_EARLY_ABORTS.to_string()).await.is_none());
    }
}
