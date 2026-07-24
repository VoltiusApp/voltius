import { describe, it, expect, vi } from "vitest";
vi.mock("@/hooks/useTerminal", () => ({ readTerminalSnapshot: vi.fn(() => "") }));
import { manifest, register } from "./index";

function fakeApi() {
  const calls: string[] = [];
  return {
    calls,
    api: {
      isActive: () => true,
      storage: { get: vi.fn(async () => null), set: vi.fn() },
      keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      sessions: { list: () => [] },
      connections: { list: async () => [] },
      ui: {
        registerGlobalPanel: vi.fn(() => { calls.push("panel"); return () => calls.push("panel:off"); }),
        registerStatusBarItem: vi.fn(() => { calls.push("titlebar"); return () => calls.push("titlebar:off"); }),
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
});
