use super::output::Output;
use super::policy_cmd::{
    edit_raw, effective_row, layer_entries, layer_of, locked_message, machine_doc, machine_path,
    plain, unknown_message, unusable, Raw,
};
use super::user::{confirm, require_user_account};
use super::{queue, CliError, Ctx};
use crate::cli_state::mirror;
use crate::cli_state::pending::{self, Change, PluginAction};
use crate::policy::{self, IssueKind, Layer, PolicyDoc};
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

const CATALOGUE_URL: &str =
    "https://raw.githubusercontent.com/voltiusApp/marketplace/main/plugins.json";
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
const INSTALL: &str = "plugins.install";
const ENABLED: &str = "plugins.enabled";
const DISABLED: &str = "plugins.disabled";
const INSTALL_REVIEW: &str = "appSettings.toggles.plugin-install-review";

#[derive(Subcommand, Debug)]
pub enum PluginsCmd {
    /// List plugins with their state, organization policy and pending changes
    List {
        /// List the plugin catalogue instead
        #[arg(long)]
        catalog: bool,
    },
    /// Install a plugin from the catalogue
    Install(Target),
    /// Enable a plugin
    Enable(Target),
    /// Disable a plugin
    Disable(Target),
    /// Remove a plugin
    Remove(Target),
}

#[derive(Args, Debug)]
pub struct Target {
    /// Plugin id, e.g. plugin-docker
    id: String,
    /// Apply to every user and lock it (needs admin)
    #[arg(long, conflicts_with = "defaults")]
    lock: bool,
    /// Apply to every user as a default they may change (needs admin)
    #[arg(long)]
    defaults: bool,
}

impl PluginsCmd {
    fn change(&self) -> Option<(PluginAction, &Target)> {
        match self {
            PluginsCmd::List { .. } => None,
            PluginsCmd::Install(t) => Some((PluginAction::Install, t)),
            PluginsCmd::Enable(t) => Some((PluginAction::Enable, t)),
            PluginsCmd::Disable(t) => Some((PluginAction::Disable, t)),
            PluginsCmd::Remove(t) => Some((PluginAction::Remove, t)),
        }
    }
}

pub(super) struct Catalogue<'a> {
    pub seeded: Vec<&'a str>,
    pub fetch: &'a dyn Fn() -> Result<String, String>,
}

#[derive(Deserialize)]
struct Listing {
    id: String,
    #[serde(default)]
    name: String,
    permissions: Option<Vec<String>>,
}

enum Listed {
    Checked(Option<Vec<String>>),
    Unreachable,
}

impl Catalogue<'_> {
    fn seeded(&self, id: &str) -> Option<Listing> {
        self.seeded
            .iter()
            .filter_map(|text| serde_json::from_str::<Listing>(text).ok())
            .find(|l| l.id == id)
    }

    fn remote(&self) -> Result<Vec<Listing>, String> {
        let root: Value = serde_json::from_str(&(self.fetch)()?).map_err(|e| e.to_string())?;
        let list = match root {
            Value::Array(list) => list,
            Value::Object(mut o) => match o.remove("plugins") {
                Some(Value::Array(list)) => list,
                _ => Vec::new(),
            },
            _ => return Err("unexpected catalogue format".into()),
        };
        Ok(list
            .into_iter()
            .filter_map(|p| serde_json::from_value(p).ok())
            .collect())
    }
}

fn fetch_catalogue() -> Result<String, String> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    rt.block_on(async {
        tokio::time::timeout(
            FETCH_TIMEOUT,
            crate::commands::plugins::fetch_text(CATALOGUE_URL),
        )
        .await
        .map_err(|_| "timed out".to_string())?
    })
}

pub fn run(cmd: PluginsCmd, ctx: &mut Ctx) -> Result<(), CliError> {
    let dir = match cmd.change() {
        Some((action, t)) if !t.lock && !t.defaults => {
            require_user_account(&format!("plugins {}", action.name()))?
        }
        _ => crate::storage::config::config_dir_peek(),
    };
    let catalogue = Catalogue {
        seeded: crate::commands::plugins::seeded_manifests().collect(),
        fetch: &fetch_catalogue,
    };
    run_plugins(
        cmd,
        policy::machine_policy_path().as_deref(),
        &dir,
        &catalogue,
        ctx,
    )
}

