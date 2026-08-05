import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { sshSendInput } = vi.hoisted(() => ({
  sshSendInput: vi.fn(async (_sessionId: string, _data: Uint8Array) => {}),
}));
vi.mock("@/services/ssh", () => ({ sshSendInput, onSshOutput: vi.fn() }));
const { serialWrite } = vi.hoisted(() => ({
  serialWrite: vi.fn(async (_sessionId: string, _data: Uint8Array) => {}),
}));
vi.mock("@/services/serial", () => ({ serialWrite, onSerialOutput: vi.fn() }));
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: [
        { id: "s1", type: "ssh" },
        { id: "ser-1", type: "serial" },
      ],
    }),
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

  // A serial session has no SSH channel. Before the third branch existed it fell
  // through to sshSendInput, so every write to a serial device was silently lost.
  test("a serial session is written over the serial transport, not the SSH one", async () => {
    loadPlugin(manifest(["terminal:write"]), register, true, false);
    await captured.sessions.sendCommand("ser-1", "AT");
    expect(sshSendInput).not.toHaveBeenCalled();
    expect(serialWrite).toHaveBeenCalledTimes(1);
    const [sessionId, data] = serialWrite.mock.calls[0];
    expect(sessionId).toBe("ser-1");
    expect(Array.from(data as Uint8Array)).toEqual(Array.from(new TextEncoder().encode("AT\n")));
  });

  test("a plugin with only sessions:write can no longer inject", async () => {
    loadPlugin(manifest(["sessions:write"]), register, true, false);
    await expect(captured.sessions.sendCommand("s1", "ls")).rejects.toThrow(/requires permission "terminal:write"/);
    expect(sshSendInput).not.toHaveBeenCalled();
  });
});
