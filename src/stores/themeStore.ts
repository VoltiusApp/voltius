import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "@/themes/presets";
import type { AppTheme } from "@/themes/types";
import { usePluginStore } from "@/stores/pluginStore";

interface ThemeDiskState {
  updatedAt: string;
  activeThemeId: string;
  customThemes: AppTheme[];
}

async function saveToDisk(state: ThemeDiskState): Promise<void> {
  try {
    await invoke("theme_save", { state: JSON.stringify(state) });
    // Dynamic import avoids circular dependency (sync.ts imports themeStore)
    const { scheduleSync } = await import("@/services/sync");
    scheduleSync();
  } catch {}
}

interface ThemeStore {
  activeThemeId: string;
  customThemes: AppTheme[];
  setTheme: (id: string) => void;
  saveCustomTheme: (theme: AppTheme) => void;
  deleteCustomTheme: (id: string) => void;
  getActiveTheme: () => AppTheme;
  loadFromDisk: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      activeThemeId: DEFAULT_THEME_ID,
      customThemes: [],
      setTheme: (id) => {
        set({ activeThemeId: id });
        saveToDisk({ updatedAt: new Date().toISOString(), activeThemeId: id, customThemes: get().customThemes });
      },
      saveCustomTheme: (theme) => {
        set((s) => ({
          customThemes: s.customThemes.some((t) => t.id === theme.id)
            ? s.customThemes.map((t) => (t.id === theme.id ? theme : t))
            : [...s.customThemes, theme],
        }));
        const { activeThemeId, customThemes } = get();
        saveToDisk({ updatedAt: new Date().toISOString(), activeThemeId, customThemes });
      },
      deleteCustomTheme: (id) => {
        set((s) => ({ customThemes: s.customThemes.filter((t) => t.id !== id) }));
        const { activeThemeId, customThemes } = get();
        saveToDisk({ updatedAt: new Date().toISOString(), activeThemeId, customThemes });
      },
      getActiveTheme: () => {
        const { activeThemeId, customThemes } = get();
        const pluginThemes = usePluginStore.getState().pluginThemes;
        return (
          BUILT_IN_THEMES.find((t) => t.id === activeThemeId) ??
          customThemes.find((t) => t.id === activeThemeId) ??
          pluginThemes.get(activeThemeId) ??
          BUILT_IN_THEMES[0]
        );
      },
      loadFromDisk: async () => {
        try {
          const raw = await invoke<string | null>("theme_load");
          if (!raw) return;
          const disk: ThemeDiskState = JSON.parse(raw);
          if (disk.activeThemeId && Array.isArray(disk.customThemes))
            set({ activeThemeId: disk.activeThemeId, customThemes: disk.customThemes });
        } catch {}
      },
    }),
    { name: "voltius-theme" },
  ),
);
