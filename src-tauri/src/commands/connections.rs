use crate::storage::config::{load_connections, save_connections, Connection, ConnectionFormData};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

fn is_alive(deleted_at: &Option<String>, updated_at: &str) -> bool {
    match deleted_at {
        None => true,
        Some(d) => updated_at > d.as_str(),
    }
}

/// Returns the max value among all clocks, falling back to `fallback` if empty.
fn max_clock(clocks: &HashMap<String, String>, fallback: &str) -> String {
    clocks.values().max().cloned().unwrap_or_else(|| fallback.to_string())
}

#[tauri::command]
pub fn connection_list() -> Result<Vec<Connection>, String> {
    let connections = load_connections();
    Ok(connections
        .into_iter()
        .filter(|c| is_alive(&c.deleted_at, &c.updated_at))
        .collect())
}

#[tauri::command]
pub fn connection_save(data: ConnectionFormData) -> Result<Connection, String> {
    let mut connections = load_connections();
    let now = Utc::now().to_rfc3339();
    let mut clocks = HashMap::new();
    clocks.insert("name".to_string(), now.clone());
    clocks.insert("host".to_string(), now.clone());
    clocks.insert("port".to_string(), now.clone());
    clocks.insert("username".to_string(), now.clone());
    clocks.insert("auth_type".to_string(), now.clone());
    clocks.insert("tags".to_string(), now.clone());
    clocks.insert("identity_id".to_string(), now.clone());
    clocks.insert("folder_id".to_string(), now.clone());
    clocks.insert("vault_id".to_string(), now.clone());
    clocks.insert("jump_hosts".to_string(), now.clone());
    clocks.insert("env_vars".to_string(), now.clone());
    clocks.insert("pre_command".to_string(), now.clone());
    clocks.insert("post_command".to_string(), now.clone());
    clocks.insert("terminal_encoding".to_string(), now.clone());
    let vault_id = data.vault_id.unwrap_or_else(|| "personal".to_string());
    check_vault_write(&[vault_id.clone()])?;
    let conn = Connection {
        id: Uuid::new_v4().to_string(),
        name: data.name,
        host: data.host,
        port: data.port,
        username: data.username,
        auth_type: data.auth_type,
        tags: data.tags,
        created_at: now.clone(),
        last_used_at: None,
        distro: None,
        identity_id: data.identity_id,
        folder_id: data.folder_id,
        vault_id,
        jump_hosts: data.jump_hosts,
        env_vars: data.env_vars,
        agent_forwarding: data.agent_forwarding,
        pre_command: data.pre_command,
        post_command: data.post_command,
        terminal_encoding: data.terminal_encoding,
        updated_at: now,
        deleted_at: None,
        pinned: data.pinned,
        ping_disabled: data.ping_disabled,
        clocks,
    };
    connections.push(conn.clone());
    save_connections(&connections)?;
    Ok(conn)
}

