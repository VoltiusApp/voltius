import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
}));

import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

function load(id: string): PluginAPI {
  let api!: PluginAPI;
  const manifest: PluginManifest = { id, name: id, version: "1", permissions: ["fs"] };
  const register: PluginRegisterFn = (a) => { api = a; };
  loadPlugin(manifest, register, true, false);
  return api;
}

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  unloadPlugin("agent-fs-watch");
});

describe("api.fs.watch", () => {
  test("a burst of ticks over one slow read fires the callback once", async () => {
    let release!: (v: string) => void;
    invoke
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));

    const api = load("agent-fs-watch");
    const cb = vi.fn();
    const stop = api.fs.watch("~/.ssh/config", cb, { intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(0); // baseline read settles

    await vi.advanceTimersByTimeAsync(100); // starts the slow read
    await vi.advanceTimersByTimeAsync(300); // three more ticks while it is pending
    release("second");
    await vi.advanceTimersByTimeAsync(0);

    expect(cb).toHaveBeenCalledTimes(1);
    stop();
  });
});
