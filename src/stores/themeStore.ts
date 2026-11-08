import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@/lib/invoke";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@/themes/presets";
import type { AppTheme } from "@/themes/types";
import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore } from "@/stores/uiStore";
import { writeUnlessLocked } from "./policyStore";
import { effectiveSettingWith, storeSetting } from "@/services/policy/effectiveCore";
import { useAdminDefaultsStore } from "./adminDefaultsStore";
import { pushSettingsChange, remoteApplyTimestamp, settingsStamp } from "./remoteApplyGuard";
import type { ThemeMode, GeoLocation, AutomationConfig, ThemePhase } from "@/services/themeAutomation";
import { DYNAMIC_THEME_ID, dynamicThemeFor } from "@/themes/dynamic";
import { useSystemColorsStore } from "@/services/androidSystemColors";
import { getSystemPrefersDark } from "@/services/systemAppearance";

// `location` is deliberately absent: it is device-scoped, and theme.json is the
// plugin path's only theme wire — a per-key filter cannot reach inside a file.
// The coordinates travel in the `themes` user-data section alone, and persist
// locally through this store's own localStorage middleware.
interface ThemeDiskState {
  updatedAt: string;
  activeThemeId: string;
  customThemes: AppTheme[];
  mode?: ThemeMode;
  lightThemeId?: string;
  darkThemeId?: string;
  scheduleLightStart?: string;
  scheduleDarkStart?: string;
}

async function saveToDisk(state: ThemeDiskState): Promise<void> {
  // Read the guard BEFORE the await: by the time theme_save resolves, the
  // remote apply that triggered this write may already have finished.
  const isLocalEdit = remoteApplyTimestamp() === null;
  try {
    await invoke("theme_save", { state: JSON.stringify(state) });
    if (isLocalEdit) pushSettingsChange();
  } catch {}
}

const LOCATION_KEY = "themes.location";

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
  /** The Material You theme (D1) for the current phase, or null when the device has no palette. */
  getDynamicTheme: () => AppTheme | null;
  loadFromDisk: () => Promise<void>;
}

/** Material You picks its light or dark tones from the automation phase when a mode drives the
 *  theme, otherwise (manual) from the phone's own light/dark setting. */
function dynamicPhase(s: Pick<ThemeStore, "mode" | "resolvedPhase">): ThemePhase {
  if (s.mode !== "manual") return s.resolvedPhase;
  return getSystemPrefersDark() ? "dark" : "light";
}

function phaseDefault(phase: ThemePhase): AppTheme {
  const id = phase === "dark" ? DEFAULT_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? BUILT_IN_THEMES[0];
}

/** The dynamic theme, or, where there is no palette (desktop after a sync, Android < 12), the
 *  default theme of the same phase, so a synced "material-you" degrades gracefully. */
function dynamicOrFallback(s: ThemeStore): AppTheme {
  return s.getDynamicTheme() ?? phaseDefault(dynamicPhase(s));
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
        const now = settingsStamp();
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
      setLocation: (loc) =>
        writeUnlessLocked(LOCATION_KEY, () => {
          set({ location: loc });
          useAdminDefaultsStore.getState().clear(LOCATION_KEY);
          get().persist();
        }),
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
          location: effectiveSettingWith(LOCATION_KEY, s.location, null),
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
        const theme =
          (id === DYNAMIC_THEME_ID ? dynamicOrFallback(get()) : undefined) ??
          BUILT_IN_THEMES.find((t) => t.id === id) ??
          customThemes.find((t) => t.id === id) ??
          pluginThemes.get(id) ??
          BUILT_IN_THEMES[0];
        // The terminal font size override is folded in here rather than at each
        // consumer: xterm, the CodeMirror editor, the --t-terminal-font-size
        // variable and the theme chip all read it off the active theme, and a
        // size that only some of them honoured would be worse than none.
        const override = useUIStore.getState().terminalFontSize;
        return override === null || override === theme.terminalFontSize
          ? theme
          : { ...theme, terminalFontSize: override };
      },
      getDynamicTheme: () => {
        const palette = useSystemColorsStore.getState().palette;
        return palette ? dynamicThemeFor(palette, dynamicPhase(get()), phaseDefault(dynamicPhase(get()))) : null;
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
            });
        } catch {}
      },
    }),
    { name: "voltius-theme" },
  ),
);

export const locationSetting = storeSetting(useThemeStore, "location", LOCATION_KEY);
