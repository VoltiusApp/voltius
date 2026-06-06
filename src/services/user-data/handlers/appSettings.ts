import { invoke } from "@tauri-apps/api/core";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useToggleSettingsStore, TOGGLE_DEFS, type ToggleId } from "@/stores/toggleSettingsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { KEEPALIVE_PRESETS, type KeepalivePreset } from "@/utils/keepalive";
import type { UserDataHandler } from "../handler";

interface AppSettingsData {
  sftp?: { autoRefreshIntervalMs: number };
  terminal?: { preferredShell: string | null };
  plugins?: { overrides: Record<string, boolean> };
  toggles?: Partial<Record<string, boolean>>;
  keepalivePreset?: KeepalivePreset;
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
      terminal: { preferredShell: terminal.preferredShell },
      plugins: { overrides: plugins.overrides },
      toggles: { ...values },
      keepalivePreset: useConnectivitySettingsStore.getState().keepalivePreset,
    };
  },

  async import(data: unknown): Promise<void> {
    const d = data as Partial<AppSettingsData>;
    if (d.sftp) {
      const s = useSftpSettingsStore.getState();
      if (d.sftp.autoRefreshIntervalMs != null) s.setAutoRefreshIntervalMs(d.sftp.autoRefreshIntervalMs);
    }
    if (d.terminal) {
      useTerminalSettingsStore.getState().setPreferredShell(d.terminal.preferredShell ?? null);
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
  },

  merge(_local, remote, localTs, remoteTs) {
    if (!_local) return { value: remote, updated: true };
    if (!remote) return { value: _local, updated: false };
    if (remoteTs > localTs) return { value: remote, updated: true };
    return { value: _local, updated: false };
  },

  getTimestamp(): string {
    return useAppSettingsTimestampStore.getState().updatedAt;
  },

  describe(): string {
    const { preferredShell } = useTerminalSettingsStore.getState();
    return preferredShell ? `shell: ${preferredShell}` : "default settings";
  },
};
