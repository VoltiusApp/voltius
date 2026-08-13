import { invoke } from "@tauri-apps/api/core";
import { loadPlugin } from "./runtime";
import { importPluginModule, pluginRegisterOf, type PluginModule } from "./importPluginModule";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useSeededTombstoneStore } from "@/stores/seededTombstoneStore";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUIStore } from "@/stores/uiStore";
import { log } from "@/lib/logger";
import i18n from "@/i18n";
import type { PluginManifest } from "./api";

/**
 * Load plugins shipped inside the app bundle. They run through the same external
 * loader as marketplace plugins — the only difference is provenance, which grants
 * them pre-granted consent for gated permissions (`trusted`).
 *
 * Skips an id that is tombstoned (uninstalled by the user) or that already has an
 * external install recorded — an external install always wins, since it may be newer.
 */
export async function loadSeededPlugins(): Promise<void> {
  let ids: string[] = [];
  try {
    ids = await invoke<string[]>("plugins_list_seeded");
  } catch {
    return;
  }
  const { isRemoved } = useSeededTombstoneStore.getState();
  const installedIds = new Set(useMarketplaceStore.getState().installedMeta.map((m) => m.id));
  let loaded = 0;
  let firstError: unknown;
  let failed = 0;
  for (const id of ids) {
    try {
      const manifestText = await invoke<string>("plugin_seeded_read", {
        id,
        filename: "manifest.json",
      });
      const manifest = JSON.parse(manifestText) as PluginManifest;
      // The manifest id (e.g. "plugin-docker") is what tombstones and installedMeta
      // key on, not the seeded folder name (e.g. "docker") used to read files above.
      if (isRemoved(manifest.id) || installedIds.has(manifest.id)) continue;
      const jsText = await invoke<string>("plugin_seeded_read", { id, filename: "index.js" });
      let css: string | undefined;
      try {
        css = await invoke<string>("plugin_seeded_read", { id, filename: "voltius.css" });
      } catch {
        // Most plugins ship no stylesheet — that's expected, not an error.
      }
      const mod = (await importPluginModule(jsText, css, manifest.id)) as PluginModule;
      const active = usePluginRegistryStore
        .getState()
        .isEnabled(manifest.id, manifest.defaultEnabled ?? true);
      loadPlugin(manifest, pluginRegisterOf(mod), active, true, css);
      loaded += 1;
    } catch (e) {
      failed += 1;
      firstError ??= e;
      console.warn(`[seeded] Failed to load seeded plugin "${id}":`, e);
    }
  }
  // Losing every built-in at once is otherwise invisible: the app boots, hosts and
  // vaults still arrive over IPC, and only the plugin surfaces are missing. That is
  // how a webview-level breakage (a CSP directive an engine doesn't support, say)
  // would reach users silently. Individual failures stay a console warning; total
  // failure is worth interrupting for. Everything tombstoned is not a failure.
  if (loaded === 0 && failed > 0) {
    log.error(`[seeded] no built-in plugin loaded (${failed} failed)`, String(firstError));
    useNotificationStore.getState().addBanner({
      source: { kind: "plugin", id: "core", name: "Voltius" },
      message: i18n.t("notifications.seededPluginsFailed.message"),
      severity: "error",
      dismissable: true,
      actions: [
        {
          label: i18n.t("notifications.seededPluginsFailed.action"),
          onClick: () => useUIStore.getState().openSettings("diagnostics"),
        },
      ],
    });
  }
}
