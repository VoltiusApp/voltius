import { invoke } from "@tauri-apps/api/core";
import { loadPlugin } from "./runtime";
import { importPluginModule } from "./importPluginModule";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import type { PluginManifest, PluginRegisterFn } from "./api";

/**
 * Load plugins shipped inside the app bundle. They run through the same external
 * loader as marketplace plugins — the only difference is provenance, which grants
 * them pre-granted consent for gated permissions (`trusted`).
 */
export async function loadSeededPlugins(): Promise<void> {
  let ids: string[] = [];
  try {
    ids = await invoke<string[]>("plugins_list_seeded");
  } catch {
    return;
  }
  for (const id of ids) {
    try {
      const manifestText = await invoke<string>("plugin_seeded_read", {
        id,
        filename: "manifest.json",
      });
      const manifest = JSON.parse(manifestText) as PluginManifest;
      const jsText = await invoke<string>("plugin_seeded_read", { id, filename: "index.js" });
      const mod = (await importPluginModule(jsText)) as { default: PluginRegisterFn };
      const active = usePluginRegistryStore
        .getState()
        .isEnabled(manifest.id, manifest.defaultEnabled ?? true);
      loadPlugin(manifest, mod.default, active, true);
    } catch (e) {
      console.warn(`[seeded] Failed to load seeded plugin "${id}":`, e);
    }
  }
}
