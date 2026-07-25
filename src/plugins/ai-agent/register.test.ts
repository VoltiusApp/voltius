import { describe, it, expect, vi } from "vitest";
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
}));
import { manifest, register } from "./index";

function fakeApi(isActive: () => boolean = () => true) {
  const calls: string[] = [];
  return {
    calls,
    api: {
      isActive,
      storage: { get: vi.fn(async () => null), set: vi.fn() },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [], getActive: vi.fn(() => null) },
      connections: { list: async () => [] },
      ui: {
        registerGlobalPanel: vi.fn(() => { calls.push("panel"); return () => calls.push("panel:off"); }),
        registerStatusBarItem: vi.fn((slot: string) => {
          calls.push(slot === "titlebar.right" ? "titlebar" : "terminalButton");
          return () => calls.push(slot === "titlebar.right" ? "titlebar:off" : "terminalButton:off");
        }),
        registerSettingsPage: vi.fn(() => { calls.push("settings"); return () => calls.push("settings:off"); }),
      },
      omni: { register: vi.fn(() => { calls.push("omni"); return () => calls.push("omni:off"); }) },
    } as never,
  };
}

describe("ai-agent register", () => {
  it("manifest declares the gated + public perms and is disabled by default", () => {
    expect(manifest.id).toBe("plugin-ai-agent");
    expect(manifest.defaultEnabled).toBe(false);
    expect(manifest.permissions).toEqual(expect.arrayContaining([
      "terminal:read", "terminal:stream", "keychain:read", "keychain:write",
      "global-panel", "omni-commands", "ui-contributions",
    ]));
  });
  it("registers drawer + omni + titlebar, and teardown unregisters all", () => {
    const { api, calls } = fakeApi();
    const cleanup = register(api);
    expect(calls).toEqual(expect.arrayContaining(["panel", "omni", "titlebar"]));
    cleanup?.();
    expect(calls).toEqual(expect.arrayContaining(["panel:off", "omni:off", "titlebar:off"]));
  });

  it("registers the terminal touchpoint (omni command + status-bar button), and teardown unregisters both", () => {
    const { api, calls } = fakeApi();
    const cleanup = register(api);
    expect((api as unknown as { omni: { register: ReturnType<typeof vi.fn> } }).omni.register)
      .toHaveBeenCalledWith(expect.objectContaining({ id: "ask-ai-terminal", keybinding: "ctrl+shift+j" }));
    expect(calls).toContain("terminalButton");
    cleanup?.();
    expect(calls).toContain("terminalButton:off");
  });

  it("registers a settings page only while active", () => {
    const { api } = fakeApi(() => true);
    register(api);
    expect((api as unknown as { ui: { registerSettingsPage: ReturnType<typeof vi.fn> } }).ui.registerSettingsPage)
      .toHaveBeenCalledWith(expect.objectContaining({ id: "settings", label: "AI Agent" }));
  });

  it("registers no settings page when inactive", () => {
    const { api } = fakeApi(() => false);
    register(api);
    expect((api as unknown as { ui: { registerSettingsPage: ReturnType<typeof vi.fn> } }).ui.registerSettingsPage)
      .not.toHaveBeenCalled();
  });

  it("unregisters the settings page on teardown", () => {
    const { api, calls } = fakeApi(() => true);
    const cleanup = register(api);
    cleanup?.();
    expect(calls).toContain("settings:off");
  });
});
