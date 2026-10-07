// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { loadPlugin, unloadPlugin } from "./runtime";
import { useHostPingStore } from "@/stores/hostPingStore";
import type { PluginAPI, PluginRegisterFn } from "./api";

let captured: PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

afterEach(() => {
  try { unloadPlugin("t"); } catch { /* noop */ }
  useHostPingStore.setState({ statuses: {}, latencies: {} });
});

describe("health.pingStatus", () => {
  test("reports a knock-protected host as unknown", () => {
    useHostPingStore.setState({ statuses: { a: "knock", b: "up" }, latencies: { b: 12 } });
    loadPlugin({ id: "t", name: "T", version: "1", permissions: ["health:read"] }, register, true, false);
    expect(captured.health.pingStatus()).toEqual([
      { connectionId: "a", status: "unknown", latencyMs: undefined },
      { connectionId: "b", status: "up", latencyMs: 12 },
    ]);
  });
});
