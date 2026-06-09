use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring_core::Entry;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const WRITE_ROLES: &[&str] = &["owner", "manager", "editor"];
const PERSONAL_VAULT_ID: &str = "personal";

fn service() -> String {
    match std::env::var("VOLTIUS_KEYCHAIN_NS") {
        Ok(ns) if !ns.is_empty() => format!("voltius-{ns}"),
        _ => "voltius".to_string(),
    }
}

fn keychain_read(key: &str) -> Option<String> {
    Entry::new(&service(), key).ok()?.get_password().ok()
}

/// Tri-state keychain read so callers can fail closed.
/// `Ok(None)` = no such entry, `Ok(Some)` = the value, `Err(())` = the store failed.
fn keychain_try_read(key: &str) -> Result<Option<String>, ()> {
    let entry = Entry::new(&service(), key).map_err(|_| ())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(_) => Err(()),
    }
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

// safe to skip the roles check: "personal" is reserved, no team vault can hold this id;
// an empty slice must NOT count as personal (fail closed)
fn all_personal(vault_ids: &[String]) -> bool {
    !vault_ids.is_empty() && vault_ids.iter().all(|id| id == PERSONAL_VAULT_ID)
}

fn check_roles(
    vault_ids: &[String],
    roles: &HashMap<String, String>,
    jwt_valid: bool,
) -> Result<(), String> {
    let team_ids: Vec<&String> = vault_ids
        .iter()
        .filter(|id| roles.contains_key(*id))
        .collect();

    if team_ids.is_empty() {
        return Ok(());
    }

    if !jwt_valid {
        return Err("Team vaults require an active server connection. \
             Please sign in to continue."
            .to_string());
    }

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

/// Returns `Ok(())` if the current user is allowed to write to all `vault_ids`.
/// Returns `Err(message)` if:
///   - Any vault_id is a team vault AND the JWT is missing or expired, OR
///   - Any vault_id is a team vault AND the user's role is not a write role.
pub fn check_vault_write(vault_ids: &[String]) -> Result<(), String> {
    if all_personal(vault_ids) {
        return Ok(());
    }

    // Load the cached {teamId -> role} map written by the frontend after loadTeams().
    // A keychain failure must fail closed: we can't prove a vault is personal if we
    // can't read the roles map. Only a genuinely-absent entry means "all personal".
    let roles_json = match keychain_try_read("team_vault_roles") {
        Ok(Some(s)) => s,
        Ok(None) => return Ok(()),
        Err(()) => {
            return Err(
                "Unable to verify vault permissions (keychain unavailable). \
                 Please try again."
                    .to_string(),
            )
        }
    };

    if roles_json.is_empty() {
        return Ok(());
    }

    // A corrupted roles cache must fail closed rather than be read as an empty map.
    let roles: HashMap<String, String> = match serde_json::from_str(&roles_json) {
        Ok(m) => m,
        Err(_) => {
            return Err("Vault permission data is corrupted. \
                 Please sign in again to refresh access."
                .to_string())
        }
    };

    let jwt = keychain_read("jwt").unwrap_or_default();
    let jwt_valid = !jwt.is_empty() && !jwt_is_expired(&jwt);
    check_roles(vault_ids, &roles, jwt_valid)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &str) -> String {
        v.to_string()
    }

    fn roles(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn all_personal_true_for_single_personal() {
        assert!(all_personal(&[s("personal")]));
    }

    #[test]
    fn all_personal_true_for_multiple_personal() {
        assert!(all_personal(&[s("personal"), s("personal")]));
    }

    #[test]
    fn all_personal_false_for_empty_slice() {
        assert!(!all_personal(&[]));
    }

    #[test]
    fn all_personal_false_when_any_non_personal() {
        assert!(!all_personal(&[s("personal"), s("team-uuid-abc")]));
    }

    #[test]
    fn all_personal_false_for_unknown_id() {
        assert!(!all_personal(&[s("some-uuid")]));
    }

    #[test]
    fn check_roles_no_team_vaults_always_ok() {
        let r = roles(&[("team-a", "editor")]);
        assert!(check_roles(&[s("personal"), s("other-id")], &r, false).is_ok());
    }

    #[test]
    fn check_roles_team_vault_requires_valid_jwt() {
        let r = roles(&[("team-a", "editor")]);
        let err = check_roles(&[s("team-a")], &r, false).unwrap_err();
        assert!(err.contains("active server connection"));
    }

    #[test]
    fn check_roles_team_vault_editor_with_valid_jwt_ok() {
        let r = roles(&[("team-a", "editor")]);
        assert!(check_roles(&[s("team-a")], &r, true).is_ok());
    }

    #[test]
    fn check_roles_team_vault_viewer_rejected() {
        let r = roles(&[("team-a", "viewer")]);
        let err = check_roles(&[s("team-a")], &r, true).unwrap_err();
        assert!(err.contains("viewer"));
        assert!(err.contains("write access"));
    }

    #[test]
    fn check_roles_empty_roles_map_ok() {
        let r = roles(&[]);
        assert!(check_roles(&[s("any-id")], &r, false).is_ok());
    }
}
