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
use std::collections::{HashMap, HashSet};

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

/// Ids of `root` plus every live descendant, following parent links. Folder
/// nesting is shallow, so repeated sweeps are cheaper than building an index,
/// and a sweep that adds nothing also terminates a parent cycle.
pub fn subtree_ids<T: VaultObject>(
    items: &[T],
    root: &str,
    parent_of: impl Fn(&T) -> Option<&str>,
) -> HashSet<String> {
    let mut ids = HashSet::from([root.to_string()]);
    loop {
        let before = ids.len();
        for item in items {
            if !is_alive(item.deleted_at(), item.updated_at()) {
                continue;
            }
            if parent_of(item).is_some_and(|p| ids.contains(p)) {
                ids.insert(item.id().to_string());
            }
        }
        if ids.len() == before {
            return ids;
        }
    }
}

/// Soft-deletes a row: delete stamp, `__deleted__` clock, refreshed `updated_at`.
pub fn tombstone<T: VaultObject>(item: &mut T, now: &str) {
    item.set_deleted_at(Some(now.to_string()));
    item.clocks_mut()
        .insert("__deleted__".to_string(), now.to_string());
    let stamp = max_clock(item.clocks_mut(), now);
    item.set_updated_at(stamp);
}

/// The distinct vaults of the rows a cascade is about to touch. Every one must
/// be writable before anything is written.
pub fn vaults_of<T: VaultObject>(items: &[T], doomed: impl Fn(&T) -> bool) -> HashSet<String> {
    items
        .iter()
        .filter(|i| doomed(i))
        .map(|i| i.vault_id().to_string())
        .collect()
}

/// Tombstones every row a folder delete sweeps up, returning how many. Callers
/// skip the save when it is zero: each save is a whole-file rewrite.
pub fn cascade_tombstone<T: VaultObject>(
    items: &mut [T],
    doomed: impl Fn(&T) -> bool,
    now: &str,
) -> usize {
    let mut touched = 0;
    for item in items.iter_mut() {
        if doomed(item) {
            tombstone(item, now);
            touched += 1;
        }
    }
    touched
}

/// Refiles the named objects into `folder_id`, after checking every vault they
/// sit in. Stamps `folder_id` and refreshes `updated_at` but deliberately does
/// not revive a tombstoned row, which is why this is not an update.
pub fn refile_into_folder<T: VaultObject>(
    items: &mut [T],
    ids: &[String],
    folder_id: &Option<String>,
    now: &str,
    folder_of: impl Fn(&mut T) -> &mut Option<String>,
) -> Result<(), String> {
    let named = |item: &T| ids.iter().any(|id| id == item.id());
    let vaults: Vec<String> = vaults_of(items, named).into_iter().collect();
    crate::vault_auth::check_vault_write(&vaults)?;
    for item in items.iter_mut() {
        if !ids.iter().any(|id| id == item.id()) {
            continue;
        }
        *folder_of(item) = folder_id.clone();
        item.clocks_mut()
            .insert("folder_id".to_string(), now.to_string());
        let stamp = max_clock(item.clocks_mut(), now);
        item.set_updated_at(stamp);
    }
    Ok(())
}

// ── The four command bodies every module spells identically ──────────────────
//
// `update` is deliberately absent: no two entities merge their fields the same
// way, and `merge_fields!` already carries the mechanical part of it.
//
// Each macro forwards leading attributes so a call site keeps its own doc
// comment, and takes the loader/saver as paths so the entity's storage module
// stays visible at the call site.

