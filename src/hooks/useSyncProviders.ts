import { useEffect, useMemo, useState } from "react";
import { loadedPluginSource } from "@/plugins/runtime";
import { getSyncState, onSyncStateChange } from "@/services/sync";
import { readSyncProviderInputs } from "@/services/syncProviderInputs";
import { aggregateSyncStatus, buildSyncProviders, type EffectiveSync, type SyncProviderView } from "@/services/syncProviders";
import { useLocaleStore } from "@/stores/localeStore";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

export function useSyncProviders(): { providers: SyncProviderView[]; effective: EffectiveSync } {
  const [voltiusState, setVoltiusState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setVoltiusState(getSyncState())), []);
  const accountMode = useSubscriptionStore((s) => s.accountMode);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const pluginStates = usePluginStateStore((s) => s.values);
  const settingsPages = usePluginStore((s) => s.settingsPages);
  const overrides = usePluginRegistryStore((s) => s.overrides);
  const installedMeta = useMarketplaceStore((s) => s.installedMeta);
  const locale = useLocaleStore((s) => s.locale);

  return useMemo(() => {
    const providers = buildSyncProviders(readSyncProviderInputs(loadedPluginSource));
    return { providers, effective: aggregateSyncStatus(providers) };
    // The inputs are read from stores inside; these subscriptions only trigger the rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voltiusState, accountMode, isPro, pluginStates, settingsPages, overrides, installedMeta, locale]);
}