pub(super) fn run_plugins(
    cmd: PluginsCmd,
    machine: Option<&Path>,
    user_dir: &Path,
    catalogue: &Catalogue,
    ctx: &mut Ctx,
) -> Result<(), CliError> {
    let Some((action, t)) = cmd.change() else {
        return match cmd {
            PluginsCmd::List { catalog: true } => list_catalogue(catalogue, ctx.out),
            _ => list(machine, user_dir, ctx.out),
        };
    };
    crate::commands::plugins::validate_id(&t.id)
        .map_err(|_| plain(IssueKind::Type, format!("invalid plugin id \"{}\"", t.id)))?;
    if action == PluginAction::Install && policy::is_retired_plugin(&t.id) {
        return Err(plain(
            IssueKind::Type,
            format!("{} is retired and can no longer be installed", t.id),
        ));
    }
    let by_admin = t.lock || t.defaults;
    let doc = machine_doc(machine);
    if !by_admin {
        if let Some(why) = user_refusal(action, &t.id, &doc, user_dir) {
            return Err(plain(IssueKind::Type, why));
        }
    }
    let listed = match action {
        PluginAction::Install => Some(check_listed(&t.id, catalogue)?),
        _ => None,
    };
    if by_admin {
        if let Some(Listed::Unreachable) = listed {
            ctx.out.warn(
                "could not reach the plugin catalogue; added to policy without checking the id",
            );
        }
        let layer = layer_of(t.defaults);
        return save_to_layer(action, &t.id, layer, machine_path(machine)?, ctx.out);
    }
    let consented_permissions = match listed {
        None => Vec::new(),
        Some(Listed::Checked(Some(permissions))) => {
            let review_all = reviews_every_install(&doc, user_dir);
            consent(&t.id, permissions, review_all, ctx)?
        }
        Some(_) => {
            return Err(CliError::Io(std::io::Error::other(
                "could not reach the plugin catalogue to show this plugin's permissions; try again when online",
            )))
        }
    };
    let change = Change::Plugin {
        action,
        id: t.id.clone(),
        consented_permissions,
    };
    queue(user_dir, change, ctx.out)
}

fn reviews_every_install(doc: &PolicyDoc, dir: &Path) -> bool {
    effective_row(doc, dir, INSTALL_REVIEW)
        .and_then(|r| r.value.as_bool())
        .unwrap_or(true)
}

fn listed_ids<'a>(layer: &'a BTreeMap<String, Value>, key: &str) -> impl Iterator<Item = &'a str> {
    layer
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

fn listed(layer: &BTreeMap<String, Value>, key: &str, id: &str) -> bool {
    listed_ids(layer, key).any(|v| v == id)
}

fn installed_per_mirror(dir: &Path, id: &str) -> bool {
    mirror::read(dir).is_some_and(|m| m.plugins.iter().any(|p| p.id == id))
}

fn user_refusal(action: PluginAction, id: &str, doc: &PolicyDoc, dir: &Path) -> Option<String> {
    let locked = |keys: &[&str]| keys.iter().any(|k| listed(&doc.policy, k, id));
    let refused = match action {
        PluginAction::Install => {
            let turned_off = doc.policy.get("plugins.allowInstall") == Some(&Value::Bool(false));
            if turned_off
                && !locked(&[INSTALL])
                && !listed(&doc.defaults, INSTALL, id)
                && !installed_per_mirror(dir, id)
            {
                return Some(
                    "installing plugins is turned off by your organization's policy".into(),
                );
            }
            false
        }
        PluginAction::Remove => locked(&[INSTALL, ENABLED]),
        PluginAction::Enable | PluginAction::Disable => locked(&[ENABLED, DISABLED]),
    };
    refused.then(|| locked_message(id))
}

fn check_listed(id: &str, catalogue: &Catalogue) -> Result<Listed, CliError> {
    if let Some(l) = catalogue.seeded(id) {
        return Ok(Listed::Checked(Some(l.permissions.unwrap_or_default())));
    }
    let mut list = match catalogue.remote() {
        Ok(list) => list,
        Err(e) => {
            log::warn!("plugin catalogue unavailable: {e}");
            return Ok(Listed::Unreachable);
        }
    };
    match list.iter().position(|l| l.id == id) {
        Some(i) => Ok(Listed::Checked(list.swap_remove(i).permissions)),
        None => Err(plain(
            IssueKind::UnknownKey,
            unknown_message("plugin", id, list.iter().map(|l| l.id.as_str())),
        )),
    }
}

