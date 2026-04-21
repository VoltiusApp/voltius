export interface MetricsSnapshot {
  ts: number;
  cpu_percent: number;
  mem_used_kb: number;
  mem_total_kb: number;
  net_rx_bytes_per_sec: number;
  net_tx_bytes_per_sec: number;
  disks: DiskInfo[] | null;
}

export interface DiskInfo {
  mount: string;
  used_kb: number;
  total_kb: number;
}
