import { describe, test, expect, vi, afterEach, beforeEach, type Mock } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from "@tauri-apps/api/core";
import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginManifest, PluginRegisterFn } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}

let captured: import("./api").PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("proxmox:read / proxmox:manage split", () => {
  test("a plugin holding only proxmox:read can list LXC containers and snapshots", async () => {
    (invoke as Mock).mockResolvedValue([]);
    loadPlugin(manifest(["proxmox:read"]), register, true, false);
    await expect(captured.proxmox.lxc.list("s1")).resolves.toEqual([]);
    await expect(captured.proxmox.lxc.snapshots.list("s1", 100)).resolves.toEqual([]);
  });

  test("a plugin holding only proxmox:read fails on every mutating verb", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["proxmox:read"]), register, true, false);
    const denied = /requires permission "proxmox:manage"/;

    expect(() => captured.proxmox.lxc.action("s1", 100, "start")).toThrow(denied);
    expect(() => captured.proxmox.lxc.snapshots.create("s1", 100, "snap")).toThrow(denied);
    expect(() => captured.proxmox.lxc.snapshots.rollback("s1", 100, "snap")).toThrow(denied);
    expect(() => captured.proxmox.lxc.snapshots.remove("s1", 100, "snap")).toThrow(denied);
    // openShell is declared async, so a missing-permission failure surfaces as a
    // rejected promise, not a sync throw — same shape as docker.exec.open.
    await expect(captured.proxmox.lxc.openShell("s1", 100)).rejects.toThrow(denied);

    expect(invoke).not.toHaveBeenCalled();
  });

  test("a plugin holding only proxmox:manage cannot list containers or snapshots", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["proxmox:manage"]), register, true, false);
    const denied = /requires permission "proxmox:read"/;

    expect(() => captured.proxmox.lxc.list("s1")).toThrow(denied);
    expect(() => captured.proxmox.lxc.snapshots.list("s1", 100)).toThrow(denied);
  });
});
