use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring_core::Entry;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const WRITE_ROLES: &[&str] = &["owner", "manager", "editor"];
const PERSONAL_VAULT_ID: &str = "personal";

/// Any one of the server's EDIT_* bits (server/src/permissions.rs). This gate is
/// deliberately coarse — it catches a member who can write nothing at all, and
/// leaves per-object-type authorization to the server, which is the only place
/// that knows what kind of object a write touches.
const WRITE_PERMISSIONS: i64 = (1 << 3)   // EDIT_CONNECTIONS
    | (1 << 4)                            // EDIT_IDENTITIES
    | (1 << 5)                            // EDIT_KEYS
    | (1 << 6)                            // EDIT_FOLDERS
    | (1 << 16); // EDIT_SNIPPETS

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

/// A cache written by an older build holds role UUIDs where names are expected.
/// Those entries can't be checked locally, so they are treated as unknown rather
/// than as a role the user doesn't hold.
fn looks_like_uuid(s: &str) -> bool {
    s.len() == 36
        && s.as_bytes().iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

/// One team's cached entry. Current builds write the union of the member's role
/// permission bits; older ones wrote role names (and older still, role UUIDs).
enum VaultRoleEntry {
    Permissions(i64),
    Names(Vec<String>),
    /// Undecidable here — leave it to the server rather than lock the user out.
    Unknown,
}

fn parse_entry(value: &serde_json::Value) -> VaultRoleEntry {
    if let Some(bits) = value.as_i64() {
        return VaultRoleEntry::Permissions(bits);
    }
    let Some(items) = value.as_array() else {
        return VaultRoleEntry::Unknown;
    };
    let names: Vec<String> = items
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    // Pre-name cache holding role UUIDs: no name to match, so undecidable.
    if !names.is_empty() && names.iter().all(|n| looks_like_uuid(n)) {
        return VaultRoleEntry::Unknown;
    }
    if names.len() < items.len() {
        return VaultRoleEntry::Unknown;
    }
    VaultRoleEntry::Names(names)
}

/// The server unions the permissions of every role a member holds, so any one
/// write permission is enough here too.
fn check_roles(
    vault_ids: &[String],
    roles: &HashMap<String, serde_json::Value>,
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
        let Some(value) = roles.get(vault_id) else {
            continue;
        };
        match parse_entry(value) {
            VaultRoleEntry::Unknown => continue,
            VaultRoleEntry::Permissions(bits) => {
                if bits & WRITE_PERMISSIONS == 0 {
                    return Err("You don't have write access to this vault. Ask a vault \
                         manager for a role that can make changes."
                        .to_string());
                }
            }
            VaultRoleEntry::Names(names) => {
                if !names.iter().any(|n| WRITE_ROLES.contains(&n.as_str())) {
                    let held = if names.is_empty() {
                        "none".to_string()
                    } else {
                        names.join(", ")
                    };
                    return Err(format!(
                        "You don't have write access to this vault (your role: {held}). \
                         Only owners, managers, and editors can make changes."
                    ));
                }
            }
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
    let roles: HashMap<String, serde_json::Value> = match serde_json::from_str(&roles_json) {
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

    /// Legacy cache shape: role names.
    fn roles(pairs: &[(&str, &[&str])]) -> HashMap<String, serde_json::Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), serde_json::json!(v)))
            .collect()
    }

    /// Current cache shape: the union of the member's role permission bits.
    fn perms(pairs: &[(&str, i64)]) -> HashMap<String, serde_json::Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), serde_json::json!(v)))
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
        let r = roles(&[("team-a", &["editor"])]);
        assert!(check_roles(&[s("personal"), s("other-id")], &r, false).is_ok());
    }

    #[test]
    fn check_roles_team_vault_requires_valid_jwt() {
        let r = roles(&[("team-a", &["editor"])]);
        let err = check_roles(&[s("team-a")], &r, false).unwrap_err();
        assert!(err.contains("active server connection"));
    }

    #[test]
    fn check_roles_team_vault_editor_with_valid_jwt_ok() {
        let r = roles(&[("team-a", &["editor"])]);
        assert!(check_roles(&[s("team-a")], &r, true).is_ok());
    }

    #[test]
    fn check_roles_team_vault_viewer_rejected() {
        let r = roles(&[("team-a", &["viewer"])]);
        let err = check_roles(&[s("team-a")], &r, true).unwrap_err();
        assert!(err.contains("viewer"));
        assert!(err.contains("write access"));
    }

    #[test]
    fn check_roles_empty_roles_map_ok() {
        let r = roles(&[]);
        assert!(check_roles(&[s("any-id")], &r, false).is_ok());
    }

    #[test]
    fn check_roles_multi_role_grants_when_any_is_a_write_role() {
        let r = roles(&[("team-a", &["connect-only", "editor"])]);
        assert!(check_roles(&[s("team-a")], &r, true).is_ok());
    }

    #[test]
    fn check_roles_multi_role_rejected_when_none_is_a_write_role() {
        let r = roles(&[("team-a", &["viewer", "connect-only"])]);
        let err = check_roles(&[s("team-a")], &r, true).unwrap_err();
        assert!(err.contains("viewer, connect-only"));
        assert!(err.contains("write access"));
    }

    #[test]
    fn check_roles_no_roles_for_a_team_vault_rejected() {
        let r = roles(&[("team-a", &[])]);
        let err = check_roles(&[s("team-a")], &r, true).unwrap_err();
        assert!(err.contains("none"));
    }

    #[test]
    fn check_roles_stale_uuid_cache_is_unknown_not_denied() {
        let r = roles(&[("team-a", &["3f2504e0-4f89-11d3-9a0c-0305e82c3301"])]);
        assert!(check_roles(&[s("team-a")], &r, true).is_ok());
    }

    #[test]
    fn check_roles_mixed_uuid_and_name_still_checks_the_name() {
        let r = roles(&[(
            "team-a",
            &["3f2504e0-4f89-11d3-9a0c-0305e82c3301", "viewer"],
        )]);
        assert!(check_roles(&[s("team-a")], &r, true).is_err());
    }

    // ── permission-bit cache (current shape) ────────────────────────────────

    /// The bug this replaced: a custom role with write permissions was denied
    /// locally because its name was not owner/manager/editor.
    #[test]
    fn check_roles_custom_named_write_role_allowed_by_bits() {
        let r = perms(&[("team-a", 1 << 3)]); // EDIT_CONNECTIONS only
        assert!(check_roles(&[s("team-a")], &r, true).is_ok());
    }

    #[test]
    fn check_roles_bits_without_any_edit_permission_rejected() {
        // connect-only: CONNECT + terminal-session bits, no EDIT_*.
        let r = perms(&[("team-a", 28676)]);
        let err = check_roles(&[s("team-a")], &r, true).unwrap_err();
        assert!(err.contains("write access"));
    }

    #[test]
    fn check_roles_zero_bits_rejected() {
        let r = perms(&[("team-a", 0)]);
        assert!(check_roles(&[s("team-a")], &r, true).is_err());
    }

    #[test]
    fn check_roles_snippet_only_write_allowed() {
        // "member" holds EDIT_SNIPPETS and nothing else editable; the server
        // lets it write snippets, so the coarse local gate must not refuse it.
        let r = perms(&[("team-a", 28679 | (1 << 16))]);
        assert!(check_roles(&[s("team-a")], &r, true).is_ok());
    }

    #[test]
    fn check_roles_bits_still_require_valid_jwt() {
        let r = perms(&[("team-a", 1 << 3)]);
        let err = check_roles(&[s("team-a")], &r, false).unwrap_err();
        assert!(err.contains("active server connection"));
    }

    #[test]
    fn check_roles_unparseable_entry_is_unknown_not_denied() {
        let mut r = HashMap::new();
        r.insert(s("team-a"), serde_json::json!({ "role": "editor" }));
        assert!(check_roles(&[s("team-a")], &r, true).is_ok());
    }

    #[test]
    fn looks_like_uuid_rejects_role_names() {
        assert!(looks_like_uuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301"));
        assert!(!looks_like_uuid("editor"));
        assert!(!looks_like_uuid("connect-only"));
        assert!(!looks_like_uuid("3f2504e04f8911d39a0c0305e82c3301"));
    }
}
