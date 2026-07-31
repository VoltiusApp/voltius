import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { StreamsAPI, StreamKind } from "../api";

const KINDS: Record<StreamKind, { start: string; stop: string; event: string }> = {
  metrics: { start: "metrics_start", stop: "metrics_stop", event: "metrics:snapshot" },
  processes: { start: "processes_start", stop: "processes_stop", event: "processes:snapshot" },
  "docker-logs": {
    start: "docker_start_log_stream",
    stop: "docker_stop_log_stream",
    event: "docker:log",
  },
  "docker-stack-logs": {
    start: "docker_start_stack_log_stream",
    stop: "docker_stop_log_stream",
    event: "docker:log",
  },
};

export function createStreamsAPI(): StreamsAPI {
  const kindOf = new Map<string, StreamKind>();

  return {
    async start(kind, opts) {
      const streamId = await invoke<string>(KINDS[kind].start, opts);
      kindOf.set(streamId, kind);
      return streamId;
    },
    async stop(streamId) {
      const kind = kindOf.get(streamId);
      if (!kind) return;
      await invoke(KINDS[kind].stop, { streamId });
      kindOf.delete(streamId);
    },
    async on<T>(streamId: string, cb: (snapshot: T) => void) {
      const kind = kindOf.get(streamId);
      if (!kind) throw new Error(`unknown stream "${streamId}"`);
      const unlisten = await listen<T>(`${KINDS[kind].event}:${streamId}`, ({ payload }) =>
        cb(payload),
      );
      return () => unlisten();
    },
  };
}
