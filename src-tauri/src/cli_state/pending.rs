use crate::policy::write_text_atomic;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::io;
use std::path::Path;

pub const PENDING_FILE: &str = "cli-pending.json";

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Change {
    Setting {
        key: String,
        value: Value,
    },
    Server {
        url: String,
    },
    #[serde(rename_all = "camelCase")]
    Plugin {
        action: PluginAction,
        #[serde(rename = "pluginId")]
        id: String,
        #[serde(default)]
        consented_permissions: Vec<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum PluginAction {
    Install,
    Enable,
    Disable,
    Remove,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub at: String,
    #[serde(flatten)]
    pub change: Change,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone, PartialEq, Debug)]
pub struct PendingDoc {
    pub version: u32,
    pub changes: Vec<Entry>,
}

#[derive(Deserialize, Debug)]
pub struct Settled {
    pub id: String,
    pub error: Option<String>,
}

impl PluginAction {
    pub fn name(self) -> &'static str {
        match self {
            PluginAction::Install => "install",
            PluginAction::Enable => "enable",
            PluginAction::Disable => "disable",
            PluginAction::Remove => "remove",
        }
    }
}

impl Change {
    pub fn target(&self) -> String {
        match self {
            Change::Setting { key, .. } => format!("setting:{key}"),
            Change::Server { .. } => "server".into(),
            Change::Plugin { id, .. } => format!("plugin:{id}"),
        }
    }
}

impl PendingDoc {
    pub fn queued_values(&self) -> BTreeMap<String, (Value, String)> {
        let mut map = BTreeMap::new();
        for e in &self.changes {
            let (key, value) = match &e.change {
                Change::Setting { key, value } => (key.clone(), value.clone()),
                Change::Server { url } => ("server.url".to_string(), Value::from(url.as_str())),
                Change::Plugin { .. } => continue,
            };
            map.insert(key, (value, e.at.clone()));
        }
        map
    }
}

fn empty_doc() -> PendingDoc {
    PendingDoc {
        version: 1,
        changes: Vec::new(),
    }
}

pub fn load(dir: &Path) -> (PendingDoc, Option<String>) {
    let path = dir.join(PENDING_FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return (empty_doc(), None),
        Err(e) => {
            let warning = format!("cannot read {}: {e}", path.display());
            return (empty_doc(), Some(warning));
        }
    };
    match serde_json::from_str(&text) {
        Ok(doc) => (doc, None),
        Err(e) => {
            let warning = format!("ignoring unreadable {}: {e}", path.display());
            (empty_doc(), Some(warning))
        }
    }
}

fn with_lock<T>(dir: &Path, f: impl FnOnce(&mut PendingDoc) -> T) -> io::Result<T> {
    std::fs::create_dir_all(dir)?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(format!("{PENDING_FILE}.lock")))?;
    lock.lock()?;
    let (mut doc, warning) = load(dir);
    if let Some(w) = warning {
        log::warn!("{w}");
    }
    let out = f(&mut doc);
    let text = serde_json::to_string_pretty(&doc).map_err(io::Error::other)?;
    write_text_atomic(&dir.join(PENDING_FILE), &text)?;
    Ok(out)
}

pub fn append(dir: &Path, change: Change) -> io::Result<Entry> {
    with_lock(dir, |doc| {
        let target = change.target();
        doc.changes.retain(|e| e.change.target() != target);
        let entry = Entry {
            id: uuid::Uuid::new_v4().to_string(),
            at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            change,
            error: None,
        };
        doc.changes.push(entry.clone());
        entry
    })
}