fn consent(
    id: &str,
    permissions: Vec<String>,
    review_all: bool,
    ctx: &mut Ctx,
) -> Result<Vec<String>, CliError> {
    let shown: Vec<String> = permissions
        .into_iter()
        .filter(|p| review_all || policy::is_gated_permission(p))
        .collect();
    if shown.is_empty() && !review_all {
        return Ok(shown);
    }
    if shown.is_empty() {
        ctx.out.notice(format!("{id} asks for no permissions."));
    } else {
        ctx.out.notice(format!("{id} asks for these permissions:"));
        for p in &shown {
            ctx.out.notice(format!("  {p}"));
        }
    }
    if !confirm(ctx, "Install it?")? {
        return Err(CliError::Usage("not confirmed; nothing was queued".into()));
    }
    Ok(shown)
}

fn list_edits(action: PluginAction) -> (Option<&'static str>, &'static [&'static str]) {
    match action {
        PluginAction::Install => (Some(INSTALL), &[]),
        PluginAction::Enable => (Some(ENABLED), &[DISABLED]),
        PluginAction::Disable => (Some(DISABLED), &[ENABLED]),
        PluginAction::Remove => (None, &[INSTALL, ENABLED, DISABLED]),
    }
}

fn set_listed(entries: &mut Raw, key: &str, id: &str, on: bool) -> Option<bool> {
    if !on && !entries.contains_key(key) {
        return Some(false);
    }
    let list = entries
        .entry(key.to_string())
        .or_insert_with(|| json!([]))
        .as_array_mut()?;
    let had = list.iter().any(|v| v.as_str() == Some(id));
    if on && !had {
        list.push(Value::from(id));
    }
    if !on {
        list.retain(|v| v.as_str() != Some(id));
        if list.is_empty() {
            entries.remove(key);
        }
    }
    Some(had != on)
}

fn save_to_layer(
    action: PluginAction,
    id: &str,
    layer: Layer,
    path: &Path,
    out: &mut Output,
) -> Result<(), CliError> {
    let (add, remove) = list_edits(action);
    let edits = remove
        .iter()
        .map(|k| (*k, false))
        .chain(add.map(|k| (k, true)));
    let changed = edit_raw(path, out, |root| {
        let entries = layer_entries(root, layer, path)?;
        let mut changed = false;
        for (key, on) in edits {
            changed |= set_listed(entries, key, id, on).ok_or_else(|| {
                unusable(path, &format!("has a non-list \"{}.{key}\"", layer.name()))
            })?;
        }
        Ok(changed)
    })?;
    let what = format!("{} {id}", action.name());
    if changed {
        out.line(format!("Saved: {what} in {}", layer.name()));
    } else {
        out.line(format!("Unchanged: {what} is already in {}", layer.name()));
    }
    Ok(())
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Row {
    id: String,
    version: Option<String>,
    enabled: Option<bool>,
    locked: bool,
    installed_by_organization: bool,
    pending: Option<&'static str>,
    pending_error: Option<String>,
}

impl Row {
    fn cells(&self) -> Vec<String> {
        let dash = |v: Option<String>| v.unwrap_or_else(|| "-".into());
        let policy: Vec<&str> = [
            (self.locked, "locked"),
            (self.installed_by_organization, "installed by organization"),
        ]
        .into_iter()
        .filter_map(|(on, label)| on.then_some(label))
        .collect();
        let pending = self.pending.map(|a| match &self.pending_error {
            Some(e) => format!("{a} (failed: {e})"),
            None => a.to_string(),
        });
        vec![
            self.id.clone(),
            dash(self.version.clone()),
            dash(self.enabled.map(|e| if e { "yes" } else { "no" }.into())),
            dash((!policy.is_empty()).then(|| policy.join(", "))),
            dash(pending),
        ]
    }
}

fn row<'a>(rows: &'a mut BTreeMap<String, Row>, id: &str) -> &'a mut Row {
    rows.entry(id.to_string()).or_insert_with(|| Row {
        id: id.to_string(),
        ..Row::default()
    })
}

