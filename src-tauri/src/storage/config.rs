use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

fn default_folder_object_type() -> String {
    "connection".to_string()
}
fn default_personal() -> String {
    "personal".to_string()
}
fn default_ssh() -> String {
    "ssh".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JumpHost {
    pub id: String,
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
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
    pub auth_type: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub distro: Option<String>,
    #[serde(default)]
    pub identity_id: Option<String>,
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
    #[serde(default = "default_ssh")]
    pub connection_type: String,
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
    pub auth_type: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub identity_id: Option<String>,
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
    pub pre_command: Option<String>,
    #[serde(default)]
    pub post_command: Option<String>,
    #[serde(default)]
    pub terminal_encoding: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub ping_disabled: bool,
    #[serde(default = "default_ssh")]
    pub connection_type: String,
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

fn parse_with_migration<T: serde::de::DeserializeOwned>(data: &str) -> Vec<T> {
    let raw: Vec<serde_json::Value> = serde_json::from_str(data).unwrap_or_default();
    raw.into_iter()
        .filter_map(|mut v| {
            if let serde_json::Value::Object(ref mut map) = v {
                migrate_vault_id(map);
            }
            serde_json::from_value(v).ok()
        })
        .collect()
}

// ─── File helpers ────────────────────────────────────────────────────────────

pub fn config_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("voltius");
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

pub fn load_connections() -> Vec<Connection> {
    let path = connections_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    parse_with_migration(&data)
}

pub fn save_connections(connections: &[Connection]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(connections).map_err(|e| e.to_string())?;
    fs::write(connections_file(), data).map_err(|e| e.to_string())
}

pub fn load_identities() -> Vec<Identity> {
    let path = identities_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    parse_with_migration(&data)
}

pub fn save_identities(identities: &[Identity]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(identities).map_err(|e| e.to_string())?;
    fs::write(identities_file(), data).map_err(|e| e.to_string())
}

pub fn load_keys() -> Vec<SshKey> {
    let path = keys_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    parse_with_migration(&data)
}

pub fn save_keys(keys: &[SshKey]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(keys).map_err(|e| e.to_string())?;
    fs::write(keys_file(), data).map_err(|e| e.to_string())
}

pub fn load_folders() -> Vec<Folder> {
    let path = folders_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_folders(folders: &[Folder]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(folders).map_err(|e| e.to_string())?;
    fs::write(folders_file(), data).map_err(|e| e.to_string())
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
    let path = known_hosts_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_known_hosts(entries: &[KnownHost]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(known_hosts_file(), data).map_err(|e| e.to_string())
}

// ─── Snippets ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub content: String,
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
    pub content: String,
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
    let path = port_forwarding_rules_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    parse_with_migration(&data)
}

pub fn save_port_forwarding_rules(rules: &[PortForwardingRule]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(rules).map_err(|e| e.to_string())?;
    fs::write(port_forwarding_rules_file(), data).map_err(|e| e.to_string())
}

fn snippets_file() -> PathBuf {
    config_dir().join("snippets.json")
}

pub fn load_snippets() -> Vec<Snippet> {
    let path = snippets_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    parse_with_migration(&data)
}

pub fn save_snippets(snippets: &[Snippet]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(snippets).map_err(|e| e.to_string())?;
    fs::write(snippets_file(), data).map_err(|e| e.to_string())
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
    let path = snippet_folders_file();
    if !path.exists() {
        return Vec::new();
    }
    let data = fs::read_to_string(path).unwrap_or_default();
    parse_with_migration(&data)
}

pub fn save_snippet_folders(folders: &[SnippetFolder]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(folders).map_err(|e| e.to_string())?;
    fs::write(snippet_folders_file(), data).map_err(|e| e.to_string())
}
