import { describe, expect, test } from "vitest";
import { createHostPluginAPI } from "@/plugins/runtime";
import { PERMISSIONS } from "@/mcp/hostApi";

const api = () => createHostPluginAPI("__mcp_settings_test__", PERMISSIONS);

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

  test("une permission absente fait échouer la lecture", () => {
    const bare = createHostPluginAPI("__mcp_settings_bare__", []);
    expect(() => bare.settings.list()).toThrow();
  });

  test("account.subscription rend un palier", async () => {
    const view = await api().account.subscription();
    expect(typeof view.tier).toBe("string");
  });
});
