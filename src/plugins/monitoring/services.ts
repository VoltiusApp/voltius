import type { MetricsAPI } from "@/plugins/api";
import type { MetricsSnapshot, SystemInfo } from "./types";

/** Adapts api.metrics to the same shape the components previously imported
 *  from @/services/metrics, so component/hook bodies barely change. */
export interface MetricsService {
  metricsStart(sessionId: string, isRemote: boolean): Promise<string>;
  metricsStop(streamId: string): Promise<void>;
  onMetricsSnapshot(
    streamId: string,
    cb: (snapshot: MetricsSnapshot) => void,
  ): Promise<() => void>;
  getSystemInfo(sessionId: string, sessionType: string, sessionName?: string): Promise<SystemInfo>;
}

export function createMetricsService(metrics: MetricsAPI): MetricsService {
  return {
    metricsStart: (sessionId, isRemote) => metrics.start(sessionId, isRemote),
    metricsStop: (streamId) => metrics.stop(streamId),
    onMetricsSnapshot: (streamId, cb) => metrics.onSnapshot(streamId, cb),
    getSystemInfo: (sessionId, sessionType, sessionName) =>
      metrics.getSystemInfo(sessionId, sessionType, sessionName) as Promise<SystemInfo>,
  };
}
