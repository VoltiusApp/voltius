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
        shell_integration_disabled: data.shell_integration_disabled,
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
                new.clocks
                    .insert(stringify!($field).to_string(), now.to_string());
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
    bump!(shell_integration_disabled);
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
    check_vault_write(std::slice::from_ref(&vault_id))?;
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
        shell_integration_disabled: data.shell_integration_disabled,
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

    let effective_vault = data
        .vault_id
        .as_deref()
        .unwrap_or(&existing.vault_id)
        .to_string();
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
    check_vault_write(std::slice::from_ref(&conn.vault_id))?;
    conn.deleted_at = Some(now.clone());
    conn.clocks.insert("__deleted__".to_string(), now.clone());
    conn.updated_at = max_clock(&conn.clocks, &now);
    save_connections(&connections)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::config::{Connection, ConnectionFormData, EnvVar, JumpHost};
    use std::collections::HashMap;

    /// A fully-populated `Connection` with deterministic, distinct field values.
    /// Every test starts from this and mutates only what it exercises.
    fn sample_connection() -> Connection {
        Connection {
            id: "conn-1".into(),
            name: Some("orig-name".into()),
            host: "orig.host".into(),
            port: 22,
            username: "orig-user".into(),
            auth_type: "password".into(),
            tags: vec!["a".into()],
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
                host: None,
                port: None,
                username: None,
                identity_id: None,
            }],
            env_vars: vec![EnvVar {
                id: "ev-1".into(),
                key: "K".into(),
                value: "V".into(),
            }],
            agent_forwarding: false,
            pre_command: Some("pre".into()),
            post_command: Some("post".into()),
            terminal_encoding: Some("utf-8".into()),
            pinned: false,
            ping_disabled: false,
            shell_integration_disabled: false,
            connection_type: "ssh".into(),
            serial_port: Some("/dev/ttyU0".into()),
            serial_baud: Some(9600),
            serial_data_bits: Some(8),
            serial_parity: Some("none".into()),
            serial_stop_bits: Some(1),
            serial_flow_control: Some("none".into()),
            updated_at: "2026-01-01T00:00:00Z".into(),
            deleted_at: None,
            clocks: HashMap::new(),
        }
    }

    /// Form data whose every field differs from `sample_connection()`.
    fn sample_form() -> ConnectionFormData {
        ConnectionFormData {
            name: Some("new-name".into()),
            host: "new.host".into(),
            port: 2222,
            username: "new-user".into(),
            auth_type: "key".into(),
            tags: vec!["b".into(), "c".into()],
            identity_id: Some("id-2".into()),
            key_id: Some("key-2".into()),
            folder_id: Some("folder-2".into()),
            vault_id: Some("personal".into()),
            jump_hosts: vec![JumpHost {
                id: "jh-2".into(),
                connection_id: "c-10".into(),
                host: None,
                port: None,
                username: None,
                identity_id: None,
            }],
            env_vars: vec![EnvVar {
                id: "ev-2".into(),
                key: "K2".into(),
                value: "V2".into(),
            }],
            agent_forwarding: true,
            pre_command: Some("pre2".into()),
            post_command: Some("post2".into()),
            terminal_encoding: Some("latin-1".into()),
            distro: Some("debian".into()),
            icon: Some("laptop".into()),
            pinned: true,
            ping_disabled: true,
            shell_integration_disabled: true,
            connection_type: "serial".into(),
            serial_port: Some("/dev/ttyU1".into()),
            serial_baud: Some(115200),
            serial_data_bits: Some(7),
            serial_parity: Some("even".into()),
            serial_stop_bits: Some(2),
            serial_flow_control: Some("rtscts".into()),
        }
    }

    // ── is_alive ────────────────────────────────────────────────────────────
    #[test]
    fn is_alive_true_when_never_deleted() {
        assert!(is_alive(&None, "2026-01-01T00:00:00Z"));
    }

    #[test]
    fn is_alive_true_when_updated_after_delete() {
        let deleted = Some("2026-01-01T00:00:00Z".to_string());
        assert!(is_alive(&deleted, "2026-01-02T00:00:00Z"));
    }

    #[test]
    fn is_alive_false_when_updated_equals_delete() {
        // Strict `>`: an equal timestamp counts as deleted, not alive.
        let deleted = Some("2026-01-01T00:00:00Z".to_string());
        assert!(!is_alive(&deleted, "2026-01-01T00:00:00Z"));
    }

    #[test]
    fn is_alive_false_when_updated_before_delete() {
        let deleted = Some("2026-01-02T00:00:00Z".to_string());
        assert!(!is_alive(&deleted, "2026-01-01T00:00:00Z"));
    }

    // ── max_clock ───────────────────────────────────────────────────────────
    #[test]
    fn max_clock_uses_fallback_when_empty() {
        assert_eq!(max_clock(&HashMap::new(), "fallback"), "fallback");
    }

    #[test]
    fn max_clock_returns_lexicographic_max() {
        let mut clocks = HashMap::new();
        clocks.insert("name".into(), "2026-01-01T00:00:00Z".into());
        clocks.insert("host".into(), "2026-03-01T00:00:00Z".into());
        clocks.insert("port".into(), "2026-02-01T00:00:00Z".into());
        // RFC3339 strings sort chronologically under lexicographic max.
        assert_eq!(max_clock(&clocks, "fallback"), "2026-03-01T00:00:00Z");
    }

    // ── merge_form_into_connection ──────────────────────────────────────────
    #[test]
    fn merge_overwrites_form_backed_fields() {
        let existing = sample_connection();
        let merged = merge_form_into_connection(&existing, sample_form());
        assert_eq!(merged.name, Some("new-name".to_string()));
        assert_eq!(merged.host, "new.host");
        assert_eq!(merged.port, 2222);
        assert_eq!(merged.username, "new-user");
        assert_eq!(merged.auth_type, "key");
        assert_eq!(merged.tags, vec!["b".to_string(), "c".to_string()]);
        assert_eq!(merged.connection_type, "serial");
        assert!(merged.agent_forwarding);
        assert!(merged.pinned);
    }

    #[test]
    fn merge_keeps_existing_distro_and_icon_when_form_omits_them() {
        let existing = sample_connection();
        let mut form = sample_form();
        form.distro = None;
        form.icon = None;
        let merged = merge_form_into_connection(&existing, form);
        assert_eq!(merged.distro, Some("ubuntu".to_string()));
        assert_eq!(merged.icon, Some("server".to_string()));
    }

    #[test]
    fn merge_uses_form_distro_and_icon_when_present() {
        let merged = merge_form_into_connection(&sample_connection(), sample_form());
        assert_eq!(merged.distro, Some("debian".to_string()));
        assert_eq!(merged.icon, Some("laptop".to_string()));
    }

    #[test]
    fn merge_vault_id_falls_back_to_existing_when_form_none() {
        let existing = sample_connection(); // vault_id = "team"
        let mut form = sample_form();
        form.vault_id = None;
        let merged = merge_form_into_connection(&existing, form);
        assert_eq!(merged.vault_id, "team");
    }

    #[test]
    fn merge_preserves_identity_and_clears_deleted_at() {
        let mut existing = sample_connection();
        existing.deleted_at = Some("2026-01-09T00:00:00Z".into());
        existing
            .clocks
            .insert("host".into(), "2026-01-08T00:00:00Z".into());
        let merged = merge_form_into_connection(&existing, sample_form());
        // Identity + provenance fields come from `existing`, not the form.
        assert_eq!(merged.id, "conn-1");
        assert_eq!(merged.created_at, "2026-01-01T00:00:00Z");
        assert_eq!(
            merged.last_used_at,
            Some("2026-01-05T00:00:00Z".to_string())
        );
        assert_eq!(merged.updated_at, "2026-01-01T00:00:00Z"); // caller bumps later
        assert_eq!(
            merged.clocks.get("host").map(String::as_str),
            Some("2026-01-08T00:00:00Z")
        );
        // A merge always revives the entity.
        assert_eq!(merged.deleted_at, None);
    }

    // ── bump_changed_clocks ─────────────────────────────────────────────────
    #[test]
    fn bump_stamps_only_changed_fields() {
        let old = sample_connection();
        let mut new = old.clone();
        new.host = "changed.host".into();
        new.port = 2200;
        bump_changed_clocks(&old, &mut new, "2026-02-02T00:00:00Z");
        let mut keys: Vec<_> = new.clocks.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, vec!["host".to_string(), "port".to_string()]);
        assert_eq!(new.clocks["host"], "2026-02-02T00:00:00Z");
    }

    #[test]
    fn bump_with_no_changes_adds_no_clocks() {
        let old = sample_connection();
        let mut new = old.clone();
        bump_changed_clocks(&old, &mut new, "2026-02-02T00:00:00Z");
        assert!(new.clocks.is_empty());
    }

    #[test]
    fn bump_jump_hosts_compares_ids_only() {
        let old = sample_connection();

        // Same ID, different snapshot content → NOT a change (tracked per-entry).
        let mut same_ids = old.clone();
        same_ids.jump_hosts[0].host = Some("snapshot.changed".into());
        bump_changed_clocks(&old, &mut same_ids, "2026-02-02T00:00:00Z");
        assert!(!same_ids.clocks.contains_key("jump_hosts"));

        // Different ID set → a change.
        let mut diff_ids = old.clone();
        diff_ids.jump_hosts[0].id = "jh-other".into();
        bump_changed_clocks(&old, &mut diff_ids, "2026-02-02T00:00:00Z");
        assert!(diff_ids.clocks.contains_key("jump_hosts"));
    }

    #[test]
    fn bump_env_vars_compares_ids_only() {
        let old = sample_connection();

        let mut same_ids = old.clone();
        same_ids.env_vars[0].value = "changed".into();
        bump_changed_clocks(&old, &mut same_ids, "2026-02-02T00:00:00Z");
        assert!(!same_ids.clocks.contains_key("env_vars"));

        let mut diff_ids = old.clone();
        diff_ids.env_vars[0].id = "ev-other".into();
        bump_changed_clocks(&old, &mut diff_ids, "2026-02-02T00:00:00Z");
        assert!(diff_ids.clocks.contains_key("env_vars"));
    }

    /// Pins the exact set of fields `bump_changed_clocks` tracks when everything
    /// changes. NOTE: this set (27 fields, incl. `agent_forwarding`,
    /// `ping_disabled`, `shell_integration_disabled`) is intentionally pinned
    /// as-is. It does NOT match the 24-key clock map hand-built in
    /// `connection_save` (which omits those three and never tracks `pinned`).
    /// That divergence is a known wart for Phase 1's clock-field unification to
    /// reconcile — this test exists so that reconciliation is deliberate.
    #[test]
    fn bump_covers_the_expected_field_set() {
        let old = sample_connection();
        let merged = merge_form_into_connection(&old, sample_form());
        let mut new = merged;
        bump_changed_clocks(&old, &mut new, "2026-02-02T00:00:00Z");

        let mut keys: Vec<String> = new.clocks.keys().cloned().collect();
        keys.sort();
        let mut expected = vec![
            "agent_forwarding",
            "auth_type",
            "connection_type",
            "distro",
            "env_vars",
            "folder_id",
            "host",
            "icon",
            "identity_id",
            "jump_hosts",
            "key_id",
            "name",
            "ping_disabled",
            "port",
            "post_command",
            "pre_command",
            "serial_baud",
            "serial_data_bits",
            "serial_flow_control",
            "serial_parity",
            "serial_port",
            "serial_stop_bits",
            "shell_integration_disabled",
            "tags",
            "terminal_encoding",
            "username",
            "vault_id",
        ];
        expected.sort();
        assert_eq!(keys, expected);
        assert_eq!(keys.len(), 27);
    }
}
