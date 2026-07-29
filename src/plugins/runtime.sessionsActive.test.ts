import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

const state = {
  sessions: [
    { id: "s1", connectionId: "c1", connectionName: "Prod DB", status: "connected", type: "ssh" },
    { id: "s2", connectionId: "local", connectionName: "Local", status: "connected", type: "local" },
  ],
  activeSessionId: "s2" as string | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: { getState: () => state } }));
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

beforeEach(() => { vi.clearAllMocks(); state.activeSessionId = "s2"; });
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("sessions.getActive", () => {
  test("returns the active session mapped to PluginSession", () => {
    loadPlugin(manifest(["sessions:read"]), register, true, true);
    expect(captured.sessions.getActive()).toEqual({
      id: "s2", connectionId: "local", connectionName: "Local", status: "connected", type: "local",
    });
  });

  test("returns null when there is no active session", () => {
    state.activeSessionId = null;
    loadPlugin(manifest(["sessions:read"]), register, true, true);
    expect(captured.sessions.getActive()).toBeNull();
  });

  test("returns null when activeSessionId names a session that is gone", () => {
    state.activeSessionId = "vanished";
    loadPlugin(manifest(["sessions:read"]), register, true, true);
    expect(captured.sessions.getActive()).toBeNull();
  });

  test("requires sessions:read", () => {
    loadPlugin(manifest([]), register, true, true);
    expect(() => captured.sessions.getActive()).toThrow(/requires permission/);
  });
});
