import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface SseOpenPayload {
  status: number;
  headers: Array<{ name: string; value: string }>;
}
interface SseClosedPayload {
  error?: string | null;
}

/**
 * A `fetch`-shaped wrapper over the native SSE-over-events plumbing
 * (`http_sse_start`/`http_sse_stop`). Returns a Response whose body is a
 * ReadableStream fed by `http:sse:data` events. Built for injection as the
 * Vercel AI SDK's `fetch`. Non-2xx responses resolve (not reject) with the
 * real status + the error body, so the SDK can parse provider errors.
 */
export async function sseFetch(url: string, init?: RequestInit): Promise<Response> {
  const streamId = crypto.randomUUID();
  const encoder = new TextEncoder();
  const signal = init?.signal ?? undefined;

  let unlistenOpen: UnlistenFn | null = null;
  let unlistenData: UnlistenFn | null = null;
  let unlistenClosed: UnlistenFn | null = null;
  let started = false;

  const cleanup = () => {
    unlistenOpen?.();
    unlistenData?.();
    unlistenClosed?.();
    if (started) void invoke("http_sse_stop", { streamId }).catch(() => {});
  };

  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let opened = false;
    let closedError: string | null = null;
    let sawData = false;

    const body = new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
      cancel() { cleanup(); },
    });

    const onAbort = () => {
      cleanup();
      try { controller?.error(new DOMException("Aborted", "AbortError")); } catch { /* noop */ }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const finishOpen = (payload: SseOpenPayload) => {
      opened = true;
      const headers = new Headers();
      for (const h of payload.headers) headers.append(h.name, h.value);
      resolve(new Response(body, { status: payload.status, headers }));
    };

    Promise.all([
      listen<SseOpenPayload>(`http:sse:open:${streamId}`, ({ payload }) => {
        if (!opened) finishOpen(payload);
      }),
      listen<string>(`http:sse:data:${streamId}`, ({ payload }) => {
        sawData = true;
        controller?.enqueue(encoder.encode(payload));
      }),
      listen<SseClosedPayload>(`http:sse:closed:${streamId}`, ({ payload }) => {
        closedError = payload.error ?? null;
        signal?.removeEventListener("abort", onAbort);
        if (!opened) {
          // Transport error before any response (DNS/connect): reject.
          cleanup();
          reject(new Error(closedError ?? "stream closed before response"));
          return;
        }
        // Non-2xx path: no data was streamed; surface the error body so the
        // caller sees res.ok === false with a readable body.
        if (closedError && !sawData) controller?.enqueue(encoder.encode(closedError));
        try { controller?.close(); } catch { /* noop */ }
        cleanup();
      }),
    ])
      .then(([openU, dataU, closedU]) => {
        unlistenOpen = openU; unlistenData = dataU; unlistenClosed = closedU;
        if (signal?.aborted) { onAbort(); reject(new DOMException("Aborted", "AbortError")); return; }
        started = true;
        void invoke("http_sse_start", {
          streamId,
          url,
          method: (init?.method ?? "GET").toUpperCase(),
          headers: headersToPairs(init?.headers),
          body: typeof init?.body === "string" ? init.body : init?.body == null ? null : String(init.body),
        }).catch((err) => {
          signal?.removeEventListener("abort", onAbort);
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      })
      .catch((err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

function headersToPairs(h: HeadersInit | undefined): Array<{ name: string; value: string }> {
  if (!h) return [];
  if (h instanceof Headers) return [...h.entries()].map(([name, value]) => ({ name, value }));
  if (Array.isArray(h)) return h.map(([name, value]) => ({ name, value }));
  return Object.entries(h).map(([name, value]) => ({ name, value: String(value) }));
}
