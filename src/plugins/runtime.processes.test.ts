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

describe("processes:read / processes:manage split", () => {
  test("a plugin holding only processes:read can start, tail and stop a process stream", async () => {
    (invoke as Mock).mockResolvedValue("stream-1");
    loadPlugin(manifest(["processes:read"]), register, true, false);
    await expect(captured.processes.start("s1", false)).resolves.toBe("stream-1");
    const unsub = await captured.processes.onSnapshot("stream-1", () => {});
    expect(typeof unsub).toBe("function");
    await expect(captured.processes.stop("stream-1")).resolves.toBeUndefined();
  });

  test("a plugin holding only processes:read fails to kill", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["processes:read"]), register, true, false);
    const denied = /requires permission "processes:manage"/;

    expect(() => captured.processes.kill("s1", 42, true, false)).toThrow(denied);
    expect(invoke).not.toHaveBeenCalled();
  });

  test("a plugin holding only processes:manage cannot start, tail or stop a stream", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["processes:manage"]), register, true, false);
    const denied = /requires permission "processes:read"/;

    expect(() => captured.processes.start("s1", false)).toThrow(denied);
    expect(() => captured.processes.onSnapshot("stream-1", () => {})).toThrow(denied);
    expect(() => captured.processes.stop("stream-1")).toThrow(denied);
  });
});
