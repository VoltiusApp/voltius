import { useAdminDefaultsStore, isAdminDefaulted } from "@/stores/adminDefaultsStore";
import { useAppSettingsTimestampStore, withAdminDefaultWrite } from "@/stores/appSettingsTimestampStore";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { useLocaleStore } from "@/stores/localeStore";
import { adminDefault, isLocked, onPolicyLoaded } from "@/stores/policyStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useThemeStore } from "@/stores/themeStore";
import { importSetting, readSetting, sameValue } from "@/services/user-data/settingAccess";
import { SETTING_KEYS, domainOf, relPath } from "@/services/user-data/settingKeys";

const BUILT_IN: Record<string, () => unknown> = {
  "appSettings.terminal.preferredShell": () => useTerminalSettingsStore.getInitialState().preferredShell,
  "appSettings.terminal.cursorStyle": () => useTerminalSettingsStore.getInitialState().cursorStyle,
  "appSettings.terminal.keywordRules": () => useTerminalSettingsStore.getInitialState().keywordRules,
  "appSettings.sftp.autoRefreshIntervalMs": () => useSftpSettingsStore.getInitialState().autoRefreshIntervalMs,
  "appSettings.plugins.overrides": () => usePluginRegistryStore.getInitialState().overrides,
  "appSettings.keepalivePreset": () => useConnectivitySettingsStore.getInitialState().keepalivePreset,
  "appSettings.detachedTtlHours": () => useConnectivitySettingsStore.getInitialState().detachedTtlHours,
  "appSettings.locale": () => useLocaleStore.getInitialState().locale,
  "appSettings.proxy": () => useConnectivitySettingsStore.getInitialState().proxy,
  "themes.location": () => useThemeStore.getInitialState().location,
};

// An unset toggle is absent from the export, so it has no entry and its built-in is undefined.
const builtIn = (id: string): unknown => BUILT_IN[id]?.();

const neverSet = (id: string): boolean =>
  !isAdminDefaulted(id) &&
  !isLocked(id) &&
  (domainOf(id) !== "appSettings" || !useAppSettingsTimestampStore.getState().clocks[relPath(id)]) &&
  sameValue(readSetting(id), builtIn(id));

// Written without a sync clock so a value chosen on another device wins the merge.
export function applySettingDefaults(): void {
  for (const { id } of SETTING_KEYS) {
    const value = adminDefault(id);
    if (value === undefined || !neverSet(id)) continue;
    try {
      withAdminDefaultWrite(() => void importSetting(id, value)?.catch(() => {}));
    } catch (e) {
      console.warn("[policy] default not applied:", id, e);
      continue;
    }
    if (sameValue(readSetting(id), value)) useAdminDefaultsStore.getState().markApplied(id);
  }
}

onPolicyLoaded(applySettingDefaults);
