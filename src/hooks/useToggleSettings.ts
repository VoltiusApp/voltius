import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TOGGLE_DEFS, getToggle, useToggleSettingsStore, type ToggleDef, type ToggleId } from "@/stores/toggleSettingsStore";
import { isLocked, usePolicyStore } from "@/stores/policyStore";
import { useIsAndroid } from "@/utils/platform";
import { useSyncPrefsStore, SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";
import { pluginLock, usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useUpdaterPrefStore } from "@/stores/updaterPrefStore";
import { getLoadedPlugins } from "@/plugins/runtime";
import { applyPluginEnabled } from "@/plugins/applyPluginEnabled";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { pluginDefaultEnabled } from "@/plugins/pluginDefaultEnabled";

export interface ToggleItem {
  id: string;
  label: string;
  icon: string;
  description?: string;
  keywords?: string[];
  value: boolean;
  locked?: boolean;
  onToggle: (v: boolean) => void;
}

export function useToggleSettings(): ToggleItem[] {
  const { t } = useTranslation();
  const values = useToggleSettingsStore((s) => s.values);
  const set = useToggleSettingsStore((s) => s.set);
  const machinePolicy = usePolicyStore((s) => s.machine);
  const serverPolicy = usePolicyStore((s) => s.server);
  const { syncTypes, setSyncType, isTypeSynced } = useSyncPrefsStore();
  // Subscribe to overrides so plugin toggle values stay live as they're flipped.
  const pluginOverrides = usePluginRegistryStore((s) => s.overrides);
  const installedMeta = useMarketplaceStore((s) => s.installedMeta);
  const autoUpdate = useUpdaterPrefStore((s) => s.autoUpdate);
  const setAutoUpdate = useUpdaterPrefStore((s) => s.setAutoUpdate);
  const isAndroid = useIsAndroid();

  return useMemo<ToggleItem[]>(() => [
    {
      id: "auto-update",
      label: t("settings.about.autoDownload.title"),
      icon: "lucide:refresh-cw",
      description: t("settings.nav.about.label"),
      keywords: ["update", "auto", "automatic", "background", "download", "version", "upgrade"],
      value: autoUpdate,
      onToggle: setAutoUpdate,
    },
    ...(Object.entries(TOGGLE_DEFS) as [ToggleId, ToggleDef][]).filter(([, def]) => isAndroid || !def.androidOnly).map(([id, def]) => {
      const locked = isLocked(`appSettings.toggles.${id}`);
      return {
        id,
        label: t(def.labelKey),
        icon: def.icon,
        description: locked ? t("common.policy.managed") : t(`settings.nav.${def.section}.label`),
        keywords: [...def.keywords],
        value: getToggle(id),
        locked,
        onToggle: (v: boolean) => set(id, v),
      };
    }),
    ...SYNC_OBJECT_TYPES.map((st) => ({
      id: `sync-${st.id}`,
      label: t("settings.sync.quickToggleLabel", { label: t(`settings.sync.objectType.${st.id}.label`) }),
      icon: "lucide:cloud",
      description: t("settings.nav.sync.label"),
      keywords: ["sync", "cloud", "backup", st.id],
      value: isTypeSynced(st.id),
      locked: isLocked(`sync.types.${st.id}`),
      onToggle: (v: boolean) => setSyncType(st.id, v),
    })),
    ...getLoadedPlugins().map((m) => {
      const lock = pluginLock(m.id);
      return {
        id: `plugin:${m.id}`,
        label: m.name,
        icon: "lucide:puzzle",
        description: lock === null ? t("settings.plugins.categoryLabel") : t("common.policy.managed"),
        keywords: ["plugin", "extension", m.name.toLowerCase(), m.id],
        value: lock ?? pluginOverrides[m.id] ?? pluginDefaultEnabled(m, installedMeta),
        locked: lock !== null,
        onToggle: (v: boolean) => void applyPluginEnabled(m.id, v),
      };
    }),
  ], [t, values, set, machinePolicy, serverPolicy, syncTypes, setSyncType, isTypeSynced, pluginOverrides, installedMeta, autoUpdate, setAutoUpdate, isAndroid]);
}
