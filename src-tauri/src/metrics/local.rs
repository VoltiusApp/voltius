use sysinfo::{Disks, Networks, System};
use super::{DiskInfo, MetricsSnapshot};

pub struct LocalMetrics {
    sys: System,
    networks: Networks,
    disks: Disks,
    disk_tick: u32,
    last_disks: Vec<DiskInfo>,
}

impl LocalMetrics {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let networks = Networks::new_with_refreshed_list();
        let disks = Disks::new_with_refreshed_list();
        let last_disks = collect_disks(&disks);
        Self { sys, networks, disks, disk_tick: 0, last_disks }
    }

    pub fn snapshot(&mut self) -> MetricsSnapshot {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.networks.refresh(false);

        let cpu_percent = self.sys.global_cpu_usage();
        let mem_used_kb = self.sys.used_memory() / 1024;
        let mem_total_kb = self.sys.total_memory() / 1024;

        let (net_rx, net_tx) = self.networks.iter().fold((0u64, 0u64), |(rx, tx), (_, n)| {
            (rx + n.received(), tx + n.transmitted())
        });

        self.disk_tick += 1;
        let disks = if self.disk_tick >= 10 {
            self.disk_tick = 0;
            self.disks.refresh(true);
            self.last_disks = collect_disks(&self.disks);
            Some(self.last_disks.clone())
        } else {
            None
        };

        MetricsSnapshot {
            ts: now_ms(),
            cpu_percent,
            mem_used_kb,
            mem_total_kb,
            net_rx_bytes_per_sec: net_rx,
            net_tx_bytes_per_sec: net_tx,
            disks,
        }
    }
}

fn collect_disks(disks: &Disks) -> Vec<DiskInfo> {
    disks
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| DiskInfo {
            mount: d.mount_point().to_string_lossy().to_string(),
            used_kb: (d.total_space() - d.available_space()) / 1024,
            total_kb: d.total_space() / 1024,
        })
        .collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
