import { TOGGLE_DEFS, getToggle, useToggle, useToggleSettingsStore, type ToggleId } from "@/stores/toggleSettingsStore";
import { SYNC_OBJECT_TYPES, useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { usePluginStore } from "@/stores/pluginStore";
import {
  CURSOR_STYLES,
  DEFAULT_CURSOR_STYLE,
  cursorStyleSetting,
  preferredShellSetting,
  useTerminalSettingsStore,
  type TerminalCursorStyle,
} from "@/stores/terminalSettingsStore";
import { DEFAULT_SCROLLBACK_LINES, MIN_SCROLLBACK_LINES, MAX_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { DEFAULT_KEYWORD_RULES, sameKeywordRules } from "@/utils/keywordMatcher";
import {
  useSftpSettingsStore,
  DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  autoRefreshIntervalSetting,
  DEFAULT_EDITOR_MAX_BYTES,
} from "@/stores/sftpSettingsStore";
import {
  useConnectivitySettingsStore,
  getGlobalKeepalivePreset,
  getGlobalDetachedTtlHours,
  useGlobalKeepalivePreset,
  useDetachedTtlHours,
  DETACHED_TTL_HOURS,
  DEFAULT_DETACHED_TTL_HOURS,
  DEFAULT_GLOBAL_PROXY,
  getGlobalProxy,
  useGlobalProxy,
  type DetachedTtlHours,
} from "@/stores/connectivitySettingsStore";
import { KEEPALIVE_PRESETS, DEFAULT_KEEPALIVE_PRESET, type KeepalivePreset } from "@/utils/keepalive";
import { useThemeStore } from "@/stores/themeStore";
import { effectiveShell } from "@/services/local";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@/themes/presets";
import { DYNAMIC_THEME_ID, DYNAMIC_THEME_NAME } from "@/themes/dynamic";
import { localeSetting, timeFormatSetting, useLocaleStore, SUPPORTED_LOCALES, TIME_FORMATS } from "@/stores/localeStore";
import { lockActionSetting, sessionTimeoutSetting, useSecurityStore, type LockAction } from "@/stores/securityStore";
import { useUpdaterPrefStore } from "@/stores/updaterPrefStore";
import { MAX_TERMINAL_FONT_SIZE, MAX_UI_SCALE, MIN_TERMINAL_FONT_SIZE, MIN_UI_SCALE, useUIStore } from "@/stores/uiStore";
import { locationSetting } from "@/stores/themeStore";
import { DEFAULT_ACTIVE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, MIN_ACTIVE_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS, useHostPingStore } from "@/stores/hostPingStore";
import { SYNC_SETTING_DOMAINS } from "@/stores/syncDomains";
import { setDomainSync } from "@/services/user-data/syncChoice";
import { formatShortcut, getDefaultShortcut, useShortcutStore, type Shortcut } from "@/stores/shortcutStore";
import { sessionTimeoutOptions, sessionTimeoutValue } from "@/utils/sessionTimeout";
import type { SettingConsequence, SettingControl, SettingDef, SettingOption, Translate } from "./types";

export type { SettingConsequence, SettingDef } from "./types";

/** Éteindre est la seule direction dangereuse d'une bascule de sûreté. */
const turningOff: SettingConsequence["weakens"] = (next) => next === false;

export const GUARDED: Record<string, SettingConsequence> = {
  "toggles.plugin-install-review": {
    key: "settings.mcp.consequence.pluginInstallReview",
    weakens: turningOff,
  },
  "updater.autoUpdate": {
    key: "settings.mcp.consequence.autoUpdate",
    weakens: turningOff,
  },
  "security.sessionTimeoutMinutes": {
    key: "settings.mcp.consequence.sessionTimeout",
    // null = plus de verrouillage du tout ; un délai plus long laisse le coffre
    // ouvert plus longtemps. Le raccourcir ne désarme rien.
    weakens: (next, current) =>
      next === null
      || (typeof next === "number" && typeof current === "number" && next > current),
  },
  "security.lockAction": {
    key: "settings.mcp.consequence.lockAction",
    weakens: (next) => next === "screen",
  },
  "security.systemAuthUnlock": {
    key: "settings.mcp.consequence.systemAuthUnlock",
    weakens: (next) => next === true,
  },
};


const toggleControl: SettingControl = { kind: "toggle" };
const options = (values: readonly string[], label: (v: string, t: Translate) => string) => (t: Translate): SettingOption[] =>
  values.map((value) => ({ value, label: label(value, t) }));

type ToggleRow = Partial<Pick<SettingDef, "titleKey" | "descKey" | "platform" | "mobileHidden" | "useActive" | "isDirty" | "reset">> & { use?(): unknown };

const whenToggle = (id: ToggleId) => () => useToggle(id)[0];

const TOGGLE_ROWS: Record<ToggleId, ToggleRow> = {
  "cursor-blink": { titleKey: "settings.terminal.cursorBlink.title", descKey: "settings.terminal.cursorBlink.desc" },
  "scroll-minimap": { titleKey: "settings.terminal.minimap.title", descKey: "settings.terminal.minimap.desc" },
  "select-to-copy": { titleKey: "settings.terminal.selectToCopy.title", descKey: "settings.terminal.selectToCopy.desc" },
  "drag-selects-text": { titleKey: "settings.terminal.dragSelectsText.title", descKey: "settings.terminal.dragSelectsText.desc", mobileHidden: true },
  "group-tabs-by-host": { titleKey: "settings.appearance.groupTabsByHost.title", descKey: "settings.appearance.groupTabsByHost.desc", mobileHidden: true },
  "ignore-bracketed-paste": { titleKey: "settings.terminal.ignoreBracketedPaste.title", descKey: "settings.terminal.ignoreBracketedPaste.desc" },
  "command-history": { titleKey: "settings.terminal.commandHistory.title", descKey: "settings.terminal.commandHistory.desc" },
  "paste-image-as-path": { titleKey: "settings.terminal.pasteImageAsPath.title", descKey: "settings.terminal.pasteImageAsPath.desc" },
  "volume-down-ctrl": { titleKey: "settings.terminal.volumeDownCtrl.title", descKey: "settings.terminal.volumeDownCtrl.desc", platform: "android" },
  "keyword-highlight": {
    titleKey: "settings.terminal.keywordHighlight.title",
    descKey: "settings.terminal.keywordHighlight.desc",
    use: () => {
      useTerminalSettingsStore((st) => st.keywordRules);
      return useToggle("keyword-highlight")[0];
    },
    isDirty: (v, d) => v !== d || !sameKeywordRules(useTerminalSettingsStore.getState().keywordRules, DEFAULT_KEYWORD_RULES),
    reset: () => {
      useToggleSettingsStore.getState().set("keyword-highlight", TOGGLE_DEFS["keyword-highlight"].default);
      useTerminalSettingsStore.getState().setKeywordRules(DEFAULT_KEYWORD_RULES);
    },
  },
  "auto-forward": { titleKey: "settings.portForwarding.autoForward.title", descKey: "settings.portForwarding.autoForward.desc" },
  "forwarding-notifications": { titleKey: "settings.portForwarding.notifications.title", descKey: "settings.portForwarding.notifications.desc", useActive: whenToggle("auto-forward") },
  "sftp-tar": { titleKey: "settings.sftp.transfers.tarAcceleration.title", descKey: "settings.sftp.transfers.tarAcceleration.desc" },
  "sftp-autorefresh": { titleKey: "settings.sftp.filePanel.autoRefresh.title", descKey: "settings.sftp.filePanel.autoRefresh.desc" },
  "reachability": { titleKey: "settings.hosts.reachability.title", descKey: "settings.hosts.reachability.desc" },
  "team-presence": { titleKey: "settings.hosts.teamPresence.title", descKey: "settings.hosts.teamPresence.desc" },
  "shell-integration": { titleKey: "settings.hosts.shellIntegration.title", descKey: "settings.hosts.shellIntegration.desc" },
  "persistent-sessions": { titleKey: "settings.hosts.persistentSessions.title", descKey: "settings.hosts.persistentSessions.desc" },
  "detached-session-ttl": { titleKey: "settings.hosts.detachedTtl.title", descKey: "settings.hosts.detachedTtl.desc" },
  "restore-workspace": {},
  "cross-device-sessions": {},
  "changelog-popup": { titleKey: "settings.about.whatsNew.title", descKey: "settings.about.whatsNew.desc", platform: "desktop" },
  "plugin-install-review": {},
  "mcp-server": { descKey: "settings.integrations.mcp.sub", platform: "desktop" },
};

function toggleDefs(): SettingDef[] {
  return (Object.keys(TOGGLE_DEFS) as ToggleId[]).map((id) => {
    const def = TOGGLE_DEFS[id];
    const key = `toggles.${id}`;
    const policyKey = `appSettings.toggles.${id}`;
    const row = TOGGLE_ROWS[id];
    return {
      key,
      type: "boolean" as const,
      default: def.default,
      section: def.section,
      labelKey: def.labelKey,
      titleKey: row.titleKey,
      descKey: row.descKey,
      keywords: def.keywords,
      platform: row.platform,
      mobileHidden: row.mobileHidden,
      useActive: row.useActive,
      isDirty: row.isDirty,
      reset: row.reset,
      writable: true,
      policyKey,
      syncKey: policyKey,
      consequence: GUARDED[key],
      control: toggleControl,
      get: () => getToggle(id),
      use: row.use ?? (() => useToggle(id)[0]),
      set: (v: unknown) => useToggleSettingsStore.getState().set(id, v as boolean),
    };
  });
}

function syncDefs(): SettingDef[] {
  return SYNC_OBJECT_TYPES.map((ty) => ({
    key: `sync.type.${ty.id}`,
    type: "boolean" as const,
    default: true,
    section: "sync" as const,
    labelKey: `settings.sync.objectType.${ty.id}.label`,
    descKey: `settings.sync.objectType.${ty.id}.sub`,
    writable: true,
    policyKey: `sync.types.${ty.id}`,
    control: toggleControl,
    get: () => useSyncPrefsStore.getState().isTypeSynced(ty.id),
    use: () => useSyncPrefsStore((st) => st.isTypeSynced(ty.id)),
    set: (v: unknown) => useSyncPrefsStore.getState().setSyncType(ty.id, v as boolean),
  }));
}

const findShortcut = (shortcuts: Shortcut[], id: string) => shortcuts.find((sc) => sc.id === id);

function shortcutDefs(): SettingDef[] {
  return useShortcutStore.getInitialState().shortcuts.map((initial) => {
    const id = initial.id;
    const current = () => findShortcut(useShortcutStore.getState().shortcuts, id) ?? initial;
    return {
      key: `shortcuts.${id}`,
      type: "structured" as const,
      get default() {
        const d = getDefaultShortcut(id);
        return d ? formatShortcut({ key: d.defaultKey, ctrl: d.ctrl, shift: d.shift, alt: d.alt }) : "";
      },
      section: "shortcuts" as const,
      labelKey: initial.labelKey,
      descKey: initial.descriptionKey,
      platform: "desktop" as const,
      writable: false,
      control: { kind: "open" } as const,
      get: () => formatShortcut(current()),
      use: () => useShortcutStore((st) => formatShortcut(findShortcut(st.shortcuts, id) ?? initial)),
      reset: () => useShortcutStore.getState().reset(id),
    };
  });
}

function themeIds(): string[] {
  return [
    ...BUILT_IN_THEMES.map((th) => th.id),
    DYNAMIC_THEME_ID,
    ...useThemeStore.getState().customThemes.map((th) => th.id),
  ];
}

function themeOptions(): SettingOption[] {
  const named = [
    ...BUILT_IN_THEMES,
    ...useThemeStore.getState().customThemes,
    ...usePluginStore.getState().pluginThemes.values(),
  ].map((th) => ({ value: th.id, label: th.name }));
  return [{ value: DYNAMIC_THEME_ID, label: DYNAMIC_THEME_NAME }, ...named];
}

const SCROLLBACK_OPTIONS = [1_000, 10_000, 50_000, 100_000, 250_000]
  .filter((v) => v >= MIN_SCROLLBACK_LINES && v <= MAX_SCROLLBACK_LINES);
const HOURS_PER_DAY = 24;
const ttlLabel = (h: number, t: Translate) =>
  h > HOURS_PER_DAY && h % HOURS_PER_DAY === 0
    ? t("settings.hosts.detachedTtl.days", { count: h / HOURS_PER_DAY })
    : t("settings.hosts.detachedTtl.hours", { count: h });
const THEME_MODE_LABELS: Record<string, string> = {
  manual: "settings.appearance.automation.modeManual",
  system: "settings.appearance.automation.modeSystem",
  schedule: "settings.appearance.automation.modeSchedule",
  sunset: "settings.appearance.automation.modeSunset",
};

function explicitDefs(): SettingDef[] {
  const terminal = () => useTerminalSettingsStore.getState();
  const sftp = () => useSftpSettingsStore.getState();
  const theme = () => useThemeStore.getState();

  return [
    {
      key: "terminal.scrollbackLines",
      type: "number", min: MIN_SCROLLBACK_LINES, max: MAX_SCROLLBACK_LINES,
      default: DEFAULT_SCROLLBACK_LINES,
      section: "terminal", labelKey: "settings.terminal.scrollback.title", descKey: "settings.terminal.scrollback.desc",
      keywords: ["history", "buffer", "lines"], writable: true,
      control: {
        kind: "select",
        options: (t) => SCROLLBACK_OPTIONS.map((v) => ({ value: String(v), label: t("settings.terminal.scrollback.option", { count: v }) })),
        toOption: String,
        fromOption: Number,
      },
      get: () => terminal().scrollbackLines,
      use: () => useTerminalSettingsStore((st) => st.scrollbackLines),
      set: (v) => terminal().setScrollbackLines(v as number),
    },
    {
      key: "terminal.cursorStyle",
      type: "enum", values: CURSOR_STYLES,
      default: DEFAULT_CURSOR_STYLE,
      section: "terminal", labelKey: "settings.terminal.cursorStyle.title", descKey: "settings.terminal.cursorStyle.desc",
      keywords: ["caret", "block", "bar", "underline"], writable: true,
      policyKey: "appSettings.terminal.cursorStyle",
      syncKey: "appSettings.terminal.cursorStyle",
      control: { kind: "select", options: options(CURSOR_STYLES, (v, t) => t(`settings.terminal.cursorStyle.${v}`)) },
      get: () => cursorStyleSetting.get(),
      use: () => cursorStyleSetting.use(),
      set: (v) => terminal().setCursorStyle(v as TerminalCursorStyle),
    },
    {
      key: "terminal.preferredShell",
      // No `values`: shells are detected asynchronously, so this synchronous manifest can't list them.
      type: "string", default: null,
      section: "terminal", labelKey: "settings.terminal.preferredShell.title",
      keywords: ["shell", "bash", "zsh", "fish", "powershell"], writable: true,
      policyKey: "appSettings.terminal.preferredShell",
      syncKey: "appSettings.terminal.preferredShell",
      control: { kind: "value" },
      get: () => effectiveShell(preferredShellSetting.get()),
      use: () => effectiveShell(preferredShellSetting.use()),
      isDirty: () => preferredShellSetting.get() != null,
      set: (v) => terminal().setPreferredShell(v === null ? null : String(v)),
    },
    {
      key: "sftp.autoRefreshIntervalMs",
      type: "number", min: 250, max: 60_000,
      default: DEFAULT_AUTO_REFRESH_INTERVAL_MS,
      section: "sftp", labelKey: "settings.sftp.filePanel.refreshInterval.title", descKey: "settings.sftp.filePanel.refreshInterval.desc",
      keywords: ["refresh", "interval", "poll"], writable: true,
      policyKey: "appSettings.sftp.autoRefreshIntervalMs",
      syncKey: "appSettings.sftp.autoRefreshIntervalMs",
      control: { kind: "number", min: 0.5, step: 0.5, unit: (t) => t("settings.sftp.filePanel.refreshInterval.unit"), toDisplay: (v) => Number(v) / 1000, fromDisplay: (n) => Math.round(n * 1000) },
      get: () => autoRefreshIntervalSetting.get(),
      use: () => autoRefreshIntervalSetting.use(),
      useActive: whenToggle("sftp-autorefresh"),
      set: (v) => sftp().setAutoRefreshIntervalMs(v as number),
    },
    {
      key: "sftp.editorAutoSave",
      type: "boolean", default: false,
      section: "sftp", labelKey: "settings.sftp.editor.autoSave.title", descKey: "settings.sftp.editor.autoSave.desc",
      keywords: ["editor", "save"], writable: true,
      control: toggleControl,
      get: () => sftp().editorAutoSave,
      use: () => useSftpSettingsStore((st) => st.editorAutoSave),
      set: (v) => sftp().setEditorAutoSave(v as boolean),
    },
    {
      key: "sftp.editorMaxBytes",
      type: "number", min: 1024, max: 100 * 1024 * 1024,
      default: DEFAULT_EDITOR_MAX_BYTES,
      section: "sftp", labelKey: "settings.sftp.editor.maxBytes.title",
      keywords: ["editor", "size", "limit"], writable: true,
      control: { kind: "value" },
      get: () => sftp().editorMaxBytes,
      use: () => useSftpSettingsStore((st) => st.editorMaxBytes),
      set: (v) => sftp().setEditorMaxBytes(v as number),
    },
    {
      key: "sftp.showHidden",
      type: "boolean", default: false,
      section: "sftp", labelKey: "settings.sftp.filePanel.showHidden.title",
      keywords: ["hidden", "dotfiles"], writable: true,
      control: toggleControl,
      get: () => sftp().showHidden,
      use: () => useSftpSettingsStore((st) => st.showHidden),
      set: (v) => sftp().setShowHidden(v as boolean),
    },
    {
      key: "connectivity.keepalivePreset",
      type: "enum", values: Object.keys(KEEPALIVE_PRESETS),
      default: DEFAULT_KEEPALIVE_PRESET,
      section: "hosts", labelKey: "settings.hosts.keepalive.title",
      keywords: ["keepalive", "timeout", "disconnect"], writable: true,
      policyKey: "appSettings.keepalivePreset",
      syncKey: "appSettings.keepalivePreset",
      control: { kind: "select", width: "w-36", options: options(Object.keys(KEEPALIVE_PRESETS), (v, t) => t(KEEPALIVE_PRESETS[v as KeepalivePreset].labelKey)) },
      get: () => getGlobalKeepalivePreset(),
      use: () => useGlobalKeepalivePreset()[0],
      set: (v) => useConnectivitySettingsStore.getState().setKeepalivePreset(v as never),
    },
    {
      key: "connectivity.detachedTtlHours",
      type: "enum", values: DETACHED_TTL_HOURS.map(String),
      default: String(DEFAULT_DETACHED_TTL_HOURS),
      section: "hosts", labelKey: "settings.hosts.detachedTtl.durationTitle",
      keywords: ["detached", "idle", "close"], writable: true,
      policyKey: "appSettings.detachedTtlHours",
      syncKey: "appSettings.detachedTtlHours",
      control: { kind: "select", width: "w-36", options: options(DETACHED_TTL_HOURS.map(String), (v, t) => ttlLabel(Number(v), t)), fromOption: Number },
      get: () => String(getGlobalDetachedTtlHours()),
      use: () => String(useDetachedTtlHours()[0]),
      useActive: whenToggle("detached-session-ttl"),
      set: (v) => useConnectivitySettingsStore.getState().setDetachedTtlHours(Number(v) as DetachedTtlHours),
    },
    {
      key: "theme.activeThemeId",
      type: "enum", get values() { return themeIds(); },
      default: DEFAULT_THEME_ID,
      section: "appearance", labelKey: "settings.appearance.colorTheme",
      keywords: ["theme", "color", "dark", "light"], writable: true,
      control: { kind: "select", options: themeOptions },
      get: () => theme().activeThemeId,
      use: () => useThemeStore((st) => st.activeThemeId),
      set: (v) => theme().setTheme(String(v)),
    },
    {
      key: "theme.mode",
      type: "enum", values: ["manual", "system", "schedule", "sunset"],
      default: "manual",
      section: "appearance", labelKey: "settings.appearance.automation.themeMode", titleKey: "settings.appearance.automation.mode",
      keywords: ["theme", "automatic", "schedule", "sunset", "dark"], writable: true,
      control: { kind: "select", options: options(Object.keys(THEME_MODE_LABELS), (v, t) => t(THEME_MODE_LABELS[v])) },
      get: () => theme().mode,
      use: () => useThemeStore((st) => st.mode),
      set: (v) => theme().setMode(v as never),
    },
    {
      key: "theme.lightThemeId",
      type: "enum", get values() { return themeIds(); }, default: DEFAULT_LIGHT_THEME_ID,
      section: "appearance", labelKey: "settings.appearance.automation.lightTheme",
      keywords: ["theme", "light"], writable: true,
      control: { kind: "select", options: themeOptions },
      get: () => theme().lightThemeId,
      use: () => useThemeStore((st) => st.lightThemeId),
      set: (v) => theme().setLightThemeId(String(v)),
    },
    {
      key: "theme.darkThemeId",
      type: "enum", get values() { return themeIds(); }, default: DEFAULT_THEME_ID,
      section: "appearance", labelKey: "settings.appearance.automation.darkTheme",
      keywords: ["theme", "dark"], writable: true,
      control: { kind: "select", options: themeOptions },
      get: () => theme().darkThemeId,
      use: () => useThemeStore((st) => st.darkThemeId),
      set: (v) => theme().setDarkThemeId(String(v)),
    },
    {
      key: "locale.language",
      type: "enum", values: SUPPORTED_LOCALES.map((l) => l.value), default: useLocaleStore.getInitialState().locale,
      section: "appearance", labelKey: "settings.appearance.language.title",
      keywords: ["language", "locale", "translation"], writable: true,
      policyKey: "appSettings.locale",
      syncKey: "appSettings.locale",
      control: { kind: "select", options: () => SUPPORTED_LOCALES.map((l) => ({ value: l.value, label: l.label })) },
      get: () => localeSetting.get(),
      use: () => localeSetting.use(),
      set: (v) => useLocaleStore.getState().setLocale(v as never),
    },
    {
      key: "locale.timeFormat",
      type: "enum", values: [...TIME_FORMATS], default: "auto",
      section: "appearance", labelKey: "settings.appearance.timeFormat.title", descKey: "settings.appearance.timeFormat.desc",
      keywords: ["clock", "12h", "24h", "time"], writable: true,
      policyKey: timeFormatSetting.key,
      syncKey: timeFormatSetting.key,
      control: { kind: "select", options: options(TIME_FORMATS, (v, t) => t(`settings.appearance.timeFormat.${v}`)) },
      get: () => timeFormatSetting.get(),
      use: () => timeFormatSetting.use(),
      set: (v) => useLocaleStore.getState().setTimeFormat(v as never),
    },
    {
      key: "security.sessionTimeoutMinutes",
      type: "number", min: 0, max: 1440, default: null,
      section: "account", labelKey: "settings.account.sessionSecurity.autoLockLabel", descKey: "settings.account.sessionSecurity.autoLockDesc",
      keywords: ["lock", "timeout", "idle", "security"], writable: true,
      consequence: GUARDED["security.sessionTimeoutMinutes"],
      policyKey: sessionTimeoutSetting.key,
      control: {
        kind: "select",
        options: (t) => sessionTimeoutOptions(t),
        toOption: (v) => sessionTimeoutValue(v as number | null),
        fromOption: (o) => (o === "never" ? null : Number(o)),
      },
      get: () => sessionTimeoutSetting.get(),
      use: () => sessionTimeoutSetting.use(),
      set: (v) => useSecurityStore.getState().setSessionTimeoutMinutes(v === null ? null : (v as number)),
    },
    {
      key: "security.lockAction",
      type: "enum", values: ["vault", "screen"], default: "vault",
      section: "account", labelKey: "settings.account.sessionSecurity.lockAction.label",
      keywords: ["lock", "security", "screen", "vault"], writable: true,
      consequence: GUARDED["security.lockAction"],
      policyKey: lockActionSetting.key,
      control: { kind: "select", options: options(["vault", "screen"], (v, t) => t(`settings.account.sessionSecurity.lockAction.${v}`)) },
      get: () => lockActionSetting.get(),
      use: () => lockActionSetting.use(),
      set: (v) => useSecurityStore.getState().setLockAction(v as LockAction),
    },
    {
      key: "security.systemAuthUnlock",
      type: "boolean", default: false,
      section: "account", labelKey: "settings.account.sessionSecurity.systemAuth.toggle", descKey: "settings.account.sessionSecurity.systemAuth.desc",
      keywords: ["biometric", "touch id", "windows hello", "fingerprint", "unlock"], writable: true,
      consequence: GUARDED["security.systemAuthUnlock"],
      resettable: false,
      control: { kind: "open" },
      get: () => useSecurityStore.getState().systemAuthUnlock,
      use: () => useSecurityStore((st) => st.systemAuthUnlock),
      set: (v) => useSecurityStore.getState().setSystemAuthUnlock(v as boolean),
    },
    {
      key: "updater.autoUpdate",
      type: "boolean", default: true,
      section: "about", labelKey: "settings.about.autoDownload.title", descKey: "settings.about.autoDownload.desc",
      keywords: ["update", "upgrade", "download"], writable: true,
      platform: "desktop",
      consequence: GUARDED["updater.autoUpdate"],
      control: toggleControl,
      get: () => useUpdaterPrefStore.getState().autoUpdate,
      use: () => useUpdaterPrefStore((st) => st.autoUpdate),
      set: (v) => useUpdaterPrefStore.getState().setAutoUpdate(v as boolean),
    },
  ];
}

const PERCENT = 100;
const percent = (v: unknown) => Math.round(Number(v) * PERCENT);
const activeThemeFontSize = () => useThemeStore.getState().getActiveTheme().terminalFontSize;
const SECOND = 1000;

function addedDefs(): SettingDef[] {
  const ui = () => useUIStore.getState();
  const theme = () => useThemeStore.getState();
  const ping = () => useHostPingStore.getState();
  const whenThemeMode = (mode: string) => () => useThemeStore((st) => st.mode) === mode;
  const whenReachable = whenToggle("reachability");

  return [
    {
      key: "appearance.uiScale",
      type: "number", min: MIN_UI_SCALE, max: MAX_UI_SCALE, default: 1,
      section: "appearance", labelKey: "settings.appearance.uiScale.title", descKey: "settings.appearance.uiScale.desc",
      keywords: ["zoom", "scale", "size", "dpi"], writable: true,
      control: { kind: "stepper", min: MIN_UI_SCALE * PERCENT, max: MAX_UI_SCALE * PERCENT, step: 5, unit: () => "%", toDisplay: percent, fromDisplay: (n) => n / PERCENT },
      get: () => ui().uiScale,
      use: () => useUIStore((st) => st.uiScale),
      isDirty: (v, d) => percent(v) !== percent(d),
      set: (v) => ui().setUiScale(v as number),
    },
    {
      key: "appearance.terminalFontSize",
      type: "number", min: MIN_TERMINAL_FONT_SIZE, max: MAX_TERMINAL_FONT_SIZE, default: null,
      section: "appearance", labelKey: "settings.appearance.terminalFontSize.title", descKey: "settings.appearance.terminalFontSize.desc",
      keywords: ["font", "text size", "zoom"], writable: true,
      control: { kind: "stepper", min: MIN_TERMINAL_FONT_SIZE, max: MAX_TERMINAL_FONT_SIZE, step: 1, unit: () => "px", toDisplay: (v) => (v == null ? activeThemeFontSize() : Number(v)) },
      get: () => ui().terminalFontSize,
      use: () => useUIStore((st) => st.terminalFontSize),
      isDirty: (v) => v != null,
      set: (v) => ui().setTerminalFontSize(v === null ? null : (v as number)),
    },
    {
      key: "theme.scheduleLightStart",
      type: "string", default: "07:00",
      section: "appearance", labelKey: "settings.appearance.automation.lightStarts",
      keywords: ["schedule", "light", "morning"], writable: true,
      control: { kind: "time" },
      get: () => theme().scheduleLightStart,
      use: () => useThemeStore((st) => st.scheduleLightStart),
      useActive: whenThemeMode("schedule"),
      set: (v) => theme().setSchedule(String(v), theme().scheduleDarkStart),
    },
    {
      key: "theme.scheduleDarkStart",
      type: "string", default: "19:00",
      section: "appearance", labelKey: "settings.appearance.automation.darkStarts",
      keywords: ["schedule", "dark", "evening", "night"], writable: true,
      control: { kind: "time" },
      get: () => theme().scheduleDarkStart,
      use: () => useThemeStore((st) => st.scheduleDarkStart),
      useActive: whenThemeMode("schedule"),
      set: (v) => theme().setSchedule(theme().scheduleLightStart, String(v)),
    },
    {
      key: "themes.location",
      type: "structured", default: null,
      section: "appearance", labelKey: "settings.sync.settingKey.themeLocation",
      keywords: ["location", "sunset", "sunrise", "latitude", "longitude"], writable: false,
      policyKey: "themes.location",
      syncKey: "themes.location",
      control: { kind: "open" },
      get: () => locationSetting.get(),
      use: () => locationSetting.use(),
      useActive: whenThemeMode("sunset"),
      isDirty: (v) => v != null,
      reset: () => theme().setLocation(null),
    },
    {
      key: "hosts.pollIntervalMs",
      type: "number", min: MIN_POLL_INTERVAL_MS, default: DEFAULT_POLL_INTERVAL_MS,
      section: "hosts", labelKey: "settings.hosts.pollInterval.title", descKey: "settings.hosts.pollInterval.desc",
      keywords: ["ping", "reachability", "interval"], writable: true,
      control: { kind: "number", min: MIN_POLL_INTERVAL_MS / SECOND, max: 3600, step: 1, unit: (t) => t("settings.sftp.filePanel.refreshInterval.unit"), toDisplay: (v) => Number(v) / SECOND, fromDisplay: (n) => Math.round(n * SECOND) },
      get: () => ping().pollIntervalMs,
      use: () => useHostPingStore((st) => st.pollIntervalMs),
      useActive: whenReachable,
      set: (v) => ping().setPollIntervalMs(v as number),
    },
    {
      key: "hosts.activePollIntervalMs",
      type: "number", min: MIN_ACTIVE_POLL_INTERVAL_MS, default: DEFAULT_ACTIVE_POLL_INTERVAL_MS,
      section: "hosts", labelKey: "settings.hosts.activeInterval.title", descKey: "settings.hosts.activeInterval.desc",
      keywords: ["ping", "latency", "interval"], writable: true,
      control: { kind: "number", min: MIN_ACTIVE_POLL_INTERVAL_MS / SECOND, max: 600, step: 1, unit: (t) => t("settings.sftp.filePanel.refreshInterval.unit"), toDisplay: (v) => Number(v) / SECOND, fromDisplay: (n) => Math.round(n * SECOND) },
      get: () => ping().activePollIntervalMs,
      use: () => useHostPingStore((st) => st.activePollIntervalMs),
      useActive: whenReachable,
      set: (v) => ping().setActivePollIntervalMs(v as number),
    },
    {
      key: "connectivity.proxy",
      type: "structured", default: DEFAULT_GLOBAL_PROXY,
      section: "hosts", labelKey: "settings.hosts.proxy.title", descKey: "settings.hosts.proxy.desc",
      keywords: ["proxy", "socks", "http", "network"], writable: false,
      policyKey: "appSettings.proxy",
      syncKey: "appSettings.proxy",
      control: { kind: "open" },
      get: () => getGlobalProxy(),
      use: () => useGlobalProxy()[0],
      isDirty: (v, d) => (v as { mode?: string } | null)?.mode !== (d as { mode?: string } | null)?.mode,
      reset: () => useConnectivitySettingsStore.getState().setProxy(DEFAULT_GLOBAL_PROXY),
    },
    ...SYNC_SETTING_DOMAINS.map((dom): SettingDef => ({
      key: `sync.domain.${dom.id}`,
      type: "boolean", default: true,
      section: "sync", labelKey: `settings.sync.settingDomain.${dom.id}.label`, descKey: `settings.sync.settingDomain.${dom.id}.sub`,
      keywords: ["sync", "cloud"], writable: true,
      policyKey: `sync.domains.${dom.id}`,
      control: toggleControl,
      get: () => useSyncPrefsStore.getState().isDomainSynced(dom.id),
      use: () => useSyncPrefsStore((st) => st.isDomainSynced(dom.id)),
      set: (v) => setDomainSync(dom.id, v as boolean),
    })),
  ];
}

let cached: { list: SettingDef[]; byKey: Map<string, SettingDef> } | undefined;

function registry() {
  if (!cached) {
    const list = [...toggleDefs(), ...syncDefs(), ...explicitDefs(), ...addedDefs(), ...shortcutDefs()];
    cached = { list, byKey: new Map(list.map((d) => [d.key, d])) };
  }
  return cached;
}

export function settingDefs(): readonly SettingDef[] {
  return registry().list;
}

export function settingDef(key: string): SettingDef | undefined {
  return registry().byKey.get(key);
}
