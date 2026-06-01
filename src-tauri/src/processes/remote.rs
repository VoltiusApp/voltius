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
        let mut buf = [0u8; 65536];
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
    // ps output: pid ppid pcpu rss user stat comm [rest ignored]
    let mut parts = line
        .splitn(8, char::is_whitespace)
        .filter(|s| !s.is_empty());

    let pid: u32 = parts.next()?.parse().ok()?;
    let ppid: u32 = parts.next()?.parse().unwrap_or(0);
    let cpu: f32 = parts.next()?.parse().unwrap_or(0.0);
    let rss_kb: u64 = parts.next()?.parse().unwrap_or(0);
    let user = parts.next()?.to_string();
    let stat = parts.next().unwrap_or("?").to_string();
    let name = parts.next().unwrap_or("?").to_string();

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
