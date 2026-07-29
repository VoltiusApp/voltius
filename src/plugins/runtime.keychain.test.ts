import { describe, test, expect, vi, afterEach, beforeEach, type Mock } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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

describe("gated keychain verb", () => {
  test("trusted plugin with keychain:read reads via keychain_get", async () => {
    (invoke as Mock).mockResolvedValue("secret-val");
    loadPlugin(manifest(["keychain:read"]), register, true, true);
    await expect(captured.keychain.get("ai-agent:k")).resolves.toBe("secret-val");
    expect(invoke).toHaveBeenCalledWith("keychain_get", { key: "ai-agent:k" });
  });

  test("trusted plugin with keychain:write writes via keychain_set", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["keychain:write"]), register, true, true);
    await captured.keychain.set("ai-agent:k", "v");
    expect(invoke).toHaveBeenCalledWith("keychain_set", { key: "ai-agent:k", value: "v" });
  });

  test("trusted plugin with keychain:write deletes via keychain_delete", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["keychain:write"]), register, true, true);
    await captured.keychain.delete("ai-agent:k");
    expect(invoke).toHaveBeenCalledWith("keychain_delete", { key: "ai-agent:k" });
  });

  test("untrusted plugin that declares keychain:read is now allowed (consent model)", async () => {
    (invoke as Mock).mockResolvedValue("secret-val");
    loadPlugin(manifest(["keychain:read"]), register, true, false);
    await expect(captured.keychain.get("k")).resolves.toBe("secret-val");
  });

  test("trusted plugin missing keychain:write is denied on set", async () => {
    loadPlugin(manifest(["keychain:read"]), register, true, true);
    await expect(captured.keychain.set("k", "v")).rejects.toThrow(/requires permission/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
