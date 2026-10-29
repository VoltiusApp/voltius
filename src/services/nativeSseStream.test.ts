import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ handlers: new Map<string, (e: { payload: unknown }) => void>() }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (e: { payload: unknown }) => void) => {
    h.handlers.set(event, handler);
    return () => { h.handlers.delete(event); };
  }),
}));
vi.mock("@/lib/invoke", () => ({ invoke: vi.fn(async () => null) }));

import { connectNativeSse } from "./nativeSseStream";
import { isUnreachable } from "./reachability";

const emit = (kind: string, payload: unknown) => {
  const name = [...h.handlers.keys()].find((k) => k.startsWith(`http:sse:${kind}:`));
  h.handlers.get(name!)!({ payload });
};

async function connect(onOpen: () => void) {
  const stream = connectNativeSse("http://s/stream", {}, new AbortController().signal, () => {}, onOpen);
  await vi.waitFor(() => expect(h.handlers.size).toBe(3));
  return { stream };
}

beforeEach(() => h.handlers.clear());

test("a stream the server accepted reports itself open", async () => {
  const onOpen = vi.fn();
  const { stream } = await connect(onOpen);

  emit("open", { status: 200, headers: [] });
  expect(onOpen).toHaveBeenCalledTimes(1);

  emit("closed", {});
  await stream;
});

test("a refused stream never reports itself open", async () => {
  const onOpen = vi.fn();
  const { stream } = await connect(onOpen);

  emit("open", { status: 401, headers: [] });
  emit("closed", { error: "HTTP 401: " });

  await expect(stream).rejects.toThrow("401");
  expect(onOpen).not.toHaveBeenCalled();
});

const failure = (stream: Promise<void>) => stream.then(() => null, (e: unknown) => e);

test("a stream the server refused is the server's answer, not an unreachable server", async () => {
  const { stream } = await connect(() => {});

  emit("open", { status: 401, headers: [] });
  emit("closed", { error: "HTTP 401: " });

  expect(isUnreachable(await failure(stream))).toBe(false);
});

test("a stream that never got an answer means the server is unreachable", async () => {
  const { stream } = await connect(() => {});

  emit("closed", { error: "error sending request for url (http://s/stream)" });

  const e = await failure(stream);
  expect(isUnreachable(e)).toBe(true);
  expect((e as Error).message).toBe("error sending request for url (http://s/stream)");
});

test("an answer from the proxy in front of the server means the server is unreachable", async () => {
  const onOpen = vi.fn();
  const { stream } = await connect(onOpen);

  emit("open", { status: 502, headers: [] });
  emit("closed", { error: "HTTP 502: Bad Gateway" });

  expect(isUnreachable(await failure(stream))).toBe(true);
  expect(onOpen).not.toHaveBeenCalled();
});

test("a proxy error page is reported by its status, not its HTML", async () => {
  const { stream } = await connect(() => {});

  emit("open", { status: 504, headers: [] });
  emit("closed", { error: "HTTP 504: <!doctype html><html><title>Origin server error (504)</title></html>" });

  expect((await failure(stream) as Error).message).toBe("HTTP 504");
});

test("an open stream cut off mid-way means the server is unreachable", async () => {
  const { stream } = await connect(() => {});

  emit("open", { status: 200, headers: [] });
  emit("closed", { error: "error decoding response body" });

  expect(isUnreachable(await failure(stream))).toBe(true);
});
