//! Per-field clock helpers shared by every tombstoning entity command module
//! (connections, folders, identities, keys, port forwarding rules, snippets).

use std::collections::HashMap;

/// An entity is alive unless it carries a delete stamp no older than its last update.
pub fn is_alive(deleted_at: &Option<String>, updated_at: &str) -> bool {
    match deleted_at {
        None => true,
        Some(d) => updated_at > d.as_str(),
    }
}

/// Returns the max value among all clocks, falling back to `fallback` if empty.
pub fn max_clock(clocks: &HashMap<String, String>, fallback: &str) -> String {
    clocks
        .values()
        .max()
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
