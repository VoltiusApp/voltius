/// Vault write-permission enforcement for team vaults.
///
/// Personal vaults (id = "personal" or any id not in the team_vault_roles map) are always
/// writable — they are local and the user owns them unconditionally.
///
/// Team vaults require:
///   1. A non-expired JWT in the keychain (proves recent server connection).
///   2. The cached role for this vault (written by the frontend after loadTeams) must be
///      one of: owner, manager, editor.
///
/// Roles are cached from the last successful server sync. An admin revoking access takes
/// effect the next time the JWT expires and a fresh one cannot be obtained.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring_core::Entry;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const WRITE_ROLES: &[&str] = &["owner", "manager", "editor"];

fn service() -> String {
    match std::env::var("VOLTIUS_KEYCHAIN_NS") {
        Ok(ns) if !ns.is_empty() => format!("voltius-{ns}"),
        _ => "voltius".to_string(),
    }
}

fn keychain_read(key: &str) -> Option<String> {
    Entry::new(&service(), key).ok()?.get_password().ok()
}

fn jwt_is_expired(jwt: &str) -> bool {
    let parts: Vec<&str> = jwt.split('.').collect();
    if parts.len() < 2 {
        return true;
    }
    // Pad the base64 segment to a multiple of 4 before decoding
    let segment = parts[1];
    let padded = match segment.len() % 4 {
        0 => segment.to_string(),
        n => format!("{}{}", segment, "=".repeat(4 - n)),
    };
    let bytes = match URL_SAFE_NO_PAD
        .decode(segment)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(&padded))
    {
        Ok(b) => b,
        Err(_) => return true,
    };
    let json: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return true,
    };
    let exp = match json["exp"].as_i64() {
        Some(e) => e,
        None => return true,
    };
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(_) => return true,
    };
    now >= exp
}

/// Returns `Ok(())` if the current user is allowed to write to all `vault_ids`.
/// Returns `Err(message)` if:
///   - Any vault_id is a team vault AND the JWT is missing or expired, OR
///   - Any vault_id is a team vault AND the user's role is not a write role.
pub fn check_vault_write(vault_ids: &[String]) -> Result<(), String> {
    // Load the cached {teamId -> role} map written by the frontend after loadTeams()
    let roles_json = keychain_read("team_vault_roles").unwrap_or_default();

    // If no team vaults have ever been configured, every vault is personal — allow.
    if roles_json.is_empty() {
        return Ok(());
    }

    let roles: HashMap<String, String> = serde_json::from_str(&roles_json).unwrap_or_default();

    // Which of the requested vault_ids are team vaults?
    let team_ids: Vec<&String> = vault_ids
        .iter()
        .filter(|id| roles.contains_key(*id))
        .collect();

    if team_ids.is_empty() {
        // None of these vaults are team vaults — allow.
        return Ok(());
    }

    // At least one team vault is involved — require a valid JWT.
    let jwt = keychain_read("jwt").unwrap_or_default();
    if jwt.is_empty() || jwt_is_expired(&jwt) {
        return Err("Team vaults require an active server connection. \
             Please sign in to continue."
            .to_string());
    }

    // Check the role for each team vault.
    for vault_id in team_ids {
        let role = roles.get(vault_id).map(String::as_str).unwrap_or("");
        if !WRITE_ROLES.contains(&role) {
            return Err(format!(
                "You don't have write access to this vault (your role: {role}). \
                 Only owners, managers, and editors can make changes."
            ));
        }
    }

    Ok(())
}
