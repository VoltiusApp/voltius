import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { sendSessionInput } = vi.hoisted(() => ({
  sendSessionInput: vi.fn(async (_sessionId: string, _sessionType: string, _data: Uint8Array) => {}),
}));
vi.mock("@/services/sessionInput", () => ({ sendSessionInput }));
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
  getAppCursorMode: vi.fn(() => false),
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

describe("sessions.sendInput writes verbatim", () => {
  test("writes exactly the given text, with no trailing newline", async () => {
    loadPlugin(manifest(["terminal:write"]), register, true, false);
    await captured.sessions.sendInput("s1", "\x1b[A");
    expect(sendSessionInput).toHaveBeenCalledWith("s1", "ssh", new TextEncoder().encode("\x1b[A"));
  });

  test("sendCommand still appends exactly one newline", async () => {
    loadPlugin(manifest(["terminal:write"]), register, true, false);
    await captured.sessions.sendCommand("s1", "ls");
    expect(sendSessionInput).toHaveBeenCalledWith("s1", "ssh", new TextEncoder().encode("ls\n"));
  });

  test("is gated behind terminal:write", async () => {
    loadPlugin(manifest([]), register, true, false);
    await expect(captured.sessions.sendInput("s1", "x")).rejects.toThrow(/requires permission "terminal:write"/);
  });

  test("throws on an unknown session rather than resolving silently", async () => {
    loadPlugin(manifest(["terminal:write"]), register, true, false);
    await expect(captured.sessions.sendInput("nope", "x")).rejects.toThrow(/not found/);
  });
});
