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
        keepalive_preset: data.keepalive_preset,
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

/// Single source of truth for the CRDT-clock-tracked fields of `Connection`.
///
/// One invocation generates both [`CLOCK_FIELDS`] (used to seed clocks when a
/// connection is created) and [`bump_changed_clocks`] (used to stamp clocks for
/// fields that changed on update). Adding a synced field means editing exactly
/// this one list — plus the compiler-enforced struct literal in
/// `merge_form_into_connection`; init and bump can no longer silently diverge.
///
/// `simple` fields are compared by value equality. `by_id` collections are
/// compared by the set/order of their element ids only: content edits within
/// the same ids sync via each element's own mechanism, not the parent clock.
/// `pinned` is intentionally absent — it is device-local and never synced.
macro_rules! connection_clocks {
    (
        simple: [$($simple:ident),* $(,)?],
        by_id: [$($coll:ident),* $(,)?],
    ) => {
        /// Every clock-tracked field name, in declaration order.
        const CLOCK_FIELDS: &[&str] = &[
            $(stringify!($simple),)*
            $(stringify!($coll),)*
        ];

        /// Stamps a CRDT clock for every field that changed between `old` and `new`.
        fn bump_changed_clocks(old: &Connection, new: &mut Connection, now: &str) {
            $(
                if old.$simple != new.$simple {
                    new.clocks
                        .insert(stringify!($simple).to_string(), now.to_string());
                }
            )*
            $(
                let old_ids: Vec<_> = old.$coll.iter().map(|e| e.id.as_str()).collect();
                let new_ids: Vec<_> = new.$coll.iter().map(|e| e.id.as_str()).collect();
                if old_ids != new_ids {
                    new.clocks
                        .insert(stringify!($coll).to_string(), now.to_string());
                }
            )*
        }
    };
}

connection_clocks! {
    simple: [
        name, host, port, username, auth_type, tags, identity_id, key_id,
        folder_id, vault_id, agent_forwarding, pre_command, post_command,
        terminal_encoding, distro, icon, ping_disabled,
        shell_integration_disabled, keepalive_preset, connection_type, serial_port, serial_baud,
        serial_data_bits, serial_parity, serial_stop_bits, serial_flow_control,
    ],
    by_id: [jump_hosts, env_vars],
}

/// Seeds a fresh clock map for a new connection: every [`CLOCK_FIELDS`] entry
/// stamped at `now`. Mirrors the field set that `bump_changed_clocks` tracks.
fn initial_clocks(now: &str) -> HashMap<String, String> {
    CLOCK_FIELDS
        .iter()
        .map(|field| ((*field).to_string(), now.to_string()))
        .collect()
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
    let clocks = initial_clocks(&now);
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
        keepalive_preset: data.keepalive_preset,
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

    *connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connection {} not found", id))? = updated.clone();
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
            shell_integration_disabled: None,
            keepalive_preset: None,
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
            shell_integration_disabled: Some(true),
            keepalive_preset: Some("balanced".into()),
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
    /// changes (28 fields, incl. `agent_forwarding`, `ping_disabled`,
    /// `shell_integration_disabled`, `keepalive_preset`; `pinned` is excluded as device-local).
    /// Since Phase 1, create-time init and update-time bump both derive from the
    /// single `connection_clocks!` list, so this set equals the one seeded by
    /// `initial_clocks` — see `initial_clocks_match_bumpable_field_set`.
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
            "keepalive_preset",
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
        assert_eq!(keys.len(), 28);
    }

    /// Phase 1 reconciliation: the clocks seeded for a brand-new connection
    /// (`initial_clocks` → `CLOCK_FIELDS`) must be exactly the set of fields that
    /// `bump_changed_clocks` can later stamp. Before Phase 1 these diverged
    /// (24 seeded vs 27 bumpable); this test pins that they no longer can.
    #[test]
    fn initial_clocks_match_bumpable_field_set() {
        use std::collections::HashSet;

        let now = "2026-02-02T00:00:00Z";
        let seeded: HashSet<String> = initial_clocks(now).into_keys().collect();

        let old = sample_connection();
        let mut new = merge_form_into_connection(&old, sample_form());
        bump_changed_clocks(&old, &mut new, now);
        let bumpable: HashSet<String> = new.clocks.into_keys().collect();

        assert_eq!(seeded, bumpable);
        assert_eq!(seeded.len(), 28);
    }
}