/// `Ok(live(load()))` — the whole body of every `*_list`.
macro_rules! vault_list_command {
    ($(#[$meta:meta])* $name:ident, $ty:ty, $load:path) => {
        $(#[$meta])*
        #[tauri::command]
        pub fn $name() -> Result<Vec<$ty>, String> {
            Ok($crate::commands::vault_object::live($load()))
        }
    };
}
pub(crate) use vault_list_command;

/// Create under a fresh id, after authorizing the vault the form asked for.
macro_rules! vault_create_command {
    ($(#[$meta:meta])* $name:ident, $ty:ty, $form:ty, $build:ident, $load:path, $save:path) => {
        $(#[$meta])*
        #[tauri::command]
        pub fn $name(data: $form) -> Result<$ty, String> {
            let mut items = $load();
            let now = chrono::Utc::now().to_rfc3339();
            $crate::vault_auth::check_vault_write(
                &$crate::commands::vault_object::requested_vault(&data.vault_id),
            )?;
            let created = $build(uuid::Uuid::new_v4().to_string(), data, &now, None);
            items.push(created.clone());
            $save(&items)?;
            Ok(created)
        }
    };
}
pub(crate) use vault_create_command;

/// Insert under a caller-supplied id, replacing any local row carrying it and
/// preserving that row's `created_at`. Migration-only: see `connection_adopt`.
macro_rules! vault_adopt_command {
    ($(#[$meta:meta])* $name:ident, $ty:ty, $form:ty, $build:ident, $load:path, $save:path) => {
        $(#[$meta])*
        #[tauri::command]
        pub fn $name(id: String, data: $form) -> Result<$ty, String> {
            let mut items = $load();
            let now = chrono::Utc::now().to_rfc3339();
            $crate::vault_auth::check_vault_write(
                &$crate::commands::vault_object::requested_vault(&data.vault_id),
            )?;
            let created_at = $crate::commands::vault_object::created_at_of(&items, &id);
            let adopted = $build(id, data, &now, created_at);
            $crate::commands::vault_object::adopt_into(&mut items, adopted.clone());
            $save(&items)?;
            Ok(adopted)
        }
    };
}
pub(crate) use vault_adopt_command;

/// Soft-delete one row, after authorizing the vault it actually sits in.
macro_rules! vault_delete_command {
    ($(#[$meta:meta])* $name:ident, $load:path, $save:path) => {
        $(#[$meta])*
        #[tauri::command]
        pub fn $name(id: String) -> Result<(), String> {
            let mut items = $load();
            let now = chrono::Utc::now().to_rfc3339();
            let item = $crate::commands::vault_object::find_mut(&mut items, &id)?;
            $crate::vault_auth::check_vault_write(std::slice::from_ref(&item.vault_id))?;
            $crate::commands::vault_object::tombstone(item, &now);
            $save(&items)
        }
    };
}
pub(crate) use vault_delete_command;

/// The whole command set of an entity that spells all four verbs the standard
/// way. Each verb is optional: an entity whose delete cascades, or whose builder
/// takes more than the four standard arguments, simply omits that key and keeps
/// its own function.
macro_rules! vault_object_commands {
    (
        $ty:ty, $form:ty, $build:ident, $load:path, $save:path,
        $(list = $list:ident,)?
        $(create = $create:ident,)?
        $(adopt = $adopt:ident, adopt_doc = $adopt_doc:literal,)?
        $(delete = $delete:ident,)?
    ) => {
        $($crate::commands::vault_object::vault_list_command!($list, $ty, $load);)?
        $($crate::commands::vault_object::vault_create_command!(
            $create, $ty, $form, $build, $load, $save
        );)?
        $($crate::commands::vault_object::vault_adopt_command!(
            #[doc = $adopt_doc]
            $adopt, $ty, $form, $build, $load, $save
        );)?
        $($crate::commands::vault_object::vault_delete_command!($delete, $load, $save);)?
    };
}
pub(crate) use vault_object_commands;

/// The characterisation tests every `build_*` shares: it stamps exactly the
/// synced fields at `now`, defaults an absent vault to personal, keeps an
/// explicit one, carries a supplied `created_at`, and is never born deleted.
///
/// `form` is the module's own form-data fixture; `extra` gets the built object
/// for whatever else that entity promises.
#[cfg(test)]
macro_rules! vault_build_tests {
    (
        $build:ident, $form:ident, $id:literal, [$($field:literal),* $(,)?]
        $(, extra = |$built:ident| $extra:block)? $(,)?
    ) => {
        const NOW: &str = "2026-01-01T00:00:00Z";

        #[test]
        fn build_stamps_every_synced_field_at_now() {
            let built = $build($id.into(), $form(), NOW, None);
            let mut fields: Vec<&str> = built.clocks.keys().map(String::as_str).collect();
            fields.sort();
            assert_eq!(fields, [$($field),*]);
            assert!(built.clocks.values().all(|v| v == NOW));
        }

        #[test]
        fn build_defaults_an_absent_vault_to_personal() {
            assert_eq!($build($id.into(), $form(), NOW, None).vault_id, "personal");
        }

        #[test]
        fn build_keeps_an_explicit_vault() {
            let mut data = $form();
            data.vault_id = Some("team-a".into());
            assert_eq!($build($id.into(), data, NOW, None).vault_id, "team-a");
        }

        #[test]
        fn build_carries_a_supplied_created_at_and_otherwise_uses_now() {
            let carried = $build(
                $id.into(),
                $form(),
                "2026-02-01T00:00:00Z",
                Some("2020-01-01T00:00:00Z".into()),
            );
            assert_eq!(carried.created_at, "2020-01-01T00:00:00Z");
            let fresh = $build($id.into(), $form(), "2026-02-01T00:00:00Z", None);
            assert_eq!(fresh.created_at, "2026-02-01T00:00:00Z");
        }

        #[test]
        fn build_is_never_born_deleted_and_updates_at_now() {
            let built = $build($id.into(), $form(), NOW, None);
            assert_eq!(built.deleted_at, None);
            assert_eq!(built.updated_at, NOW);
            assert_eq!(built.id, $id);
            $(let $built = built; $extra)?
        }
    };
}
#[cfg(test)]
pub(crate) use vault_build_tests;

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
