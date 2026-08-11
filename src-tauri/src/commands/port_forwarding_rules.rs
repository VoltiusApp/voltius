use crate::commands::crdt::{is_alive, max_clock};
use crate::commands::vault_object::{
    adopt_into, created_at_of, find_mut, finish_update, impl_vault_object, initial_clocks, live,
    merge_fields, requested_vault, retarget_vault, tombstone,
};
use crate::storage::config::{
    load_port_forwarding_rules, save_port_forwarding_rules, PortForwardingRule,
    PortForwardingRuleFormData,
};
use crate::vault_auth::check_vault_write;
use chrono::Utc;
use uuid::Uuid;

impl_vault_object!(PortForwardingRule, "Rule");

/// The fields whose edits are stamped and synced.
const CLOCK_FIELDS: &[&str] = &[
    "name",
    "local_port",
    "remote_port",
    "remote_host",
    "tunnel_type",
    "bind_host",
    "target_host",
    "description",
    "connection_ids",
    "folder_id",
    "vault_id",
];

#[tauri::command]
pub fn pf_rule_list() -> Result<Vec<PortForwardingRule>, String> {
    Ok(live(load_port_forwarding_rules()))
}

fn build_pf_rule(
    id: String,
    data: PortForwardingRuleFormData,
    now: &str,
    created_at: Option<String>,
) -> PortForwardingRule {
    PortForwardingRule {
        id,
        name: data.name,
        local_port: data.local_port,
        remote_port: data.remote_port,
        remote_host: data.remote_host,
        tunnel_type: data.tunnel_type,
        bind_host: data.bind_host,
        target_host: data.target_host,
        description: data.description,
        connection_ids: data.connection_ids,
        folder_id: data.folder_id,
        vault_id: requested_vault(&data.vault_id)[0].clone(),
        created_at: created_at.unwrap_or_else(|| now.to_string()),
        updated_at: now.to_string(),
        deleted_at: None,
        clocks: initial_clocks(CLOCK_FIELDS, now),
    }
}

#[tauri::command]
pub fn pf_rule_create(data: PortForwardingRuleFormData) -> Result<PortForwardingRule, String> {
    let mut rules = load_port_forwarding_rules();
    let now = Utc::now().to_rfc3339();
    check_vault_write(&requested_vault(&data.vault_id))?;
    let rule = build_pf_rule(Uuid::new_v4().to_string(), data, &now, None);
    rules.push(rule.clone());
    save_port_forwarding_rules(&rules)?;
    Ok(rule)
}

/// Inserts a rule under a caller-supplied `id`, replacing any local row with that
/// id. Migration-only: see `connection_adopt`. The id must survive because sync
/// preferences and undo entries key on it.
#[tauri::command]
pub fn pf_rule_adopt(
    id: String,
    data: PortForwardingRuleFormData,
) -> Result<PortForwardingRule, String> {
    let mut rules = load_port_forwarding_rules();
    let now = Utc::now().to_rfc3339();
    check_vault_write(&requested_vault(&data.vault_id))?;
    let created_at = created_at_of(&rules, &id);
    let adopted = build_pf_rule(id, data, &now, created_at);
    adopt_into(&mut rules, adopted.clone());
    save_port_forwarding_rules(&rules)?;
    Ok(adopted)
}

#[tauri::command]
pub fn pf_rule_update(
    id: String,
    data: PortForwardingRuleFormData,
) -> Result<PortForwardingRule, String> {
    let mut rules = load_port_forwarding_rules();
    let rule = find_mut(&mut rules, &id)?;
    let now = Utc::now().to_rfc3339();
    let effective = retarget_vault(rule, &data.vault_id, &now);
    check_vault_write(std::slice::from_ref(&effective))?;

    merge_fields!(
        rule,
        data,
        &now,
        name,
        local_port,
        remote_port,
        remote_host,
        tunnel_type,
        bind_host,
        target_host,
        description,
        connection_ids,
        folder_id,
    );
    rule.vault_id = effective;
    finish_update(rule, &now);
    let updated = rule.clone();
    save_port_forwarding_rules(&rules)?;
    Ok(updated)
}

