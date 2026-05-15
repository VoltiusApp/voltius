import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface NativeSseEventNames {
  data: string;
  closed: string;
}

interface NativeSseClosedPayload {
  error?: string | null;
}

export function getNativeSseEventNames(streamId: string): NativeSseEventNames {
  return {
    data: `http:sse:data:${streamId}`,
    closed: `http:sse:closed:${streamId}`,
  };
}

export async function connectNativeSse(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const streamId = crypto.randomUUID();
  const events = getNativeSseEventNames(streamId);
  let unlistenData: UnlistenFn | null = null;
  let unlistenClosed: UnlistenFn | null = null;
  let started = false;

  const cleanup = async () => {
    unlistenData?.();
    unlistenClosed?.();
    if (started) await invoke("http_sse_stop", { streamId }).catch(() => {});
  };

  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      cleanup().finally(() => {
        if (error) reject(error);
        else resolve();
      });
    };

    const abort = () => finish();
    signal.addEventListener("abort", abort, { once: true });

    Promise.all([
      listen<string>(events.data, ({ payload }) => onChunk(payload)),
      listen<NativeSseClosedPayload>(events.closed, ({ payload }) => {
        signal.removeEventListener("abort", abort);
        finish(payload.error ? new Error(payload.error) : undefined);
      }),
    ])
      .then(([dataUnlisten, closedUnlisten]) => {
        unlistenData = dataUnlisten;
        unlistenClosed = closedUnlisten;
        if (signal.aborted) {
          finish();
          return;
        }
        started = true;
        void invoke("http_sse_start", {
          streamId,
          url,
          headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
        }).catch((err) => {
          signal.removeEventListener("abort", abort);
          finish(err instanceof Error ? err : new Error(String(err)));
        });
      })
      .catch((err) => {
        signal.removeEventListener("abort", abort);
        finish(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
