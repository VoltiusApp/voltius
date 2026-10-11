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
