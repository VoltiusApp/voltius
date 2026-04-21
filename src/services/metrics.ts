import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MetricsSnapshot } from "@/plugins/monitoring/types";

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
