import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

const domain = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  stat: vi.fn(async () => null),
  readText: vi.fn(async () => ""),
  writeText: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  delete: vi.fn(async () => {}),
  transfer: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
vi.mock("./domains/sftp", () => ({ createSftpAPI: () => domain }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
}));

import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}
let captured: PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => vi.clearAllMocks());
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

const READS: Array<[string, (api: PluginAPI) => Promise<unknown>]> = [
  ["list", (a) => a.sftp.list("c1", "/")],
  ["stat", (a) => a.sftp.stat("c1", "/x")],
  ["readText", (a) => a.sftp.readText("c1", "/x")],
];
const WRITES: Array<[string, (api: PluginAPI) => Promise<unknown>]> = [
  ["writeText", (a) => a.sftp.writeText("c1", "/x", "y")],
  ["mkdir", (a) => a.sftp.mkdir("c1", "/x")],
  ["rename", (a) => a.sftp.rename("c1", "/x", "/y")],
  ["delete", (a) => a.sftp.delete("c1", "/x")],
  ["transfer", (a) => a.sftp.transfer({ target: "c1", path: "/x" }, { target: "local", path: "/y" })],
];

describe("api.sftp permission split", () => {
  // The gate throws synchronously, before any promise exists — same as every
  // other requireGated verb in the runtime, so a caller cannot swallow it with
  // a bare .catch() on an awaited call.
  test.each(READS)("%s needs sftp:read", (_n, call) => {
    loadPlugin(manifest(["sftp:write"]), register, true, false);
    expect(() => call(captured)).toThrow(/requires permission "sftp:read"/);
  });

  test.each(WRITES)("%s needs sftp:write", (_n, call) => {
    loadPlugin(manifest(["sftp:read"]), register, true, false);
    expect(() => call(captured)).toThrow(/requires permission "sftp:write"/);
  });

  test.each(READS)("%s is allowed with sftp:read", async (_n, call) => {
    loadPlugin(manifest(["sftp:read"]), register, true, false);
    await expect(call(captured)).resolves.not.toThrow();
  });

  test.each(WRITES)("%s is allowed with sftp:write", async (_n, call) => {
    loadPlugin(manifest(["sftp:write"]), register, true, false);
    await expect(call(captured)).resolves.not.toThrow();
  });

  // Letting go of a handle the plugin itself opened exposes and changes nothing.
  test("disconnect needs no permission", async () => {
    loadPlugin(manifest([]), register, true, false);
    await expect(captured.sftp.disconnect("c1")).resolves.not.toThrow();
  });

  test("unloading the plugin closes the connections it opened", () => {
    loadPlugin(manifest(["sftp:read"]), register, true, false);
    expect(domain.dispose).not.toHaveBeenCalled();
    unloadPlugin("t");
    expect(domain.dispose).toHaveBeenCalledTimes(1);
  });
});
