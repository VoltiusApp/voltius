// @vitest-environment jsdom
import { describe, test, expect, beforeEach } from "vitest";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";
import type { TerminalSession } from "@/types";

const { loadPlugin } = await import("./runtime");
const { useSessionStore } = await import("@/stores/sessionStore");

function load(id: string): PluginAPI {
  let api!: PluginAPI;
  const manifest: PluginManifest = { id, name: id, version: "1", permissions: ["sessions:read", "sessions:write"] };
  const register: PluginRegisterFn = (a) => { api = a; };
  loadPlugin(manifest, register, true, false);
  return api;
}

const session = (id: string, locked: boolean): TerminalSession => ({ id, connectionId: "local", connectionName: id, status: "disconnected", type: "local", locked });

describe("api.sessions.close on a locked tab", () => {
  beforeEach(() => useSessionStore.setState({ sessions: [session("a", true), session("b", false)], activeSessionId: "a" }));

  test("rejects with tab_locked and keeps the tab", async () => {
    const api = load("close-locked");
    await expect(api.sessions.close("a")).rejects.toThrow(/^tab_locked/);
    expect(useSessionStore.getState().sessions.map((s) => s.id)).toContain("a");
  });

  test("lists the lock state", () => {
    const api = load("list-locked");
    expect(api.sessions.list().find((s) => s.id === "a")?.locked).toBe(true);
  });

  test("closes an unlocked tab", async () => {
    const api = load("close-unlocked");
    await api.sessions.close("b");
    expect(useSessionStore.getState().sessions.map((s) => s.id)).toEqual(["a"]);
  });
});
