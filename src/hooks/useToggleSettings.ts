import { useMemo } from "react";
import { TOGGLE_DEFS, useToggleSettingsStore, type ToggleId } from "@/stores/toggleSettingsStore";
import { useSyncPrefsStore, SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";

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
  ], [values, set, syncTypes, setSyncType]);
}
