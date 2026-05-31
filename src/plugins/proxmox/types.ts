export interface LxcContainer {
  vmid: number;
  name: string;
  status: string;
  mem_mb: number;
  disk_gb: number;
  pid: number;
}

export interface LxcSnapshot {
  name: string;
  timestamp: string | null;
  description: string;
  is_current: boolean;
}

export type LxcAction = "start" | "stop" | "restart";

export type ProxmoxView = "containers" | "snapshots";

export interface ProxmoxState {
  view: ProxmoxView;
  containers: LxcContainer[];
  snapshots: LxcSnapshot[];
  selectedVmid: number | null;
  selectedVmName: string;
  loading: boolean;
  error: string | null;
  snapshotInput: string;
  snapshotInputDesc: string;
}
