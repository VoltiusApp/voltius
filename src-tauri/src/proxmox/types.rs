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

/// Parse the output of `pct listsnapshot <vmid>`.
/// Output is a tree with leading backtick/dash/space decoration:
///   `-current                             You are here!
///   `-snap1      2024-01-01 00:00:00  A description
///     `-child    2024-01-02 00:00:00  Child snapshot
pub fn parse_lxc_snapshots(output: &str) -> Vec<LxcSnapshot> {
    let mut result = Vec::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if line.contains("You are here!") {
            let stripped = line.trim_start_matches(|c: char| {
                c.is_whitespace() || c == '`' || c == '-' || c == '\''
            });
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
        let stripped = line
            .trim_start_matches(|c: char| c.is_whitespace() || c == '`' || c == '-' || c == '\'');
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
