import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TOGGLE_DEFS, useToggleSettingsStore, type ToggleId } from "@/stores/toggleSettingsStore";
import { useSyncPrefsStore, SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useUpdaterPrefStore } from "@/stores/updaterPrefStore";
import { getLoadedPlugins, setPluginActive } from "@/plugins/runtime";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { pluginDefaultEnabled } from "@/plugins/pluginDefaultEnabled";

export interface ToggleItem {
  id: string;
  label: string;
  icon: string;
  description?: string;
  keywords?: string[];
  value: boolean;
  onToggle: (v: boolean) => void;
}

export function useToggleSettings(): ToggleItem[] {
  const { t } = useTranslation();
  const values = useToggleSettingsStore((s) => s.values);
  const set = useToggleSettingsStore((s) => s.set);
  const { syncTypes, setSyncType } = useSyncPrefsStore();
  // Subscribe to overrides so plugin toggle values stay live as they're flipped.
  const pluginOverrides = usePluginRegistryStore((s) => s.overrides);
  const setPluginEnabled = usePluginRegistryStore((s) => s.setEnabled);
  const installedMeta = useMarketplaceStore((s) => s.installedMeta);
  const autoUpdate = useUpdaterPrefStore((s) => s.autoUpdate);
  const setAutoUpdate = useUpdaterPrefStore((s) => s.setAutoUpdate);

  return useMemo<ToggleItem[]>(() => [
    {
      id: "auto-update",
      label: t("settings.about.autoDownload.title"),
      icon: "lucide:refresh-cw",
      description: t("settings.toggleDefs.category.updates"),
      keywords: ["update", "auto", "automatic", "background", "download", "version", "upgrade"],
      value: autoUpdate,
      onToggle: setAutoUpdate,
    },
    ...(Object.entries(TOGGLE_DEFS) as [ToggleId, typeof TOGGLE_DEFS[ToggleId]][]).map(([id, def]) => ({
      id,
      label: t(def.labelKey),
      icon: def.icon,
      description: t(def.descriptionKey),
      keywords: [...def.keywords],
      value: values[id] ?? def.default,
      onToggle: (v: boolean) => set(id, v),
    })),
    ...SYNC_OBJECT_TYPES.map((st) => ({
      id: `sync-${st.id}`,
      label: t("settings.sync.quickToggleLabel", { label: t(`settings.sync.objectType.${st.id}.label`) }),
      icon: "lucide:cloud",
      description: t("settings.nav.sync.label"),
      keywords: ["sync", "cloud", "backup", st.id, st.label.toLowerCase()],
      value: syncTypes[st.id] ?? true,
      onToggle: (v: boolean) => setSyncType(st.id, v),
    })),
    ...getLoadedPlugins().map((m) => ({
      id: `plugin:${m.id}`,
      label: m.name,
      icon: "lucide:puzzle",
      description: t("settings.plugins.categoryLabel"),
      keywords: ["plugin", "extension", m.name.toLowerCase(), m.id],
      value: pluginOverrides[m.id] ?? pluginDefaultEnabled(m, installedMeta),
      onToggle: (v: boolean) => {
        setPluginActive(m.id, v);
        void setPluginEnabled(m.id, v);
      },
    })),
  ], [t, values, set, syncTypes, setSyncType, pluginOverrides, setPluginEnabled, installedMeta, autoUpdate, setAutoUpdate]);
}
