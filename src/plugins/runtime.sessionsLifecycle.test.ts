import { describe, test, expect, vi, afterEach } from "vitest";

const connect = vi.fn(async () => {});
const disconnect = vi.fn(async () => {});
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: { getState: () => ({ sessions: [], connect, disconnect }) },
}));
vi.mock("@/services/ssh", () => ({ sshSendInput: vi.fn(), onSshOutput: vi.fn(async () => () => {}) }));
vi.mock("@/services/local", () => ({ onLocalOutput: vi.fn(async () => () => {}) }));
vi.mock("@/services/serial", () => ({ onSerialOutput: vi.fn(async () => () => {}) }));
vi.mock("@/hooks/useTerminal", () => ({ readTerminalSnapshot: vi.fn(() => "") }));

import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginManifest, PluginRegisterFn } from "./api";

let api: import("./api").PluginAPI;
const register: PluginRegisterFn = (a) => { api = a; };
const m = (perms: string[]): PluginManifest => ({ id: "sl", name: "SL", version: "1", permissions: perms });
afterEach(() => { try { unloadPlugin("sl"); } catch { /* noop */ } vi.clearAllMocks(); });

describe("sessions open/close", () => {
  test("open with sessions:write calls store.connect", async () => {
    loadPlugin(m(["sessions:write"]), register, true, false);
    await api.sessions.open("conn-1");
    expect(connect).toHaveBeenCalledWith("conn-1");
  });

  test("close with sessions:write calls store.disconnect", async () => {
    loadPlugin(m(["sessions:write"]), register, true, false);
    await api.sessions.close("sess-1");
    expect(disconnect).toHaveBeenCalledWith("sess-1");
  });

  test("open without sessions:write throws", async () => {
    loadPlugin(m([]), register, true, false);
    await expect(api.sessions.open("conn-1")).rejects.toThrow(/requires permission/);
    expect(connect).not.toHaveBeenCalled();
  });
});
