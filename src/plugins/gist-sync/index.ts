import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import type { GistSyncPublicApi } from "@/services/syncStatus";
import manifestJson from "./manifest.json";
import { messages } from "./i18n";
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
  api.i18n.register(messages);
  init(api);

  // Settings page always registered regardless of active state
  api.ui.registerSettingsPage({
    id: "gist-sync-settings",
    label: () => api.i18n.t("settingsLabel"),
    icon: "custom:github",
    component: createSettingsPage(api),
  });

  // Public API for the host's SyncDropdown "sync now" button — avoids the host
  // importing this plugin's module directly. Dropped on disable and re-exposed on
  // reactivation; host callers null-check.
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
