import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import type { CloudflareSyncPublicApi } from "@/services/syncStatus";
import manifestJson from "./manifest.json";
import { messages } from "./i18n";
import { createSettingsPage } from "./SettingsPage";
import { init, isConfigured, syncNow, startPoll, stopPoll, push } from "./sync-engine";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  api.i18n.register(messages);
  init(api);

  api.ui.registerSettingsPage({
    id: "cloudflare-sync-settings",
    label: () => api.i18n.t("settingsLabel"),
    icon: "lucide:cloud",
    component: createSettingsPage(api),
  });

  api.plugins.expose({ syncNow } satisfies CloudflareSyncPublicApi);

  let offBeforeQuit: (() => void) | null = null;
  if (api.isActive()) {
    void (async () => {
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
    offBeforeQuit?.();
  };
};
