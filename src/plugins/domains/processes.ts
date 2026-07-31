import { invoke } from "@tauri-apps/api/core";
import type { ProcessesAPI, StreamsAPI } from "../api";

export function createProcessesAPI(streams: StreamsAPI): ProcessesAPI {
  return {
    start: (sessionId, isRemote) => streams.start("processes", { sessionId, isRemote }),
    stop: (streamId) => streams.stop(streamId),
    onSnapshot: (streamId, cb) => streams.on(streamId, cb),
    kill: (sessionId, pid, isRemote, force) =>
      invoke("process_kill", { sessionId, pid, isRemote, force }),
  };
}
