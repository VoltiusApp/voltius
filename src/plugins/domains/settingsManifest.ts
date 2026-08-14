import type { SettingsSection } from "@/stores/uiStore";
import { TOGGLE_DEFS, getToggle, useToggleSettingsStore, type ToggleId } from "@/stores/toggleSettingsStore";
import { SYNC_OBJECT_TYPES, useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { DEFAULT_SCROLLBACK_LINES, MIN_SCROLLBACK_LINES, MAX_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import {
  useSftpSettingsStore,
  DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  DEFAULT_EDITOR_MAX_BYTES,
} from "@/stores/sftpSettingsStore";
import { useConnectivitySettingsStore } from "@/stores/connectivitySettingsStore";
import { KEEPALIVE_PRESETS, DEFAULT_KEEPALIVE_PRESET } from "@/utils/keepalive";
import { useThemeStore } from "@/stores/themeStore";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@/themes/presets";
import { useLocaleStore, SUPPORTED_LOCALES } from "@/stores/localeStore";
import { useSecurityStore } from "@/stores/securityStore";
import { useUpdaterPrefStore } from "@/stores/updaterPrefStore";
import { useShortcutStore } from "@/stores/shortcutStore";

export interface SettingDef {
  key: string;
  type: "boolean" | "number" | "enum" | "string" | "structured";
  values?: readonly string[];
  min?: number;
  max?: number;
  default: unknown;
  section: SettingsSection;
  /** Clé i18n, résolue à l'appel de `setting_list` — jamais au build. */
  labelKey: string;
  writable: boolean;
  /** Clé i18n. Présente seulement sur les clés qui désarment un garde-fou. */
  consequence?: string;
  get(): unknown;
  set?(value: unknown): void;
}

/** La catégorie déclarée par TOGGLE_DEFS, traduite en section de l'écran Settings.
 *  `updates` vise `about` : c'est AboutSection qui rend la bascule du changelog
 *  et la préférence de mise à jour automatique. */
const TOGGLE_SECTION: Record<string, SettingsSection> = {
  appearance: "appearance",
  portForwarding: "portForwarding",
  sftp: "sftp",
  hosts: "hosts",
  updates: "about",
  plugins: "plugins",
  integrations: "integrations",
};

const GUARDED: Record<string, string> = {
  "toggles.plugin-install-review": "settings.mcp.consequence.pluginInstallReview",
  "security.sessionTimeoutMinutes": "settings.mcp.consequence.sessionTimeout",
};

function toggleDefs(): SettingDef[] {
  return (Object.keys(TOGGLE_DEFS) as ToggleId[]).map((id) => {
    const def = TOGGLE_DEFS[id];
    const category = def.descriptionKey.split(".").pop() ?? "appearance";
    const key = `toggles.${id}`;
    return {
      key,
      type: "boolean" as const,
      default: def.default,
      section: TOGGLE_SECTION[category] ?? "appearance",
      labelKey: def.labelKey,
      writable: true,
      consequence: GUARDED[key],
      get: () => getToggle(id),
      set: (v: unknown) => useToggleSettingsStore.getState().set(id, v as boolean),
    };
  });
}

function syncDefs(): SettingDef[] {
  return SYNC_OBJECT_TYPES.map((t) => ({
    key: `sync.type.${t.id}`,
    type: "boolean" as const,
    default: true,
    section: "sync" as const,
    labelKey: "settings.sync.objectType",
    writable: true,
    get: () => useSyncPrefsStore.getState().isTypeSynced(t.id),
    set: (v: unknown) => useSyncPrefsStore.getState().setSyncType(t.id, v as boolean),
  }));
}

function shortcutDefs(): SettingDef[] {
  return useShortcutStore.getState().shortcuts.map((sc) => ({
    key: `shortcuts.${sc.id}`,
    type: "structured" as const,
    default: "",
    section: "shortcuts" as const,
    labelKey: "settings.shortcuts.binding",
    writable: false,
    get: () =>
      [sc.ctrl && "Ctrl", sc.shift && "Shift", sc.alt && "Alt", sc.key]
        .filter(Boolean)
        .join("+"),
  }));
}

function themeIds(): string[] {
  return [
    ...BUILT_IN_THEMES.map((t) => t.id),
    ...useThemeStore.getState().customThemes.map((t) => t.id),
  ];
}

function explicitDefs(): SettingDef[] {
  const terminal = () => useTerminalSettingsStore.getState();
  const sftp = () => useSftpSettingsStore.getState();
  const theme = () => useThemeStore.getState();

  return [
    {
      key: "terminal.scrollbackLines",
      type: "number", min: MIN_SCROLLBACK_LINES, max: MAX_SCROLLBACK_LINES,
      default: DEFAULT_SCROLLBACK_LINES,
      section: "terminal", labelKey: "settings.terminal.scrollback", writable: true,
      get: () => terminal().scrollbackLines,
      set: (v) => terminal().setScrollbackLines(v as number),
    },
    {
      key: "terminal.preferredShell",
      // No `values`: the only source of valid shells (useLocalShells / local_list_shells) is
      // async with no synchronous accessor, so it can't feed this manifest's synchronous read.
      type: "string", default: null,
      section: "terminal", labelKey: "settings.terminal.preferredShell", writable: true,
      get: () => terminal().preferredShell,
      set: (v) => terminal().setPreferredShell(v === null ? null : String(v)),
    },
    {
      key: "sftp.autoRefreshIntervalMs",
      type: "number", min: 250, max: 60_000,
      default: DEFAULT_AUTO_REFRESH_INTERVAL_MS,
      section: "sftp", labelKey: "settings.sftp.autoRefreshInterval", writable: true,
      get: () => sftp().autoRefreshIntervalMs,
      set: (v) => sftp().setAutoRefreshIntervalMs(v as number),
    },
    {
      key: "sftp.editorAutoSave",
      type: "boolean", default: false,
      section: "sftp", labelKey: "settings.sftp.editorAutoSave", writable: true,
      get: () => sftp().editorAutoSave,
      set: (v) => sftp().setEditorAutoSave(v as boolean),
    },
    {
      key: "sftp.editorMaxBytes",
      type: "number", min: 1024, max: 100 * 1024 * 1024,
      default: DEFAULT_EDITOR_MAX_BYTES,
      section: "sftp", labelKey: "settings.sftp.editorMaxBytes", writable: true,
      get: () => sftp().editorMaxBytes,
      set: (v) => sftp().setEditorMaxBytes(v as number),
    },
    {
      key: "sftp.showHidden",
      type: "boolean", default: false,
      section: "sftp", labelKey: "settings.sftp.showHidden", writable: true,
      get: () => sftp().showHidden,
      set: (v) => sftp().setShowHidden(v as boolean),
    },
    {
      key: "connectivity.keepalivePreset",
      type: "enum", values: Object.keys(KEEPALIVE_PRESETS),
      default: DEFAULT_KEEPALIVE_PRESET,
      section: "hosts", labelKey: "settings.hosts.keepalive", writable: true,
      get: () => useConnectivitySettingsStore.getState().keepalivePreset,
      set: (v) => useConnectivitySettingsStore.getState().setKeepalivePreset(v as never),
    },
    {
      key: "theme.activeThemeId",
      type: "enum", values: themeIds(),
      default: DEFAULT_THEME_ID,
      section: "appearance", labelKey: "settings.appearance.theme", writable: true,
      get: () => theme().activeThemeId,
      set: (v) => theme().setTheme(String(v)),
    },
    {
      key: "theme.mode",
      type: "enum", values: ["manual", "system", "schedule", "sunset"],
      default: "manual",
      section: "appearance", labelKey: "settings.appearance.themeMode", writable: true,
      get: () => theme().mode,
      set: (v) => theme().setMode(v as never),
    },
    {
      key: "theme.lightThemeId",
      type: "enum", values: themeIds(), default: DEFAULT_LIGHT_THEME_ID,
      section: "appearance", labelKey: "settings.appearance.lightTheme", writable: true,
      get: () => theme().lightThemeId,
      set: (v) => theme().setLightThemeId(String(v)),
    },
    {
      key: "theme.darkThemeId",
      type: "enum", values: themeIds(), default: DEFAULT_THEME_ID,
      section: "appearance", labelKey: "settings.appearance.darkTheme", writable: true,
      get: () => theme().darkThemeId,
      set: (v) => theme().setDarkThemeId(String(v)),
    },
    {
      key: "locale.language",
      type: "enum", values: SUPPORTED_LOCALES.map((l) => l.value), default: "en",
      section: "appearance", labelKey: "settings.appearance.language", writable: true,
      get: () => useLocaleStore.getState().locale,
      set: (v) => useLocaleStore.getState().setLocale(v as never),
    },
    {
      key: "security.sessionTimeoutMinutes",
      type: "number", min: 1, max: 1440, default: null,
      section: "account", labelKey: "settings.account.sessionTimeout", writable: true,
      consequence: GUARDED["security.sessionTimeoutMinutes"],
      get: () => useSecurityStore.getState().sessionTimeoutMinutes,
      set: (v) => useSecurityStore.getState().setSessionTimeoutMinutes(v === null ? null : (v as number)),
    },
    {
      key: "updater.autoUpdate",
      type: "boolean", default: true,
      section: "about", labelKey: "settings.about.autoUpdate", writable: true,
      get: () => useUpdaterPrefStore.getState().autoUpdate,
      set: (v) => useUpdaterPrefStore.getState().setAutoUpdate(v as boolean),
    },
  ];
}

export function settingDefs(): SettingDef[] {
  return [...toggleDefs(), ...syncDefs(), ...explicitDefs(), ...shortcutDefs()];
}

export function settingDef(key: string): SettingDef | undefined {
  return settingDefs().find((d) => d.key === key);
}
