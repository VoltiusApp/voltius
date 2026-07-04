import i18n from "@/i18n";
import { useThemeStore } from "@/stores/themeStore";
import type { AppTheme } from "@/themes/types";
import type { UserDataHandler } from "../handler";

interface ThemesData {
  activeThemeId: string;
  customThemes: AppTheme[];
}

export const themesHandler: UserDataHandler = {
  key: "themes",
  label: "Themes",
  icon: "lucide:palette",

  export(): ThemesData {
    const { activeThemeId, customThemes } = useThemeStore.getState();
    return { activeThemeId, customThemes };
  },

  async import(data: unknown): Promise<void> {
    const { activeThemeId, customThemes } = data as ThemesData;
    const store = useThemeStore.getState();
    for (const theme of (customThemes ?? [])) {
      store.saveCustomTheme({ ...theme, builtIn: false });
    }
    if (activeThemeId) store.setTheme(activeThemeId);
  },

  merge(_local, remote, localTs, remoteTs) {
    if (!_local) return { value: remote, updated: true };
    if (!remote) return { value: _local, updated: false };
    if (remoteTs > localTs) return { value: remote, updated: true };
    return { value: _local, updated: false };
  },

  getTimestamp(): string {
    return useThemeStore.getState().updatedAt;
  },

  describe(): string {
    const { customThemes } = useThemeStore.getState();
    return i18n.t("importExport.userData.describe.themes", { count: customThemes.length });
  },
};
