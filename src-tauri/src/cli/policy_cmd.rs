use super::output::Output;
use super::{Access, CliError};
use crate::cli_state::{mirror, pending};
use crate::commands::local::ShellOption;
use crate::policy::{self, Blocked, Issue, IssueKind, Layer, MachineAcl, PolicyDoc, Range, Trust};
use clap::Subcommand;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

#[derive(Subcommand, Debug)]
pub enum PolicyCmd {
    /// Lock a setting to a value on this machine
    Set {
        key: String,
        /// Omit when giving --min, --max or --allow
        value: Option<String>,
        /// Set a default users may override instead of a locked value
        #[arg(long)]
        defaults: bool,
        /// Lowest value users may choose
        #[arg(long)]
        min: Option<f64>,
        /// Highest value users may choose
        #[arg(long)]
        max: Option<f64>,
        /// A value users may choose; repeat for several
        #[arg(long = "allow")]
        allow: Vec<String>,
    },
    /// Remove a setting from the machine policy file
    Unset {
        key: String,
        #[arg(long)]
        defaults: bool,
    },
    /// Show each setting's effective value and where it comes from
    Show,
    /// Validate a policy file (default: the machine file)
    Check { file: Option<PathBuf> },
    /// Merge a policy file into the machine file; nothing is written if it has any issue
    Import {
        file: PathBuf,
        /// Discard the machine file's current content and write exactly this file
        #[arg(long)]
        replace: bool,
    },
    /// Print the machine policy file
    Export,
    /// Print where the machine policy file lives
    Path,
}

pub fn run(cmd: PolicyCmd, machine: Option<&Path>, out: &mut Output) -> Result<(), CliError> {
    let Some(path) = machine else {
        return match cmd {
            PolicyCmd::Path => print_path(None, out),
            _ => Err(CliError::Usage(
                "policy commands are not available on this platform".into(),
            )),
        };
    };
    let acl = policy::machine_acl(path);
    match cmd {
        PolicyCmd::Set {
            key,
            value,
            defaults,
            min,
            max,
            allow,
        } => write_setting(
            &key,
            SetArgs {
                value,
                min,
                max,
                allow,
            },
            layer_of(defaults),
            path,
            out,
        ),
        PolicyCmd::Unset { key, defaults } => unset(&key, layer_of(defaults), path, out),
        PolicyCmd::Show => show(path, user_dir().as_deref(), out),
        PolicyCmd::Check { file } => check(file.as_deref(), path, acl.map(|a| a.probe), out),
        PolicyCmd::Import { file, replace } => import(&file, path, acl, replace, out),
        PolicyCmd::Export => export(path, out),
        PolicyCmd::Path => print_path(Some(path), out),
    }
}

fn print_path(machine: Option<&Path>, out: &mut Output) -> Result<(), CliError> {
    if out.json {
        out.json(&json!({ "path": machine.map(|p| p.display().to_string()) }));
    } else {
        match machine {
            Some(p) => out.line(p.display()),
            None => out.line("no machine policy on this platform"),
        }
    }
    Ok(())
}

pub(super) fn layer_of(defaults: bool) -> Layer {
    if defaults {
        Layer::Defaults
    } else {
        Layer::Policy
    }
}

fn layers(doc: &PolicyDoc) -> [(Layer, &BTreeMap<String, Value>); 2] {
    [
        (Layer::Policy, &doc.policy),
        (Layer::Defaults, &doc.defaults),
    ]
}

fn entries(doc: &PolicyDoc) -> impl Iterator<Item = (Layer, &str)> {
    layers(doc)
        .into_iter()
        .flat_map(|(layer, map)| map.keys().map(move |k| (layer, k.as_str())))
}

fn io_error(path: &Path, access: Access, e: std::io::Error) -> CliError {
    io_error_as(super::user::is_elevated(), path, access, e)
}

fn io_error_as(elevated: bool, path: &Path, access: Access, e: std::io::Error) -> CliError {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied if elevated => CliError::Denied(format!(
            "{} was refused even with root/Administrator rights; it may be held open by \
             another program, or be read-only. Close that program or clear the flag, then run again",
            path.display()
        )),
        std::io::ErrorKind::PermissionDenied => CliError::Permission(access, path.to_path_buf()),
        _ => CliError::Io(e),
    }
}

fn not_found(path: &Path) -> CliError {
    CliError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("{} does not exist", path.display()),
    ))
}

fn read_text(path: &Path) -> Result<Option<String>, CliError> {
    policy::read_optional(path).map_err(|e| io_error(path, Access::Read, e))
}

pub(super) type Raw = serde_json::Map<String, Value>;

pub(super) fn plain(kind: IssueKind, message: String) -> CliError {
    CliError::Validation(vec![Issue::general(kind, message)])
}

pub(super) fn unusable(path: &Path, why: &str) -> CliError {
    plain(
        IssueKind::File,
        format!(
            "{} {why}; fix it or run `voltius-cli policy check`",
            path.display()
        ),
    )
}

fn empty_root() -> Raw {
    let mut root = Raw::new();
    root.insert("version".into(), json!(1));
    root.insert("policy".into(), json!({}));
    root.insert("defaults".into(), json!({}));
    root
}

fn parse_raw(path: &Path, text: Option<String>) -> Result<Raw, CliError> {
    let Some(text) = text else {
        return Ok(empty_root());
    };
    let Ok(Value::Object(root)) = serde_json::from_str::<Value>(&text) else {
        return Err(unusable(path, "is not a valid policy file"));
    };
    if policy::version_issue(&root).is_some() {
        return Err(unusable(path, "has an unsupported version"));
    }
    Ok(root)
}

pub(super) fn layer_entries<'a>(
    root: &'a mut Raw,
    layer: Layer,
    path: &Path,
) -> Result<&'a mut Raw, CliError> {
    root.entry(layer.name())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            unusable(
                path,
                &format!("has a malformed \"{}\" section", layer.name()),
            )
        })
}

fn blocked(b: Blocked) -> CliError {
    match b {
        Blocked::Link(p) => CliError::Denied(format!(
            "{} is a link; delete it and run again",
            p.display()
        )),
        Blocked::Unprotected(p) => plain(
            IssueKind::Unprotected,
            format!(
                "{} was writable by standard users; review it, then run \
                 `voltius-cli policy import --replace <reviewed file>` or delete it",
                p.display()
            ),
        ),
        Blocked::Held(p) => CliError::Denied(format!(
            "{} is held open or not owned by Administrators; \
             close other programs or remove it, then run again",
            p.display()
        )),
        Blocked::Io(p, e) => io_error(&p, Access::Write, e),
    }
}

pub(super) fn edit_raw(
    path: &Path,
    out: &mut Output,
    edit: impl FnOnce(&mut Raw) -> Result<bool, CliError>,
) -> Result<bool, CliError> {
    edit_raw_with(path, policy::machine_acl(path), false, out, edit)
}

fn edit_raw_with(
    path: &Path,
    acl: Option<MachineAcl>,
    replace: bool,
    out: &mut Output,
    edit: impl FnOnce(&mut Raw) -> Result<bool, CliError>,
) -> Result<bool, CliError> {
    let existing = match acl {
        Some(a) => {
            let check = || policy::write_check(path, a.probe, replace).map_err(blocked);
            check()?;
            if let Some(aside) = (a.harden_dir)(path).map_err(blocked)? {
                let dir = path.parent().unwrap_or(path);
                out.notice(format!(
                    "moved {} to {}; its contents were not kept",
                    dir.display(),
                    aside.display()
                ));
            }
            // Re-check once the folder is locked; the text comes from the handle this check passed.
            check()?
        }
        None if replace => None,
        None => read_text(path)?,
    };
    let mut root = if replace {
        empty_root()
    } else {
        parse_raw(path, existing)?
    };
    root.entry("version").or_insert_with(|| json!(1));
    let before = Value::Object(root.clone()).to_string();
    let changed = edit(&mut root)?;
    if changed {
        let mut text = serde_json::to_string_pretty(&root).map_err(|e| CliError::Io(e.into()))?;
        text.push('\n');
        let write = acl.map_or(policy::write_text_atomic as fn(&Path, &str) -> _, |a| {
            a.write
        });
        write(path, &text).map_err(|e| io_error(path, Access::Write, e))?;
        if let Some(a) = acl {
            (a.adopt_written)(path).map_err(blocked)?;
        }
        if let Some(profile) = policy::machine_profile(path) {
            let written = policy::parse(&text).0;
            for line in shadowed(&written, &policy::parse(&before).0, &profile.doc) {
                out.warn(line);
            }
        }
    }
    Ok(changed)
}

