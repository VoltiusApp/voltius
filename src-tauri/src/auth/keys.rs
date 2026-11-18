use std::sync::LazyLock;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct KeyLists {
    pub session: Vec<String>,
    pub reset: Vec<String>,
    pub saved_index: String,
    pub saved_entry_prefix: String,
}

static LISTS: LazyLock<KeyLists> = LazyLock::new(|| {
    serde_json::from_str(include_str!("session_keys.json"))
        .expect("auth/session_keys.json is valid")
});

pub fn key_lists() -> &'static KeyLists {
    &LISTS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_lists_match_the_app() {
        let l = key_lists();
        for k in ["account_id", "jwt", "wrapped_user_secrets"] {
            assert!(l.session.iter().any(|s| s == k), "{k}");
        }
        assert!(l.reset.iter().any(|s| s == "lan_sync_farewell"));
        assert_eq!(l.saved_index, "voltius.saved_accounts");
        assert_eq!(l.saved_entry_prefix, "voltius.saved_account.");
    }
}
