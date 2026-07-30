import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Mirrors src/plugins/monitoring/types.ts — kept as a separate host-side copy
// because TerminalStatusBar.tsx lives in the host bundle, not the plugin bundle,
// and has no access to the plugin's runtime-singleton PluginAPI.
export interface MetricsSnapshot {
  ts: number;
  cpu_percent: number;
  mem_used_kb: number;
  mem_total_kb: number;
  net_rx_bytes_per_sec: number;
  net_tx_bytes_per_sec: number;
  disks: { mount: string; used_kb: number; total_kb: number }[] | null;
}

export async function metricsStart(sessionId: string, isRemote: boolean): Promise<string> {
  return invoke("metrics_start", { sessionId, isRemote });
}

export async function metricsStop(streamId: string): Promise<void> {
  return invoke("metrics_stop", { streamId });
}

export function onMetricsSnapshot(
  streamId: string,
  cb: (snapshot: MetricsSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<MetricsSnapshot>(`metrics:snapshot:${streamId}`, ({ payload }) => cb(payload));
}
