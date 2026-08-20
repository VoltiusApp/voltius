import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { CURSOR_STYLES, useTerminalSettingsStore, type TerminalCursorStyle } from "@/stores/terminalSettingsStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useToggleSettingsStore, TOGGLE_DEFS, type ToggleId } from "@/stores/toggleSettingsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { useLocaleStore, SUPPORTED_LOCALES, type Locale } from "@/stores/localeStore";
import { KEEPALIVE_PRESETS, type KeepalivePreset } from "@/utils/keepalive";
import { lastWriteWins, type UserDataHandler } from "../handler";

interface AppSettingsData {
  sftp?: { autoRefreshIntervalMs: number };
  terminal?: { preferredShell: string | null; cursorStyle?: TerminalCursorStyle };
  plugins?: { overrides: Record<string, boolean> };
  toggles?: Partial<Record<string, boolean>>;
  keepalivePreset?: KeepalivePreset;
  locale?: Locale;
}

export const appSettingsHandler: UserDataHandler = {
  key: "appSettings",
  label: "App Settings",
  icon: "lucide:settings",

  export(): AppSettingsData {
    const sftp = useSftpSettingsStore.getState();
    const terminal = useTerminalSettingsStore.getState();
    const plugins = usePluginRegistryStore.getState();
    const { values } = useToggleSettingsStore.getState();
    return {
      sftp: { autoRefreshIntervalMs: sftp.autoRefreshIntervalMs },
      terminal: { preferredShell: terminal.preferredShell, cursorStyle: terminal.cursorStyle },
      plugins: { overrides: plugins.overrides },
      toggles: { ...values },
      keepalivePreset: useConnectivitySettingsStore.getState().keepalivePreset,
      locale: useLocaleStore.getState().locale,
    };
  },

  async import(data: unknown): Promise<void> {
    const d = data as Partial<AppSettingsData>;
    if (d.sftp) {
      const s = useSftpSettingsStore.getState();
      if (d.sftp.autoRefreshIntervalMs != null) s.setAutoRefreshIntervalMs(d.sftp.autoRefreshIntervalMs);
    }
    if (d.terminal) {
      const s = useTerminalSettingsStore.getState();
      s.setPreferredShell(d.terminal.preferredShell ?? null);
      const style = d.terminal.cursorStyle;
      if (style && CURSOR_STYLES.includes(style)) s.setCursorStyle(style);
    }
    if (d.plugins?.overrides) {
      const overrides = d.plugins.overrides;
      usePluginRegistryStore.setState({ overrides });
      await invoke("plugin_registry_save", { overrides }).catch(() => {});
    }
    if (d.toggles) {
      const { set } = useToggleSettingsStore.getState();
      for (const [id, value] of Object.entries(d.toggles)) {
        if (id in TOGGLE_DEFS && value != null) set(id as ToggleId, value);
      }
    }
    if (d.keepalivePreset && d.keepalivePreset in KEEPALIVE_PRESETS) {
      useConnectivitySettingsStore.setState({ keepalivePreset: d.keepalivePreset });
    }
    if (d.locale && SUPPORTED_LOCALES.some((l) => l.value === d.locale)) {
      useLocaleStore.getState().setLocale(d.locale);
    }
  },

  merge: lastWriteWins,

  getTimestamp(): string {
    return useAppSettingsTimestampStore.getState().updatedAt;
  },

  touch(): void {
    useAppSettingsTimestampStore.getState().touch();
  },

  describe(): string {
    const { preferredShell } = useTerminalSettingsStore.getState();
    return preferredShell
      ? i18n.t("importExport.userData.describe.appSettingsShell", { shell: preferredShell })
      : i18n.t("importExport.userData.describe.appSettingsDefault");
  },
};
