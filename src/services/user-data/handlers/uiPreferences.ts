import i18n from "@/i18n";
import { useUIStore } from "@/stores/uiStore";
import type { LayoutMode, SortMode } from "@/stores/uiStore";
import type { UserDataHandler } from "../handler";

interface UIPrefsData {
  uiScale: number;
  homeLayoutMode: LayoutMode;
  homeSortMode: SortMode;
  keychainLayoutMode: LayoutMode;
  keychainSortMode: SortMode;
  portForwardingLayoutMode: LayoutMode;
  portForwardingSortMode: SortMode;
}

export const uiPreferencesHandler: UserDataHandler = {
  key: "uiPreferences",
  label: "UI Preferences",
  icon: "lucide:layout-dashboard",

  export(): UIPrefsData {
    const s = useUIStore.getState();
    return {
      uiScale: s.uiScale,
      homeLayoutMode: s.homeLayoutMode,
      homeSortMode: s.homeSortMode,
      keychainLayoutMode: s.keychainLayoutMode,
      keychainSortMode: s.keychainSortMode,
      portForwardingLayoutMode: s.portForwardingLayoutMode,
      portForwardingSortMode: s.portForwardingSortMode,
    };
  },

  async import(data: unknown): Promise<void> {
    const d = data as Partial<UIPrefsData>;
    const s = useUIStore.getState();
    if (d.uiScale != null) s.setUiScale(d.uiScale);
    if (d.homeLayoutMode) s.setHomeLayoutMode(d.homeLayoutMode);
    if (d.homeSortMode) s.setHomeSortMode(d.homeSortMode);
    if (d.keychainLayoutMode) s.setKeychainLayoutMode(d.keychainLayoutMode);
    if (d.keychainSortMode) s.setKeychainSortMode(d.keychainSortMode);
    if (d.portForwardingLayoutMode) s.setPortForwardingLayoutMode(d.portForwardingLayoutMode);
    if (d.portForwardingSortMode) s.setPortForwardingSortMode(d.portForwardingSortMode);
  },

  merge(_local, remote, localTs, remoteTs) {
    if (!_local) return { value: remote, updated: true };
    if (!remote) return { value: _local, updated: false };
    if (remoteTs > localTs) return { value: remote, updated: true };
    return { value: _local, updated: false };
  },

  getTimestamp(): string {
    return useUIStore.getState().prefsUpdatedAt;
  },

  describe(): string {
    const s = useUIStore.getState();
    return i18n.t("importExport.userData.describe.uiPreferences", { scale: s.uiScale, layout: s.homeLayoutMode });
  },
};