pub(super) fn shadowed(
    written: &PolicyDoc,
    before: &PolicyDoc,
    profile: &PolicyDoc,
) -> Vec<String> {
    let mut lines = Vec::new();
    for (((layer, now), (_, was)), (_, theirs)) in layers(written)
        .into_iter()
        .zip(layers(before))
        .zip(layers(profile))
    {
        for (key, value) in now {
            if was.get(key) != Some(value) && theirs.get(key).is_some_and(|p| p != value) {
                lines.push(format!(
                    "the configuration profile sets {}.{key}; it wins over policy.json",
                    layer.name()
                ));
            }
        }
    }
    lines
}

fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cur = row[j + 1];
            row[j + 1] = (prev + usize::from(ca != *cb)).min(row[j] + 1).min(cur + 1);
            prev = cur;
        }
    }
    row[b.len()]
}

pub(super) fn unknown_message<'a>(
    what: &str,
    key: &str,
    candidates: impl Iterator<Item = &'a str>,
) -> String {
    let closest = candidates.map(|id| (edit_distance(key, id), id)).min();
    match closest {
        Some((d, id)) if d <= key.len() / 3 + 2 => {
            format!("unknown {what} \"{key}\"; did you mean \"{id}\"?")
        }
        _ => format!("unknown {what} \"{key}\""),
    }
}

pub(super) fn unknown_key_message(key: &str) -> String {
    unknown_message("key", key, policy::key_ids())
}

pub(super) fn locked_message(what: &str) -> String {
    format!("{what} is locked by your organization's policy")
}

pub(super) fn machine_doc(machine: Option<&Path>) -> PolicyDoc {
    machine
        .map(|p| policy::load_machine_at(p).doc)
        .unwrap_or_default()
}

pub(super) fn machine_path(machine: Option<&Path>) -> Result<&Path, CliError> {
    machine
        .ok_or_else(|| CliError::Usage("machine policy is not available on this platform".into()))
}

fn not_honoured_message(layer: Layer, key: &str) -> Option<String> {
    match layer {
        Layer::Policy if !policy::is_enforced(key) => Some(format!(
            "{key} is saved but this version of Voltius does not enforce it yet"
        )),
        Layer::Defaults if !policy::is_default_applied(key) => Some(format!(
            "{key} is saved as a default but this version of Voltius does not apply defaults for it yet"
        )),
        _ => None,
    }
}

fn not_honoured<'a>(
    entries: impl IntoIterator<Item = (Layer, &'a str)>,
) -> impl Iterator<Item = (Layer, &'a str, String)> {
    entries
        .into_iter()
        .filter_map(|(layer, key)| not_honoured_message(layer, key).map(|m| (layer, key, m)))
}

fn warn_not_honoured<'a>(out: &mut Output, entries: impl IntoIterator<Item = (Layer, &'a str)>) {
    for (_, _, message) in not_honoured(entries) {
        out.warn(message);
    }
}

pub(super) fn typed_value(key: &str, ty: policy::KeyType, raw: &str) -> Result<Value, CliError> {
    policy::parse_cli_value(ty, raw)
        .and_then(|v| policy::value_problem(key, ty, &v).map_or(Ok(v), Err))
        .map_err(|m| keyed(key, IssueKind::Type, m))
}

fn keyed(key: &str, kind: IssueKind, message: String) -> CliError {
    plain(kind, format!("{key}: {message}"))
}

#[derive(Default)]
struct SetArgs {
    value: Option<String>,
    min: Option<f64>,
    max: Option<f64>,
    allow: Vec<String>,
}

fn built_range(key: &str, ty: policy::KeyType, a: &SetArgs) -> Result<Value, CliError> {
    let allowed = if a.allow.is_empty() {
        None
    } else {
        let parse = |raw: &String| {
            policy::parse_cli_value(ty, raw).map_err(|m| keyed(key, IssueKind::Type, m))
        };
        Some(a.allow.iter().map(parse).collect::<Result<Vec<_>, _>>()?)
    };
    if let Some(bound) = [a.min, a.max]
        .into_iter()
        .flatten()
        .find(|n| !n.is_finite())
    {
        return Err(keyed(
            key,
            IssueKind::Type,
            format!("expected a finite number, got {bound}"),
        ));
    }
    let range = Range {
        min: a.min,
        max: a.max,
        allowed,
    };
    match policy::range_problem(key, &range) {
        Some(m) => Err(keyed(key, IssueKind::Range, m)),
        None => Ok(json!({ "$range": range_json(&range) })),
    }
}

fn set_value(key: &str, ty: policy::KeyType, layer: Layer, a: &SetArgs) -> Result<Value, CliError> {
    let is_range = a.min.is_some() || a.max.is_some() || !a.allow.is_empty();
    match (&a.value, is_range) {
        (Some(_), true) | (None, false) => Err(CliError::Usage(
            "give a value or --min/--max/--allow, not both".into(),
        )),
        (None, true) if layer == Layer::Defaults => {
            Err(CliError::Usage("ranges belong under policy".into()))
        }
        (None, true) => built_range(key, ty, a),
        (Some(raw), false) => typed_value(key, ty, raw),
    }
}

pub(super) fn set(
    key: &str,
    raw: &str,
    layer: Layer,
    path: &Path,
    out: &mut Output,
) -> Result<(), CliError> {
    write_setting(key, raw_args(raw), layer, path, out)
}

fn raw_args(raw: &str) -> SetArgs {
    SetArgs {
        value: Some(raw.to_string()),
        ..Default::default()
    }
}

fn store_setting(
    key: &str,
    args: &SetArgs,
    layer: Layer,
    path: &Path,
    out: &mut Output,
) -> Result<(), CliError> {
    let ty = policy::key_type(key)
        .ok_or_else(|| plain(IssueKind::UnknownKey, unknown_key_message(key)))?;
    if let Some(m) = policy::lock_problem(layer, key) {
        return Err(plain(IssueKind::Type, m));
    }
    let value = set_value(key, ty, layer, args)?;
    edit_raw(path, out, |root| {
        layer_entries(root, layer, path)?.insert(key.to_string(), value);
        Ok(true)
    })?;
    Ok(())
}

pub(super) fn put(
    key: &str,
    raw: &str,
    layer: Layer,
    path: &Path,
    out: &mut Output,
) -> Result<(), CliError> {
    store_setting(key, &raw_args(raw), layer, path, out)
}

fn write_setting(
    key: &str,
    args: SetArgs,
    layer: Layer,
    path: &Path,
    out: &mut Output,
) -> Result<(), CliError> {
    store_setting(key, &args, layer, path, out)?;
    out.line(format!("Set {key} in {}", layer.name()));
    warn_not_honoured(out, [(layer, key)]);
    Ok(())
}

pub(super) fn remove_setting(
    key: &str,
    layer: Layer,
    path: &Path,
    out: &mut Output,
) -> Result<bool, CliError> {
    edit_raw(path, out, |root| {
        Ok(layer_entries(root, layer, path)?.remove(key).is_some())
    })
}

fn unset(key: &str, layer: Layer, path: &Path, out: &mut Output) -> Result<(), CliError> {
    let removed = remove_setting(key, layer, path, out)?;
    if removed {
        out.line(format!("Removed {key} from {}", layer.name()));
    } else {
        out.line(format!("{key} is not set in {}", layer.name()));
    }
    Ok(())
}

const BUILT_IN: &str = "built-in";
const POLICY: &str = "machine policy";

pub(super) struct Row {
    pub value: Value,
    pub source: &'static str,
    default_value: Option<Value>,
    at: Option<String>,
    range: Option<Range>,
    user_value: Option<Value>,
    forced_by: Option<&'static str>,
}

impl Row {
    fn new(value: Value, source: &'static str, at: Option<String>) -> Self {
        Row {
            value,
            source,
            default_value: None,
            at,
            range: None,
            user_value: None,
            forced_by: None,
        }
    }

    fn note(&self) -> String {
        if let Some(by) = self.forced_by {
            return format!("{}, forced on by {by}", self.source);
        }
        if let Some(r) = &self.range {
            let moved = self
                .user_value
                .as_ref()
                .map_or(String::new(), |u| format!("; user value {u} is outside it"));
            let by = if self.source == POLICY {
                POLICY.to_string()
            } else {
                format!("{}, {POLICY}", self.source)
            };
            return format!("{by} range: {}{moved}", range_text(r));
        }
        match &self.default_value {
            Some(d) => format!("{}, machine default: {d}", self.source),
            None => self.source.to_string(),
        }
    }

    fn json(&self, key: &str) -> Value {
        let mut e = json!({ "key": key, "value": self.value, "source": self.source });
        if let Some(d) = &self.default_value {
            e["defaultValue"] = d.clone();
        }
        if let Some(r) = &self.range {
            e["range"] = range_json(r);
        }
        if let Some(u) = &self.user_value {
            e["userValue"] = u.clone();
        }
        if let Some(by) = self.forced_by {
            e["forcedBy"] = json!(by);
        }
        e
    }
}

