// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

const domain = vi.hoisted(() => ({
  exec: vi.fn(async () => ({})),
  stream: vi.fn(() => ({ done: Promise.resolve({}), cancel: vi.fn() })),
  dispose: vi.fn(),
}));
const resolver = vi.hoisted(() => ({ fn: null as null | ((id: string) => unknown) }));
vi.mock("./domains/host", () => ({
  createHostAPI: (resolve: (id: string) => unknown) => {
    resolver.fn = resolve;
    return domain;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { loadPlugin, unloadPlugin } from "./runtime";
import { useSessionStore } from "@/stores/sessionStore";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}
let captured: PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => vi.clearAllMocks());
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("api.host", () => {
  test.each([
    ["exec", (a: PluginAPI) => a.host.exec("s1", "ls")],
    ["stream", (a: PluginAPI) => a.host.stream("s1", "ls", {})],
  ])("%s needs host:exec, checked before anything runs", (_n, call) => {
    loadPlugin(manifest(["sftp:read", "terminal:write"]), register, true, false);
    expect(() => call(captured)).toThrow(/requires permission "host:exec"/);
    expect(domain.exec).not.toHaveBeenCalled();
    expect(domain.stream).not.toHaveBeenCalled();
  });

  test("an ssh session runs remotely, a local one locally with its shell, a serial one not at all", () => {
    loadPlugin(manifest(["host:exec"]), register, true, false);
    useSessionStore.setState({
      sessions: [
        { id: "ssh", type: "ssh" },
        { id: "loc", type: "local", localShell: "/bin/zsh" },
        { id: "ser", type: "serial" },
      ] as never,
    });
    expect(resolver.fn!("ssh")).toEqual({ isRemote: true, localShell: null });
    expect(resolver.fn!("loc")).toEqual({ isRemote: false, localShell: "/bin/zsh" });
    expect(() => resolver.fn!("ser")).toThrow(/cannot run commands/);
    expect(() => resolver.fn!("gone")).toThrow(/not found/);
  });

  test("unloading the plugin stops its commands", () => {
    loadPlugin(manifest(["host:exec"]), register, true, false);
    unloadPlugin("t");
    expect(domain.dispose).toHaveBeenCalled();
  });
});
