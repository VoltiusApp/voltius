import i18n from "@/i18n";
import { useThemeStore } from "@/stores/themeStore";
import type { AppTheme } from "@/themes/types";
import type { ThemeMode, GeoLocation } from "@/services/themeAutomation";
import { lastWriteWins, type UserDataHandler } from "../handler";

interface ThemesData {
  activeThemeId: string;
  customThemes: AppTheme[];
  mode?: ThemeMode;
  lightThemeId?: string;
  darkThemeId?: string;
  scheduleLightStart?: string;
  scheduleDarkStart?: string;
  location?: GeoLocation | null;
}

export const themesHandler: UserDataHandler = {
  key: "themes",
  label: "Themes",
  icon: "lucide:palette",

  export(): ThemesData {
    const s = useThemeStore.getState();
    return {
      activeThemeId: s.activeThemeId,
      customThemes: s.customThemes,
      mode: s.mode,
      lightThemeId: s.lightThemeId,
      darkThemeId: s.darkThemeId,
      scheduleLightStart: s.scheduleLightStart,
      scheduleDarkStart: s.scheduleDarkStart,
      location: s.location,
    };
  },

  async import(data: unknown): Promise<void> {
    const d = (data ?? {}) as Partial<ThemesData>;
    const store = useThemeStore.getState();
    for (const theme of d.customThemes ?? []) {
      store.saveCustomTheme({ ...theme, builtIn: false });
    }

    // One setState + one persist: each individual setter writes theme.json and
    // schedules a push, so calling seven of them would do that seven times.
    const patch: Partial<ThemesData> = {};
    if (d.activeThemeId) patch.activeThemeId = d.activeThemeId;
    if (d.mode) patch.mode = d.mode;
    if (d.lightThemeId) patch.lightThemeId = d.lightThemeId;
    if (d.darkThemeId) patch.darkThemeId = d.darkThemeId;
    if (d.scheduleLightStart) patch.scheduleLightStart = d.scheduleLightStart;
    if (d.scheduleDarkStart) patch.scheduleDarkStart = d.scheduleDarkStart;
    if (d.location !== undefined) patch.location = d.location;
    if (Object.keys(patch).length === 0) return;
    useThemeStore.setState(patch);
    useThemeStore.getState().persist();
  },

  merge: lastWriteWins,

  getTimestamp(): string {
    return useThemeStore.getState().updatedAt;
  },

  describe(): string {
    const { customThemes } = useThemeStore.getState();
    return i18n.t("importExport.userData.describe.themes", { count: customThemes.length });
  },
};
