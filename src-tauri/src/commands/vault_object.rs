//! The shape every vault-object command module repeats.
//!
//! Connections, folders, identities, keys, port-forwarding rules, snippets and
//! snippet folders each store a `Vec<T>` in one JSON file and expose the same
//! verbs: list, create, adopt, update, delete. Only the field list differs. The
//! scaffolding around it — the liveness filter, the clock seeding, the vault
//! defaulting, the replace-or-push of an adopt, the not-found error and the
//! tombstone — lives here, once.
//!
//! Per-field clock primitives are in [`crate::commands::crdt`].

use crate::commands::crdt::{is_alive, max_clock};
use std::collections::HashMap;

/// The vault an object belongs to when the caller names none.
pub const PERSONAL: &str = "personal";

/// A stored object carrying a soft-delete tombstone and per-field LWW clocks.
pub trait VaultObject {
    /// Capitalised entity name, used in the "<Label> <id> not found" error.
    const LABEL: &'static str;

    fn id(&self) -> &str;
    fn vault_id(&self) -> &str;
    fn created_at(&self) -> &str;
    fn deleted_at(&self) -> &Option<String>;
    fn updated_at(&self) -> &str;
    fn clocks_mut(&mut self) -> &mut HashMap<String, String>;
    fn set_deleted_at(&mut self, at: Option<String>);
    fn set_updated_at(&mut self, at: String);
}

/// Implements [`VaultObject`] for a struct with the standard field names.
/// Every entity in `storage::config` spells them identically, so the impl is
/// pure boilerplate and belongs in one place.
macro_rules! impl_vault_object {
    ($ty:ty, $label:literal) => {
        impl $crate::commands::vault_object::VaultObject for $ty {
            const LABEL: &'static str = $label;

            fn id(&self) -> &str {
                &self.id
            }
            fn vault_id(&self) -> &str {
                &self.vault_id
            }
            fn created_at(&self) -> &str {
                &self.created_at
            }
            fn deleted_at(&self) -> &Option<String> {
                &self.deleted_at
            }
            fn updated_at(&self) -> &str {
                &self.updated_at
            }
            fn clocks_mut(&mut self) -> &mut std::collections::HashMap<String, String> {
                &mut self.clocks
            }
            fn set_deleted_at(&mut self, at: Option<String>) {
                self.deleted_at = at;
            }
            fn set_updated_at(&mut self, at: String) {
                self.updated_at = at;
            }
        }
    };
}
pub(crate) use impl_vault_object;

/// The live rows of a freshly loaded collection — the body of every `*_list`.
pub fn live<T: VaultObject>(items: Vec<T>) -> Vec<T> {
    items
        .into_iter()
        .filter(|i| is_alive(i.deleted_at(), i.updated_at()))
        .collect()
}

/// Seeds a clock map with every synced field stamped at `now`.
pub fn initial_clocks(fields: &[&str], now: &str) -> HashMap<String, String> {
    fields
        .iter()
        .map(|f| ((*f).to_string(), now.to_string()))
        .collect()
}

/// The vault a create or adopt writes into: what the form asked for, else
/// personal. Returned as an array so it can be passed straight to
/// `check_vault_write`.
pub fn requested_vault(vault_id: &Option<String>) -> [String; 1] {
    [vault_id.clone().unwrap_or_else(|| PERSONAL.to_string())]
}

/// The vault an update lands in. An omitted `vault_id` means "leave it where it
/// is" — rename and reparent payloads routinely omit it, and defaulting to
/// personal would silently teleport an object held in another vault.
pub fn effective_vault(requested: &Option<String>, current: &str) -> String {
    requested.as_deref().unwrap_or(current).to_string()
}

/// `created_at` of the row already stored under `id`, so an adopt preserves the
/// original creation time instead of restamping it.
pub fn created_at_of<T: VaultObject>(items: &[T], id: &str) -> Option<String> {
    items
        .iter()
        .find(|i| i.id() == id)
        .map(|i| i.created_at().to_string())
}

/// Replaces the row carrying `adopted`'s id, or appends it. Replacing rather
/// than rejecting keeps a retry after a half-done migration idempotent.
pub fn adopt_into<T: VaultObject>(items: &mut Vec<T>, adopted: T) {
    match items.iter_mut().find(|i| i.id() == adopted.id()) {
        Some(slot) => *slot = adopted,
        None => items.push(adopted),
    }
}

