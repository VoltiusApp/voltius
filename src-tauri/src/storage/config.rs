use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Overrides the base config directory. Set once at startup on platforms where
/// `dirs::config_dir()` doesn't resolve to writable, app-scoped storage — most
/// importantly Android, where it falls back to an unwritable cwd ("/"). When
/// set, `config_dir()` uses this instead. See `set_config_dir`.
static CONFIG_DIR_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

/// Pin the base config directory (e.g. to Tauri's `app_data_dir()` on Android).
/// Must be called before any storage access; later calls are ignored.
#[cfg(target_os = "android")]
pub fn set_config_dir(dir: PathBuf) {
    let _ = CONFIG_DIR_OVERRIDE.set(dir);
}

fn default_folder_object_type() -> String {
    "connection".to_string()
}
fn default_personal() -> String {
    "personal".to_string()
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    #[default]
    Password,
    Key,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionType {
    #[default]
    Ssh,
    Serial,
    Ftp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JumpHost {
    pub id: String,
    pub connection_id: String,
    // Snapshot fields, optional. Host/port/username/credentials are resolved
    // dynamically from `connection_id` at use time; these remain only as a
    // fallback for deleted connections or jump hosts imported from external
    // formats that have no managed connection.
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub identity_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub id: String,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: String,
    #[serde(default)]
    pub parent_folder_id: Option<String>,
    #[serde(default = "default_folder_object_type")]
    pub object_type: String,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    /// Per-field LWW clocks: field_name → RFC3339 timestamp of last write.
    /// "__deleted__" key tracks when the entity was soft-deleted.
    pub clocks: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct FolderFormData {
    pub name: String,
    #[serde(default)]
    pub parent_folder_id: Option<String>,
    #[serde(default = "default_folder_object_type")]
    pub object_type: String,
    #[serde(default)]
    pub vault_id: Option<String>,
    #[serde(default)]
    pub pinned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub auth_type: AuthType,
    pub tags: Vec<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub distro: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub identity_id: Option<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    #[serde(default)]
    pub jump_hosts: Vec<JumpHost>,
    #[serde(default)]
    pub env_vars: Vec<EnvVar>,
    #[serde(default)]
    pub agent_forwarding: bool,
    /// Allow weak legacy SSH algorithms (e.g. legacy Cisco IOS) for this host.
    #[serde(default)]
    pub legacy_algorithms: bool,
    #[serde(default)]
    pub pre_command: Option<String>,
    #[serde(default)]
    pub post_command: Option<String>,
    #[serde(default)]
    pub terminal_encoding: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub ping_disabled: bool,
    /// Absent inherits the global toggle; Some(true) forces shell integration
    /// off for this host. (Force-on isn't stored — not sync-safe as a bool.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell_integration_disabled: Option<bool>,
    /// Per-host keepalive preset; None inherits the global setting.
    #[serde(default)]
    pub keepalive_preset: Option<String>,
    /// Per-host session persistence override. None inherits the global setting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persist_session: Option<bool>,
    #[serde(default)]
    pub connection_type: ConnectionType,
    #[serde(default)]
    pub serial_port: Option<String>,
    #[serde(default)]
    pub serial_baud: Option<u32>,
    #[serde(default)]
    pub serial_data_bits: Option<u8>,
    #[serde(default)]
    pub serial_parity: Option<String>,
    #[serde(default)]
    pub serial_stop_bits: Option<u8>,
    #[serde(default)]
    pub serial_flow_control: Option<String>,
    /// FTP only: use explicit FTPS (AUTH TLS) instead of plain FTP.
    #[serde(default)]
    pub ftp_secure: bool,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub clocks: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct ConnectionFormData {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub auth_type: AuthType,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub identity_id: Option<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    /// None = keep existing vault on update, defaults to "personal" on create
    #[serde(default)]
    pub vault_id: Option<String>,
    #[serde(default)]
    pub jump_hosts: Vec<JumpHost>,
    #[serde(default)]
    pub env_vars: Vec<EnvVar>,
    #[serde(default)]
    pub agent_forwarding: bool,
    #[serde(default)]
    pub legacy_algorithms: bool,
    #[serde(default)]
    pub pre_command: Option<String>,
    #[serde(default)]
    pub post_command: Option<String>,
    #[serde(default)]
    pub terminal_encoding: Option<String>,
    #[serde(default)]
    pub distro: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub ping_disabled: bool,
    #[serde(default)]
    pub shell_integration_disabled: Option<bool>,
    #[serde(default)]
    pub keepalive_preset: Option<String>,
    #[serde(default)]
    pub persist_session: Option<bool>,
    #[serde(default)]
    pub connection_type: ConnectionType,
    #[serde(default)]
    pub serial_port: Option<String>,
    #[serde(default)]
    pub serial_baud: Option<u32>,
    #[serde(default)]
    pub serial_data_bits: Option<u8>,
    #[serde(default)]
    pub serial_parity: Option<String>,
    #[serde(default)]
    pub serial_stop_bits: Option<u8>,
    #[serde(default)]
    pub serial_flow_control: Option<String>,
    #[serde(default)]
    pub ftp_secure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub username: String,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    #[serde(default)]
    pub pinned: bool,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub clocks: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct IdentityFormData {
    #[serde(default)]
    pub name: Option<String>,
    pub username: String,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub vault_id: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKey {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub key_type: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    #[serde(default)]
    pub pinned: bool,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub clocks: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct SshKeyFormData {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub key_type: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub vault_id: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

// ─── Backward-compat migration ───────────────────────────────────────────────

/// Migrate an entity JSON object from the old `vault_ids: [...]` format
/// to the new `vault_id: "..."` format.  No-op if already migrated.
fn migrate_vault_id(obj: &mut serde_json::Map<String, serde_json::Value>) {
    if obj.contains_key("vault_id") {
        obj.remove("vault_ids");
        return;
    }
    let vault_id = obj
        .remove("vault_ids")
        .and_then(|v| match v {
            serde_json::Value::Array(arr) => arr
                .into_iter()
                .next()
                .and_then(|e| e.as_str().map(str::to_string)),
            serde_json::Value::String(s) => Some(s),
            _ => None,
        })
        .unwrap_or_else(|| "personal".to_string());
    obj.insert("vault_id".to_string(), serde_json::Value::String(vault_id));
}

/// Legacy `shell_integration_disabled: false` (= follow global) becomes absent
/// (inherit). `true` is kept; new code never writes `false`, so this is idempotent.
fn migrate_shell_integration(obj: &mut serde_json::Map<String, serde_json::Value>) {
    if obj.get("shell_integration_disabled") == Some(&serde_json::Value::Bool(false)) {
        obj.remove("shell_integration_disabled");
    }
}

/// Drop legacy/invalid `auth_type`/`connection_type` strings so `#[serde(default)]`
/// supplies a valid enum variant instead of the record failing to deserialize
/// (which would silently drop it). New code only ever writes valid variants.
fn migrate_enum_fields(obj: &mut serde_json::Map<String, serde_json::Value>) {
    if !matches!(
        obj.get("auth_type").and_then(|v| v.as_str()),
        Some("password") | Some("key")
    ) {
        obj.remove("auth_type");
    }
    if !matches!(
        obj.get("connection_type").and_then(|v| v.as_str()),
        Some("ssh") | Some("serial") | Some("ftp")
    ) {
        obj.remove("connection_type");
    }
}

fn parse_with_migration<T: serde::de::DeserializeOwned>(data: &str) -> Vec<T> {
    let raw: Vec<serde_json::Value> = serde_json::from_str(data).unwrap_or_default();
    raw.into_iter()
        .filter_map(|mut v| {
            if let serde_json::Value::Object(ref mut map) = v {
                migrate_vault_id(map);
                migrate_shell_integration(map);
                migrate_enum_fields(map);
            }
            serde_json::from_value(v).ok()
        })
        .collect()
}

// ─── File helpers ────────────────────────────────────────────────────────────

pub fn config_dir() -> PathBuf {
    let dir = match CONFIG_DIR_OVERRIDE.get() {
        Some(base) => base.clone(),
        None => dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("voltius"),
    };
    fs::create_dir_all(&dir).ok();
    dir
}

fn connections_file() -> PathBuf {
    config_dir().join("connections.json")
}
fn identities_file() -> PathBuf {
    config_dir().join("identities.json")
}
fn keys_file() -> PathBuf {
    config_dir().join("ssh_keys.json")
}
fn folders_file() -> PathBuf {
    config_dir().join("folders.json")
}
pub fn known_hosts_file() -> PathBuf {
    config_dir().join("known_hosts.json")
}

// ─── Generic JSON load/save ──────────────────────────────────────────────────

/// Load a JSON value from `path`, returning `T::default()` if the file is
/// missing, unreadable, or malformed. Mirrors the historical
/// `unwrap_or_default()` behavior: errors are swallowed, never surfaced.
fn load_json<T: serde::de::DeserializeOwned + Default>(path: PathBuf) -> T {
    if !path.exists() {
        return T::default();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

/// Like [`load_json`] but applies the `vault_ids` → `vault_id` migration to
/// each record (see [`parse_with_migration`]). Used by the entity stores.
fn load_json_migrated<T: serde::de::DeserializeOwned>(path: PathBuf) -> Vec<T> {
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    parse_with_migration(&data)
}

/// Pretty-print `value` as JSON and write it to `path`.
fn save_json<T: Serialize + ?Sized>(path: PathBuf, value: &T) -> Result<(), String> {
    let data = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

pub fn load_connections() -> Vec<Connection> {
    load_json_migrated(connections_file())
}

pub fn save_connections(connections: &[Connection]) -> Result<(), String> {
    save_json(connections_file(), connections)
}

pub fn load_identities() -> Vec<Identity> {
    load_json_migrated(identities_file())
}

pub fn save_identities(identities: &[Identity]) -> Result<(), String> {
    save_json(identities_file(), identities)
}

pub fn load_keys() -> Vec<SshKey> {
    load_json_migrated(keys_file())
}

pub fn save_keys(keys: &[SshKey]) -> Result<(), String> {
    save_json(keys_file(), keys)
}

pub fn load_folders() -> Vec<Folder> {
    load_json(folders_file())
}

pub fn save_folders(folders: &[Folder]) -> Result<(), String> {
    save_json(folders_file(), folders)
}

// ─── Known Hosts ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownHost {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub clocks: HashMap<String, String>,
}

pub fn load_known_hosts() -> Vec<KnownHost> {
    load_json(known_hosts_file())
}

pub fn save_known_hosts(entries: &[KnownHost]) -> Result<(), String> {
    save_json(known_hosts_file(), entries)
}

// ─── Snippets ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SnippetStep {
    Script {
        content: String,
    },
    Transfer {
        direction: TransferDirection,
        local_path: String,
        remote_path: String,
        is_dir: bool,
    },
    Snippet {
        snippet_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default)]
    pub steps: Vec<SnippetStep>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub only_for_connection_tags: Vec<String>,
    #[serde(default)]
    pub only_for_distros: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    pub clocks: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct SnippetFormData {
    pub name: String,
    #[serde(default)]
    pub steps: Vec<SnippetStep>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub only_for_connection_tags: Vec<String>,
    #[serde(default)]
    pub only_for_distros: Vec<String>,
    #[serde(default)]
    pub vault_id: Option<String>,
}

// ─── Port Forwarding Rules ────────────────────────────────────────────────────

fn default_localhost() -> String {
    "127.0.0.1".to_string()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TunnelType {
    #[default]
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardingRule {
    pub id: String,
    pub name: String,
    pub local_port: u16,
    pub remote_port: u16,
    #[serde(default = "default_localhost")]
    pub remote_host: String,
    #[serde(default)]
    pub tunnel_type: TunnelType,
    /// Remote tunnels: server-side bind address (default 127.0.0.1)
    #[serde(default = "default_localhost")]
    pub bind_host: String,
    /// Remote tunnels: local target host reached from this machine (default 127.0.0.1)
    #[serde(default = "default_localhost")]
    pub target_host: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Which SSH connections this rule applies to (empty = all)
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub clocks: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct PortForwardingRuleFormData {
    pub name: String,
    pub local_port: u16,
    pub remote_port: u16,
    #[serde(default = "default_localhost")]
    pub remote_host: String,
    #[serde(default)]
    pub tunnel_type: TunnelType,
    #[serde(default = "default_localhost")]
    pub bind_host: String,
    #[serde(default = "default_localhost")]
    pub target_host: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub vault_id: Option<String>,
}

fn port_forwarding_rules_file() -> PathBuf {
    config_dir().join("port_forwarding_rules.json")
}

pub fn load_port_forwarding_rules() -> Vec<PortForwardingRule> {
    load_json_migrated(port_forwarding_rules_file())
}

pub fn save_port_forwarding_rules(rules: &[PortForwardingRule]) -> Result<(), String> {
    save_json(port_forwarding_rules_file(), rules)
}

fn snippets_file() -> PathBuf {
    config_dir().join("snippets.json")
}

fn migrate_snippet_steps(s: &mut Snippet) {
    if s.content.is_none() {
        return;
    }
    // Legacy record carrying `content`: fold it into steps if none exist yet.
    let content = s.content.take().unwrap_or_default();
    if s.steps.is_empty() {
        s.steps = vec![SnippetStep::Script { content }];
    }
    if let Some(c) = s.clocks.remove("content") {
        s.clocks.entry("steps".to_string()).or_insert(c);
    }
}

pub fn load_snippets() -> Vec<Snippet> {
    let mut snippets: Vec<Snippet> = load_json_migrated(snippets_file());
    let needs = snippets.iter().any(|s| s.content.is_some());
    for s in snippets.iter_mut() {
        migrate_snippet_steps(s);
    }
    if needs {
        let _ = save_snippets(&snippets);
    }
    snippets
}

pub fn save_snippets(snippets: &[Snippet]) -> Result<(), String> {
    save_json(snippets_file(), snippets)
}

// ─── Snippet folders ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetFolder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    pub clocks: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct SnippetFolderFormData {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub vault_id: Option<String>,
}

fn snippet_folders_file() -> PathBuf {
    config_dir().join("snippet_folders.json")
}

pub fn load_snippet_folders() -> Vec<SnippetFolder> {
    load_json_migrated(snippet_folders_file())
}

pub fn save_snippet_folders(folders: &[SnippetFolder]) -> Result<(), String> {
    save_json(snippet_folders_file(), folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;

    /// Asserts that `value` survives a JSON serialize → deserialize → serialize
    /// cycle unchanged. Compares `serde_json::Value`s (not strings) so that
    /// `HashMap` clock ordering does not make the assertion flaky.
    fn assert_json_round_trip<T: Serialize + DeserializeOwned>(value: &T) {
        let v1 = serde_json::to_value(value).expect("serialize");
        let back: T = serde_json::from_value(v1.clone()).expect("deserialize");
        let v2 = serde_json::to_value(&back).expect("re-serialize");
        assert_eq!(v1, v2);
    }

    fn clocks() -> HashMap<String, String> {
        let mut c = HashMap::new();
        c.insert("name".to_string(), "2026-01-01T00:00:00Z".to_string());
        c.insert("host".to_string(), "2026-01-02T00:00:00Z".to_string());
        c
    }

    fn sample_connection() -> Connection {
        Connection {
            id: "conn-1".into(),
            name: Some("web".into()),
            host: "example.com".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Key,
            tags: vec!["prod".into(), "eu".into()],
            created_at: "2026-01-01T00:00:00Z".into(),
            last_used_at: Some("2026-01-05T00:00:00Z".into()),
            distro: Some("ubuntu".into()),
            icon: Some("server".into()),
            identity_id: Some("id-1".into()),
            key_id: Some("key-1".into()),
            folder_id: Some("folder-1".into()),
            vault_id: "team".into(),
            jump_hosts: vec![JumpHost {
                id: "jh-1".into(),
                connection_id: "c-9".into(),
                host: Some("bastion".into()),
                port: Some(2222),
                username: Some("jump".into()),
                identity_id: Some("id-2".into()),
            }],
            env_vars: vec![EnvVar {
                id: "ev-1".into(),
                key: "TERM".into(),
                value: "xterm".into(),
            }],
            agent_forwarding: true,
            legacy_algorithms: false,
            pre_command: Some("echo hi".into()),
            post_command: Some("echo bye".into()),
            terminal_encoding: Some("utf-8".into()),
            pinned: true,
            ping_disabled: false,
            shell_integration_disabled: None,
            keepalive_preset: None,
            persist_session: None,
            connection_type: ConnectionType::Ssh,
            serial_port: Some("/dev/ttyU0".into()),
            serial_baud: Some(9600),
            serial_data_bits: Some(8),
            serial_parity: Some("none".into()),
            serial_stop_bits: Some(1),
            serial_flow_control: Some("none".into()),
            ftp_secure: false,
            updated_at: "2026-01-02T00:00:00Z".into(),
            deleted_at: None,
            clocks: clocks(),
        }
    }

    fn sample_identity() -> Identity {
        Identity {
            id: "id-1".into(),
            name: Some("admin".into()),
            username: "root".into(),
            key_id: Some("key-1".into()),
            tags: vec!["prod".into()],
            created_at: "2026-01-01T00:00:00Z".into(),
            folder_id: Some("folder-1".into()),
            vault_id: "team".into(),
            pinned: true,
            updated_at: "2026-01-02T00:00:00Z".into(),
            deleted_at: None,
            clocks: clocks(),
        }
    }

    fn sample_folder() -> Folder {
        Folder {
            id: "folder-1".into(),
            name: "Servers".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            parent_folder_id: Some("root".into()),
            object_type: "connection".into(),
            vault_id: "team".into(),
            pinned: Some(true),
            updated_at: "2026-01-02T00:00:00Z".into(),
            deleted_at: None,
            clocks: clocks(),
        }
    }

    #[test]
    fn connection_serde_round_trip() {
        assert_json_round_trip(&sample_connection());
    }

    #[test]
    fn identity_serde_round_trip() {
        assert_json_round_trip(&sample_identity());
    }

    #[test]
    fn folder_serde_round_trip() {
        assert_json_round_trip(&sample_folder());
    }

    #[test]
    fn deleted_connection_serde_round_trip() {
        let mut c = sample_connection();
        c.deleted_at = Some("2026-02-01T00:00:00Z".into());
        c.clocks
            .insert("__deleted__".into(), "2026-02-01T00:00:00Z".into());
        assert_json_round_trip(&c);
    }

    // ── migrate_vault_id ────────────────────────────────────────────────────
    /// Runs `migrate_vault_id` over `input`'s object and returns the result.
    fn migrate(input: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        let mut map = input.as_object().expect("object").clone();
        migrate_vault_id(&mut map);
        map
    }

    #[test]
    fn migrate_keeps_existing_vault_id_and_drops_vault_ids() {
        let out = migrate(serde_json::json!({ "vault_id": "keep", "vault_ids": ["x"] }));
        assert_eq!(out.get("vault_id").unwrap(), "keep");
        assert!(!out.contains_key("vault_ids"));
    }

    #[test]
    fn migrate_takes_first_element_of_vault_ids_array() {
        let out = migrate(serde_json::json!({ "vault_ids": ["team", "other"] }));
        assert_eq!(out.get("vault_id").unwrap(), "team");
        assert!(!out.contains_key("vault_ids"));
    }

    #[test]
    fn migrate_accepts_vault_ids_as_bare_string() {
        let out = migrate(serde_json::json!({ "vault_ids": "solo" }));
        assert_eq!(out.get("vault_id").unwrap(), "solo");
    }

    #[test]
    fn migrate_defaults_to_personal_for_empty_array() {
        let out = migrate(serde_json::json!({ "vault_ids": [] }));
        assert_eq!(out.get("vault_id").unwrap(), "personal");
    }

    #[test]
    fn migrate_defaults_to_personal_when_absent() {
        let out = migrate(serde_json::json!({ "other": 1 }));
        assert_eq!(out.get("vault_id").unwrap(), "personal");
    }

    #[test]
    fn migrate_defaults_to_personal_for_wrong_type() {
        let out = migrate(serde_json::json!({ "vault_ids": 42 }));
        assert_eq!(out.get("vault_id").unwrap(), "personal");
    }

    // ── migrate_enum_fields ─────────────────────────────────────────────────
    fn migrate_enums(input: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        let mut map = input.as_object().expect("object").clone();
        migrate_enum_fields(&mut map);
        map
    }

    #[test]
    fn migrate_enum_keeps_valid_values() {
        let out =
            migrate_enums(serde_json::json!({ "auth_type": "key", "connection_type": "serial" }));
        assert_eq!(out.get("auth_type").unwrap(), "key");
        assert_eq!(out.get("connection_type").unwrap(), "serial");

        // FTP is a valid connection_type and must survive a load round-trip.
        let ftp = migrate_enums(serde_json::json!({ "connection_type": "ftp" }));
        assert_eq!(ftp.get("connection_type").unwrap(), "ftp");
    }

    #[test]
    fn migrate_enum_drops_invalid_values_so_defaults_apply() {
        // Legacy empty/unknown strings must be removed, not deserialized — else the
        // whole connection record would be silently dropped on load.
        let out =
            migrate_enums(serde_json::json!({ "auth_type": "", "connection_type": "telnet" }));
        assert!(!out.contains_key("auth_type"));
        assert!(!out.contains_key("connection_type"));
    }

    // ── parse_with_migration ────────────────────────────────────────────────
    #[derive(serde::Deserialize, Debug, PartialEq)]
    struct Mini {
        id: String,
    }

    #[derive(serde::Deserialize, Debug, PartialEq)]
    struct WithVault {
        id: String,
        vault_id: String,
    }

    #[test]
    fn parse_reads_valid_array() {
        let got: Vec<Mini> = parse_with_migration(r#"[{"id":"a"},{"id":"b"}]"#);
        assert_eq!(got, vec![Mini { id: "a".into() }, Mini { id: "b".into() }]);
    }

    #[test]
    fn parse_applies_migration_to_each_record() {
        let got: Vec<WithVault> = parse_with_migration(r#"[{"id":"a","vault_ids":["team","x"]}]"#);
        assert_eq!(
            got,
            vec![WithVault {
                id: "a".into(),
                vault_id: "team".into(),
            }]
        );
    }

    #[test]
    fn parse_returns_empty_on_malformed_json() {
        // Pinned current behavior: `unwrap_or_default()` swallows parse errors.
        let got: Vec<Mini> = parse_with_migration("not valid json {");
        assert!(got.is_empty());
    }

    #[test]
    fn parse_returns_empty_when_top_level_is_not_an_array() {
        let got: Vec<Mini> = parse_with_migration(r#"{"id":"a"}"#);
        assert!(got.is_empty());
    }

    #[test]
    fn parse_silently_drops_records_that_fail_to_deserialize() {
        // Pinned current behavior: a bad record is filtered out, not surfaced.
        let got: Vec<Mini> = parse_with_migration(r#"[{"id":"a"},{"nope":"b"}]"#);
        assert_eq!(got, vec![Mini { id: "a".into() }]);
    }

    // ── End-to-end persistence (golden master for the load/save layer) ───────
    //
    // Linux only: `config_dir()` resolves via `dirs::config_dir()`, which honors
    // `XDG_CONFIG_HOME` on Linux but not on macOS/Windows (CI runs on Linux).
    // Kept in a single test (no `serial_test` dep) because it mutates the
    // process-global `XDG_CONFIG_HOME`; no other test reads `config_dir()`.
    #[cfg(target_os = "linux")]
    #[test]
    fn persistence_round_trip_and_on_disk_migration() {
        let dir = std::env::temp_dir().join(format!("voltius-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("XDG_CONFIG_HOME", &dir);

        // A missing file loads as empty, not an error.
        assert!(load_identities().is_empty());

        // save → load preserves the record.
        save_connections(&[sample_connection()]).expect("save");
        let loaded = load_connections();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "conn-1");
        assert_eq!(loaded[0].vault_id, "team");

        // Legacy `vault_ids` on disk is migrated to `vault_id` on load.
        let legacy = r#"[{"id":"c2","tags":[],"created_at":"t","last_used_at":null,
            "updated_at":"t","deleted_at":null,"clocks":{},"vault_ids":["legacy-team","x"]}]"#;
        std::fs::write(config_dir().join("connections.json"), legacy).unwrap();
        let migrated = load_connections();
        assert_eq!(migrated.len(), 1);
        assert_eq!(migrated[0].vault_id, "legacy-team");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod snippet_steps_tests {
    use super::*;

    #[test]
    fn legacy_content_becomes_single_script_step() {
        let json = r#"{"id":"a","name":"n","content":"echo hi","created_at":"t","updated_at":"t","deleted_at":null,"vault_id":"personal","clocks":{"content":"t"}}"#;
        let mut s: Snippet = serde_json::from_str(json).unwrap();
        migrate_snippet_steps(&mut s);
        assert_eq!(s.steps.len(), 1);
        match &s.steps[0] {
            SnippetStep::Script { content } => assert_eq!(content, "echo hi"),
            _ => panic!("expected script step"),
        }
        assert!(s.content.is_none());
        assert!(s.clocks.contains_key("steps"));
        assert!(!s.clocks.contains_key("content"));
    }

    #[test]
    fn snippet_with_steps_is_left_alone() {
        let json = r#"{"id":"a","name":"n","steps":[{"kind":"script","content":"x"}],"created_at":"t","updated_at":"t","deleted_at":null,"vault_id":"personal","clocks":{"steps":"t"}}"#;
        let mut s: Snippet = serde_json::from_str(json).unwrap();
        migrate_snippet_steps(&mut s);
        assert_eq!(s.steps.len(), 1);
    }

    #[test]
    fn empty_steps_without_content_is_left_empty() {
        let json = r#"{"id":"a","name":"n","steps":[],"created_at":"t","updated_at":"t","deleted_at":null,"vault_id":"personal","clocks":{"name":"t"}}"#;
        let mut s: Snippet = serde_json::from_str(json).unwrap();
        migrate_snippet_steps(&mut s);
        assert!(s.steps.is_empty());
        assert!(!s.clocks.contains_key("steps"));
        assert!(!s.clocks.contains_key("content"));
    }

    #[test]
    fn content_dropped_when_steps_already_present() {
        let json = r#"{"id":"a","name":"n","content":"legacy","steps":[{"kind":"script","content":"real"}],"created_at":"t","updated_at":"t","deleted_at":null,"vault_id":"personal","clocks":{"steps":"t"}}"#;
        let mut s: Snippet = serde_json::from_str(json).unwrap();
        migrate_snippet_steps(&mut s);
        assert!(s.content.is_none());
        assert_eq!(s.steps.len(), 1);
        match &s.steps[0] {
            SnippetStep::Script { content } => assert_eq!(content, "real"),
            _ => panic!("expected script step"),
        }
    }
}
