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
    expect(invoke).toHaveBeenCalledWith("keychain_get", { key: "plugin:t:ai-agent:k" });
  });

  test("trusted plugin with keychain:write writes via keychain_set", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["keychain:write"]), register, true, true);
    await captured.keychain.set("ai-agent:k", "v");
    expect(invoke).toHaveBeenCalledWith("keychain_set", { key: "plugin:t:ai-agent:k", value: "v" });
  });

  test("trusted plugin with keychain:write deletes via keychain_delete", async () => {
    (invoke as Mock).mockResolvedValue(undefined);
    loadPlugin(manifest(["keychain:write"]), register, true, true);
    await captured.keychain.delete("ai-agent:k");
    expect(invoke).toHaveBeenCalledWith("keychain_delete", { key: "plugin:t:ai-agent:k" });
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

  test("two plugin ids read different namespaced keys (isolation)", async () => {
    (invoke as Mock).mockResolvedValue(null);
    let apiA!: import("./api").PluginAPI;
    let apiB!: import("./api").PluginAPI;
    loadPlugin({ id: "a", name: "A", version: "1", permissions: ["keychain:read"] }, (api) => { apiA = api; }, true, false);
    loadPlugin({ id: "b", name: "B", version: "1", permissions: ["keychain:read"] }, (api) => { apiB = api; }, true, false);
    await apiA.keychain.get("token");
    await apiB.keychain.get("token");
    expect(invoke).toHaveBeenCalledWith("keychain_get", { key: "plugin:a:token" });
    expect(invoke).toHaveBeenCalledWith("keychain_get", { key: "plugin:b:token" });
    try { unloadPlugin("a"); } catch { /* noop */ }
    try { unloadPlugin("b"); } catch { /* noop */ }
  });

  test("a plugin id containing the delimiter cannot escape into another plugin's namespace", async () => {
    (invoke as Mock).mockResolvedValue(null);
    let apiFoo!: import("./api").PluginAPI;
    let apiEvil!: import("./api").PluginAPI;
    loadPlugin({ id: "foo", name: "Foo", version: "1", permissions: ["keychain:read"] }, (api) => { apiFoo = api; }, true, false);
    loadPlugin({ id: "foo:x", name: "Evil", version: "1", permissions: ["keychain:read"] }, (api) => { apiEvil = api; }, true, false);
    await apiFoo.keychain.get("x:secret");
    await apiEvil.keychain.get("secret");
    const calls = (invoke as Mock).mock.calls.filter(c => c[0] === "keychain_get").map(c => c[1].key);
    // The two must resolve to DIFFERENT physical keys (no escape).
    expect(calls[0]).not.toBe(calls[1]);
    try { unloadPlugin("foo"); } catch { /* noop */ }
    try { unloadPlugin("foo:x"); } catch { /* noop */ }
  });
});
