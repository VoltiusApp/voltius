import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@/themes/presets";
import type { AppTheme } from "@/themes/types";
import { usePluginStore } from "@/stores/pluginStore";
import type { ThemeMode, GeoLocation, AutomationConfig, ThemePhase } from "@/services/themeAutomation";

interface ThemeDiskState {
  updatedAt: string;
  activeThemeId: string;
  customThemes: AppTheme[];
  mode?: ThemeMode;
  lightThemeId?: string;
  darkThemeId?: string;
  scheduleLightStart?: string;
  scheduleDarkStart?: string;
  location?: GeoLocation | null;
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
  updatedAt: string;
  mode: ThemeMode;
  lightThemeId: string;
  darkThemeId: string;
  scheduleLightStart: string;
  scheduleDarkStart: string;
  location: GeoLocation | null;
  resolvedPhase: ThemePhase;
  persist: () => void;
  setTheme: (id: string) => void;
  saveCustomTheme: (theme: AppTheme) => void;
  deleteCustomTheme: (id: string) => void;
  setMode: (mode: ThemeMode) => void;
  setLightThemeId: (id: string) => void;
  setDarkThemeId: (id: string) => void;
  setSchedule: (lightStart: string, darkStart: string) => void;
  setLocation: (loc: GeoLocation | null) => void;
  setResolvedPhase: (phase: ThemePhase) => void;
  toggleLightDark: () => void;
  getAutomationConfig: () => AutomationConfig;
  getEffectiveThemeId: () => string;
  getActiveTheme: () => AppTheme;
  loadFromDisk: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      activeThemeId: DEFAULT_THEME_ID,
      customThemes: [],
      updatedAt: new Date(0).toISOString(),
      mode: "manual",
      lightThemeId: DEFAULT_LIGHT_THEME_ID,
      darkThemeId: DEFAULT_THEME_ID,
      scheduleLightStart: "07:00",
      scheduleDarkStart: "19:00",
      location: null,
      resolvedPhase: "dark",
      persist: () => {
        const now = new Date().toISOString();
        set({ updatedAt: now });
        const s = get();
        saveToDisk({
          updatedAt: now,
          activeThemeId: s.activeThemeId,
          customThemes: s.customThemes,
          mode: s.mode,
          lightThemeId: s.lightThemeId,
          darkThemeId: s.darkThemeId,
          scheduleLightStart: s.scheduleLightStart,
          scheduleDarkStart: s.scheduleDarkStart,
          location: s.location,
        });
      },
      setTheme: (id) => {
        set({ activeThemeId: id });
        get().persist();
      },
      saveCustomTheme: (theme) => {
        set((s) => ({
          customThemes: s.customThemes.some((t) => t.id === theme.id)
            ? s.customThemes.map((t) => (t.id === theme.id ? theme : t))
            : [...s.customThemes, theme],
        }));
        get().persist();
      },
      deleteCustomTheme: (id) => {
        set((s) => ({ customThemes: s.customThemes.filter((t) => t.id !== id) }));
        get().persist();
      },
      setMode: (mode) => {
        set({ mode });
        get().persist();
      },
      setLightThemeId: (id) => {
        set({ lightThemeId: id });
        get().persist();
      },
      setDarkThemeId: (id) => {
        set({ darkThemeId: id });
        get().persist();
      },
      setSchedule: (lightStart, darkStart) => {
        set({ scheduleLightStart: lightStart, scheduleDarkStart: darkStart });
        get().persist();
      },
      setLocation: (loc) => {
        set({ location: loc });
        get().persist();
      },
      setResolvedPhase: (phase) => set({ resolvedPhase: phase }), // device-local, no persist/sync
      toggleLightDark: () => {
        const { lightThemeId, darkThemeId } = get();
        const currentId = get().getEffectiveThemeId();
        const next = currentId === lightThemeId ? darkThemeId : lightThemeId;
        set({ activeThemeId: next, mode: "manual" });
        get().persist();
      },
      getAutomationConfig: () => {
        const s = get();
        return {
          mode: s.mode,
          scheduleLightStart: s.scheduleLightStart,
          scheduleDarkStart: s.scheduleDarkStart,
          location: s.location,
        };
      },
      getEffectiveThemeId: () => {
        const { mode, activeThemeId, lightThemeId, darkThemeId, resolvedPhase } = get();
        if (mode === "manual") return activeThemeId;
        return resolvedPhase === "dark" ? darkThemeId : lightThemeId;
      },
      getActiveTheme: () => {
        const id = get().getEffectiveThemeId();
        const { customThemes } = get();
        const pluginThemes = usePluginStore.getState().pluginThemes;
        return (
          BUILT_IN_THEMES.find((t) => t.id === id) ??
          customThemes.find((t) => t.id === id) ??
          pluginThemes.get(id) ??
          BUILT_IN_THEMES[0]
        );
      },
      loadFromDisk: async () => {
        try {
          const raw = await invoke<string | null>("theme_load");
          if (!raw) return;
          const disk: ThemeDiskState = JSON.parse(raw);
          if (disk.activeThemeId && Array.isArray(disk.customThemes))
            set({
              activeThemeId: disk.activeThemeId,
              customThemes: disk.customThemes,
              updatedAt: disk.updatedAt ?? new Date(0).toISOString(),
              mode: disk.mode ?? "manual",
              lightThemeId: disk.lightThemeId ?? DEFAULT_LIGHT_THEME_ID,
              darkThemeId: disk.darkThemeId ?? DEFAULT_THEME_ID,
              scheduleLightStart: disk.scheduleLightStart ?? "07:00",
              scheduleDarkStart: disk.scheduleDarkStart ?? "19:00",
              location: disk.location ?? null,
            });
        } catch {}
      },
    }),
    { name: "voltius-theme" },
  ),
);