pub fn settle(dir: &Path, results: &[Settled]) -> io::Result<()> {
    with_lock(dir, |doc| {
        doc.changes
            .retain(|e| !results.iter().any(|r| r.id == e.id && r.error.is_none()));
        for e in &mut doc.changes {
            if let Some(r) = results.iter().find(|r| r.id == e.id) {
                e.error = r.error.clone();
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn setting(k: &str, v: i64) -> Change {
        Change::Setting {
            key: k.into(),
            value: json!(v),
        }
    }

    fn plugin(action: PluginAction, id: &str) -> Change {
        Change::Plugin {
            action,
            id: id.into(),
            consented_permissions: vec![],
        }
    }

    #[test]
    fn append_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let e = append(dir.path(), setting("fontSize", 14)).unwrap();
        let (doc, warn) = load(dir.path());
        assert!(warn.is_none());
        assert_eq!(doc.version, 1);
        assert_eq!(doc.changes, vec![e.clone()]);
        assert_eq!(doc.changes[0].error, None);
        assert!(chrono::DateTime::parse_from_rfc3339(&e.at).is_ok());
    }

    #[test]
    fn entry_json_is_flat_and_tagged() {
        let dir = tempfile::tempdir().unwrap();
        append(dir.path(), plugin(PluginAction::Install, "plugin-docker")).unwrap();
        let text = std::fs::read_to_string(dir.path().join(PENDING_FILE)).unwrap();
        let raw: Value = serde_json::from_str(&text).unwrap();
        let e = &raw["changes"][0];
        assert_eq!(e["kind"], "plugin");
        assert_eq!(e["action"], "install");
        assert_eq!(e["pluginId"], "plugin-docker");
        assert_eq!(e["id"].as_str().map(str::len), Some(36));
        assert_eq!(e["consentedPermissions"], json!([]));
    }

    #[test]
    fn coalesces_same_target() {
        let dir = tempfile::tempdir().unwrap();
        append(dir.path(), setting("k", 1)).unwrap();
        append(dir.path(), setting("k", 2)).unwrap();
        append(dir.path(), plugin(PluginAction::Install, "p")).unwrap();
        append(dir.path(), plugin(PluginAction::Remove, "p")).unwrap();
        let (doc, _) = load(dir.path());
        assert_eq!(doc.changes.len(), 2);
        assert_eq!(doc.changes[0].change, setting("k", 2));
        assert_eq!(doc.changes[1].change, plugin(PluginAction::Remove, "p"));
    }

    #[test]
    fn settle_removes_ok_and_marks_failed() {
        let dir = tempfile::tempdir().unwrap();
        let a = append(dir.path(), setting("a", 1)).unwrap();
        let b = append(dir.path(), setting("b", 1)).unwrap();
        let results = [
            Settled {
                id: a.id,
                error: None,
            },
            Settled {
                id: b.id.clone(),
                error: Some("offline".into()),
            },
        ];
        settle(dir.path(), &results).unwrap();
        let (doc, _) = load(dir.path());
        assert_eq!(doc.changes.len(), 1);
        assert_eq!(doc.changes[0].id, b.id);
        assert_eq!(doc.changes[0].error.as_deref(), Some("offline"));
    }

    #[test]
    fn settle_keeps_entries_added_after_load() {
        let dir = tempfile::tempdir().unwrap();
        append(dir.path(), setting("a", 1)).unwrap();
        let (loaded, _) = load(dir.path());
        let c = append(dir.path(), setting("c", 1)).unwrap();
        let results: Vec<Settled> = loaded
            .changes
            .into_iter()
            .map(|e| Settled {
                id: e.id,
                error: None,
            })
            .collect();
        settle(dir.path(), &results).unwrap();
        let (doc, _) = load(dir.path());
        assert_eq!(doc.changes, vec![c]);
    }

    #[test]
    fn load_tolerates_garbage() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PENDING_FILE), "{not json").unwrap();
        let (doc, warn) = load(dir.path());
        assert!(doc.changes.is_empty());
        assert!(warn.unwrap().contains(PENDING_FILE));
        append(dir.path(), setting("k", 1)).unwrap();
        assert_eq!(load(dir.path()).0.changes.len(), 1);
    }

    #[test]
    fn targets() {
        assert_eq!(setting("k", 1).target(), "setting:k");
        assert_eq!(Change::Server { url: "u".into() }.target(), "server");
        assert_eq!(plugin(PluginAction::Enable, "p").target(), "plugin:p");
    }
}
