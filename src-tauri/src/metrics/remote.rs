use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::time::{timeout, Duration};

use super::{DiskInfo, MetricsSnapshot};

const METRICS_CMD: &str =
    "cat /proc/stat | head -1; \
     awk '/MemTotal|MemAvailable/{print}' /proc/meminfo; \
     awk 'NR>2{rx+=$2;tx+=$10}END{printf \"NET %d %d\\n\",rx,tx}' /proc/net/dev; \
     df -P / 2>/dev/null | awk 'NR==2{printf \"DISK %d %d %s\\n\",$2,$3,$6}'";

pub struct RemoteMetricsState {
    prev_cpu_idle: u64,
    prev_cpu_total: u64,
    prev_net_rx: u64,
    prev_net_tx: u64,
    disk_tick: u32,
    last_disks: Vec<DiskInfo>,
}

impl RemoteMetricsState {
    pub fn new() -> Self {
        Self {
            prev_cpu_idle: 0,
            prev_cpu_total: 0,
            prev_net_rx: 0,
            prev_net_tx: 0,
            disk_tick: 0,
            last_disks: vec![],
        }
    }

    pub async fn snapshot(
        &mut self,
        handle: &Arc<russh::client::Handle<crate::ssh::client::SshClient>>,
    ) -> Result<MetricsSnapshot, String> {
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("channel error: {e}"))?;

        channel
            .exec(true, METRICS_CMD)
            .await
            .map_err(|e| format!("exec error: {e}"))?;

        let mut stream = channel.into_stream();
        let mut output = Vec::new();

        let _ = timeout(Duration::from_secs(3), async {
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => output.extend_from_slice(&buf[..n]),
                }
            }
        })
        .await;

        let text = String::from_utf8_lossy(&output);
        self.parse(&text)
    }

    fn parse(&mut self, text: &str) -> Result<MetricsSnapshot, String> {
        let mut cpu_percent = 0.0f32;
        let mut mem_total_kb = 0u64;
        let mut mem_avail_kb = 0u64;
        let mut net_rx_per_sec = 0u64;
        let mut net_tx_per_sec = 0u64;

        for line in text.lines() {
            let line = line.trim();

            if line.starts_with("cpu") && line.chars().nth(3) == Some(' ') {
                let parts: Vec<u64> = line
                    .split_whitespace()
                    .skip(1)
                    .filter_map(|s| s.parse().ok())
                    .collect();
                if parts.len() >= 5 {
                    let idle = parts[3].saturating_add(*parts.get(4).unwrap_or(&0));
                    let total: u64 = parts.iter().sum();
                    let dt = total.saturating_sub(self.prev_cpu_total);
                    let di = idle.saturating_sub(self.prev_cpu_idle);
                    if dt > 0 {
                        cpu_percent = ((dt - di) as f32 / dt as f32 * 100.0).clamp(0.0, 100.0);
                    }
                    self.prev_cpu_total = total;
                    self.prev_cpu_idle = idle;
                }
            } else if line.starts_with("MemTotal:") {
                mem_total_kb = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            } else if line.starts_with("MemAvailable:") {
                mem_avail_kb = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            } else if line.starts_with("NET ") {
                let parts: Vec<u64> = line.split_whitespace().skip(1).filter_map(|s| s.parse().ok()).collect();
                if parts.len() >= 2 {
                    net_rx_per_sec = parts[0].saturating_sub(self.prev_net_rx);
                    net_tx_per_sec = parts[1].saturating_sub(self.prev_net_tx);
                    self.prev_net_rx = parts[0];
                    self.prev_net_tx = parts[1];
                }
            }
        }

        let mem_used_kb = mem_total_kb.saturating_sub(mem_avail_kb);

        self.disk_tick += 1;
        let disks = if self.disk_tick >= 10 {
            self.disk_tick = 0;
            for line in text.lines() {
                let line = line.trim();
                if line.starts_with("DISK ") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 4 {
                        let total_kb: u64 = parts[1].parse().unwrap_or(0);
                        let used_kb: u64 = parts[2].parse().unwrap_or(0);
                        self.last_disks = vec![DiskInfo {
                            mount: parts[3].to_string(),
                            used_kb,
                            total_kb,
                        }];
                    }
                }
            }
            Some(self.last_disks.clone())
        } else {
            None
        };

        Ok(MetricsSnapshot {
            ts: now_ms(),
            cpu_percent,
            mem_used_kb,
            mem_total_kb,
            net_rx_bytes_per_sec: net_rx_per_sec,
            net_tx_bytes_per_sec: net_tx_per_sec,
            disks,
        })
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
