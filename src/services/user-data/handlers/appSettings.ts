import { invoke } from "@tauri-apps/api/core";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { usePortForwardingSettingsStore } from "@/stores/portForwardingSettingsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import type { UserDataHandler } from "../handler";

interface AppSettingsData {
  sftp?: { autoRefreshEnabled: boolean; autoRefreshIntervalMs: number; tarTransferEnabled: boolean };
  terminal?: { preferredShell: string | null };
  plugins?: { overrides: Record<string, boolean> };
  portForwarding?: { autoForwardEnabled: boolean; autoForwardNotificationsEnabled: boolean };
}

export const appSettingsHandler: UserDataHandler = {
  key: "appSettings",
  label: "App Settings",
  icon: "lucide:settings",

  export(): AppSettingsData {
    const sftp = useSftpSettingsStore.getState();
    const terminal = useTerminalSettingsStore.getState();
    const plugins = usePluginRegistryStore.getState();
    const pf = usePortForwardingSettingsStore.getState();
    return {
      sftp: {
        autoRefreshEnabled: sftp.autoRefreshEnabled,
        autoRefreshIntervalMs: sftp.autoRefreshIntervalMs,
        tarTransferEnabled: sftp.tarTransferEnabled,
      },
      terminal: { preferredShell: terminal.preferredShell },
      plugins: { overrides: plugins.overrides },
      portForwarding: {
        autoForwardEnabled: pf.autoForwardEnabled,
        autoForwardNotificationsEnabled: pf.autoForwardNotificationsEnabled,
      },
    };
  },

  async import(data: unknown): Promise<void> {
    const d = data as Partial<AppSettingsData>;
    if (d.sftp) {
      const s = useSftpSettingsStore.getState();
      if (d.sftp.autoRefreshEnabled != null) s.setAutoRefreshEnabled(d.sftp.autoRefreshEnabled);
      if (d.sftp.autoRefreshIntervalMs != null) s.setAutoRefreshIntervalMs(d.sftp.autoRefreshIntervalMs);
      if (d.sftp.tarTransferEnabled != null) s.setTarTransferEnabled(d.sftp.tarTransferEnabled);
    }
    if (d.terminal) {
      useTerminalSettingsStore.getState().setPreferredShell(d.terminal.preferredShell ?? null);
    }
    if (d.plugins?.overrides) {
      const overrides = d.plugins.overrides;
      usePluginRegistryStore.setState({ overrides });
      await invoke("plugin_registry_save", { overrides }).catch(() => {});
    }
    if (d.portForwarding) {
      const s = usePortForwardingSettingsStore.getState();
      if (d.portForwarding.autoForwardEnabled != null) s.setAutoForwardEnabled(d.portForwarding.autoForwardEnabled);
      if (d.portForwarding.autoForwardNotificationsEnabled != null) s.setAutoForwardNotificationsEnabled(d.portForwarding.autoForwardNotificationsEnabled);
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
