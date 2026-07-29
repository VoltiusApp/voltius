import { invoke } from "@tauri-apps/api/core";
import type { MetricsAPI, StreamsAPI } from "../api";

export function createMetricsAPI(streams: StreamsAPI): MetricsAPI {
  return {
    start: (sessionId, isRemote) => streams.start("metrics", { sessionId, isRemote }),
    stop: (streamId) => streams.stop(streamId),
    onSnapshot: (streamId, cb) => streams.on(streamId, cb),
    getSystemInfo: (sessionId, sessionType, sessionName) =>
      invoke("get_connected_system_info", { sessionId, sessionType, sessionName }),
  };
}
