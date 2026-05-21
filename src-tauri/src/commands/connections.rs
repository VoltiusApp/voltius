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
    clocks
        .values()
        .max()
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

/// Builds an updated `Connection` by applying `data` on top of `existing`.
///
/// Using a struct literal here is intentional: the compiler will flag any newly
/// added `Connection` field that isn't handled, preventing the class of bug
/// where a field is silently dropped on update.
///
/// `distro` / `icon` use "keep existing if not provided" semantics.
/// `vault_id` falls back to the existing vault when absent from the form.
fn merge_form_into_connection(existing: &Connection, data: ConnectionFormData) -> Connection {
    let vault_id = data.vault_id.unwrap_or_else(|| existing.vault_id.clone());
    Connection {
        id: existing.id.clone(),
        name: data.name,
        host: data.host,
        port: data.port,
        username: data.username,
        auth_type: data.auth_type,
        tags: data.tags,
        identity_id: data.identity_id,
        key_id: data.key_id,
        folder_id: data.folder_id,
        vault_id,
        jump_hosts: data.jump_hosts,
        env_vars: data.env_vars,
        agent_forwarding: data.agent_forwarding,
        pre_command: data.pre_command,
        post_command: data.post_command,
        terminal_encoding: data.terminal_encoding,
        distro: data.distro.or_else(|| existing.distro.clone()),
        icon: data.icon.or_else(|| existing.icon.clone()),
        pinned: data.pinned,
        ping_disabled: data.ping_disabled,
        connection_type: data.connection_type,
        serial_port: data.serial_port,
        serial_baud: data.serial_baud,
        serial_data_bits: data.serial_data_bits,
        serial_parity: data.serial_parity,
        serial_stop_bits: data.serial_stop_bits,
        serial_flow_control: data.serial_flow_control,
        created_at: existing.created_at.clone(),
        last_used_at: existing.last_used_at.clone(),
        updated_at: existing.updated_at.clone(), // caller sets this after clock bumps
        deleted_at: None,
        clocks: existing.clocks.clone(),
    }
}

/// Stamps a CRDT clock for every field that changed between `old` and `new`.
fn bump_changed_clocks(old: &Connection, new: &mut Connection, now: &str) {
    macro_rules! bump {
        ($field:ident) => {
            if old.$field != new.$field {
                new.clocks.insert(stringify!($field).to_string(), now.to_string());
            }
        };
    }
    bump!(name);
    bump!(host);
    bump!(port);
    bump!(username);
    bump!(auth_type);
    bump!(tags);
    bump!(identity_id);
    bump!(key_id);
    bump!(folder_id);
    bump!(vault_id);
    bump!(agent_forwarding);
    bump!(pre_command);
    bump!(post_command);
    bump!(terminal_encoding);
    bump!(distro);
    bump!(icon);
    bump!(ping_disabled);
    bump!(connection_type);
    bump!(serial_port);
    bump!(serial_baud);
    bump!(serial_data_bits);
    bump!(serial_parity);
    bump!(serial_stop_bits);
    bump!(serial_flow_control);
    // ID-only comparison: content changes within the same set of IDs are tracked
    // by each entry's own sync mechanism, not the parent connection clock.
    let old_jh: Vec<_> = old.jump_hosts.iter().map(|j| j.id.as_str()).collect();
    let new_jh: Vec<_> = new.jump_hosts.iter().map(|j| j.id.as_str()).collect();
    if old_jh != new_jh {
        new.clocks.insert("jump_hosts".to_string(), now.to_string());
    }
    let old_ev: Vec<_> = old.env_vars.iter().map(|e| e.id.as_str()).collect();
    let new_ev: Vec<_> = new.env_vars.iter().map(|e| e.id.as_str()).collect();
    if old_ev != new_ev {
        new.clocks.insert("env_vars".to_string(), now.to_string());
    }
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
    clocks.insert("key_id".to_string(), now.clone());
    clocks.insert("folder_id".to_string(), now.clone());
    clocks.insert("vault_id".to_string(), now.clone());
    clocks.insert("jump_hosts".to_string(), now.clone());
    clocks.insert("env_vars".to_string(), now.clone());
    clocks.insert("pre_command".to_string(), now.clone());
    clocks.insert("post_command".to_string(), now.clone());
    clocks.insert("terminal_encoding".to_string(), now.clone());
    clocks.insert("distro".to_string(), now.clone());
    clocks.insert("icon".to_string(), now.clone());
    clocks.insert("connection_type".to_string(), now.clone());
    clocks.insert("serial_port".to_string(), now.clone());
    clocks.insert("serial_baud".to_string(), now.clone());
    clocks.insert("serial_data_bits".to_string(), now.clone());
    clocks.insert("serial_parity".to_string(), now.clone());
    clocks.insert("serial_stop_bits".to_string(), now.clone());
    clocks.insert("serial_flow_control".to_string(), now.clone());
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
        distro: data.distro,
        icon: data.icon,
        identity_id: data.identity_id,
        key_id: data.key_id,
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
        connection_type: data.connection_type,
        serial_port: data.serial_port,
        serial_baud: data.serial_baud,
        serial_data_bits: data.serial_data_bits,
        serial_parity: data.serial_parity,
        serial_stop_bits: data.serial_stop_bits,
        serial_flow_control: data.serial_flow_control,
        clocks,
    };
    connections.push(conn.clone());
    save_connections(&connections)?;
    Ok(conn)
}

#[tauri::command]
pub fn connection_update(id: String, data: ConnectionFormData) -> Result<Connection, String> {
    let mut connections = load_connections();
    let existing = connections
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connection {} not found", id))?
        .clone();

    let effective_vault = data.vault_id.as_deref().unwrap_or(&existing.vault_id).to_string();
    check_vault_write(&[effective_vault])?;

    let now = Utc::now().to_rfc3339();
    let mut updated = merge_form_into_connection(&existing, data);
    bump_changed_clocks(&existing, &mut updated, &now);
    updated.updated_at = max_clock(&updated.clocks, &now);

    *connections.iter_mut().find(|c| c.id == id).unwrap() = updated.clone();
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
