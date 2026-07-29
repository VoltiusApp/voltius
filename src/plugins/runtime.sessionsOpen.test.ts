import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

const connect = vi.fn();
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: { getState: () => ({ connect, disconnect: vi.fn() }) },
}));
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
}));

import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginManifest, PluginRegisterFn, PluginAPI } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}
let captured: PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("sessions.open returns the new sessionId", () => {
  test("resolves to the id from the store", async () => {
    connect.mockResolvedValue("sess-123");
    loadPlugin(manifest(["sessions:write"]), register, true, true);
    await expect(captured.sessions.open("conn-1")).resolves.toBe("sess-123");
    expect(connect).toHaveBeenCalledWith("conn-1");
  });
});
