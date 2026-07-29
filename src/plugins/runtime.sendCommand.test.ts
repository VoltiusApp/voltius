import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { sshSendInput } = vi.hoisted(() => ({
  sshSendInput: vi.fn(async (_sessionId: string, _data: Uint8Array) => {}),
}));
vi.mock("@/services/ssh", () => ({ sshSendInput, onSshOutput: vi.fn() }));
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({ sessions: [{ id: "s1", type: "ssh" }] }),
  },
}));

import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginManifest, PluginRegisterFn } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}
let captured: import("./api").PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("sessions.sendCommand is gated behind terminal:write", () => {
  test("a plugin with terminal:write can inject a command", async () => {
    loadPlugin(manifest(["terminal:write"]), register, true, false);
    await captured.sessions.sendCommand("s1", "ls");
    expect(sshSendInput).toHaveBeenCalledTimes(1);
    const [sessionId, data] = sshSendInput.mock.calls[0];
    expect(sessionId).toBe("s1");
    expect(Array.from(data as Uint8Array)).toEqual(Array.from(new TextEncoder().encode("ls\n")));
  });

  test("a plugin with only sessions:write can no longer inject", async () => {
    loadPlugin(manifest(["sessions:write"]), register, true, false);
    await expect(captured.sessions.sendCommand("s1", "ls")).rejects.toThrow(/requires permission "terminal:write"/);
    expect(sshSendInput).not.toHaveBeenCalled();
  });
});
