import { useMemo } from "react";
import { TOGGLE_DEFS, useToggleSettingsStore, type ToggleId } from "@/stores/toggleSettingsStore";
import { useSyncPrefsStore, SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { getLoadedPlugins, setPluginActive } from "@/plugins/runtime";

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
  const values = useToggleSettingsStore((s) => s.values);
  const set = useToggleSettingsStore((s) => s.set);
  const { syncTypes, setSyncType } = useSyncPrefsStore();
  // Subscribe to overrides so plugin toggle values stay live as they're flipped.
  const pluginOverrides = usePluginRegistryStore((s) => s.overrides);
  const setPluginEnabled = usePluginRegistryStore((s) => s.setEnabled);

  return useMemo<ToggleItem[]>(() => [
    ...(Object.entries(TOGGLE_DEFS) as [ToggleId, typeof TOGGLE_DEFS[ToggleId]][]).map(([id, def]) => ({
      id,
      label: def.label,
      icon: def.icon,
      description: def.description,
      keywords: [...def.keywords],
      value: values[id] ?? def.default,
      onToggle: (v: boolean) => set(id, v),
    })),
    ...SYNC_OBJECT_TYPES.map((t) => ({
      id: `sync-${t.id}`,
      label: `Sync ${t.label}`,
      icon: "lucide:cloud",
      description: "Sync",
      keywords: ["sync", "cloud", "backup", t.id, t.label.toLowerCase()],
      value: syncTypes[t.id] ?? true,
      onToggle: (v: boolean) => setSyncType(t.id, v),
    })),
    ...getLoadedPlugins().map((m) => ({
      id: `plugin:${m.id}`,
      label: m.name,
      icon: "lucide:puzzle",
      description: "Plugin",
      keywords: ["plugin", "extension", m.name.toLowerCase(), m.id],
      value: pluginOverrides[m.id] ?? m.defaultEnabled ?? true,
      onToggle: (v: boolean) => {
        setPluginActive(m.id, v);
        void setPluginEnabled(m.id, v);
      },
    })),
  ], [values, set, syncTypes, setSyncType, pluginOverrides, setPluginEnabled]);
}
