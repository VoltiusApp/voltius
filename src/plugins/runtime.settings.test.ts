import { afterEach, describe, expect, test } from "vitest";
import { createHostPluginAPI, loadPlugin, setPluginActive, unloadPlugin } from "@/plugins/runtime";
import { PERMISSIONS } from "@/mcp/hostApi";
import type { PluginAPI, PluginManifest } from "@/plugins/api";

const api = () => createHostPluginAPI("__mcp_settings_test__", PERMISSIONS);

const PLUGIN_ID = "settings-lifecycle";

/** A real plugin, unlike createHostPluginAPI's host id, which `whileActive`
 *  exempts by design. */
function disabledPluginApi(): PluginAPI {
  const manifest: PluginManifest = {
    id: PLUGIN_ID, name: PLUGIN_ID, version: "1",
    permissions: ["settings:read", "settings:write", "account:read"],
  };
  let captured: PluginAPI | null = null;
  loadPlugin(manifest, (a) => { captured = a; }, true, false);
  setPluginActive(PLUGIN_ID, false);
  return captured!;
}

describe("PluginAPI settings", () => {
  test("list rend des entrées et get retrouve une clé", () => {
    expect(api().settings.list().length).toBeGreaterThan(20);
    expect(api().settings.get("toggles.scroll-minimap")!.key).toBe("toggles.scroll-minimap");
  });

  test("set rend la valeur effective", () => {
    const res = api().settings.set("toggles.select-to-copy", false);
    expect(res.ok).toBe(true);
    expect(api().settings.get("toggles.select-to-copy")!.value).toBe(false);
  });

  test("une permission absente fait échouer la lecture", async () => {
    const bare = createHostPluginAPI("__mcp_settings_bare__", []);
    expect(() => bare.settings.list()).toThrow(/requires permission "settings:read"/);
    expect(() => bare.settings.set("toggles.scroll-minimap", false))
      .toThrow(/requires permission "settings:write"/);
    await expect(bare.account.subscription()).rejects.toThrow(/requires permission "account:read"/);
  });

  test("account.subscription rend un palier", async () => {
    const view = await api().account.subscription();
    expect(typeof view.tier).toBe("string");
  });
});

describe("settings et account suivent le cycle de vie du plugin", () => {
  afterEach(() => {
    try { unloadPlugin(PLUGIN_ID); } catch { /* noop */ }
  });

  test("un plugin désactivé ne lit ni n'écrit plus un réglage", async () => {
    const dead = disabledPluginApi();
    expect(dead.settings.list()).toEqual([]);
    expect(dead.settings.get("toggles.scroll-minimap")).toBeUndefined();
    expect(dead.settings.consequenceOf("toggles.plugin-install-review", false)).toBeUndefined();

    const res = dead.settings.set("toggles.scroll-minimap", false);
    expect(res.ok).toBe(false);
    await expect(dead.account.subscription()).rejects.toThrow(/disabled or unloaded/);
  });
});