#[tauri::command]
pub fn connection_update(id: String, data: ConnectionFormData) -> Result<Connection, String> {
    let mut connections = load_connections();
    let conn = connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connection {} not found", id))?;

    let now = Utc::now().to_rfc3339();
    if conn.name != data.name         { conn.clocks.insert("name".to_string(),       now.clone()); }
    if conn.host != data.host         { conn.clocks.insert("host".to_string(),       now.clone()); }
    if conn.port != data.port         { conn.clocks.insert("port".to_string(),       now.clone()); }
    if conn.username != data.username { conn.clocks.insert("username".to_string(),   now.clone()); }
    if conn.auth_type != data.auth_type { conn.clocks.insert("auth_type".to_string(), now.clone()); }
    if conn.tags != data.tags         { conn.clocks.insert("tags".to_string(),       now.clone()); }
    if conn.identity_id != data.identity_id { conn.clocks.insert("identity_id".to_string(), now.clone()); }
    if conn.folder_id != data.folder_id { conn.clocks.insert("folder_id".to_string(), now.clone()); }
    {
        let old_ids: Vec<_> = conn.jump_hosts.iter().map(|j| j.id.as_str()).collect();
        let new_ids: Vec<_> = data.jump_hosts.iter().map(|j| j.id.as_str()).collect();
        if old_ids != new_ids { conn.clocks.insert("jump_hosts".to_string(), now.clone()); }
    }
    {
        let old_ids: Vec<_> = conn.env_vars.iter().map(|e| e.id.as_str()).collect();
        let new_ids: Vec<_> = data.env_vars.iter().map(|e| e.id.as_str()).collect();
        if old_ids != new_ids { conn.clocks.insert("env_vars".to_string(), now.clone()); }
    }
    if conn.agent_forwarding != data.agent_forwarding { conn.clocks.insert("agent_forwarding".to_string(), now.clone()); }
    if conn.pre_command != data.pre_command { conn.clocks.insert("pre_command".to_string(), now.clone()); }
    if conn.post_command != data.post_command { conn.clocks.insert("post_command".to_string(), now.clone()); }
    if conn.terminal_encoding != data.terminal_encoding { conn.clocks.insert("terminal_encoding".to_string(), now.clone()); }
    if conn.ping_disabled != data.ping_disabled { conn.clocks.insert("ping_disabled".to_string(), now.clone()); }

    // Effective vault: use new one if provided, otherwise keep existing
    let effective_vault = data.vault_id.as_deref().unwrap_or(&conn.vault_id).to_string();
    if let Some(ref vid) = data.vault_id {
        if conn.vault_id != *vid { conn.clocks.insert("vault_id".to_string(), now.clone()); }
    }
    check_vault_write(&[effective_vault])?;

    conn.name = data.name;
    conn.host = data.host;
    conn.port = data.port;
    conn.username = data.username;
    conn.auth_type = data.auth_type;
    conn.tags = data.tags;
    conn.identity_id = data.identity_id;
    conn.folder_id = data.folder_id;
    conn.jump_hosts = data.jump_hosts;
    conn.env_vars = data.env_vars;
    conn.agent_forwarding = data.agent_forwarding;
    conn.pre_command = data.pre_command;
    conn.post_command = data.post_command;
    conn.terminal_encoding = data.terminal_encoding;
    conn.pinned = data.pinned;
    conn.ping_disabled = data.ping_disabled;
    if let Some(vid) = data.vault_id { conn.vault_id = vid; }
    conn.deleted_at = None; // revive if somehow updating a tombstone
    conn.updated_at = max_clock(&conn.clocks, &now);

    let updated = conn.clone();
    save_connections(&connections)?;
    Ok(updated)
}

#[tauri::command]
pub fn connection_set_distro(id: String, distro: String) -> Result<(), String> {
    let mut connections = load_connections();
    let conn = connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connection {} not found", id))?;
    let now = Utc::now().to_rfc3339();
    conn.distro = Some(distro);
    conn.clocks.insert("distro".to_string(), now.clone());
    conn.updated_at = max_clock(&conn.clocks, &now);
    save_connections(&connections)
}

#[tauri::command]
pub fn connection_set_last_used(id: String) -> Result<(), String> {
    let mut connections = load_connections();
    let conn = connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connection {} not found", id))?;
    let now = Utc::now().to_rfc3339();
    conn.last_used_at = Some(now.clone());
    conn.clocks.insert("last_used_at".to_string(), now.clone());
    conn.updated_at = max_clock(&conn.clocks, &now);
    save_connections(&connections)
}

#[tauri::command]
pub fn connection_delete(id: String) -> Result<(), String> {
    let mut connections = load_connections();
    let now = Utc::now().to_rfc3339();
    let conn = connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connection {} not found", id))?;
    check_vault_write(&[conn.vault_id.clone()])?;
    conn.deleted_at = Some(now.clone());
    conn.clocks.insert("__deleted__".to_string(), now.clone());
    conn.updated_at = max_clock(&conn.clocks, &now);
    save_connections(&connections)
}