fn range_json(r: &Range) -> Value {
    let mut o = serde_json::Map::new();
    if let Some(n) = r.min {
        o.insert("min".into(), policy::number_value(n));
    }
    if let Some(n) = r.max {
        o.insert("max".into(), policy::number_value(n));
    }
    if let Some(a) = &r.allowed {
        o.insert("allowed".into(), Value::Array(a.clone()));
    }
    Value::Object(o)
}

pub(super) fn range_text(r: &Range) -> String {
    let parts = [
        r.min.map(|n| format!("min {}", policy::number_value(n))),
        r.max.map(|n| format!("max {}", policy::number_value(n))),
        r.allowed.as_ref().map(|a| {
            let items: Vec<String> = a.iter().map(policy::show).collect();
            format!("allowed {}", items.join(", "))
        }),
    ];
    parts.into_iter().flatten().collect::<Vec<_>>().join(", ")
}

pub(super) fn range_violation(doc: &PolicyDoc, key: &str, value: &Value) -> Option<String> {
    let range = doc.policy.get(key).and_then(policy::range_of)?;
    let shells = detected_shells_for(doc, key);
    (!policy::within(key, &range, value, &shells)).then(|| {
        format!(
            "{key}: outside the range your organization allows ({})",
            range_text(&range)
        )
    })
}

#[derive(Default)]
struct UserState {
    rows: BTreeMap<String, Row>,
    as_of: Option<String>,
    built_ins: BTreeMap<String, Value>,
}

fn user_values(dir: &Path) -> UserState {
    let mut state = UserState::default();
    if let Some(m) = mirror::read(dir) {
        for (k, v) in m.values() {
            let source = if m.built_ins.get(&k) == Some(&v) {
                BUILT_IN
            } else {
                "app"
            };
            state
                .rows
                .insert(k, Row::new(v, source, Some(m.written_at.clone())));
        }
        state.as_of = Some(m.written_at);
        state.built_ins = m.built_ins;
    }
    for (k, (v, at)) in pending::load(dir).0.queued_values() {
        state.rows.insert(k, Row::new(v, "pending", Some(at)));
    }
    state
}

type Stored = (Value, &'static str, Option<String>);

fn range_row(
    key: &str,
    range: Range,
    stored: Option<&Stored>,
    admin_default: Option<&Value>,
    built_in: Option<&Value>,
    shells: &[ShellOption],
) -> Row {
    let mut value = policy::bounded(key, &range, stored.map(|s| &s.0), admin_default, built_in);
    if let (SHELL_KEY, Some(allowed)) = (key, &range.allowed) {
        let entries: Vec<&str> = allowed.iter().filter_map(Value::as_str).collect();
        value = policy::pick_shell(shells, &entries, value.as_str())
            .map_or(Value::Null, |s| json!(s.path));
    }
    let user = stored.filter(|(_, source, _)| *source != BUILT_IN);
    let inside = |v: &Value| policy::within(key, &range, v, shells);
    let mut row = match user.filter(|(v, ..)| inside(v)) {
        Some((_, source, at)) => Row::new(value, source, at.clone()),
        None => Row::new(value, POLICY, None),
    };
    row.user_value = user.map(|(v, ..)| v).filter(|v| !inside(v)).cloned();
    row.range = Some(range);
    row
}

fn forced_toggle_rows(doc: &PolicyDoc, rows: &mut BTreeMap<String, Row>) {
    let toggles: BTreeSet<&str> = doc
        .policy
        .keys()
        .filter_map(|k| policy::key_def(k)?.implies.as_deref())
        .collect();
    for toggle in toggles {
        if let Some(by) = policy::implied_lock(doc, toggle) {
            let mut row = Row::new(Value::Bool(true), POLICY, None);
            row.forced_by = Some(by);
            rows.insert(toggle.to_string(), row);
        }
    }
}

fn effective_rows(
    doc: &PolicyDoc,
    mut rows: BTreeMap<String, Row>,
    built_ins: &BTreeMap<String, Value>,
    shells: &[ShellOption],
) -> BTreeMap<String, Row> {
    let stored: BTreeMap<String, Stored> = rows
        .iter()
        .map(|(k, r)| (k.clone(), (r.value.clone(), r.source, r.at.clone())))
        .collect();
    for (k, v) in &doc.defaults {
        match rows.get_mut(k) {
            Some(r) if r.source != BUILT_IN && r.value != *v => r.default_value = Some(v.clone()),
            _ => {
                rows.insert(k.clone(), Row::new(v.clone(), "machine default", None));
            }
        }
    }
    for (k, v) in &doc.policy {
        let row = match policy::range_of(v) {
            Some(range) => range_row(
                k,
                range,
                stored.get(k),
                doc.defaults.get(k),
                built_ins.get(k),
                shells,
            ),
            None => {
                let own = stored.get(k).map(|s| &s.0).or(doc.defaults.get(k));
                Row::new(policy::merged_lock(k, v, own), POLICY, None)
            }
        };
        rows.insert(k.clone(), row);
    }
    forced_toggle_rows(doc, &mut rows);
    rows
}

// Precedence: machine policy > pending > app > machine default > built-in.
pub(super) fn effective_row(doc: &PolicyDoc, dir: &Path, key: &str) -> Option<Row> {
    let mut user = user_values(dir);
    user.rows.retain(|k, _| k == key);
    effective_rows(
        doc,
        user.rows,
        &user.built_ins,
        &detected_shells_for(doc, key),
    )
    .remove(key)
    .or_else(|| user.as_of.map(|at| Row::new(Value::Null, "app", Some(at))))
}

pub(super) fn print_row(key: &str, r: &Row, out: &mut Output) {
    if out.json {
        let mut e = r.json(key);
        e["asOf"] = json!(r.at);
        out.json(&e);
        return;
    }
    let at = match (&r.at, r.source) {
        (Some(at), "app" | BUILT_IN) => format!(", as of {at}"),
        _ => String::new(),
    };
    out.line(format!("{} ({}{at})", r.value, r.note()));
}

fn show(path: &Path, user_dir: Option<&Path>, out: &mut Output) -> Result<(), CliError> {
    let loaded = policy::load_machine_at(path);
    let user = user_dir.map_or_else(Default::default, user_values);
    let as_of = user.as_of.clone();
    let shells = detected_shells_for(&loaded.doc, SHELL_KEY);
    let mut rows = effective_rows(&loaded.doc, user.rows, &user.built_ins, &shells);
    rows.retain(|_, r| r.source != BUILT_IN);
    let warnings = shell_warnings(&loaded.doc, &shells);
    if out.json {
        let entries: Vec<Value> = rows.iter().map(|(k, r)| r.json(k)).collect();
        out.json(&json!({
            "path": loaded.path,
            "entries": entries,
            "issues": loaded.issues,
            "warnings": warnings,
            "mirrorAsOf": as_of,
        }));
        return Ok(());
    }
    let bold = anstyle::Style::new().bold();
    let dim = anstyle::Style::new().dimmed();
    out.line(format!(
        "{bold}Effective settings{bold:#} {dim}{}{dim:#}",
        path.display()
    ));
    if rows.is_empty() {
        out.line(format!("  {dim}none{dim:#}"));
    }
    for (k, r) in &rows {
        out.line(format!("  {k} = {} {dim}({}){dim:#}", r.value, r.note()));
    }
    match (user_dir, &as_of) {
        (None, _) => out.line(format!(
            "\n{dim}user values not shown when run as root{dim:#}"
        )),
        (Some(_), Some(t)) => out.line(format!("\n{dim}app values as of {t}{dim:#}")),
        (Some(_), None) => out.line(format!(
            "\n{dim}Voltius has not run yet for this user{dim:#}"
        )),
    }
    let warn = anstyle::AnsiColor::Yellow.on_default();
    for i in &loaded.issues {
        out.line(format!("{warn}warning{warn:#}: {}", describe(i)));
    }
    for w in warnings {
        out.warn(w);
    }
    Ok(())
}

const SHELL_KEY: &str = "appSettings.terminal.preferredShell";
const SYSTEM_DEFAULT: &str = "new terminals use the system default";

fn shell_warnings(doc: &PolicyDoc, shells: &[ShellOption]) -> Vec<String> {
    let installed = |entry: &str| shells.iter().any(|s| s.matches(entry));
    let Some(v) = doc.policy.get(SHELL_KEY) else {
        return Vec::new();
    };
    if let Some(range) = policy::range_of(v) {
        let allowed = range.allowed.unwrap_or_default();
        if !allowed.iter().filter_map(Value::as_str).any(installed) {
            return vec![format!(
                "none of the allowed shells is installed; {SYSTEM_DEFAULT}"
            )];
        }
        return Vec::new();
    }
    match v.as_str() {
        Some(s) if !installed(s) => vec![format!("locked shell {s} not found; {SYSTEM_DEFAULT}")],
        _ => Vec::new(),
    }
}

fn detected_shells_for(doc: &PolicyDoc, key: &str) -> Vec<ShellOption> {
    if key != SHELL_KEY || !doc.policy.contains_key(SHELL_KEY) {
        return Vec::new();
    }
    let Ok(rt) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return Vec::new();
    };
    rt.block_on(crate::commands::local::detected_shells())
}

