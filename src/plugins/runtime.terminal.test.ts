import { describe, test, expect, vi, afterEach } from "vitest";

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
  useSessionStore: { getState: () => ({ sessions: [{ id: "s1", type: "ssh" }] }) },
}));

import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginManifest, PluginRegisterFn } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}

let captured: import("./api").PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

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
});