/// The mutable row under `id`, or the entity's not-found error.
pub fn find_mut<'a, T: VaultObject>(items: &'a mut [T], id: &str) -> Result<&'a mut T, String> {
    items
        .iter_mut()
        .find(|i| i.id() == id)
        .ok_or_else(|| format!("{} {} not found", T::LABEL, id))
}

/// Stamps `field` at `now` when the value changed. The caller evaluates the
/// comparison so this borrows only the clock map, leaving the field reads free.
pub fn bump(clocks: &mut HashMap<String, String>, field: &str, changed: bool, now: &str) {
    if changed {
        clocks.insert(field.to_string(), now.to_string());
    }
}

/// The vault this update lands in, stamping `vault_id` when the form moves the
/// object. An omitted `vault_id` leaves it where it is, so nothing is stamped.
pub fn retarget_vault<T: VaultObject>(
    item: &mut T,
    requested: &Option<String>,
    now: &str,
) -> String {
    let effective = effective_vault(requested, item.vault_id());
    let moved = requested.is_some() && item.vault_id() != effective;
    bump(item.clocks_mut(), "vault_id", moved, now);
    effective
}

/// For each named field: stamp its clock if the form changed it, then take the
/// form's value. Every entity spells the field and its clock key the same, so
/// the list is the only per-entity part of an update.
///
/// Fields needing more than an equality test (`vault_id`, snippet `steps`) stay
/// spelled out at the call site.
macro_rules! merge_fields {
    ($obj:expr, $data:expr, $now:expr, $($field:ident),+ $(,)?) => {
        $(
            $crate::commands::vault_object::bump(
                &mut $obj.clocks,
                stringify!($field),
                $obj.$field != $data.$field,
                $now,
            );
            $obj.$field = $data.$field;
        )+
    };
}
pub(crate) use merge_fields;

/// Closes an update: an edit revives a tombstoned row, and `updated_at` follows
/// the newest clock rather than the wall time, so a no-op save does not bump it.
pub fn finish_update<T: VaultObject>(item: &mut T, now: &str) {
    item.set_deleted_at(None);
    let stamp = max_clock(item.clocks_mut(), now);
    item.set_updated_at(stamp);
}