fn user_dir() -> Option<PathBuf> {
    (!super::user::is_system_account()).then(crate::storage::config::config_dir_peek)
}

pub fn describe(i: &Issue) -> String {
    match (i.layer, &i.key) {
        (Some(l), Some(k)) => format!("{}.{k}: {}", l.name(), i.message),
        (Some(l), None) => format!("{}: {}", l.name(), i.message),
        _ => i.message.clone(),
    }
}

fn check(
    file: Option<&Path>,
    machine: &Path,
    probe: Option<policy::Probe>,
    out: &mut Output,
) -> Result<(), CliError> {
    let (target, doc, issues) = match file {
        None => {
            let loaded = policy::load_machine_with(machine, probe);
            (machine, loaded.doc, loaded.issues)
        }
        Some(f) => {
            let (doc, issues) = read_checked(f, machine, probe)?;
            (f, doc, issues)
        }
    };
    let (issues, profile_conflicts) = split_conflicts(issues);
    let conflicts = policy::conflicts(&doc)
        .into_iter()
        .map(|(key, message)| warning(Some(Layer::Policy), Some(key), &message));
    let warnings: Vec<Value> = profile_conflicts
        .into_iter()
        .chain(
            not_honoured(entries(&doc))
                .map(|(layer, key, message)| warning(Some(layer), Some(key), &message)),
        )
        .chain(conflicts)
        .collect();
    if out.json {
        out.json(&json!({
            "path": target.display().to_string(),
            "issues": issues,
            "warnings": warnings,
        }));
    } else {
        for w in &warnings {
            out.warn(w["message"].as_str().unwrap_or_default());
        }
    }
    if issues.is_empty() {
        if out.json {
            return Ok(());
        }
        let ok = anstyle::AnsiColor::Green.on_default();
        out.line(format!("{ok}ok{ok:#}: {}", target.display()));
        Ok(())
    } else {
        Err(CliError::Validation(issues))
    }
}

fn read_checked(
    file: &Path,
    machine: &Path,
    probe: Option<policy::Probe>,
) -> Result<(PolicyDoc, Vec<Issue>), CliError> {
    let (doc, mut issues) = match policy::read_optional(file) {
        Ok(Some(t)) => policy::parse(&t),
        Ok(None) => return Err(not_found(file)),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            (PolicyDoc::default(), vec![policy::read_issue(file, &e)])
        }
        Err(e) => return Err(io_error(file, Access::Read, e)),
    };
    if let Some(Trust::Ignored(issue)) = probe
        .filter(|_| policy::same_path(file, machine))
        .map(|p| policy::trust(file, p))
    {
        issues.push(issue);
    }
    Ok((doc, issues))
}

fn warning(layer: Option<Layer>, key: Option<&str>, message: &str) -> Value {
    json!({ "layer": layer.map(Layer::name), "key": key, "message": message })
}

fn split_conflicts(issues: Vec<Issue>) -> (Vec<Issue>, Vec<Value>) {
    let (conflicts, rest): (Vec<Issue>, Vec<Issue>) = issues
        .into_iter()
        .partition(|i| i.kind == IssueKind::Conflict);
    let warnings = conflicts
        .iter()
        .map(|i| warning(i.layer, i.key.as_deref(), &describe(i)))
        .collect();
    (rest, warnings)
}

fn import(
    file: &Path,
    machine: &Path,
    acl: Option<MachineAcl>,
    replace: bool,
    out: &mut Output,
) -> Result<(), CliError> {
    let text = read_text(file)?.ok_or_else(|| not_found(file))?;
    let (incoming, issues) = policy::parse(&text);
    if !issues.is_empty() {
        return Err(CliError::Validation(issues));
    }
    edit_raw_with(machine, acl, replace, out, |root| {
        for (layer, map) in layers(&incoming) {
            layer_entries(root, layer, machine)?.extend(map.clone());
        }
        Ok(true)
    })?;
    out.line(format!(
        "Imported {} into {}",
        file.display(),
        machine.display()
    ));
    warn_not_honoured(out, entries(&incoming));
    Ok(())
}

