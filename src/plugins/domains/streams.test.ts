import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listen(...a) }));

import { createStreamsAPI } from "./streams";

describe("createStreamsAPI", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  test("start maps a stream kind to its backing command", async () => {
    invoke.mockResolvedValue("sid-1");
    const api = createStreamsAPI();
    await api.start("metrics", { sessionId: "s1", isRemote: true });
    expect(invoke).toHaveBeenCalledWith("metrics_start", { sessionId: "s1", isRemote: true });
  });

  test("on subscribes to the kind-scoped event channel and returns an unsubscribe", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    invoke.mockResolvedValue("sid-1");
    const api = createStreamsAPI();
    await api.start("metrics", { sessionId: "s1", isRemote: true });
    const off = await api.on("sid-1", () => {});
    expect(listen).toHaveBeenCalledWith("metrics:snapshot:sid-1", expect.any(Function));
    off();
    expect(unlisten).toHaveBeenCalled();
  });

  test("on delivers the raw event payload to the callback", async () => {
    let handler: ((e: { payload: unknown }) => void) | null = null;
    listen.mockImplementation(async (_n: string, h: (e: { payload: unknown }) => void) => {
      handler = h;
      return vi.fn();
    });
    invoke.mockResolvedValue("sid-1");
    const api = createStreamsAPI();
    await api.start("metrics", { sessionId: "s1", isRemote: true });
    const seen: unknown[] = [];
    await api.on("sid-1", (s) => seen.push(s));
    handler!({ payload: { cpu: 42 } });
    expect(seen).toEqual([{ cpu: 42 }]);
  });

  test("on for an unknown streamId rejects rather than silently never firing", async () => {
    const api = createStreamsAPI();
    await expect(api.on("nope", () => {})).rejects.toThrow(/unknown stream/i);
  });
});
