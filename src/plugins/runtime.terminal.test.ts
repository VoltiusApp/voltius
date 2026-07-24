import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => "snap-text"),
}));
// vi.mock factories are hoisted above top-level consts; vi.hoisted() hoists
// these mock fns alongside them so the factories below can reference them.
const { onSshOutput, onLocalOutput, onSerialOutput } = vi.hoisted(() => ({
  onSshOutput: vi.fn(async () => () => {}),
  onLocalOutput: vi.fn(async () => () => {}),
  onSerialOutput: vi.fn(async () => () => {}),
}));
vi.mock("@/services/ssh", () => ({ onSshOutput, sshSendInput: vi.fn() }));
vi.mock("@/services/local", () => ({ onLocalOutput }));
vi.mock("@/services/serial", () => ({ onSerialOutput }));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: [
        { id: "s1", type: "ssh" },
        { id: "s2", type: "local" },
        { id: "s3", type: "serial" },
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

describe("gated terminal verbs", () => {
  test("trusted plugin with terminal:read gets a snapshot", () => {
    loadPlugin(manifest(["terminal:read"]), register, true, true);
    expect(captured.terminal.readSnapshot("s1", 50)).toBe("snap-text");
  });

  test("untrusted plugin is denied even if it declares terminal:read", () => {
    loadPlugin(manifest(["terminal:read"]), register, true, false);
    expect(() => captured.terminal.readSnapshot("s1")).toThrow(/first-party-only/);
  });

  test("trusted plugin missing the permission is denied", () => {
    loadPlugin(manifest([]), register, true, true);
    expect(() => captured.terminal.readSnapshot("s1")).toThrow(/requires permission/);
  });

  test("onOutput dispatches by session type", async () => {
    loadPlugin(manifest(["terminal:stream"]), register, true, true);
    await captured.terminal.onOutput("s1", () => {});
    expect(onSshOutput).toHaveBeenCalledWith("s1", expect.any(Function));
  });

  test("onOutput on a local session calls onLocalOutput, not onSshOutput", async () => {
    loadPlugin(manifest(["terminal:stream"]), register, true, true);
    await captured.terminal.onOutput("s2", () => {});
    expect(onLocalOutput).toHaveBeenCalledWith("s2", expect.any(Function));
    expect(onSshOutput).not.toHaveBeenCalled();
  });

  test("onOutput on a serial session calls onSerialOutput", async () => {
    loadPlugin(manifest(["terminal:stream"]), register, true, true);
    await captured.terminal.onOutput("s3", () => {});
    expect(onSerialOutput).toHaveBeenCalledWith("s3", expect.any(Function));
  });

  test("onOutput on an unknown sessionId rejects with a not-found error", async () => {
    loadPlugin(manifest(["terminal:stream"]), register, true, true);
    await expect(captured.terminal.onOutput("nope", () => {})).rejects.toThrow(/not found/);
  });

  test("untrusted plugin missing the permission fails on the permission check first", () => {
    loadPlugin(manifest([]), register, true, false);
    expect(() => captured.terminal.readSnapshot("s1")).toThrow(/requires permission/);
  });
});