fn export(path: &Path, out: &mut Output) -> Result<(), CliError> {
    let root = match read_text(path)? {
        None => Value::Object(empty_root()),
        Some(t) => serde_json::from_str(&t).map_err(|_| unusable(path, "is not valid JSON"))?,
    };
    out.json(&root);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{capture, capture_split, captured};
    use crate::cli_state::{mirror, pending};
    use crate::policy::test_probes::*;

    fn run(cmd: PolicyCmd, path: &Path, out: &mut Output) -> Result<(), CliError> {
        super::run(cmd, Some(path), out)
    }

    fn set_all(
        key: &str,
        value: Option<&str>,
        defaults: bool,
        (min, max): (Option<f64>, Option<f64>),
        allow: &[&str],
    ) -> PolicyCmd {
        PolicyCmd::Set {
            key: key.into(),
            value: value.map(Into::into),
            defaults,
            min,
            max,
            allow: allow.iter().map(|a| a.to_string()).collect(),
        }
    }

    fn set_cmd(key: &str, value: Option<&str>, defaults: bool) -> PolicyCmd {
        set_all(key, value, defaults, (None, None), &[])
    }

    fn range_cmd(key: &str, min: Option<f64>, max: Option<f64>, allow: &[&str]) -> PolicyCmd {
        set_all(key, None, false, (min, max), allow)
    }

    fn out() -> Output {
        Output::with_sink(false, true, Box::new(std::io::sink()))
    }

    fn unset(path: &Path, key: &str) -> Result<(), CliError> {
        run(
            PolicyCmd::Unset {
                key: key.into(),
                defaults: false,
            },
            path,
            &mut out(),
        )
    }

    fn set(path: &Path, key: &str, value: &str, defaults: bool) -> Result<(), CliError> {
        run(set_cmd(key, Some(value), defaults), path, &mut out())
    }

    fn read(path: &Path) -> PolicyDoc {
        policy::parse(&std::fs::read_to_string(path).unwrap()).0
    }

    #[test]
    fn set_then_show_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "server.url", "https://x", false).unwrap();
        set(&path, "appSettings.toggles.cursor-blink", "false", true).unwrap();
        let doc = read(&path);
        assert_eq!(doc.policy["server.url"], Value::from("https://x"));
        assert_eq!(
            doc.defaults["appSettings.toggles.cursor-blink"],
            Value::Bool(false)
        );
        assert_eq!(doc.policy.len(), 1);
        assert_eq!(doc.defaults.len(), 1);
        let (mut sink, buf) = capture(false);
        show(&path, None, &mut sink).unwrap();
        assert!(captured(&buf).contains("server.url"));
    }

    #[test]
    fn set_unknown_key_suggests() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        match set(&path, "server.ur", "https://x", false) {
            Err(CliError::Validation(issues)) => assert!(issues[0].message.contains("server.url")),
            other => panic!("expected validation error, got {other:?}"),
        }
        assert!(!path.exists());
    }

    #[test]
    fn set_bad_value_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let err = set(&path, "sshConfig.import", "maybe", false).unwrap_err();
        assert_eq!(err.exit_code(), 3);
        assert!(!path.exists());
    }

    #[test]
    fn denied_while_elevated_blames_a_holder_not_missing_rights() {
        let denied = || std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let path = Path::new("/etc/voltius/policy.json");
        let held = io_error_as(true, path, Access::Write, denied());
        assert_eq!(held.exit_code(), 4);
        assert!(held.to_string().contains("held open"), "{held}");
        assert!(!held.to_string().contains("needs root"));
        let user = io_error_as(false, path, Access::Write, denied());
        assert!(user.to_string().contains("needs root"), "{user}");
    }

    #[cfg(unix)]
    #[test]
    fn set_without_permission_exits_4() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("ro");
        std::fs::create_dir(&sub).unwrap();
        std::fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o555)).unwrap();
        if std::fs::write(sub.join("probe"), b"").is_ok() {
            return;
        }
        let err = set(&sub.join("policy.json"), "server.url", "https://x", false).unwrap_err();
        assert!(matches!(err, CliError::Permission(Access::Write, _)));
        assert_eq!(err.exit_code(), 4);
    }

    #[test]
    fn import_is_all_or_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "server.url", "https://x", false).unwrap();
        let before = std::fs::read_to_string(&path).unwrap();
        let file = dir.path().join("in.json");
        std::fs::write(
            &file,
            r#"{"version":1,"policy":{"sshConfig.import":true,"nope.key":1}}"#,
        )
        .unwrap();
        let err = run(
            PolicyCmd::Import {
                file,
                replace: false,
            },
            &path,
            &mut out(),
        )
        .unwrap_err();
        assert!(matches!(err, CliError::Validation(_)));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
    }

    #[test]
    fn import_merges_valid_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "server.url", "https://x", false).unwrap();
        let file = dir.path().join("in.json");
        std::fs::write(&file, r#"{"version":1,"policy":{"sshConfig.import":true}}"#).unwrap();
        run(
            PolicyCmd::Import {
                file,
                replace: false,
            },
            &path,
            &mut out(),
        )
        .unwrap();
        assert_eq!(read(&path).policy.len(), 2);
    }

    #[test]
    fn check_reports_issues_exit_3() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("bad.json");
        std::fs::write(&file, r#"{"version":1,"policy":{"nope.key":1}}"#).unwrap();
        let err = run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 3);
    }

    #[test]
    fn check_clean_file_ok() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("good.json");
        std::fs::write(&file, r#"{"version":1,"policy":{"sshConfig.import":true}}"#).unwrap();
        run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap();
    }

    #[test]
    fn check_reports_unprotected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "sshConfig.import", "true", false).unwrap();
        for file in [None, Some(path.as_path())] {
            let err = check(file, &path, Some(all_unprotected), &mut out()).unwrap_err();
            assert_eq!(err.exit_code(), 3);
            assert!(unprotected_issue(&err).is_some());
        }
        check(None, &path, None, &mut out()).unwrap();
        let other = dir.path().join("other.json");
        std::fs::copy(&path, &other).unwrap();
        check(Some(&other), &path, Some(all_unprotected), &mut out()).unwrap();
    }

    fn unprotected_issue(err: &CliError) -> Option<&Issue> {
        let CliError::Validation(issues) = err else {
            return None;
        };
        issues.iter().find(|i| i.kind == IssueKind::Unprotected)
    }

    const PLANTED: &str = r#"{"version":1,"policy":{"server.url":"https://evil.example"}}"#;

    fn planted() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, PLANTED).unwrap();
        (dir, path)
    }

    fn insert_key(root: &mut Raw) -> Result<bool, CliError> {
        root.insert("policy".into(), json!({ "sshConfig.import": true }));
        Ok(true)
    }

    #[test]
    fn writers_never_adopt_an_unprotected_file() {
        let (_dir, path) = planted();
        for probe in [all_unprotected as policy::Probe, file_unprotected] {
            let err =
                edit_raw_with(&path, Some(acl(probe)), false, &mut out(), insert_key).unwrap_err();
            assert_eq!(err.exit_code(), 3);
            let message = &unprotected_issue(&err).unwrap().message;
            assert!(
                message.contains("was writable by standard users"),
                "{message}"
            );
            assert!(message.contains("policy import --replace"), "{message}");
            assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
        }
        edit_raw_with(
            &path,
            Some(acl(dir_unprotected)),
            false,
            &mut out(),
            insert_key,
        )
        .unwrap();
    }

    #[test]
    fn import_replace_writes_exactly_the_reviewed_file() {
        let (dir, path) = planted();
        let file = dir.path().join("reviewed.json");
        std::fs::write(
            &file,
            r#"{"version":1,"defaults":{"sshConfig.import":true}}"#,
        )
        .unwrap();
        let unprotected = Some(acl(file_unprotected));
        let err = import(&file, &path, unprotected, false, &mut out()).unwrap_err();
        assert!(unprotected_issue(&err).is_some());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
        import(&file, &path, unprotected, true, &mut out()).unwrap();
        let doc = read(&path);
        assert!(doc.policy.is_empty(), "{:?}", doc.policy);
        assert_eq!(doc.defaults["sshConfig.import"], Value::Bool(true));
        assert_eq!(calls(), ["harden_dir", "write", "adopt_written"]);
    }

    #[test]
    fn a_file_appearing_after_the_first_check_is_refused() {
        let (_dir, path) = planted();
        let err = edit_raw_with(
            &path,
            Some(acl(appears_after_first_probe)),
            false,
            &mut out(),
            insert_key,
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 3, "{err}");
        assert!(unprotected_issue(&err).is_some());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
        assert_eq!(calls(), ["harden_dir"]);
    }

    #[test]
    fn replace_never_adopts_the_old_file_even_if_the_write_fails() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("planted"), PLANTED).unwrap();
        let err = edit_raw_with(
            &path,
            Some(acl(file_unprotected)),
            true,
            &mut out(),
            insert_key,
        )
        .unwrap_err();
        assert!(matches!(err, CliError::Io(_)), "{err:?}");
        assert_eq!(calls(), ["harden_dir", "write"]);
    }

    #[test]
    fn links_are_refused_with_exit_4() {
        let (_dir, path) = planted();
        for probe in [file_link as policy::Probe, dir_link_no_file] {
            let err =
                edit_raw_with(&path, Some(acl(probe)), true, &mut out(), insert_key).unwrap_err();
            assert_eq!(err.exit_code(), 4);
            assert!(
                err.to_string()
                    .contains("is a link; delete it and run again"),
                "{err}"
            );
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
    }

    #[test]
    fn writers_keep_the_content_of_the_checked_handle_not_the_path() {
        let (_dir, path) = planted();
        edit_raw_with(
            &path,
            Some(acl(all_protected)),
            false,
            &mut out(),
            add_default,
        )
        .unwrap();
        let doc = read(&path);
        assert_eq!(doc.policy["server.url"], json!("https://checked.example"));
        assert_eq!(doc.defaults["sshConfig.import"], json!(true));
        assert_eq!(calls(), ["harden_dir", "write", "adopt_written"]);
    }

    #[test]
    fn writers_refuse_a_hard_linked_policy_file() {
        let (_dir, path) = planted();
        for replace in [false, true] {
            let err = edit_raw_with(
                &path,
                Some(acl(hard_linked_protected)),
                replace,
                &mut out(),
                insert_key,
            )
            .unwrap_err();
            assert_eq!(err.exit_code(), 4);
            assert!(err.to_string().contains("is a link"), "{err}");
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
    }

    fn add_default(root: &mut Raw) -> Result<bool, CliError> {
        layer_entries(root, Layer::Defaults, Path::new("policy.json"))?
            .insert("sshConfig.import".into(), json!(true));
        Ok(true)
    }

    #[test]
    fn a_replaced_folder_never_contributes_its_old_file() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("Voltius");
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("policy.json");
        std::fs::write(&path, PLANTED).unwrap();
        let replacing = policy::MachineAcl {
            harden_dir: harden_replacing,
            ..acl(on_disk)
        };
        let (mut o, _, err) = capture_split(false, false);
        edit_raw_with(&path, Some(replacing), false, &mut o, add_default).unwrap();
        let doc = read(&path);
        assert!(doc.policy.is_empty(), "{:?}", doc.policy);
        assert_eq!(doc.defaults["sshConfig.import"], json!(true));
        let aside_dir = policy::acl::untrusted_sibling(&dir, 1);
        assert_eq!(
            captured(&err).trim(),
            format!(
                "moved {} to {}; its contents were not kept",
                dir.display(),
                aside_dir.display()
            )
        );
        let aside = aside_dir.join("policy.json");
        assert_eq!(std::fs::read_to_string(aside).unwrap(), PLANTED);
        assert_eq!(calls(), ["harden_dir", "write", "adopt_written"]);
    }

    #[test]
    fn a_folder_that_cannot_be_replaced_exits_4() {
        let (dir, path) = planted();
        let held = policy::MachineAcl {
            harden_dir: harden_held,
            ..acl(all_protected)
        };
        let err = edit_raw_with(&path, Some(held), false, &mut out(), insert_key).unwrap_err();
        assert_eq!(err.exit_code(), 4, "{err}");
        let expected = format!(
            "{} is held open or not owned by Administrators; \
             close other programs or remove it, then run again",
            dir.path().display()
        );
        assert_eq!(err.to_string(), expected);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), PLANTED);
        assert!(calls().is_empty(), "{:?}", calls());
    }

    #[test]
    fn harden_access_denied_exits_4() {
        let (_dir, path) = planted();
        let denied = policy::MachineAcl {
            harden_dir: harden_denied,
            ..acl(all_protected)
        };
        let err = edit_raw_with(&path, Some(denied), false, &mut out(), insert_key).unwrap_err();
        assert!(matches!(err, CliError::Permission(Access::Write, _)));
    }

    #[test]
    fn unset_removes_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        set(&path, "server.url", "https://x", false).unwrap();
        run(
            PolicyCmd::Unset {
                key: "server.url".into(),
                defaults: false,
            },
            &path,
            &mut out(),
        )
        .unwrap();
        assert!(read(&path).policy.is_empty());
    }

    const HAND_WRITTEN: &str = r#"{"version":1,"policy":{"future.key":7,"server.allowOther":{"$range":[1,2]}},"defaults":{}}"#;

    #[test]
    fn set_keeps_unknown_and_range_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        set(&path, "server.url", "https://x", false).unwrap();
        let root: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(root["policy"]["future.key"], Value::from(7));
        assert!(root["policy"]["server.allowOther"].get("$range").is_some());
        assert_eq!(root["policy"]["server.url"], Value::from("https://x"));
    }

    #[test]
    fn unset_keeps_unrelated_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        set(&path, "server.url", "https://x", false).unwrap();
        unset(&path, "server.url").unwrap();
        let root: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(root["policy"]["future.key"], Value::from(7));
        assert!(root["policy"].get("server.url").is_none());
    }

    #[test]
    fn set_on_unusable_file_exits_3_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        for content in [
            "{not json",
            "[1]",
            r#"{"version":2,"policy":{}}"#,
            r#"{"version":"2","policy":{}}"#,
            r#"{"version":0,"policy":{}}"#,
            r#"{"version":1.5,"policy":{}}"#,
            r#"{"version":null,"policy":{}}"#,
        ] {
            std::fs::write(&path, content).unwrap();
            let err = set(&path, "server.url", "https://x", false).unwrap_err();
            assert_eq!(err.exit_code(), 3);
            assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        }
    }

    #[test]
    fn check_json_output_is_pure_json() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("good.json");
        std::fs::write(&file, r#"{"version":1,"policy":{"sshConfig.import":true}}"#).unwrap();
        let (mut sink, buf) = capture(true);
        run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut sink,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&captured(&buf)).unwrap();
        assert_eq!(v["issues"], serde_json::json!([]));
    }

    #[test]
    fn export_prints_file_as_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, HAND_WRITTEN).unwrap();
        let (mut sink, buf) = capture(true);
        run(PolicyCmd::Export, &path, &mut sink).unwrap();
        let v: Value = serde_json::from_str(&captured(&buf)).unwrap();
        assert_eq!(v["policy"]["future.key"], Value::from(7));
    }

    const CURSOR: &str = "appSettings.terminal.cursorStyle";
    const BLINK: &str = "appSettings.toggles.cursor-blink";

    fn user_dir(settings: Value, server: Value) -> tempfile::TempDir {
        user_dir_with_built_ins(settings, server, json!({}))
    }

    fn user_dir_with_built_ins(
        settings: Value,
        server: Value,
        built_ins: Value,
    ) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        mirror::write(
            dir.path(),
            &json!({
                "writtenAt": "2026-11-05T10:00:00Z", "appVersion": "1", "serverUrl": server,
                "plugins": [], "settings": settings, "builtIns": built_ins
            }),
        )
        .unwrap();
        dir
    }

    fn show_json(path: &Path, dir: Option<&Path>) -> Value {
        let (mut sink, buf) = capture(true);
        show(path, dir, &mut sink).unwrap();
        serde_json::from_str(&captured(&buf)).unwrap()
    }

    fn source_of(v: &Value, key: &str) -> Value {
        v["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["key"] == key)
            .map_or(Value::Null, |e| e["source"].clone())
    }

    fn machine(dir: &Path, policy: Value, defaults: Value) -> PathBuf {
        let path = dir.join("policy.json");
        std::fs::write(
            &path,
            json!({"version":1,"policy":policy,"defaults":defaults}).to_string(),
        )
        .unwrap();
        path
    }

    #[test]
    fn show_merges_sources_in_precedence() {
        let user = user_dir(
            json!({ CURSOR: "bar", BLINK: true, "appSettings.fontSize": 14 }),
            json!("https://app"),
        );
        let m = tempfile::tempdir().unwrap();
        let path = machine(
            m.path(),
            json!({ CURSOR: "block", "server.url": "https://locked" }),
            json!({ BLINK: false }),
        );
        let v = show_json(&path, Some(user.path()));
        assert_eq!(source_of(&v, CURSOR), "machine policy");
        assert_eq!(source_of(&v, "server.url"), "machine policy");
        assert_eq!(source_of(&v, BLINK), "app");
        assert_eq!(source_of(&v, "appSettings.fontSize"), "app");
        let cursor = v["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["key"] == CURSOR)
            .unwrap();
        assert_eq!(cursor["value"], "block");
        assert_eq!(v["mirrorAsOf"], "2026-11-05T10:00:00Z");
    }

    #[test]
    fn show_marks_pending() {
        let user = user_dir(json!({ CURSOR: "bar" }), Value::Null);
        pending::append(
            user.path(),
            pending::Change::Setting {
                key: CURSOR.into(),
                value: json!("underline"),
            },
        )
        .unwrap();
        pending::append(
            user.path(),
            pending::Change::Server {
                url: "https://queued".into(),
            },
        )
        .unwrap();
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({}));
        let v = show_json(&path, Some(user.path()));
        assert_eq!(source_of(&v, CURSOR), "pending");
        assert_eq!(source_of(&v, "server.url"), "pending");
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        assert!(captured(&buf).contains("underline"));
    }

    fn entry<'a>(v: &'a Value, key: &str) -> &'a Value {
        v["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["key"] == key)
            .unwrap()
    }

    #[test]
    fn show_user_value_beats_default_with_note() {
        let user = user_dir(json!({ BLINK: true }), Value::Null);
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({ BLINK: false }));
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        assert!(captured(&buf).contains("(app, machine default: false)"));
        let v = show_json(&path, Some(user.path()));
        let e = entry(&v, BLINK);
        assert_eq!(e["source"], "app");
        assert_eq!(e["value"], true);
        assert_eq!(e["defaultValue"], false);
        assert!(e.get("userValue").is_none());
    }

    #[test]
    fn show_pending_overrides_default() {
        let user = user_dir(json!({ BLINK: false }), Value::Null);
        pending::append(
            user.path(),
            pending::Change::Setting {
                key: BLINK.into(),
                value: json!(true),
            },
        )
        .unwrap();
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({ BLINK: false }));
        let v = show_json(&path, Some(user.path()));
        let e = entry(&v, BLINK);
        assert_eq!(e["source"], "pending");
        assert_eq!(e["value"], true);
        assert_eq!(e["defaultValue"], false);
    }

    #[test]
    fn show_user_value_equal_to_default_is_machine_default() {
        let user = user_dir(json!({ BLINK: false }), Value::Null);
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({ BLINK: false }));
        let v = show_json(&path, Some(user.path()));
        let e = entry(&v, BLINK);
        assert_eq!(e["source"], "machine default");
        assert!(e.get("defaultValue").is_none());
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        assert!(!captured(&buf).contains("machine default: "));
    }

    #[test]
    fn show_omits_app_values_at_built_in() {
        let user = user_dir_with_built_ins(
            json!({ CURSOR: "block", BLINK: false }),
            Value::Null,
            json!({ CURSOR: "block", BLINK: true }),
        );
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({}));
        let v = show_json(&path, Some(user.path()));
        assert_eq!(source_of(&v, CURSOR), Value::Null);
        assert_eq!(source_of(&v, BLINK), "app");
    }

    #[test]
    fn machine_default_beats_a_built_in_app_value() {
        let user = user_dir_with_built_ins(
            json!({ CURSOR: "block" }),
            Value::Null,
            json!({ CURSOR: "block" }),
        );
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({}), json!({ CURSOR: "bar" }));
        let e = entry(&show_json(&path, Some(user.path())), CURSOR).clone();
        assert_eq!(e["source"], "machine default");
        assert_eq!(e["value"], "bar");
        assert!(e.get("defaultValue").is_none());
    }

    #[test]
    fn show_as_system_skips_user_values() {
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({ CURSOR: "block" }), json!({}));
        let v = show_json(&path, None);
        assert_eq!(v["entries"].as_array().unwrap().len(), 1);
        assert_eq!(v["mirrorAsOf"], Value::Null);
        let (mut sink, buf) = capture(false);
        show(&path, None, &mut sink).unwrap();
        assert!(captured(&buf).contains("user values not shown when run as root"));
    }

    #[test]
    fn show_json_shape() {
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({ "nope.key": 1 }), json!({}));
        let v = show_json(&path, None);
        assert!(v["path"].is_string());
        assert!(v["entries"].is_array());
        assert_eq!(v["issues"].as_array().unwrap().len(), 1);
        assert!(v.get("mirrorAsOf").is_some());
    }

    fn set_with(out: &mut Output, path: &Path, key: &str, value: &str) {
        run(set_cmd(key, Some(value), false), path, out).unwrap();
    }

    #[test]
    fn set_enforced_locale_no_warning() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, stdout, stderr) = capture_split(false, false);
        set_with(&mut sink, &path, "appSettings.locale", "fr");
        assert_eq!(captured(&stderr), "");
        assert!(!captured(&stdout).contains("does not enforce"));
        assert_eq!(read(&path).policy["appSettings.locale"], Value::from("fr"));
    }

    #[test]
    fn set_enforced_key_no_warning() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, _, stderr) = capture_split(false, false);
        set_with(&mut sink, &path, "server.url", "https://x");
        assert_eq!(captured(&stderr), "");
    }

    #[test]
    fn quiet_suppresses_warning() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, _, stderr) = capture_split(false, true);
        run(
            set_cmd("sshConfig.import", Some("true"), true),
            &path,
            &mut sink,
        )
        .unwrap();
        assert_eq!(captured(&stderr), "");
    }

    #[test]
    fn import_unapplied_default_warns_json_stdout_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let file = dir.path().join("in.json");
        std::fs::write(
            &file,
            r#"{"version":1,"defaults":{"sshConfig.import":true}}"#,
        )
        .unwrap();
        let (mut sink, stdout, stderr) = capture_split(true, false);
        run(
            PolicyCmd::Import {
                file,
                replace: false,
            },
            &path,
            &mut sink,
        )
        .unwrap();
        assert!(captured(&stderr).contains(NOT_APPLIED));
        assert!(!captured(&stdout).contains("does not apply"));
    }

    #[test]
    fn set_schemeless_server_url_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let err = set(&path, "server.url", "voltius.acme.com", false).unwrap_err();
        assert_eq!(err.exit_code(), 3);
        assert!(!path.exists());
        set(&path, "server.url", "https://voltius.acme.com", false).unwrap();
    }

    #[cfg(unix)]
    fn unreadable(dir: &Path, name: &str) -> Option<PathBuf> {
        use std::os::unix::fs::PermissionsExt;
        let file = dir.join(name);
        std::fs::write(&file, r#"{"version":1}"#).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o000)).unwrap();
        std::fs::read(&file).is_err().then_some(file)
    }

    #[cfg(unix)]
    #[test]
    fn check_unreadable_file_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let Some(file) = unreadable(dir.path(), "locked.json") else {
            return;
        };
        let err = run(
            PolicyCmd::Check {
                file: Some(file.clone()),
            },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 3);
        let CliError::Validation(issues) = err else {
            unreachable!()
        };
        assert_eq!(
            issues[0].message,
            format!("cannot read {}: permission denied", file.display())
        );
    }

    #[cfg(unix)]
    #[test]
    fn import_unreadable_source_says_reading() {
        let dir = tempfile::tempdir().unwrap();
        let Some(file) = unreadable(dir.path(), "in.json") else {
            return;
        };
        let err = run(
            PolicyCmd::Import {
                file: file.clone(),
                replace: false,
            },
            &dir.path().join("m.json"),
            &mut out(),
        )
        .unwrap_err();
        assert_eq!(err.exit_code(), 4);
        let text = err.to_string();
        assert!(text.starts_with("Reading "), "{text}");
        assert!(text.contains(file.to_str().unwrap()), "{text}");
    }

    const NOT_APPLIED: &str = "sshConfig.import is saved as a default but this version of Voltius does not apply defaults for it yet";

    #[test]
    fn set_defaults_for_unapplied_key_warns() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let (mut sink, _, stderr) = capture_split(false, false);
        run(
            set_cmd("sshConfig.import", Some("true"), true),
            &path,
            &mut sink,
        )
        .unwrap();
        assert!(captured(&stderr).contains(NOT_APPLIED));
        let (mut sink, _, stderr) = capture_split(false, false);
        run(
            set_cmd("appSettings.toggles.cursor-blink", Some("false"), true),
            &path,
            &mut sink,
        )
        .unwrap();
        assert_eq!(captured(&stderr), "");
    }

    #[test]
    fn check_json_lists_default_warnings() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("good.json");
        std::fs::write(
            &file,
            r#"{"version":1,"defaults":{"sshConfig.import":true,"server.url":"https://x"}}"#,
        )
        .unwrap();
        let (mut sink, stdout, _) = capture_split(true, false);
        run(
            PolicyCmd::Check { file: Some(file) },
            &dir.path().join("m.json"),
            &mut sink,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert_eq!(v["warnings"].as_array().unwrap().len(), 1);
        assert_eq!(v["warnings"][0]["layer"], "defaults");
        assert_eq!(v["warnings"][0]["message"], NOT_APPLIED);
    }

    #[test]
    fn path_prints_machine_path() {
        let (mut sink, stdout, _) = capture_split(true, false);
        run(
            PolicyCmd::Path,
            Path::new("/etc/voltius/policy.json"),
            &mut sink,
        )
        .unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert_eq!(v["path"], "/etc/voltius/policy.json");
        let (mut sink, stdout, _) = capture_split(true, false);
        super::run(PolicyCmd::Path, None, &mut sink).unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert_eq!(v["path"], Value::Null);
        let (mut sink, stdout, _) = capture_split(false, false);
        super::run(PolicyCmd::Path, None, &mut sink).unwrap();
        assert_eq!(captured(&stdout), "no machine policy on this platform\n");
    }

    #[test]
    fn policy_layer_warning_for_unenforced_key() {
        assert!(not_honoured_message(Layer::Policy, "appSettings.plugins.overrides").is_some());
        assert!(not_honoured_message(Layer::Policy, "appSettings.locale").is_none());
    }

    const TTL: &str = "appSettings.detachedTtlHours";
    const TTL_TOGGLE: &str = "appSettings.toggles.detached-session-ttl";
    const SHELL: &str = "appSettings.terminal.preferredShell";

    fn run_range(path: &Path, cmd: PolicyCmd) -> Result<(), CliError> {
        run(cmd, path, &mut out())
    }

    fn raw_policy(path: &Path) -> Value {
        let root: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        root["policy"].clone()
    }

    #[test]
    fn set_range_writes_wrapper() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        run_range(&path, range_cmd(TTL, None, Some(24.0), &[])).unwrap();
        assert_eq!(raw_policy(&path)[TTL], json!({"$range": {"max": 24}}));
        assert!(!std::fs::read_to_string(&path).unwrap().contains("24.0"));
    }

    #[test]
    fn set_range_and_value_is_usage_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let cmd = set_all(TTL, Some("12"), false, (None, Some(24.0)), &[]);
        let err = run_range(&path, cmd).unwrap_err();
        assert_eq!(err.exit_code(), 2);
        assert_eq!(
            err.to_string(),
            "give a value or --min/--max/--allow, not both"
        );
        let err = run_range(&path, set_cmd(TTL, None, false)).unwrap_err();
        assert_eq!(err.exit_code(), 2);
        assert!(!path.exists());
    }

    #[test]
    fn set_range_under_defaults_is_usage_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let cmd = set_all(TTL, None, true, (None, Some(24.0)), &[]);
        let err = run_range(&path, cmd).unwrap_err();
        assert_eq!(err.exit_code(), 2);
        assert_eq!(err.to_string(), "ranges belong under policy");
        assert!(!path.exists());
    }

    #[test]
    fn set_empty_range_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let err = run_range(&path, range_cmd(TTL, Some(25.0), Some(30.0), &[])).unwrap_err();
        assert_eq!(err.exit_code(), 3);
        assert_eq!(err.to_string(), format!("{TTL}: leaves no allowed value"));
        assert!(!path.exists());
    }

    #[test]
    fn set_allow_parses_numbers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        run_range(&path, range_cmd(TTL, None, None, &["6", "12"])).unwrap();
        assert_eq!(
            raw_policy(&path)[TTL],
            json!({"$range": {"allowed": [6, 12]}})
        );
    }

    #[test]
    fn set_non_finite_bound_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        for (min, max) in [
            (None, Some(f64::INFINITY)),
            (Some(f64::NEG_INFINITY), None),
            (Some(f64::NAN), None),
        ] {
            let err = run_range(&path, range_cmd(TTL, min, max, &[])).unwrap_err();
            assert_eq!(err.exit_code(), 3);
            assert!(err.to_string().contains("finite"), "{err}");
        }
        assert!(!path.exists());
    }

    #[test]
    fn set_bad_locale_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let err = set(&path, "appSettings.locale", "xx", false).unwrap_err();
        assert_eq!(err.exit_code(), 3);
        assert!(!path.exists());
    }

    #[test]
    fn set_overrides_under_policy_exits_3() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let key = "appSettings.plugins.overrides";
        let err = set(&path, key, "{}", false).unwrap_err();
        assert_eq!(err.exit_code(), 3);
        assert!(err.to_string().contains("cannot be locked"));
        assert!(!path.exists());
    }

    #[test]
    fn show_bounds_user_value_with_note() {
        let user = user_dir(json!({ TTL: 72 }), Value::Null);
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({ TTL: {"$range": {"max": 24}} }), json!({}));
        let v = show_json(&path, Some(user.path()));
        let e = entry(&v, TTL);
        assert_eq!(e["value"], 24);
        assert_eq!(e["userValue"], 72);
        assert_eq!(e["range"], json!({"max": 24}));
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        let text = captured(&buf);
        assert!(
            text.contains("machine policy range: max 24; user value 72 is outside it"),
            "{text}"
        );
    }

    // The shell row, the shell this machine would open, and the text output.
    fn shell_show(stored: &str, allowed: &[&str]) -> (Value, Value, String) {
        let shell = "appSettings.terminal.preferredShell";
        let user = user_dir(json!({ shell: stored }), Value::Null);
        let m = tempfile::tempdir().unwrap();
        let path = machine(
            m.path(),
            json!({ shell: {"$range": {"allowed": allowed}} }),
            json!({}),
        );
        let e = entry(&show_json(&path, Some(user.path())), shell).clone();
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        let detected = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(crate::commands::local::detected_shells());
        let opens = policy::pick_shell(&detected, allowed, Some(stored));
        (e, json!(opens.map(|s| &s.path)), captured(&buf))
    }

    #[test]
    fn show_keeps_an_allowed_shell_path_under_a_name_list() {
        let (e, opens, text) = shell_show("/bin/zsh", &["fish", "zsh"]);
        assert_eq!(e["value"], opens);
        assert_eq!(e["source"], "app");
        assert!(e.get("userValue").is_none());
        assert!(!text.contains("outside it"));
    }

    #[test]
    fn show_prints_the_shell_that_opens_for_an_out_of_range_value() {
        let (e, opens, _) = shell_show("/no/such/fish", &["bash"]);
        assert_eq!(e["value"], opens);
        assert_eq!(e["userValue"], "/no/such/fish");
    }

    #[test]
    fn show_range_inside_keeps_user_value() {
        let user = user_dir(json!({ TTL: 12 }), Value::Null);
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({ TTL: {"$range": {"max": 24}} }), json!({}));
        let v = show_json(&path, Some(user.path()));
        let e = entry(&v, TTL);
        assert_eq!(e["value"], 12);
        assert_eq!(e["source"], "app");
        assert_eq!(e["range"], json!({"max": 24}));
        assert!(e.get("userValue").is_none());
        let (mut sink, buf) = capture(false);
        show(&path, Some(user.path()), &mut sink).unwrap();
        assert!(captured(&buf).contains("app, machine policy range: max 24"));
    }

    #[test]
    fn range_text_formats() {
        let r = |v: Value| policy::range_of(&json!({"$range": v})).unwrap();
        assert_eq!(range_text(&r(json!({"max": 24}))), "max 24");
        assert_eq!(
            range_text(&r(json!({"min": 5000.0, "max": 30000}))),
            "min 5000, max 30000"
        );
        assert_eq!(
            range_text(&r(json!({"allowed": ["en", "fr"]}))),
            "allowed en, fr"
        );
    }

    #[test]
    fn show_implied_toggle_forced_on() {
        let m = tempfile::tempdir().unwrap();
        let path = machine(m.path(), json!({ TTL: {"$range": {"max": 24}} }), json!({}));
        let (mut sink, buf) = capture(false);
        show(&path, None, &mut sink).unwrap();
        let text = captured(&buf);
        assert!(text.contains(&format!("{TTL_TOGGLE} = true ")), "{text}");
        assert!(
            text.contains(&format!("machine policy, forced on by {TTL}")),
            "{text}"
        );
    }

    fn shells(names: &[(&str, &str)]) -> Vec<crate::commands::local::ShellOption> {
        names
            .iter()
            .map(|(name, path)| crate::commands::local::ShellOption {
                name: name.to_string(),
                path: path.to_string(),
            })
            .collect()
    }

    #[test]
    fn shell_warnings_follow_matching_rule() {
        let found = shells(&[("zsh", "/bin/zsh"), ("PowerShell", "/usr/bin/pwsh")]);
        let doc = |v: Value| {
            let m = tempfile::tempdir().unwrap();
            policy::load_from(&machine(m.path(), json!({ SHELL: v }), json!({}))).doc
        };
        assert!(shell_warnings(&doc(json!("/bin/zsh")), &found).is_empty());
        assert!(shell_warnings(&doc(json!("ZSH")), &found).is_empty());
        assert_eq!(
            shell_warnings(&doc(json!("fish")), &found),
            vec!["locked shell fish not found; new terminals use the system default"]
        );
        assert!(shell_warnings(
            &doc(json!({"$range": {"allowed": ["bash", "zsh"]}})),
            &found
        )
        .is_empty());
        assert_eq!(
            shell_warnings(
                &doc(json!({"$range": {"allowed": ["bash", "fish"]}})),
                &found
            ),
            vec!["none of the allowed shells is installed; new terminals use the system default"]
        );
    }

    #[test]
    fn check_reports_conflict_warning() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("c.json");
        std::fs::write(
            &file,
            json!({"version":1,"policy":{TTL: {"$range": {"max": 24}}, TTL_TOGGLE: false}})
                .to_string(),
        )
        .unwrap();
        let machine = dir.path().join("none.json");
        let (mut sink, _, stderr) = capture_split(false, false);
        check(Some(&file), &machine, None, &mut sink).unwrap();
        assert!(captured(&stderr).contains(&format!(
            "{TTL_TOGGLE} is locked off but {TTL} forces it on; {TTL} wins"
        )));
        let (mut sink, stdout, _) = capture_split(true, false);
        check(Some(&file), &machine, None, &mut sink).unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert!(v["warnings"][0]["message"]
            .as_str()
            .unwrap()
            .contains("forces it on"));
        assert_eq!(v["warnings"][0]["key"], TTL_TOGGLE);
    }

    #[test]
    fn check_conflict_is_a_warning() {
        let message = "set by the configuration profile; the value in policy.json is ignored";
        let unknown = Issue::keyed(
            IssueKind::UnknownKey,
            Some(Layer::Policy),
            "x",
            "bad".into(),
        );
        let (issues, warnings) = split_conflicts(vec![
            Issue::keyed(
                IssueKind::Conflict,
                Some(Layer::Policy),
                "server.url",
                message.into(),
            ),
            unknown.clone(),
        ]);
        assert_eq!(issues, vec![unknown]);
        assert_eq!(
            warnings,
            vec![json!({
                "layer": "policy",
                "key": "server.url",
                "message": format!("policy.server.url: {message}"),
            })]
        );
    }

    #[test]
    fn check_explicit_file_ignores_profile() {
        let dir = tempfile::tempdir().unwrap();
        let machine = machine(dir.path(), json!({}), json!({}));
        let other = dir.path().join("other.json");
        std::fs::write(
            &other,
            r#"{"version":1,"policy":{"sshConfig.import":true}}"#,
        )
        .unwrap();
        let (mut sink, stdout, _) = capture_split(true, false);
        check(Some(&other), &machine, None, &mut sink).unwrap();
        let v: Value = serde_json::from_str(&captured(&stdout)).unwrap();
        assert_eq!(v["path"], other.display().to_string());
    }

    fn layered(policy: Value, defaults: Value) -> PolicyDoc {
        serde_json::from_value(json!({"version": 1, "policy": policy, "defaults": defaults}))
            .unwrap()
    }

    #[test]
    fn shadowed_warns_only_for_touched_keys() {
        let lines = shadowed(
            &layered(json!({"a": 1, "b": 2}), json!({})),
            &layered(json!({"a": 1}), json!({})),
            &layered(json!({"a": 9, "b": 3}), json!({})),
        );
        assert_eq!(
            lines,
            vec!["the configuration profile sets policy.b; it wins over policy.json"]
        );
    }

    #[test]
    fn shadowed_ignores_other_layer() {
        let lines = shadowed(
            &layered(json!({}), json!({"b": 2})),
            &layered(json!({}), json!({})),
            &layered(json!({"b": 3}), json!({})),
        );
        assert!(lines.is_empty());
    }

    #[test]
    fn shadowed_ignores_same_value() {
        let lines = shadowed(
            &layered(json!({"b": 3}), json!({})),
            &layered(json!({}), json!({})),
            &layered(json!({"b": 3}), json!({})),
        );
        assert!(lines.is_empty());
    }
}