fn plugin_rows(doc: &PolicyDoc, dir: &Path, out: &mut Output) -> Vec<Row> {
    let mut rows: BTreeMap<String, Row> = BTreeMap::new();
    match mirror::read(dir) {
        Some(m) => {
            for p in m.plugins {
                let r = row(&mut rows, &p.id);
                r.version = Some(p.version);
                r.enabled = Some(p.enabled);
                r.locked = p.locked.is_some();
            }
        }
        None => out.warn("Voltius has not run yet for this user; installed plugins are unknown"),
    }
    let (pending, warning) = pending::load(dir);
    if let Some(w) = warning {
        out.warn(w);
    }
    for e in pending.changes {
        if let Change::Plugin { action, id, .. } = e.change {
            let r = row(&mut rows, &id);
            r.pending = Some(action.name());
            r.pending_error = e.error;
        }
    }
    for (layer, is_policy) in [(&doc.policy, true), (&doc.defaults, false)] {
        for key in [INSTALL, ENABLED, DISABLED] {
            for id in listed_ids(layer, key) {
                let r = row(&mut rows, id);
                r.locked |= is_policy && key != INSTALL;
                r.installed_by_organization |= key == INSTALL;
            }
        }
    }
    rows.into_values().collect()
}

fn print_table(out: &mut Output, header: &[&str], rows: Vec<Vec<String>>) {
    let header: Vec<String> = header.iter().map(|h| h.to_string()).collect();
    let mut widths: Vec<usize> = header.iter().map(String::len).collect();
    for r in &rows {
        for (w, cell) in widths.iter_mut().zip(r) {
            *w = (*w).max(cell.chars().count());
        }
    }
    for r in std::iter::once(header).chain(rows) {
        let cells: Vec<String> = r
            .iter()
            .zip(&widths)
            .map(|(c, w)| format!("{c:<w$}"))
            .collect();
        out.line(cells.join("  ").trim_end());
    }
}

fn list(machine: Option<&Path>, dir: &Path, out: &mut Output) -> Result<(), CliError> {
    let rows = plugin_rows(&machine_doc(machine), dir, out);
    if out.json {
        out.json(&json!(rows));
    } else if rows.is_empty() {
        out.line("No plugins");
    } else {
        let cells = rows.iter().map(Row::cells).collect();
        print_table(
            out,
            &["ID", "VERSION", "ENABLED", "POLICY", "PENDING"],
            cells,
        );
    }
    Ok(())
}

