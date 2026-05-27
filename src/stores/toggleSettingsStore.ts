import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

export interface ToggleDef {
  label: string;
  icon: string;
  description: string;
  keywords: string[];
  default: boolean;
}

/**
 * Single source of truth for every boolean toggle setting.
 * Adding a new setting here is the only change required — no edits to
 * OmniSearch, useToggleSettings, or any UI file.
 */
export const TOGGLE_DEFS = {
  "scroll-minimap": {
    label: "Scroll Minimap",
    icon: "lucide:layout-panel-right",
    description: "Appearance",
    keywords: ["minimap", "scrollbar", "terminal", "map"],
    default: true,
  },
  "select-to-copy": {
    label: "Select to Copy",
    icon: "lucide:clipboard-check",
    description: "Appearance",
    keywords: ["copy", "select", "clipboard", "terminal", "auto"],
    default: true,
  },
  "auto-forward": {
    label: "Automatic Port Forwarding",
    icon: "lucide:arrow-left-right",
    description: "Port Forwarding",
    keywords: ["forward", "port", "tunnel", "auto", "detect", "ssh"],
    default: true,
  },
  "forwarding-notifications": {
    label: "Port Forwarding Notifications",
    icon: "lucide:bell",
    description: "Port Forwarding",
    keywords: ["notification", "alert", "forward", "port", "notify"],
    default: false,
  },
  "sftp-tar": {
    label: "SFTP Tar Acceleration",
    icon: "lucide:package",
    description: "SFTP",
    keywords: ["sftp", "transfer", "tar", "compress", "file", "fast"],
    default: true,
  },
  "sftp-autorefresh": {
    label: "SFTP Auto-Refresh",
    icon: "lucide:folder-sync",
    description: "SFTP",
    keywords: ["sftp", "refresh", "auto", "file", "panel", "reload"],
    default: true,
  },
  "reachability": {
    label: "Reachability Check",
    icon: "lucide:radio-tower",
    description: "Hosts",
    keywords: ["ping", "reachability", "status", "check", "connectivity", "dot", "latency"],
    default: true,
  },
  "team-presence": {
    label: "Team Presence",
    icon: "lucide:user-check",
    description: "Hosts",
    keywords: ["presence", "team", "avatar", "share", "online", "activity"],
    default: true,
  },
} as const satisfies Record<string, ToggleDef>;

export type ToggleId = keyof typeof TOGGLE_DEFS;

interface ToggleSettingsState {
  values: Partial<Record<ToggleId, boolean>>;
  set: (id: ToggleId, value: boolean) => void;
}

export const useToggleSettingsStore = create<ToggleSettingsState>()(
  persist(
    (set) => ({
      values: {},
      set: (id, value) => {
        set((s) => ({ values: { ...s.values, [id]: value } }));
        useAppSettingsTimestampStore.getState().touch();
      },
    }),
    { name: "voltius-toggle-settings" },
  ),
);

/** Read a toggle value outside of React (non-reactive). */
export function getToggle(id: ToggleId): boolean {
  return useToggleSettingsStore.getState().values[id] ?? TOGGLE_DEFS[id].default;
}

/** React hook — returns [value, setter]. */
export function useToggle(id: ToggleId): [boolean, (v: boolean) => void] {
  const value = useToggleSettingsStore((s) => s.values[id] ?? TOGGLE_DEFS[id].default);
  const set = useToggleSettingsStore((s) => s.set);
  const setter = useCallback((v: boolean) => set(id, v), [set, id]);
  return [value, setter];
}
