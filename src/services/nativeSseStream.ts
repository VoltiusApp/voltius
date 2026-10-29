import { invoke } from "@/lib/invoke";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { gatewayUnreachable, isGatewayStatus, UnreachableError } from "@/services/reachability";

export interface NativeSseEventNames {
  open: string;
  data: string;
  closed: string;
}

interface NativeSseOpenPayload {
  status: number;
}

interface NativeSseClosedPayload {
  error?: string | null;
}

export function getNativeSseEventNames(streamId: string): NativeSseEventNames {
  return {
    open: `http:sse:open:${streamId}`,
    data: `http:sse:data:${streamId}`,
    closed: `http:sse:closed:${streamId}`,
  };
}

export async function connectNativeSse(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  onOpen?: () => void,
): Promise<void> {
  const streamId = crypto.randomUUID();
  const events = getNativeSseEventNames(streamId);
  let unlistenOpen: UnlistenFn | null = null;
  let unlistenData: UnlistenFn | null = null;
  let unlistenClosed: UnlistenFn | null = null;
  let started = false;
  let status: number | undefined;
  const failure = (error: string): Error => {
    if (status === undefined) return new UnreachableError(error);
    return isGatewayStatus(status) ? gatewayUnreachable(status) : new Error(error);
  };

  const cleanup = async () => {
    unlistenOpen?.();
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
      listen<NativeSseOpenPayload>(events.open, ({ payload }) => {
        if (payload.status >= 200 && payload.status < 300) onOpen?.();
        else status = payload.status;
      }),
      listen<string>(events.data, ({ payload }) => onChunk(payload)),
      listen<NativeSseClosedPayload>(events.closed, ({ payload }) => {
        signal.removeEventListener("abort", abort);
        if (!payload.error) finish();
        else finish(failure(payload.error));
      }),
    ])
      .then(([openUnlisten, dataUnlisten, closedUnlisten]) => {
        unlistenOpen = openUnlisten;
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
          method: "GET",
          headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
          body: null,
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
