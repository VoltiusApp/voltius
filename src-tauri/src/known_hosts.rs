use crate::storage::config::{config_dir, load_known_hosts, save_known_hosts, KnownHost};
use chrono::Utc;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

// ─── Conflict resolution types ───────────────────────────────────────────────

pub enum ConflictAction {
    AddNew,
    Replace,
    Abort,
}

pub struct PendingConflicts(pub Mutex<HashMap<String, oneshot::Sender<ConflictAction>>>);

impl PendingConflicts {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
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

// ─── Store ────────────────────────────────────────────────────────────────────

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

    /// Load from disk, migrating the old HashMap-based format if present.
    pub fn load() -> Arc<Self> {
        let mut entries = load_known_hosts();

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
                        let now = Utc::now().to_rfc3339();
                        for (key, fingerprint) in map {
                            let mut parts = key.splitn(2, ':');
                            let host = parts.next().unwrap_or("").to_string();
                            let port: u16 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(22);
                            if !entries.iter().any(|e| {
                                e.host == host && e.port == port && e.fingerprint == fingerprint
                            }) {
                                entries.push(KnownHost {
                                    id: Uuid::new_v4().to_string(),
                                    host,
                                    port,
                                    fingerprint,
                                    name: None,
                                    vault_id: "personal".to_string(),
                                    created_at: now.clone(),
                                    updated_at: now.clone(),
                                    deleted_at: None,
                                    clocks: HashMap::new(),
                                });
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
        let matching: Vec<&KnownHost> = entries
            .iter()
            .filter(|e| e.deleted_at.is_none() && e.host == host && e.port == port)
            .collect();

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

    /// Add a new entry (TOFU or "Add as new" conflict resolution).
    pub async fn add_new(
        &self,
        host: &str,
        port: u16,
        fingerprint: String,
        vault_id: &str,
    ) -> KnownHost {
        let now = Utc::now().to_rfc3339();
        let entry = KnownHost {
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
        };
        let mut entries = self.entries.lock().await;
        entries.push(entry.clone());
        save_known_hosts(&entries).ok();
        entry
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
                if e.host == host && e.port == port && e.deleted_at.is_none() {
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
            .filter(|e| e.deleted_at.is_none() && e.host == host && e.port == port)
            .cloned()
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