/// Soft-deletes a row: delete stamp, `__deleted__` clock, refreshed `updated_at`.
pub fn tombstone<T: VaultObject>(item: &mut T, now: &str) {
    item.set_deleted_at(Some(now.to_string()));
    item.clocks_mut()
        .insert("__deleted__".to_string(), now.to_string());
    let stamp = max_clock(item.clocks_mut(), now);
    item.set_updated_at(stamp);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, PartialEq)]
    struct Thing {
        id: String,
        vault_id: String,
        created_at: String,
        updated_at: String,
        deleted_at: Option<String>,
        clocks: HashMap<String, String>,
    }
    impl_vault_object!(Thing, "Thing");

    fn thing(id: &str) -> Thing {
        Thing {
            id: id.to_string(),
            vault_id: PERSONAL.to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            deleted_at: None,
            clocks: HashMap::new(),
        }
    }

    #[test]
    fn live_drops_rows_whose_delete_stamp_is_not_older_than_their_update() {
        let mut deleted = thing("b");
        deleted.deleted_at = Some("2026-02-01T00:00:00Z".into());
        let mut revived = thing("c");
        revived.deleted_at = Some("2026-01-01T00:00:00Z".into());
        revived.updated_at = "2026-03-01T00:00:00Z".into();

        let ids: Vec<String> = live(vec![thing("a"), deleted, revived])
            .iter()
            .map(|t| t.id.clone())
            .collect();
        assert_eq!(ids, ["a", "c"]);
    }

    #[test]
    fn initial_clocks_stamps_each_field_once_at_now() {
        let clocks = initial_clocks(&["name", "tags"], "2026-01-01T00:00:00Z");
        assert_eq!(clocks.len(), 2);
        assert!(clocks.values().all(|v| v == "2026-01-01T00:00:00Z"));
    }

    #[test]
    fn requested_vault_defaults_to_personal_but_keeps_an_explicit_one() {
        assert_eq!(requested_vault(&None), ["personal".to_string()]);
        assert_eq!(
            requested_vault(&Some("team-a".into())),
            ["team-a".to_string()]
        );
    }

    #[test]
    fn effective_vault_leaves_an_object_where_it_is_when_none_is_requested() {
        assert_eq!(effective_vault(&None, "team-a"), "team-a");
        assert_eq!(
            effective_vault(&Some("personal".into()), "team-a"),
            "personal"
        );
    }

    #[test]
    fn created_at_of_finds_the_existing_row_and_is_none_for_a_new_id() {
        let items = vec![thing("a")];
        assert_eq!(
            created_at_of(&items, "a"),
            Some("2026-01-01T00:00:00Z".to_string())
        );
        assert_eq!(created_at_of(&items, "zz"), None);
    }

    #[test]
    fn adopt_into_replaces_a_matching_row_rather_than_duplicating_it() {
        let mut items = vec![thing("a"), thing("b")];
        let mut adopted = thing("a");
        adopted.vault_id = "team-a".into();
        adopt_into(&mut items, adopted);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].vault_id, "team-a");
    }

    #[test]
    fn adopt_into_appends_an_unknown_id() {
        let mut items = vec![thing("a")];
        adopt_into(&mut items, thing("b"));
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].id, "b");
    }

    #[test]
    fn find_mut_reports_the_entity_label_in_its_error() {
        let mut items = vec![thing("a")];
        assert!(find_mut(&mut items, "a").is_ok());
        assert_eq!(
            find_mut(&mut items, "zz").unwrap_err(),
            "Thing zz not found"
        );
    }

    #[test]
    fn bump_stamps_only_when_the_value_changed() {
        let mut clocks = HashMap::new();
        bump(&mut clocks, "name", false, "2026-01-01T00:00:00Z");
        assert!(clocks.is_empty());
        bump(&mut clocks, "name", true, "2026-01-01T00:00:00Z");
        assert_eq!(clocks.get("name").unwrap(), "2026-01-01T00:00:00Z");
    }

    #[test]
    fn finish_update_revives_a_tombstoned_row_and_follows_the_newest_clock() {
        let mut item = thing("a");
        item.deleted_at = Some("2026-02-01T00:00:00Z".into());
        item.clocks
            .insert("name".into(), "2026-05-01T00:00:00Z".into());
        finish_update(&mut item, "2026-03-01T00:00:00Z");
        assert_eq!(item.deleted_at, None);
        assert_eq!(item.updated_at, "2026-05-01T00:00:00Z");
    }

    #[test]
    fn finish_update_falls_back_to_now_when_nothing_was_stamped() {
        let mut item = thing("a");
        finish_update(&mut item, "2026-03-01T00:00:00Z");
        assert_eq!(item.updated_at, "2026-03-01T00:00:00Z");
    }

    #[test]
    fn tombstone_stamps_the_delete_clock_and_wins_over_older_field_clocks() {
        let mut item = thing("a");
        item.clocks
            .insert("name".into(), "2026-01-01T00:00:00Z".into());
        tombstone(&mut item, "2026-03-01T00:00:00Z");
        assert_eq!(item.deleted_at, Some("2026-03-01T00:00:00Z".into()));
        assert_eq!(
            item.clocks.get("__deleted__").unwrap(),
            "2026-03-01T00:00:00Z"
        );
        assert_eq!(item.updated_at, "2026-03-01T00:00:00Z");
        assert!(!is_alive(&item.deleted_at, &item.updated_at));
    }

    #[test]
    fn a_tombstoned_row_stays_dead_even_with_a_newer_field_clock() {
        // A later field clock pushes updated_at past the delete stamp, which
        // `is_alive` reads as a revival. Pinned so a future edit to `tombstone`
        // cannot resurrect rows by accident.
        let mut item = thing("a");
        item.clocks
            .insert("name".into(), "2026-09-01T00:00:00Z".into());
        tombstone(&mut item, "2026-03-01T00:00:00Z");
        assert_eq!(item.updated_at, "2026-09-01T00:00:00Z");
        assert!(is_alive(&item.deleted_at, &item.updated_at));
    }
}
