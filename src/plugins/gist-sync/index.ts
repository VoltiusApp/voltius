import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import { createSettingsPage } from "./SettingsPage";
import {
  init,
  isConfigured,
  syncNow,
  startPoll,
  stopPoll,
  push,
} from "./sync-engine";

// ─── Manifest ─────────────────────────────────────────────────────────────────

export const manifest: PluginManifest = {
  id: "plugin-gist-sync",
  name: "GitHub Gist Sync",
  version: "1.0.0",
  description:
    "Sync your data across devices via encrypted GitHub Gist — no Voltius account required.",
  permissions: [
    "vault:read",
    "vault:write",
    "storage",
    "http",
    "ui",
    "sync:read",
    "sync:write",
    "notifications",
    "settings-page",
  ],
  defaultEnabled: false,
};

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
