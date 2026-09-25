import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { CURSOR_STYLES, useTerminalSettingsStore, type TerminalCursorStyle } from "@/stores/terminalSettingsStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useToggleSettingsStore, TOGGLE_DEFS, type ToggleId } from "@/stores/toggleSettingsStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { remoteApplyTimestamp } from "@/stores/remoteApplyGuard";
import { getPath, hasPath, setPath } from "@/utils/dotPath";
import {
  useConnectivitySettingsStore,
  GLOBAL_PROXY_MODES,
  type GlobalProxy,
  type GlobalProxyMode,
} from "@/stores/connectivitySettingsStore";
import { useLocaleStore, SUPPORTED_LOCALES, type Locale } from "@/stores/localeStore";
import { KEEPALIVE_PRESETS, type KeepalivePreset } from "@/utils/keepalive";
import { lastWriteWins, type UserDataHandler } from "../handler";
import { keysForDomain, relPath } from "../settingKeys";

interface AppSettingsData {
  sftp?: { autoRefreshIntervalMs?: number };
  terminal?: { preferredShell?: string | null; cursorStyle?: TerminalCursorStyle };
  plugins?: { overrides?: Record<string, boolean> };
  toggles?: Partial<Record<string, boolean>>;
  keepalivePreset?: KeepalivePreset;
  locale?: Locale;
  proxy?: GlobalProxy;
  // Absent from peers that predate per-leaf clocks: every leaf then carries the section's clock.
  clocks?: Record<string, string>;
}

function leafClock(data: AppSettingsData, sectionTs: string, leaf: string): string {
  if (!data.clocks) return sectionTs;
  const at = data.clocks[leaf];
  return typeof at === "string" ? at : "";
}

const mergeAppSettings: UserDataHandler["merge"] = (local, remote, localTs, remoteTs) => {
  if (!local || !remote) return lastWriteWins(local, remote, localTs, remoteTs);
  const l = local as AppSettingsData;
  const r = remote as AppSettingsData;
  const value = JSON.parse(JSON.stringify(l)) as AppSettingsData;
  const clocks: Record<string, string> = {};
  const { isSettingSynced } = useSyncPrefsStore.getState();
  let updated = false;
  let updatedAt = localTs;
  for (const { id } of keysForDomain("appSettings")) {
    const leaf = relPath(id);
    const localAt = leafClock(l, localTs, leaf);
    const remoteAt = leafClock(r, remoteTs, leaf);
    if (isSettingSynced(id) && hasPath(r, leaf) && remoteAt > localAt) {
      setPath(value, leaf, getPath(r, leaf));
      clocks[leaf] = remoteAt;
      if (remoteAt > updatedAt) updatedAt = remoteAt;
      updated = true;
    } else if (localAt) {
      clocks[leaf] = localAt;
    }
  }
  value.clocks = clocks;
  return { value, updated, updatedAt };
};

// Sync input is untrusted: rebuild a fresh object field-by-field instead of
// trusting the sender's types, so a bad host/port never reaches the Rust IPC.
function normalizeGlobalProxy(raw: unknown): GlobalProxy | null {
  if (!raw || typeof raw !== "object") return null;
  const { mode, host, port, username } = raw as Record<string, unknown>;
  if (typeof mode !== "string" || !GLOBAL_PROXY_MODES.includes(mode as GlobalProxyMode)) return null;
  const out: GlobalProxy = { mode: mode as GlobalProxyMode };
  if (typeof host === "string" && host.trim()) out.host = host.trim();
  if (typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535) out.port = port;
  if (typeof username === "string" && username.trim()) out.username = username.trim();
  return out;
}

export const appSettingsHandler: UserDataHandler = {
  key: "appSettings",
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
      proxy: useConnectivitySettingsStore.getState().proxy,
      clocks: { ...useAppSettingsTimestampStore.getState().clocks },
    };
  },

  async import(data: unknown): Promise<void> {
    const d = data as Partial<AppSettingsData>;
    if (d.sftp) {
      const s = useSftpSettingsStore.getState();
      if (d.sftp.autoRefreshIntervalMs != null) s.setAutoRefreshIntervalMs(d.sftp.autoRefreshIntervalMs);
    }
    if (d.terminal && typeof d.terminal === "object") {
      const s = useTerminalSettingsStore.getState();
      // An absent leaf means "held back by the sender", not "cleared": a device
      // filtering preferredShell out of its push must not reset every other
      // device's shell to the default.
      if ("preferredShell" in d.terminal) s.setPreferredShell(d.terminal.preferredShell ?? null);
      const style = d.terminal.cursorStyle;
      if (style && CURSOR_STYLES.includes(style)) s.setCursorStyle(style);
    }
    const overrides = d.plugins?.overrides;
    if (overrides) usePluginRegistryStore.setState({ overrides });
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
    const proxy = normalizeGlobalProxy(d.proxy);
    if (proxy) useConnectivitySettingsStore.setState({ proxy });
    if (d.clocks && typeof d.clocks === "object" && remoteApplyTimestamp() !== null) {
      useAppSettingsTimestampStore.getState().adoptClocks(d.clocks);
    }
    if (overrides) await invoke("plugin_registry_save", { overrides }).catch(() => {});
  },

  merge: mergeAppSettings,

  getTimestamp(): string {
    return useAppSettingsTimestampStore.getState().updatedAt;
  },

  touch(path?: string): void {
    useAppSettingsTimestampStore.getState().touch(path ? [relPath(path)] : undefined);
  },

  describe(): string {
    const { preferredShell } = useTerminalSettingsStore.getState();
    return preferredShell
      ? i18n.t("importExport.userData.describe.appSettingsShell", { shell: preferredShell })
      : i18n.t("importExport.userData.describe.appSettingsDefault");
  },
};
