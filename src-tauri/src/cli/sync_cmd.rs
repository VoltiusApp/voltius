use super::output::Output;
use super::{CliError, Ctx};
use crate::cli_state::mirror;
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;

#[derive(Subcommand, Debug)]
pub enum SyncCmd {
    /// Show the app's last cloud sync result for each of your other devices
    Status,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncReport {
    status: String,
    last_sync: Option<String>,
    error: Option<String>,
    devices: Vec<DeviceReport>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct DeviceReport {
    device_id: String,
    name: Option<String>,
    state: String,
    http_status: Option<u16>,
    remote_updated_at: String,
    synced_at: Option<String>,
    failed_at: Option<String>,
}

pub fn run(cmd: SyncCmd, ctx: &mut Ctx) -> Result<(), CliError> {
    run_sync(cmd, &crate::storage::config::config_dir_peek(), ctx.out)
}

fn run_sync(cmd: SyncCmd, dir: &Path, out: &mut Output) -> Result<(), CliError> {
    match cmd {
        SyncCmd::Status => status(dir, out),
    }
}

fn status(dir: &Path, out: &mut Output) -> Result<(), CliError> {
    let mirror = mirror::read(dir);
    let report = mirror
        .as_ref()
        .and_then(|m| m.sync.clone())
        .and_then(|v| serde_json::from_value::<SyncReport>(v).ok())
        .ok_or_else(|| {
            CliError::Refused("No sync result yet. Open Voltius and let it sync once.".into())
        })?;
    let as_of = mirror.map(|m| m.written_at).unwrap_or_default();
    if out.json {
        out.json(&json!({ "asOf": as_of, "sync": report }));
        return Ok(());
    }
    let last = report.last_sync.as_deref().unwrap_or("never");
    out.line(format!(
        "Cloud sync: {} (last sync {last}, recorded {as_of})",
        report.status
    ));
    if let Some(error) = &report.error {
        out.line(format!("  {error}"));
    }
    if report.devices.is_empty() {
        out.line("No other device has synced yet.");
    }
    for d in &report.devices {
        out.line(describe(d));
    }
    Ok(())
}

fn describe(d: &DeviceReport) -> String {
    let short: String = d.device_id.chars().take(8).collect();
    let name = d
        .name
        .as_deref()
        .map_or(short.clone(), |n| format!("{n} ({short})"));
    let state = match (d.state.as_str(), d.http_status) {
        ("unavailable", Some(code)) => format!("unavailable (HTTP {code})"),
        (s, _) => s.to_string(),
    };
    let read = match &d.synced_at {
        Some(at) => format!("last read {at}"),
        None => "never read".into(),
    };
    format!("  {name}: {state}, changed {}, {read}", d.remote_updated_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::testing::{capture, captured};
    use serde_json::{json, Value};

    fn mirror_with(dir: &Path, sync: Value) {
        let doc = json!({
            "writtenAt": "2026-11-13T10:00:00Z", "appVersion": "1", "settings": {}, "serverUrl": null, "plugins": [],
            "sync": sync,
        });
        mirror::write(dir, &doc).unwrap();
    }

    fn run(dir: &Path, json: bool) -> (Result<(), CliError>, String) {
        let (mut out, buf) = capture(json);
        let r = run_sync(SyncCmd::Status, dir, &mut out);
        (r, captured(&buf))
    }

    fn partial() -> Value {
        json!({
            "status": "partial", "lastSync": "2026-11-13T09:59:00Z", "error": "1 device couldn't be synced",
            "devices": [
                {"deviceId": "aaaaaaaa-1111", "name": "laptop", "state": "synced", "httpStatus": null,
                 "remoteUpdatedAt": "2026-11-13T09:00:00Z", "syncedAt": "2026-11-13T09:59:00Z", "failedAt": null},
                {"deviceId": "bbbbbbbb-2222", "name": null, "state": "unavailable", "httpStatus": 503,
                 "remoteUpdatedAt": "2026-11-12T08:00:00Z", "syncedAt": null, "failedAt": "2026-11-13T09:59:00Z"},
            ],
        })
    }

    #[test]
    fn prints_each_device() {
        let dir = tempfile::tempdir().unwrap();
        mirror_with(dir.path(), partial());
        let (r, out) = run(dir.path(), false);
        r.unwrap();
        assert!(out.contains("Cloud sync: partial"), "{out}");
        assert!(out.contains("1 device couldn't be synced"), "{out}");
        assert!(out.contains("laptop (aaaaaaaa): synced"), "{out}");
        assert!(out.contains("bbbbbbbb: unavailable (HTTP 503)"), "{out}");
        assert!(out.contains("never read"), "{out}");
    }

    #[test]
    fn json_keeps_the_report() {
        let dir = tempfile::tempdir().unwrap();
        mirror_with(dir.path(), partial());
        let (r, out) = run(dir.path(), true);
        r.unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["asOf"], "2026-11-13T10:00:00Z");
        assert_eq!(v["sync"]["status"], "partial");
        assert_eq!(v["sync"]["devices"][1]["httpStatus"], 503);
    }

    #[test]
    fn no_result_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            run(dir.path(), false).0,
            Err(CliError::Refused(_))
        ));
        mirror_with(dir.path(), Value::Null);
        assert!(matches!(
            run(dir.path(), false).0,
            Err(CliError::Refused(_))
        ));
    }

    #[test]
    fn a_bad_sync_section_leaves_the_mirror_readable() {
        let dir = tempfile::tempdir().unwrap();
        mirror_with(dir.path(), json!({"status": 7}));
        assert!(mirror::read(dir.path()).is_some());
        assert!(matches!(
            run(dir.path(), false).0,
            Err(CliError::Refused(_))
        ));
    }
}
