use crate::policy::write_text_atomic;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::io;
use std::path::Path;

pub const MIRROR_FILE: &str = "cli-mirror.json";

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mirror {
    pub written_at: String,
    pub app_version: String,
    pub settings: BTreeMap<String, Value>,
    pub server_url: Option<String>,
    pub plugins: Vec<MirrorPlugin>,
    #[serde(default)]
    pub built_ins: BTreeMap<String, Value>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MirrorPlugin {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub origin: String,
    pub locked: Option<bool>,
}

impl Mirror {
    pub fn values(&self) -> BTreeMap<String, Value> {
        let mut map = self.settings.clone();
        if let Some(url) = &self.server_url {
            map.insert("server.url".into(), Value::from(url.as_str()));
        }
        map
    }
}

pub fn read(dir: &Path) -> Option<Mirror> {
    let text = std::fs::read_to_string(dir.join(MIRROR_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write(dir: &Path, mirror: &Value) -> io::Result<()> {
    let text = serde_json::to_string_pretty(mirror).map_err(io::Error::other)?;
    write_text_atomic(&dir.join(MIRROR_FILE), &text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn write_then_read() {
        let dir = tempfile::tempdir().unwrap();
        let doc = json!({
            "writtenAt": "2026-11-05T00:00:00Z",
            "appVersion": "0.56.0",
            "settings": {"fontSize": 14},
            "serverUrl": null,
            "plugins": [{"id": "plugin-docker", "version": "1.0.0", "enabled": true, "origin": "marketplace", "locked": null}],
        });
        write(dir.path(), &doc).unwrap();
        let m = read(dir.path()).unwrap();
        assert_eq!(m.app_version, "0.56.0");
        assert_eq!(m.settings["fontSize"], json!(14));
        assert_eq!(m.server_url, None);
        assert_eq!(m.plugins[0].id, "plugin-docker");
        assert!(m.built_ins.is_empty());
    }

    #[test]
    fn reads_built_ins() {
        let dir = tempfile::tempdir().unwrap();
        let doc = json!({
            "writtenAt": "t", "appVersion": "1", "settings": {}, "serverUrl": null, "plugins": [],
            "builtIns": {"appSettings.toggles.cursor-blink": true},
        });
        write(dir.path(), &doc).unwrap();
        let m = read(dir.path()).unwrap();
        assert_eq!(m.built_ins["appSettings.toggles.cursor-blink"], json!(true));
    }

    #[test]
    fn read_garbage_is_none() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(MIRROR_FILE), "{nope").unwrap();
        assert!(read(dir.path()).is_none());
        assert!(read(&dir.path().join("missing")).is_none());
    }
}
