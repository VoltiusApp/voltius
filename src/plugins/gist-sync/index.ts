import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import type { GistSyncPublicApi } from "@/services/syncStatus";
import manifestJson from "./manifest.json";
import { createSettingsPage } from "./SettingsPage";
import {
  init,
  isConfigured,
  syncNow,
  startPoll,
  stopPoll,
  push,
} from "./sync-engine";

export const manifest = manifestJson as PluginManifest;

// ─── Register ─────────────────────────────────────────────────────────────────

export const register: PluginRegisterFn = (api: PluginAPI) => {
  init(api);

  // Settings page always registered regardless of active state
  api.ui.registerSettingsPage({
    id: "gist-sync-settings",
    label: "GitHub Gist Sync",
    icon: "mdi:github",
    component: createSettingsPage(api),
  });

  // Public API for the host's SyncDropdown "sync now" button — avoids the host
  // importing this plugin's module directly. Exposed unconditionally so it
  // survives disable, same as the settings page above; callers gate on
  // whether the plugin is enabled before invoking.
  api.plugins.expose({ syncNow } satisfies GistSyncPublicApi);

  // Functional hooks only when the plugin is enabled
  let offBeforeQuit: (() => void) | null = null;
  if (api.isActive()) {
    (async () => {
      if (!(await isConfigured())) return;
      await syncNow();
      const interval = (await api.storage.get<number>("pollIntervalSeconds")) ?? 60;
      startPoll(interval);
    })();

    offBeforeQuit = api.lifecycle.onBeforeQuit(async () => {
      if (await isConfigured()) await push().catch(() => {});
    });
  }

  return () => {
    stopPoll();
    // Drop the quit-time push handler too, otherwise a disabled plugin would
    // still sync on app exit.
    offBeforeQuit?.();
  };
};
