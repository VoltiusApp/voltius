import { invoke } from "@/lib/invoke";
import { listen } from "@tauri-apps/api/event";
import type { HostAPI, HostExecOptions, HostExecResult } from "../api";

export interface HostSessionTarget {
  isRemote: boolean;
  localShell: string | null;
}

const NOT_RUN: HostExecResult = { stdout: "", stderr: "", code: null, timedOut: false, truncated: false, cancelled: true };

interface Chunk {
  stream: "stdout" | "stderr";
  data: string;
}

/** `resolve` throws for a session that cannot run commands; `dispose` stops every running one. */
export function createHostAPI(
  resolve: (sessionId: string) => HostSessionTarget,
): HostAPI & { dispose(): void } {
  const running = new Set<string>();

  const run = async (
    execId: string,
    sessionId: string,
    command: string,
    stream: boolean,
    opts: HostExecOptions = {},
  ): Promise<HostExecResult> => {
    const target = resolve(sessionId);
    running.add(execId);
    try {
      return await invoke<HostExecResult>("host_exec", {
        request: {
          execId, sessionId, command, stream,
          isRemote: target.isRemote,
          localShell: target.localShell,
          stdin: opts.stdin ?? null,
          timeoutMs: opts.timeoutMs ?? null,
          maxBytes: opts.maxBytes ?? null,
        },
      });
    } finally {
      running.delete(execId);
    }
  };

  const cancel = (execId: string) => {
    if (running.has(execId)) void invoke("host_exec_cancel", { execId }).catch(() => {});
  };

  return {
    exec: (sessionId, command, opts) => run(crypto.randomUUID(), sessionId, command, false, opts),

    stream(sessionId, command, handlers, opts) {
      const execId = crypto.randomUUID();
      let cancelledEarly = false;
      // Listen before starting: a fast command's first lines would otherwise be lost.
      const done = listen<Chunk>(`host-exec:${execId}`, ({ payload }) => {
        if (payload.stream === "stdout") handlers.onStdout?.(payload.data);
        else handlers.onStderr?.(payload.data);
      }).then(async (unlisten) => {
        try {
          if (cancelledEarly) return NOT_RUN;
          return await run(execId, sessionId, command, true, opts);
        } finally {
          unlisten();
        }
      });
      return {
        done,
        cancel: () => {
          cancelledEarly = true;
          cancel(execId);
        },
      };
    },

    dispose() {
      for (const id of running) cancel(id);
      running.clear();
    },
  };
}