#[tauri::command]
pub fn pf_rule_delete(id: String) -> Result<(), String> {
    let mut rules = load_port_forwarding_rules();
    let now = Utc::now().to_rfc3339();
    let rule = find_mut(&mut rules, &id)?;
    check_vault_write(std::slice::from_ref(&rule.vault_id))?;
    tombstone(rule, &now);
    save_port_forwarding_rules(&rules)
}

#[tauri::command]
pub fn pf_rule_duplicate(id: String) -> Result<PortForwardingRule, String> {
    let rules = load_port_forwarding_rules();
    let source = rules
        .iter()
        .find(|r| r.id == id && is_alive(&r.deleted_at, &r.updated_at))
        .ok_or_else(|| format!("Rule {} not found", id))?;

    let data = PortForwardingRuleFormData {
        name: format!("{} (copy)", source.name),
        local_port: source.local_port,
        remote_port: source.remote_port,
        remote_host: source.remote_host.clone(),
        tunnel_type: source.tunnel_type,
        bind_host: source.bind_host.clone(),
        target_host: source.target_host.clone(),
        description: source.description.clone(),
        connection_ids: source.connection_ids.clone(),
        folder_id: source.folder_id.clone(),
        vault_id: Some(source.vault_id.clone()),
    };
    pf_rule_create(data)
}

#[tauri::command]
pub fn pf_rule_move_folder(id: String, folder_id: Option<String>) -> Result<(), String> {
    let mut rules = load_port_forwarding_rules();
    let now = Utc::now().to_rfc3339();
    let rule = find_mut(&mut rules, &id)?;
    rule.folder_id = folder_id;
    rule.clocks.insert("folder_id".to_string(), now.clone());
    rule.updated_at = max_clock(&rule.clocks, &now);
    save_port_forwarding_rules(&rules)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::config::TunnelType;

    fn form() -> PortForwardingRuleFormData {
        PortForwardingRuleFormData {
            name: "tunnel".into(),
            local_port: 8080,
            remote_port: 80,
            remote_host: "10.0.0.1".into(),
            tunnel_type: TunnelType::Local,
            bind_host: "127.0.0.1".into(),
            target_host: "127.0.0.1".into(),
            description: Some("d".into()),
            connection_ids: vec!["c-1".into()],
            folder_id: Some("folder-1".into()),
            vault_id: None,
        }
    }

    #[test]
    fn build_stamps_every_synced_field_at_now() {
        let built = build_pf_rule("r-1".into(), form(), "2026-01-01T00:00:00Z", None);
        let mut fields: Vec<&str> = built.clocks.keys().map(String::as_str).collect();
        fields.sort();
        assert_eq!(
            fields,
            [
                "bind_host",
                "connection_ids",
                "description",
                "folder_id",
                "local_port",
                "name",
                "remote_host",
                "remote_port",
                "target_host",
                "tunnel_type",
                "vault_id",
            ]
        );
        assert!(built.clocks.values().all(|v| v == "2026-01-01T00:00:00Z"));
    }

    #[test]
    fn build_defaults_an_absent_vault_to_personal() {
        let built = build_pf_rule("r-1".into(), form(), "2026-01-01T00:00:00Z", None);
        assert_eq!(built.vault_id, "personal");
    }

    #[test]
    fn build_keeps_an_explicit_vault() {
        let mut data = form();
        data.vault_id = Some("team-a".into());
        let built = build_pf_rule("r-1".into(), data, "2026-01-01T00:00:00Z", None);
        assert_eq!(built.vault_id, "team-a");
    }

    #[test]
    fn build_carries_a_supplied_created_at_and_otherwise_uses_now() {
        let carried = build_pf_rule(
            "r-1".into(),
            form(),
            "2026-02-01T00:00:00Z",
            Some("2020-01-01T00:00:00Z".into()),
        );
        assert_eq!(carried.created_at, "2020-01-01T00:00:00Z");
        let fresh = build_pf_rule("r-1".into(), form(), "2026-02-01T00:00:00Z", None);
        assert_eq!(fresh.created_at, "2026-02-01T00:00:00Z");
    }

    #[test]
    fn build_is_never_born_deleted_and_updates_at_now() {
        let built = build_pf_rule("r-1".into(), form(), "2026-01-01T00:00:00Z", None);
        assert_eq!(built.deleted_at, None);
        assert_eq!(built.updated_at, "2026-01-01T00:00:00Z");
    }
}
