import type { ProcessesAPI } from "@/plugins/api";
import type { ProcessSnapshot } from "./types";

/** Adapts api.processes to the shape useProcessList expects, shared by the
 *  desktop panel and the mobile screen (both live in this plugin bundle now). */
export interface ProcessesService {
  processesStart(sessionId: string, isRemote: boolean): Promise<string>;
  processesStop(streamId: string): Promise<void>;
  onProcessesSnapshot(
    streamId: string,
    cb: (snapshot: ProcessSnapshot) => void,
  ): Promise<() => void>;
  processKill(sessionId: string, pid: number, isRemote: boolean, force: boolean): Promise<void>;
}

export function createProcessesService(processes: ProcessesAPI): ProcessesService {
  return {
    processesStart: (sessionId, isRemote) => processes.start(sessionId, isRemote),
    processesStop: (streamId) => processes.stop(streamId),
    onProcessesSnapshot: (streamId, cb) => processes.onSnapshot(streamId, cb),
    processKill: (sessionId, pid, isRemote, force) =>
      processes.kill(sessionId, pid, isRemote, force),
  };
}