fn list_catalogue(catalogue: &Catalogue, out: &mut Output) -> Result<(), CliError> {
    let list = catalogue.remote().map_err(|e| {
        CliError::Io(std::io::Error::other(format!(
            "could not reach the plugin catalogue: {e}"
        )))
    })?;
    if out.json {
        let items: Vec<Value> = list
            .iter()
            .map(|l| json!({ "id": l.id, "name": l.name }))
            .collect();
        out.json(&Value::Array(items));
        return Ok(());
    }
    let cells = list.into_iter().map(|l| vec![l.id, l.name]).collect();
    print_table(out, &["ID", "NAME"], cells);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{captured, Buf, Shared};
    use crate::cli_state::pending::{self, Change};
    use crate::policy;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    const DOCKER: &str =
        r#"{"id":"plugin-docker","name":"Docker","permissions":["docker:manage","storage"]}"#;
    const THEME: &str = r#"{"id":"plugin-theme","name":"Theme","permissions":["themes"]}"#;

    struct Run {
        result: Result<(), CliError>,
        out: String,
        err: String,
    }

    fn exec(
        cmd: PluginsCmd,
        machine: &Path,
        dir: &Path,
        yes: bool,
        fetch: &dyn Fn() -> Result<String, String>,
    ) -> Run {
        exec_seeded(cmd, machine, dir, yes, vec![], fetch)
    }

    fn exec_seeded(
        cmd: PluginsCmd,
        machine: &Path,
        dir: &Path,
        yes: bool,
        seeded: Vec<&str>,
        fetch: &dyn Fn() -> Result<String, String>,
    ) -> Run {
        let (out_buf, err_buf): (Shared, Shared) = (
            Arc::new(Mutex::new(Vec::new())),
            Arc::new(Mutex::new(Vec::new())),
        );
        let mut out = Output::with_sinks(
            false,
            false,
            Box::new(Buf(out_buf.clone())),
            Box::new(Buf(err_buf.clone())),
        );
        let mut ctx = Ctx {
            out: &mut out,
            yes,
            interactive: false,
        };
        let catalogue = Catalogue { seeded, fetch };
        let result = run_plugins(cmd, Some(machine), dir, &catalogue, &mut ctx);
        Run {
            result,
            out: captured(&out_buf),
            err: captured(&err_buf),
        }
    }

    fn catalogue() -> Result<String, String> {
        Ok(format!(r#"{{"plugins":[{DOCKER},{THEME}]}}"#))
    }

    fn offline() -> Result<String, String> {
        Err("network down".into())
    }

    fn target(id: &str, lock: bool, defaults: bool) -> Target {
        Target {
            id: id.into(),
            lock,
            defaults,
        }
    }

    fn layer(machine: &Path, name: &str) -> serde_json::Map<String, Value> {
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(machine).unwrap()).unwrap();
        doc[name].as_object().cloned().unwrap_or_default()
    }

    fn setup() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let machine = dir.path().join("policy.json");
        (dir, machine)
    }

    fn write_policy(machine: &Path, doc: Value) {
        std::fs::write(machine, doc.to_string()).unwrap();
    }

    fn queued(dir: &Path) -> Vec<Change> {
        pending::load(dir)
            .0
            .changes
            .into_iter()
            .map(|e| e.change)
            .collect()
    }

    #[test]
    fn lock_install_is_idempotent() {
        let (dir, machine) = setup();
        for _ in 0..2 {
            let r = exec(
                PluginsCmd::Install(target("plugin-docker", true, false)),
                &machine,
                dir.path(),
                false,
                &catalogue,
            );
            r.result.unwrap();
        }
        assert_eq!(
            layer(&machine, "policy")["plugins.install"],
            json!(["plugin-docker"])
        );
        assert!(queued(dir.path()).is_empty());
    }

    #[test]
    fn enable_lock_moves_id_out_of_disabled() {
        let (dir, machine) = setup();
        exec(
            PluginsCmd::Disable(target("plugin-docker", false, true)),
            &machine,
            dir.path(),
            false,
            &offline,
        )
        .result
        .unwrap();
        assert_eq!(
            layer(&machine, "defaults")["plugins.disabled"],
            json!(["plugin-docker"])
        );
        exec(
            PluginsCmd::Enable(target("plugin-docker", false, true)),
            &machine,
            dir.path(),
            false,
            &offline,
        )
        .result
        .unwrap();
        let defaults = layer(&machine, "defaults");
        assert_eq!(defaults["plugins.enabled"], json!(["plugin-docker"]));
        assert!(defaults.get("plugins.disabled").is_none(), "{defaults:?}");
    }

    #[test]
    fn remove_lock_clears_all_lists() {
        let (dir, machine) = setup();
        write_policy(
            &machine,
            json!({"version": 1, "policy": {
                "plugins.install": ["plugin-docker", "plugin-theme"],
                "plugins.enabled": ["plugin-docker"],
                "plugins.disabled": ["plugin-docker"],
            }, "defaults": {"plugins.install": ["plugin-docker"]}}),
        );
        exec(
            PluginsCmd::Remove(target("plugin-docker", true, false)),
            &machine,
            dir.path(),
            false,
            &offline,
        )
        .result
        .unwrap();
        let policy = layer(&machine, "policy");
        assert_eq!(policy["plugins.install"], json!(["plugin-theme"]));
        assert!(policy.get("plugins.enabled").is_none(), "{policy:?}");
        assert!(policy.get("plugins.disabled").is_none(), "{policy:?}");
        assert_eq!(
            layer(&machine, "defaults")["plugins.install"],
            json!(["plugin-docker"])
        );
    }

    #[test]
    fn install_unknown_id_suggests() {
        let (dir, machine) = setup();
        for lock in [false, true] {
            let r = exec(
                PluginsCmd::Install(target("plugin-dockr", lock, false)),
                &machine,
                dir.path(),
                true,
                &catalogue,
            );
            let e = r.result.unwrap_err();
            assert_eq!(e.exit_code(), 3);
            assert!(
                e.to_string().contains("did you mean \"plugin-docker\""),
                "{e}"
            );
        }
        assert!(queued(dir.path()).is_empty());
        assert!(!machine.exists());
    }

    #[test]
    fn invalid_id_is_refused() {
        let (dir, machine) = setup();
        let r = exec(
            PluginsCmd::Enable(target("../evil", false, false)),
            &machine,
            dir.path(),
            true,
            &offline,
        );
        assert_eq!(r.result.unwrap_err().exit_code(), 3);
        assert!(queued(dir.path()).is_empty());
    }

    #[test]
    fn per_user_install_needs_the_catalogue_to_show_permissions() {
        let (dir, machine) = setup();
        let unlisted_permissions = || -> Result<String, String> {
            Ok(r#"[{"id":"plugin-docker","name":"Docker"}]"#.into())
        };
        let sources: [&dyn Fn() -> Result<String, String>; 2] = [&offline, &unlisted_permissions];
        for fetch in sources {
            let r = exec(
                PluginsCmd::Install(target("plugin-docker", false, false)),
                &machine,
                dir.path(),
                true,
                fetch,
            );
            let e = r.result.unwrap_err();
            assert_eq!(e.exit_code(), 5);
            assert!(e.to_string().contains(
                "could not reach the plugin catalogue to show this plugin's permissions; try again when online"
            ), "{e}");
        }
        assert!(queued(dir.path()).is_empty());
    }

    #[test]
    fn lock_install_offline_warns_and_saves() {
        let (dir, machine) = setup();
        let r = exec(
            PluginsCmd::Install(target("plugin-docker", true, false)),
            &machine,
            dir.path(),
            false,
            &offline,
        );
        r.result.unwrap();
        assert!(
            r.err.contains(
                "could not reach the plugin catalogue; added to policy without checking the id"
            ),
            "{}",
            r.err
        );
        assert!(!r.err.contains("queued"), "{}", r.err);
        assert_eq!(
            layer(&machine, "policy")["plugins.install"],
            json!(["plugin-docker"])
        );
    }

    #[test]
    fn gated_install_without_yes_needs_flag_off_tty() {
        let (dir, machine) = setup();
        let r = exec(
            PluginsCmd::Install(target("plugin-docker", false, false)),
            &machine,
            dir.path(),
            false,
            &catalogue,
        );
        let e = r.result.unwrap_err();
        assert_eq!(e.exit_code(), 2);
        assert!(e.to_string().contains("--yes"), "{e}");
        assert!(r.err.contains("docker:manage"), "{}", r.err);
        assert!(queued(dir.path()).is_empty());
    }

    fn review(dir: &Path, on: bool) {
        mirror::write(
            dir,
            &json!({
                "writtenAt": "t", "appVersion": "1", "serverUrl": null, "plugins": [],
                "settings": { INSTALL_REVIEW: on }
            }),
        )
        .unwrap();
    }

    fn consented(dir: &Path) -> Vec<String> {
        match queued(dir).pop() {
            Some(Change::Plugin {
                consented_permissions,
                ..
            }) => consented_permissions,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn review_off_prompts_and_records_only_gated_permissions() {
        let (dir, machine) = setup();
        review(dir.path(), false);
        let r = exec(
            PluginsCmd::Install(target("plugin-docker", false, false)),
            &machine,
            dir.path(),
            true,
            &catalogue,
        );
        r.result.unwrap();
        assert!(!r.err.contains("storage"), "{}", r.err);
        assert_eq!(consented(dir.path()), vec!["docker:manage".to_string()]);

        let r = exec(
            PluginsCmd::Install(target("plugin-theme", false, false)),
            &machine,
            dir.path(),
            false,
            &catalogue,
        );
        r.result.unwrap();
        assert!(consented(dir.path()).is_empty());
    }

    #[test]
    fn review_on_needs_consent_for_an_ungated_plugin() {
        let (dir, machine) = setup();
        review(dir.path(), true);
        let r = exec(
            PluginsCmd::Install(target("plugin-theme", false, false)),
            &machine,
            dir.path(),
            false,
            &catalogue,
        );
        assert_eq!(r.result.unwrap_err().exit_code(), 2);
        assert!(r.err.contains("  themes"), "{}", r.err);
        assert!(queued(dir.path()).is_empty());
    }

    #[test]
    fn locked_review_policy_beats_the_app_value() {
        let (dir, machine) = setup();
        review(dir.path(), true);
        write_policy(
            &machine,
            json!({"version": 1, "policy": { INSTALL_REVIEW: false }}),
        );
        exec(
            PluginsCmd::Install(target("plugin-theme", false, false)),
            &machine,
            dir.path(),
            false,
            &catalogue,
        )
        .result
        .unwrap();
        assert!(consented(dir.path()).is_empty());
    }

    #[test]
    fn permission_list_survives_quiet() {
        let (dir, machine) = setup();
        let err: Shared = Arc::new(Mutex::new(Vec::new()));
        let mut out = Output::with_sinks(
            false,
            true,
            Box::new(std::io::sink()),
            Box::new(Buf(err.clone())),
        );
        let mut ctx = Ctx {
            out: &mut out,
            yes: true,
            interactive: false,
        };
        let catalogue = Catalogue {
            seeded: vec![DOCKER],
            fetch: &offline,
        };
        let cmd = PluginsCmd::Install(target("plugin-docker", false, false));
        run_plugins(cmd, Some(&machine), dir.path(), &catalogue, &mut ctx).unwrap();
        assert!(
            captured(&err).contains("  docker:manage"),
            "{}",
            captured(&err)
        );
    }

    #[test]
    fn retired_plugin_install_is_refused() {
        let (dir, machine) = setup();
        for (lock, defaults) in [(false, false), (true, false), (false, true)] {
            let r = exec(
                PluginsCmd::Install(target("plugin-ssh-config", lock, defaults)),
                &machine,
                dir.path(),
                true,
                &catalogue,
            );
            let e = r.result.unwrap_err();
            assert_eq!(e.exit_code(), 3);
            assert!(e.to_string().contains("is retired"), "{e}");
        }
        assert!(queued(dir.path()).is_empty());
        assert!(!machine.exists());
    }

    #[test]
    fn gated_install_with_yes_records_consent() {
        let (dir, machine) = setup();
        let r = exec(
            PluginsCmd::Install(target("plugin-docker", false, false)),
            &machine,
            dir.path(),
            true,
            &catalogue,
        );
        r.result.unwrap();
        assert!(
            r.out.contains(
                "Queued: install plugin-docker. Applies when Voltius next opens or regains focus."
            ),
            "{}",
            r.out
        );
        assert_eq!(
            queued(dir.path()),
            vec![Change::Plugin {
                action: PluginAction::Install,
                id: "plugin-docker".into(),
                consented_permissions: vec!["docker:manage".into(), "storage".into()],
            }]
        );
    }

    #[test]
    fn lock_install_of_gated_plugin_never_prompts() {
        let (dir, machine) = setup();
        exec(
            PluginsCmd::Install(target("plugin-docker", false, true)),
            &machine,
            dir.path(),
            false,
            &catalogue,
        )
        .result
        .unwrap();
        assert_eq!(
            layer(&machine, "defaults")["plugins.install"],
            json!(["plugin-docker"])
        );
    }

    #[test]
    fn remove_locked_install_refused() {
        let (dir, machine) = setup();
        for key in ["plugins.install", "plugins.enabled"] {
            write_policy(
                &machine,
                json!({"version": 1, "policy": {key: ["plugin-docker"]}}),
            );
            let r = exec(
                PluginsCmd::Remove(target("plugin-docker", false, false)),
                &machine,
                dir.path(),
                true,
                &offline,
            );
            let e = r.result.unwrap_err();
            assert_eq!(e.exit_code(), 3);
            assert!(
                e.to_string()
                    .contains("locked by your organization's policy"),
                "{e}"
            );
        }
        write_policy(
            &machine,
            json!({"version": 1, "defaults": {"plugins.install": ["plugin-docker"]}}),
        );
        exec(
            PluginsCmd::Remove(target("plugin-docker", false, false)),
            &machine,
            dir.path(),
            true,
            &offline,
        )
        .result
        .unwrap();
        assert_eq!(queued(dir.path()).len(), 1);
    }

    #[test]
    fn toggling_a_locked_plugin_is_refused() {
        let (dir, machine) = setup();
        write_policy(
            &machine,
            json!({"version": 1, "policy": {"plugins.disabled": ["plugin-docker"]}}),
        );
        for cmd in [
            PluginsCmd::Enable(target("plugin-docker", false, false)),
            PluginsCmd::Disable(target("plugin-docker", false, false)),
        ] {
            assert_eq!(
                exec(cmd, &machine, dir.path(), true, &offline)
                    .result
                    .unwrap_err()
                    .exit_code(),
                3
            );
        }
        assert!(queued(dir.path()).is_empty());
    }

    #[test]
    fn install_refused_when_installs_turned_off() {
        let (dir, machine) = setup();
        write_policy(
            &machine,
            json!({"version": 1, "policy": {"plugins.allowInstall": false}}),
        );
        let r = exec(
            PluginsCmd::Install(target("plugin-docker", false, false)),
            &machine,
            dir.path(),
            true,
            &catalogue,
        );
        assert_eq!(r.result.unwrap_err().exit_code(), 3);
        assert!(queued(dir.path()).is_empty());
        write_policy(
            &machine,
            json!({"version": 1, "policy": {"plugins.allowInstall": false}, "defaults": {"plugins.install": ["plugin-docker"]}}),
        );
        exec(
            PluginsCmd::Install(target("plugin-docker", false, false)),
            &machine,
            dir.path(),
            true,
            &catalogue,
        )
        .result
        .unwrap();
        assert_eq!(queued(dir.path()).len(), 1);
    }

    #[test]
    fn seeded_id_needs_no_network() {
        let (dir, machine) = setup();
        let no_network = || -> Result<String, String> { panic!("network used") };
        let r = exec_seeded(
            PluginsCmd::Install(target("plugin-docker", false, false)),
            &machine,
            dir.path(),
            true,
            vec![DOCKER],
            &no_network,
        );
        r.result.unwrap();
        assert!(!r.err.contains("warning"), "{}", r.err);
        assert_eq!(
            queued(dir.path()),
            vec![Change::Plugin {
                action: PluginAction::Install,
                id: "plugin-docker".into(),
                consented_permissions: vec!["docker:manage".into(), "storage".into()],
            }]
        );
    }

    #[test]
    fn list_overlays_pending_and_policy() {
        let (dir, machine) = setup();
        write_policy(
            &machine,
            json!({"version": 1, "policy": {"plugins.enabled": ["plugin-docker"]}, "defaults": {"plugins.install": ["plugin-theme"]}}),
        );
        crate::cli_state::mirror::write(
            dir.path(),
            &json!({"writtenAt": "2026-11-05T00:00:00Z", "appVersion": "0.56.0", "settings": {}, "serverUrl": null,
                "plugins": [{"id": "plugin-docker", "version": "1.2.0", "enabled": true, "origin": "seeded", "locked": null}]}),
        )
        .unwrap();
        pending::append(
            dir.path(),
            Change::Plugin {
                action: PluginAction::Install,
                id: "plugin-theme".into(),
                consented_permissions: vec![],
            },
        )
        .unwrap();
        let r = exec(
            PluginsCmd::List { catalog: false },
            &machine,
            dir.path(),
            false,
            &offline,
        );
        r.result.unwrap();
        for needle in [
            "plugin-docker",
            "1.2.0",
            "locked",
            "plugin-theme",
            "installed by organization",
            "install",
        ] {
            assert!(r.out.contains(needle), "{needle} missing in:\n{}", r.out);
        }

        let (mut out, buf) = crate::cli::output::testing::capture(true);
        let mut ctx = Ctx {
            out: &mut out,
            yes: false,
            interactive: false,
        };
        let catalogue = Catalogue {
            seeded: vec![],
            fetch: &offline,
        };
        run_plugins(
            PluginsCmd::List { catalog: false },
            Some(&machine),
            dir.path(),
            &catalogue,
            &mut ctx,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&captured(&buf)).unwrap();
        assert_eq!(v[0]["id"], "plugin-docker");
        assert_eq!(v[0]["locked"], true);
        assert_eq!(v[0]["enabled"], true);
        assert_eq!(v[1]["id"], "plugin-theme");
        assert_eq!(v[1]["installedByOrganization"], true);
        assert_eq!(v[1]["pending"], "install");
        assert_eq!(v[1]["version"], Value::Null);
    }

    #[test]
    fn list_catalog_prints_ids_and_names() {
        let (dir, machine) = setup();
        let r = exec(
            PluginsCmd::List { catalog: true },
            &machine,
            dir.path(),
            false,
            &catalogue,
        );
        r.result.unwrap();
        assert!(
            r.out.contains("plugin-docker") && r.out.contains("Docker"),
            "{}",
            r.out
        );
        let r = exec(
            PluginsCmd::List { catalog: true },
            &machine,
            dir.path(),
            false,
            &offline,
        );
        assert_eq!(r.result.unwrap_err().exit_code(), 5);
        assert!(policy::load_from(&machine).doc.policy.is_empty());
    }
}
