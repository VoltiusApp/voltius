import { TOGGLE_DEFS } from "@/stores/toggleSettingsStore";

export interface SettingKeyDef {
  /** Dotted path into the bundle; the first segment is the handler key. */
  id: string;
  labelKey: string;
  /** A property of the machine, not of the person: not synced unless the user opts in. */
  deviceScoped?: boolean;
}

// Only leaves a user can plausibly want to pin to one device belong here.
// A domain with no entry is controlled by its domain toggle alone.
const HAND_WRITTEN: SettingKeyDef[] = [
  {
    id: "appSettings.terminal.preferredShell",
    labelKey: "settings.sync.settingKey.preferredShell",
    // A filesystem path that is wrong on another OS by construction.
    deviceScoped: true,
  },
  { id: "appSettings.terminal.cursorStyle", labelKey: "settings.terminal.cursorStyle.title" },
  { id: "appSettings.sftp.autoRefreshIntervalMs", labelKey: "settings.sftp.filePanel.refreshInterval.title" },
  { id: "appSettings.plugins.overrides", labelKey: "settings.sync.settingKey.pluginOverrides" },
  { id: "appSettings.keepalivePreset", labelKey: "settings.hosts.keepalive.title" },
  { id: "appSettings.locale", labelKey: "settings.appearance.language.title" },
  {
    id: "themes.location",
    labelKey: "settings.sync.settingKey.themeLocation",
    // The user's coordinates. It only ever synced by accident of theme.json
    // carrying whatever themeStore persisted (see PR 1).
    deviceScoped: true,
  },
];

export const SETTING_KEYS: SettingKeyDef[] = [
  ...HAND_WRITTEN,
  ...Object.entries(TOGGLE_DEFS).map(([id, def]) => ({
    id: `appSettings.toggles.${id}`,
    labelKey: def.labelKey,
  })),
];

const BY_ID = new Map(SETTING_KEYS.map((k) => [k.id, k]));

export function settingKey(id: string): SettingKeyDef | undefined {
  return BY_ID.get(id);
}

export function domainOf(id: string): string {
  return id.slice(0, id.indexOf("."));
}

/** The path within the section's data, i.e. the id minus its domain. */
export function relPath(id: string): string {
  return id.slice(id.indexOf(".") + 1);
}

export function keysForDomain(domain: string): SettingKeyDef[] {
  return SETTING_KEYS.filter((k) => domainOf(k.id) === domain);
}
