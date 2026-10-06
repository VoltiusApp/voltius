use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LxcContainer {
    pub vmid: u32,
    pub name: String,
    pub status: String,
    pub mem_mb: u32,
    pub disk_gb: f64,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LxcSnapshot {
    pub name: String,
    pub timestamp: Option<String>,
    pub description: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LxcAction {
    Start,
    Stop,
    Restart,
}

/// Parse the output of `pct list`.
/// Real Proxmox output format: VMID  Status  Lock  Name
///   100  running        mycontainer
///   101  stopped        another
/// Lock column is empty for unlocked containers (no token emitted by split_whitespace).
pub fn parse_lxc_list(output: &str) -> Vec<LxcContainer> {
    let mut result = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("VMID") {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 3 {
            continue;
        }
        let Ok(vmid) = tokens[0].parse::<u32>() else {
            continue;
        };
        let status = tokens[1].to_string();
        // tokens[2] is either the lock word or the name; name is always last
        let Some(name) = tokens.last().map(|s| s.to_string()) else {
            continue;
        };
        result.push(LxcContainer {
            vmid,
            name,
            status,
            mem_mb: 0,
            disk_gb: 0.0,
            pid: 0,
        });
    }
    result
}

/// Parse `pvesh get /nodes/<node>/lxc --output-format json`, which unlike
/// `pct list` carries memory, disk and pid. None when it isn't that JSON.
pub fn parse_pvesh_lxc(output: &str) -> Option<Vec<LxcContainer>> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(output.trim()).ok()?;
    let num = |row: &serde_json::Value, key: &str| -> Option<u64> {
        match &row[key] {
            serde_json::Value::String(s) => s.parse().ok(),
            v => v.as_u64(),
        }
    };
    let mut result: Vec<LxcContainer> = rows
        .iter()
        .filter_map(|row| {
            let vmid = u32::try_from(num(row, "vmid")?).ok()?;
            Some(LxcContainer {
                vmid,
                name: row["name"]
                    .as_str()
                    .map_or_else(|| vmid.to_string(), str::to_string),
                status: row["status"].as_str()?.to_string(),
                mem_mb: u32::try_from(num(row, "mem").unwrap_or(0) / (1024 * 1024))
                    .unwrap_or(u32::MAX),
                disk_gb: num(row, "disk").unwrap_or(0) as f64 / (1024.0 * 1024.0 * 1024.0),
                pid: num(row, "pid")
                    .and_then(|p| u32::try_from(p).ok())
                    .unwrap_or(0),
            })
        })
        .collect();
    result.sort_by_key(|c| c.vmid);
    Some(result)
}

/// Strip `pct listsnapshot`'s tree decoration from the start of a line.
///
/// PVE has emitted two shapes; both must land on the bare name, because the parsed
/// name is what rollback/delete send back to the host:
///   `-snap1                                   (older)
///   `-> snap1                                 (PVE 9.x)
/// Snapshot names are `[A-Za-z][A-Za-z0-9_-]*`, so no real name can begin with any
/// of these characters and over-stripping is not a risk.
fn strip_tree_prefix(line: &str) -> &str {
    line.trim_start_matches(|c: char| {
        c.is_whitespace() || c == '`' || c == '-' || c == '\'' || c == '>'
    })
}

/// Parse the output of `pct listsnapshot <vmid>`.
/// Output is a tree with leading backtick/dash/arrow/space decoration:
///   `-> current                           You are here!
///   `-> snap1    2024-01-01 00:00:00  A description
///     `-> child  2024-01-02 00:00:00  Child snapshot
pub fn parse_lxc_snapshots(output: &str) -> Vec<LxcSnapshot> {
    let mut result = Vec::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if line.contains("You are here!") {
            let stripped = strip_tree_prefix(line);
            let name = stripped
                .split_whitespace()
                .next()
                .unwrap_or("current")
                .to_string();
            result.push(LxcSnapshot {
                name,
                timestamp: None,
                description: String::new(),
                is_current: true,
            });
            continue;
        }
        let stripped = strip_tree_prefix(line);
        let tokens: Vec<&str> = stripped.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }
        let name = tokens[0].to_string();
        // Detect timestamp: tokens[1] is YYYY-MM-DD (10 chars, contains '-')
        // and tokens[2] is HH:MM:SS (contains ':')
        let (timestamp, description) = if tokens.len() >= 3
            && tokens[1].len() == 10
            && tokens[1].contains('-')
            && tokens[2].contains(':')
        {
            let ts = format!("{} {}", tokens[1], tokens[2]);
            let desc = tokens[3..].join(" ");
            (Some(ts), desc)
        } else {
            (None, tokens[1..].join(" "))
        };
        result.push(LxcSnapshot {
            name,
            timestamp,
            description,
            is_current: false,
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // The shape of PVE's /nodes/{node}/lxc list: numbers are JSON numbers, a stopped
    // container reports mem 0 and no pid.
    const PVESH: &str = r#"[{"cpu":0.0021,"cpus":1,"disk":1162825728,"maxdisk":8350298112,"maxmem":536870912,"mem":42450944,"name":"pihole","pid":4242,"status":"running","type":"lxc","uptime":3600,"vmid":101},
{"cpu":0,"cpus":2,"disk":0,"maxdisk":17179869184,"maxmem":2147483648,"mem":0,"name":"test-debian","status":"stopped","type":"lxc","uptime":0,"vmid":"105"},
{"cpu":0.01,"cpus":1,"disk":0,"maxmem":1073741824,"mem":268435456,"status":"running","type":"lxc","vmid":100}]"#;

    #[test]
    fn parses_pvesh_lxc_memory_disk_pid_sorted_by_vmid() {
        let containers = parse_pvesh_lxc(PVESH).unwrap();
        assert_eq!(
            containers.iter().map(|c| c.vmid).collect::<Vec<_>>(),
            [100, 101, 105]
        );
        let pihole = &containers[1];
        assert_eq!(
            (
                pihole.name.as_str(),
                pihole.status.as_str(),
                pihole.mem_mb,
                pihole.pid
            ),
            ("pihole", "running", 40, 4242)
        );
        assert!((pihole.disk_gb - 1.083).abs() < 0.001);
        assert_eq!((containers[2].mem_mb, containers[2].pid), (0, 0));
        assert_eq!(
            (containers[0].name.as_str(), containers[0].mem_mb),
            ("100", 256)
        );
    }

    #[test]
    fn pvesh_output_that_is_not_its_json_is_none() {
        assert!(parse_pvesh_lxc("sh: 1: pvesh: not found").is_none());
        assert!(parse_pvesh_lxc("").is_none());
        assert_eq!(parse_pvesh_lxc("[]").unwrap().len(), 0);
    }

    #[test]
    fn parses_pct_list_running_and_stopped() {
        let output = "VMID       Status     Lock         Name\n\
                      100        running                 myct\n\
                      101        stopped                 stopped-ct\n";
        let containers = parse_lxc_list(output);
        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].vmid, 100);
        assert_eq!(containers[0].name, "myct");
        assert_eq!(containers[0].status, "running");
        assert_eq!(containers[1].vmid, 101);
        assert_eq!(containers[1].name, "stopped-ct");
        assert_eq!(containers[1].status, "stopped");
    }

    #[test]
    fn parses_pct_list_locked_container() {
        // When a container has a lock, it appears as a third token before the name
        let output = "VMID       Status     Lock         Name\n\
                      102        running    backup       myct-locked\n";
        let containers = parse_lxc_list(output);
        assert_eq!(containers.len(), 1);
        assert_eq!(containers[0].vmid, 102);
        assert_eq!(containers[0].name, "myct-locked");
        assert_eq!(containers[0].status, "running");
    }

    #[test]
    fn parses_pct_list_skips_header_and_empty() {
        let output =
            "\nVMID       Status     Lock         Name\n\n200        running                 ct2\n";
        let containers = parse_lxc_list(output);
        assert_eq!(containers.len(), 1);
        assert_eq!(containers[0].vmid, 200);
        assert_eq!(containers[0].status, "running");
    }

    #[test]
    fn parses_pct_listsnapshot() {
        let output = "`-current                                           You are here!\n\
                       `-snap1          2024-01-01 00:00:00  A description\n\
                         `-snap1-child  2024-01-02 12:30:00  Child snapshot\n";
        let snaps = parse_lxc_snapshots(output);
        assert_eq!(snaps.len(), 3);
        assert!(snaps[0].is_current);
        assert_eq!(snaps[0].name, "current");
        assert_eq!(snaps[1].name, "snap1");
        assert_eq!(snaps[1].timestamp.as_deref(), Some("2024-01-01 00:00:00"));
        assert_eq!(snaps[1].description, "A description");
        assert!(!snaps[1].is_current);
        assert_eq!(snaps[2].name, "snap1-child");
        assert_eq!(snaps[2].timestamp.as_deref(), Some("2024-01-02 12:30:00"));
        assert_eq!(snaps[2].description, "Child snapshot");
    }

    // Real `pct listsnapshot` output from PVE 9.0.9 — the arrow form. Getting the
    // name wrong here is silent: rollback/delete send a name that matches nothing
    // and the host reports no error (VoltiusApp/voltius#83).
    #[test]
    fn parses_pct_listsnapshot_arrow_tree_form() {
        let output = "`-> gatetest                    2026-07-30 19:37:22     voltius live gate\n \
                      `-> current                                             You are here!\n";
        let snaps = parse_lxc_snapshots(output);
        assert_eq!(snaps.len(), 2);
        assert_eq!(snaps[0].name, "gatetest");
        assert_eq!(snaps[0].timestamp.as_deref(), Some("2026-07-30 19:37:22"));
        assert_eq!(snaps[0].description, "voltius live gate");
        assert!(!snaps[0].is_current);
        assert!(snaps[1].is_current);
        assert_eq!(snaps[1].name, "current");
    }

    #[test]
    fn snapshot_name_never_keeps_tree_decoration() {
        let output = "`-> snap1  2024-01-01 00:00:00  d\n  `-> nested  2024-01-02 00:00:00  d\n";
        for snap in parse_lxc_snapshots(output) {
            assert!(
                !snap.name.contains('>') && !snap.name.contains('`') && !snap.name.is_empty(),
                "tree decoration leaked into snapshot name: {:?}",
                snap.name,
            );
        }
    }

    #[test]
    fn parses_snapshot_without_timestamp() {
        let output = "`-current  You are here!\n`-notime  just a description\n";
        let snaps = parse_lxc_snapshots(output);
        assert_eq!(snaps.len(), 2);
        assert!(snaps[0].is_current);
        assert_eq!(snaps[1].name, "notime");
        assert!(snaps[1].timestamp.is_none());
        assert_eq!(snaps[1].description, "just a description");
    }
}
