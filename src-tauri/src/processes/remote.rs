use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::time::{timeout, Duration};

use super::{now_ms, ProcessEntry, ProcessSnapshot};

// Works on Linux and macOS: awk strips the header row, columns are positional.
// Fields: pid ppid pcpu rss user stat comm
const PS_CMD: &str = "ps -eo pid,ppid,pcpu,rss,user,stat,comm 2>/dev/null | awk 'NR>1{print}'";

const KILL_TIMEOUT_SECS: u64 = 5;

pub struct RemoteProcesses;

impl RemoteProcesses {
    pub async fn snapshot(
        handle: &Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
    ) -> Result<ProcessSnapshot, String> {
        let output = exec_remote(handle, PS_CMD, 10).await?;
        Ok(parse_snapshot(&output))
    }

    pub async fn kill(
        handle: &Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
        pid: u32,
        force: bool,
    ) -> Result<(), String> {
        let signal = if force { "-9" } else { "-15" };
        let cmd = format!("kill {signal} {pid} 2>&1; echo \"EXIT:$?\"");
        let output = exec_remote(handle, &cmd, KILL_TIMEOUT_SECS).await?;
        // Check exit code echoed at the end
        for line in output.lines() {
            if let Some(code) = line.strip_prefix("EXIT:") {
                if code.trim() == "0" {
                    return Ok(());
                } else {
                    return Err(format!("kill returned exit code {}", code.trim()));
                }
            }
        }
        Ok(())
    }
}

async fn exec_remote(
    handle: &Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
    cmd: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel error: {e}"))?;

    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("exec error: {e}"))?;

    let mut stream = channel.into_stream();
    let mut output = Vec::new();

    let _ = timeout(Duration::from_secs(timeout_secs), async {
        let mut buf = vec![0u8; 65536];
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => output.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await;

    Ok(String::from_utf8_lossy(&output).to_string())
}

fn parse_snapshot(text: &str) -> ProcessSnapshot {
    let mut entries: Vec<ProcessEntry> = text
        .lines()
        .filter_map(|line| parse_line(line.trim()))
        .collect();

    entries.sort_by(|a, b| {
        b.cpu_percent
            .partial_cmp(&a.cpu_percent)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    ProcessSnapshot {
        ts: now_ms(),
        entries,
    }
}

fn parse_line(line: &str) -> Option<ProcessEntry> {
    let fields: Vec<&str> = line.split_whitespace().collect();

    let pid: u32 = fields.first()?.parse().ok()?;
    let ppid: u32 = fields.get(1)?.parse().unwrap_or(0);
    let cpu: f32 = fields.get(2)?.parse().unwrap_or(0.0);
    let rss_kb: u64 = fields.get(3)?.parse().unwrap_or(0);
    let user = fields.get(4)?.to_string();
    let stat = fields.get(5)?.to_string();
    let name = if fields.len() >= 7 {
        fields[6..].join(" ")
    } else {
        "?".to_string()
    };

    Some(ProcessEntry {
        pid,
        ppid,
        name,
        command: String::new(), // ps -o comm only gives argv[0]; full cmdline needs /proc or procargs
        user,
        cpu_percent: cpu,
        mem_kb: rss_kb,
        status: stat_to_status(&stat),
    })
}

fn stat_to_status(stat: &str) -> String {
    match stat.chars().next() {
        Some('R') => "running",
        Some('S') => "sleeping",
        Some('D') => "waiting",
        Some('Z') => "zombie",
        Some('T') => "stopped",
        Some('I') => "idle",
        _ => "unknown",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "    1     0  0.0  9488 root     Ss   systemd
  734     1  0.3 45120 root     Ssl  containerd
 2811   734  0.0  1024 ubuntu   S    tmux: server
12345     1 12.5 204800 www-data R    nginx";

    #[test]
    fn parses_padded_columns() {
        let snap = parse_snapshot(SAMPLE);
        assert_eq!(snap.entries.len(), 4);

        // sorted by cpu desc: nginx(12.5), containerd(0.3), systemd(0.0), tmux(0.0)
        let nginx = &snap.entries[0];
        assert_eq!(nginx.pid, 12345);
        assert_eq!(nginx.ppid, 1);
        assert_eq!(nginx.cpu_percent, 12.5);
        assert_eq!(nginx.mem_kb, 204800);
        assert_eq!(nginx.user, "www-data");
        assert_eq!(nginx.status, "running");
        assert_eq!(nginx.name, "nginx");

        let containerd = &snap.entries[1];
        assert_eq!(containerd.pid, 734);
        assert_eq!(containerd.name, "containerd");

        let systemd = snap.entries.iter().find(|e| e.pid == 1).unwrap();
        assert_eq!(systemd.ppid, 0);
        assert_eq!(systemd.name, "systemd");
        assert_eq!(systemd.mem_kb, 9488);
    }

    #[test]
    fn preserves_comm_with_space() {
        let snap = parse_snapshot(SAMPLE);
        let tmux = snap.entries.iter().find(|e| e.pid == 2811).unwrap();
        assert_eq!(tmux.name, "tmux: server");
        assert_eq!(tmux.ppid, 734);
        assert_eq!(tmux.user, "ubuntu");
    }

    #[test]
    fn skips_garbage_and_blank_lines() {
        let input = "\n   \nnot a process line\n    1     0  0.0  9488 root     Ss   systemd";
        let snap = parse_snapshot(input);
        assert_eq!(snap.entries.len(), 1);
        assert_eq!(snap.entries[0].pid, 1);
    }

    #[test]
    fn missing_comm_falls_back_to_question_mark() {
        let entry = parse_line("42 1 0.0 512 root S").unwrap();
        assert_eq!(entry.name, "?");
        assert_eq!(entry.pid, 42);
    }

    #[test]
    fn sorts_by_cpu_descending() {
        let snap = parse_snapshot(SAMPLE);
        let cpus: Vec<f32> = snap.entries.iter().map(|e| e.cpu_percent).collect();
        for w in cpus.windows(2) {
            assert!(w[0] >= w[1]);
        }
    }
}
