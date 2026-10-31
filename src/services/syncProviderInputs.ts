import i18n from "@/i18n";
import type { PluginManifest } from "@/plugins/api";
import { getSyncState, isSyncPaused, syncNow } from "@/services/sync";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { planDisplay } from "./planDisplay";
import type { SyncProviderInputs } from "./syncProviders";

export interface LoadedPluginSource {
  loaded(): PluginManifest[];
  isActive(id: string): boolean;
  exposed(id: string): unknown;
}

export function readSyncProviderInputs(source: LoadedPluginSource): SyncProviderInputs {
  const subscription = useSubscriptionStore.getState();
  const { accountMode, isPro } = subscription;
  const pluginStates = usePluginStateStore.getState();
  return {
    voltius: {
      label: i18n.t("layout.sync.voltiusSync"),
      state: getSyncState(),
      accountMode,
      isPro,
      canUpgrade: planDisplay(subscription).showUpgrade,
      paused: isSyncPaused(),
      syncNow: () => syncNow(true),
    },
    plugins: source.loaded().map((manifest) => ({
      manifest,
      active: source.isActive(manifest.id),
      exposed: source.exposed(manifest.id),
      publishedState: pluginStates.read(manifest.id, "sync-state"),
    })),
    settingsPages: [...usePluginStore.getState().settingsPages.values()],
  };
}
