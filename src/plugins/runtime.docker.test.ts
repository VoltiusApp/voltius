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

const T = { sessionId: "s1", isRemote: true, localShell: null };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("docker:read / docker:manage split", () => {
  test("a plugin holding only docker:read can list containers", async () => {
    (invoke as Mock).mockResolvedValue([]);
    loadPlugin(manifest(["docker:read"]), register, true, false);
    await expect(captured.docker.containers.list(T)).resolves.toEqual([]);
    await expect(captured.docker.images.list(T)).resolves.toEqual([]);
    await expect(captured.docker.volumes.list(T)).resolves.toEqual([]);
    await expect(captured.docker.networks.list(T)).resolves.toEqual([]);
    await expect(captured.docker.stacks.list(T)).resolves.toEqual([]);
    await expect(captured.docker.stacks.services(T, "web")).resolves.toEqual([]);
    await expect(captured.docker.images.checkUpdate(T, "img1")).resolves.toEqual([]);
  });

  test("a plugin holding only docker:read can start and tail a log stream", async () => {
    (invoke as Mock).mockResolvedValue("log-1");
    loadPlugin(manifest(["docker:read"]), register, true, false);
    await expect(captured.docker.logs.start(T, "c1", 100)).resolves.toBe("log-1");
    await expect(captured.docker.logs.startStack(T, "web", 100)).resolves.toBe("log-1");
    const unsub = await captured.docker.logs.on("log-1", () => {});
    expect(typeof unsub).toBe("function");
    await expect(captured.docker.logs.stop("log-1")).resolves.toBeUndefined();
  });

  test("a plugin holding only docker:read fails on every mutating verb", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["docker:read"]), register, true, false);
    const denied = /requires permission "docker:manage"/;

    expect(() => captured.docker.containers.action(T, "c1", "restart")).toThrow(denied);
    expect(() => captured.docker.containers.runCommand(T, "c1", "nginx")).toThrow(denied);
    expect(() => captured.docker.images.remove(T, "img1")).toThrow(denied);
    expect(() => captured.docker.images.pull(T, "nginx")).toThrow(denied);
    expect(() => captured.docker.images.update(T, "nginx", true)).toThrow(denied);
    expect(() => captured.docker.images.recreateContainers(T, "nginx")).toThrow(denied);
    expect(() => captured.docker.images.prune(T)).toThrow(denied);
    expect(() => captured.docker.volumes.remove(T, "vol1")).toThrow(denied);
    expect(() => captured.docker.volumes.prune(T)).toThrow(denied);
    expect(() => captured.docker.networks.remove(T, "net1")).toThrow(denied);
    expect(() => captured.docker.networks.prune(T)).toThrow(denied);
    expect(() => captured.docker.stacks.action(T, "web", "up")).toThrow(denied);
    expect(() => captured.docker.stacks.update(T, "web")).toThrow(denied);
    expect(() => captured.docker.system.prune(T)).toThrow(denied);
    // exec.open is declared async (it awaits session bookkeeping on the happy path),
    // so a missing-permission failure surfaces as a rejected promise, not a sync throw.
    await expect(captured.docker.exec.open(T, "c1")).rejects.toThrow(denied);

    expect(invoke).not.toHaveBeenCalled();
  });

  test("a plugin holding only docker:manage cannot list or tail logs", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["docker:manage"]), register, true, false);
    const denied = /requires permission "docker:read"/;

    expect(() => captured.docker.containers.list(T)).toThrow(denied);
    expect(() => captured.docker.images.checkUpdate(T, "img1")).toThrow(denied);
    expect(() => captured.docker.logs.start(T, "c1", 100)).toThrow(denied);
    expect(() => captured.docker.logs.on("log-1", () => {})).toThrow(denied);
  });
});
