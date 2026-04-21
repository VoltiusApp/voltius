pub mod local;
pub mod remote;
pub mod stream;

#[derive(Debug, Clone, serde::Serialize)]
pub struct MetricsSnapshot {
    pub ts: u64,
    pub cpu_percent: f32,
    pub mem_used_kb: u64,
    pub mem_total_kb: u64,
    pub net_rx_bytes_per_sec: u64,
    pub net_tx_bytes_per_sec: u64,
    pub disks: Option<Vec<DiskInfo>>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiskInfo {
    pub mount: String,
    pub used_kb: u64,
    pub total_kb: u64,
}
