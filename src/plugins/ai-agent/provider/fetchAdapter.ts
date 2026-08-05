import type { PluginAPI } from "@/plugins/api";

/**
 * A `fetch`-shaped function over `api.http.stream`. Injected as the Vercel AI
 * SDK's `fetch` so all provider traffic rides the native SSE-over-events path
 * (streaming POST). `api.http.stream` returns a real Response whose ReadableStream
 * body also serves `.json()`/`.text()` for any buffered reply.
 */
export function makeStreamFetch(api: Pick<PluginAPI, "http">): typeof globalThis.fetch {
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === "string") return api.http.stream(input, init);
    if (input instanceof URL) return api.http.stream(input.toString(), init);
    // Request: decompose into url + init (init, if given, takes precedence).
    const req = input;
    const merged: RequestInit = init ?? {
      method: req.method,
      headers: req.headers,
      body: req.body ? await req.text() : undefined,
      signal: req.signal,
    };
    return api.http.stream(req.url, merged);
  };
  return f as typeof globalThis.fetch;
}
