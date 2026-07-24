import { describe, test, expect, vi, beforeEach } from "vitest";

const listeners = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { sseFetch } from "./sseFetch";

// Fire an event to whatever id sseFetch registered (single in-flight stream per test).
function emit(kind: "open" | "data" | "closed", payload: unknown) {
  const entry = [...listeners.keys()].find((k) => k.startsWith(`http:sse:${kind}:`));
  if (entry) listeners.get(entry)!({ payload });
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

beforeEach(() => { listeners.clear(); vi.clearAllMocks(); });

describe("sseFetch", () => {
  test("resolves a 200 Response whose body streams the data chunks", async () => {
    const p = sseFetch("https://api.test/v1", { method: "POST", body: "{}" });
    // Let the internal listen() calls register.
    await Promise.resolve(); await Promise.resolve();
    emit("open", { status: 200, headers: [{ name: "content-type", value: "text/event-stream" }] });
    const res = await p;
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const bodyPromise = readAll(res);
    emit("data", "hello ");
    emit("data", "world");
    emit("closed", { error: null });
    await expect(bodyPromise).resolves.toBe("hello world");
    expect(invoke).toHaveBeenCalledWith("http_sse_start", expect.objectContaining({
      method: "POST", body: "{}",
    }));
  });

  test("non-2xx yields a Response with the real status and the error body", async () => {
    const p = sseFetch("https://api.test/v1", { method: "POST", body: "{}" });
    await Promise.resolve(); await Promise.resolve();
    emit("open", { status: 429, headers: [] });
    emit("closed", { error: "HTTP 429: rate limited" });
    const res = await p;
    expect(res.status).toBe(429);
    expect(res.ok).toBe(false);
    await expect(readAll(res)).resolves.toContain("rate limited");
  });

  test("a transport error before open rejects", async () => {
    const p = sseFetch("https://api.test/v1", {});
    await Promise.resolve(); await Promise.resolve();
    emit("closed", { error: "dns failure" });
    await expect(p).rejects.toThrow(/dns failure/);
  });

  test("aborting via the signal calls http_sse_stop", async () => {
    const ctrl = new AbortController();
    const p = sseFetch("https://api.test/v1", { signal: ctrl.signal });
    await Promise.resolve(); await Promise.resolve();
    emit("open", { status: 200, headers: [] });
    const res = await p;
    void readAll(res);
    ctrl.abort();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("http_sse_stop", expect.any(Object));
  });
});
