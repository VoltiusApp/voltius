use crate::storage::config::{
    load_port_forwarding_rules, save_port_forwarding_rules, PortForwardingRule,
    PortForwardingRuleFormData,
};
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

fn max_clock(clocks: &HashMap<String, String>, fallback: &str) -> String {
    clocks
        .values()
        .max()
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

#[tauri::command]
pub fn pf_rule_list() -> Result<Vec<PortForwardingRule>, String> {
    Ok(load_port_forwarding_rules()
        .into_iter()
        .filter(|r| is_alive(&r.deleted_at, &r.updated_at))
        .collect())
}

#[tauri::command]
pub fn pf_rule_create(data: PortForwardingRuleFormData) -> Result<PortForwardingRule, String> {
    let mut rules = load_port_forwarding_rules();
    let now = Utc::now().to_rfc3339();
    let mut clocks = HashMap::new();
    clocks.insert("name".to_string(), now.clone());
    clocks.insert("local_port".to_string(), now.clone());
    clocks.insert("remote_port".to_string(), now.clone());
    clocks.insert("remote_host".to_string(), now.clone());
    clocks.insert("tunnel_type".to_string(), now.clone());
    clocks.insert("bind_host".to_string(), now.clone());
    clocks.insert("target_host".to_string(), now.clone());
    clocks.insert("description".to_string(), now.clone());
    clocks.insert("connection_ids".to_string(), now.clone());
    clocks.insert("folder_id".to_string(), now.clone());
    clocks.insert("vault_id".to_string(), now.clone());
    let vault_id = data.vault_id.unwrap_or_else(|| "personal".to_string());
    check_vault_write(&[vault_id.clone()])?;
    let rule = PortForwardingRule {
        id: Uuid::new_v4().to_string(),
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
        vault_id,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
        clocks,
    };
    rules.push(rule.clone());
    save_port_forwarding_rules(&rules)?;
    Ok(rule)
}

#[tauri::command]
pub fn pf_rule_update(
    id: String,
    data: PortForwardingRuleFormData,
) -> Result<PortForwardingRule, String> {
    let mut rules = load_port_forwarding_rules();
    let rule = rules
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("Rule {} not found", id))?;

    let now = Utc::now().to_rfc3339();
    if rule.name != data.name {
        rule.clocks.insert("name".to_string(), now.clone());
    }
    if rule.local_port != data.local_port {
        rule.clocks.insert("local_port".to_string(), now.clone());
    }
    if rule.remote_port != data.remote_port {
        rule.clocks.insert("remote_port".to_string(), now.clone());
    }
    if rule.remote_host != data.remote_host {
        rule.clocks.insert("remote_host".to_string(), now.clone());
    }
    if rule.tunnel_type != data.tunnel_type {
        rule.clocks.insert("tunnel_type".to_string(), now.clone());
    }
    if rule.bind_host != data.bind_host {
        rule.clocks.insert("bind_host".to_string(), now.clone());
    }
    if rule.target_host != data.target_host {
        rule.clocks.insert("target_host".to_string(), now.clone());
    }
    if rule.description != data.description {
        rule.clocks.insert("description".to_string(), now.clone());
    }
    if rule.connection_ids != data.connection_ids {
        rule.clocks
            .insert("connection_ids".to_string(), now.clone());
    }
    if rule.folder_id != data.folder_id {
        rule.clocks.insert("folder_id".to_string(), now.clone());
    }

    let effective_vault = data
        .vault_id
        .as_deref()
        .unwrap_or(&rule.vault_id)
        .to_string();
    if let Some(ref vid) = data.vault_id {
        if rule.vault_id != *vid {
            rule.clocks.insert("vault_id".to_string(), now.clone());
        }
    }
    check_vault_write(&[effective_vault])?;

    rule.name = data.name;
    rule.local_port = data.local_port;
    rule.remote_port = data.remote_port;
    rule.remote_host = data.remote_host;
    rule.tunnel_type = data.tunnel_type;
    rule.bind_host = data.bind_host;
    rule.target_host = data.target_host;
    rule.description = data.description;
    rule.connection_ids = data.connection_ids;
    rule.folder_id = data.folder_id;
    if let Some(vid) = data.vault_id {
        rule.vault_id = vid;
    }
    rule.deleted_at = None;
    rule.updated_at = max_clock(&rule.clocks, &now);

    let updated = rule.clone();
    save_port_forwarding_rules(&rules)?;
    Ok(updated)
}

#[tauri::command]
pub fn pf_rule_delete(id: String) -> Result<(), String> {
    let mut rules = load_port_forwarding_rules();
    let now = Utc::now().to_rfc3339();
    let rule = rules
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("Rule {} not found", id))?;
    check_vault_write(&[rule.vault_id.clone()])?;
    rule.deleted_at = Some(now.clone());
    rule.clocks.insert("__deleted__".to_string(), now.clone());
    rule.updated_at = max_clock(&rule.clocks, &now);
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
    let rule = rules
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("Rule {} not found", id))?;
    rule.folder_id = folder_id;
    rule.clocks.insert("folder_id".to_string(), now.clone());
    rule.updated_at = max_clock(&rule.clocks, &now);
    save_port_forwarding_rules(&rules)
}
