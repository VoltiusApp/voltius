import { SETTING_KEYS, settingKey } from "@/services/user-data/settingKeys";
import { SYNC_OBJECT_TYPES, SYNC_SETTING_DOMAINS } from "@/stores/syncDomains";
import { CURSOR_STYLES } from "@/stores/terminalSettingsStore";
import { SUPPORTED_LOCALES } from "@/stores/localeStore";
import { DETACHED_TTL_HOURS, GLOBAL_PROXY_MODES } from "@/stores/connectivitySettingsStore";
import { KEEPALIVE_PRESETS } from "@/utils/keepalive";
import { ANSI_SLOTS, MAX_KEYWORD_LENGTH, MAX_KEYWORD_RULES, MAX_KEYWORD_WORDS } from "@/utils/keywordMatcher";

export type PolicyKeyType = "bool" | "string" | "number" | "stringList" | "json";

export type RangeField = "min" | "max" | "allowed";

export interface PolicyDomain {
  values?: Array<string | number>;
  min?: number;
  max?: number;
  shape?: "shell" | "proxy" | "keywordRules" | "location";
  colors?: string[];
  maxRules?: number;
  maxWords?: number;
  maxLength?: number;
}

export interface PolicyKeyDef {
  id: string;
  type: PolicyKeyType;
  domain?: PolicyDomain;
  range?: RangeField[];
  lock?: "add" | "never";
  implies?: string;
}

type KeyExtras = Omit<PolicyKeyDef, "id" | "type">;

const keyExtras = (): Record<string, KeyExtras> => ({
  "appSettings.terminal.cursorStyle": { domain: { values: [...CURSOR_STYLES] }, range: ["allowed"] },
  "appSettings.locale": { domain: { values: SUPPORTED_LOCALES.map((l) => l.value) }, range: ["allowed"] },
  "appSettings.keepalivePreset": { domain: { values: Object.keys(KEEPALIVE_PRESETS) }, range: ["allowed"] },
  "appSettings.detachedTtlHours": {
    domain: { values: [...DETACHED_TTL_HOURS] },
    range: ["allowed", "min", "max"],
    implies: "appSettings.toggles.detached-session-ttl",
  },
  "appSettings.sftp.autoRefreshIntervalMs": { domain: { min: 500 }, range: ["min", "max"] },
  "appSettings.terminal.preferredShell": { domain: { shape: "shell" }, range: ["allowed"] },
  "appSettings.proxy": { domain: { shape: "proxy", values: [...GLOBAL_PROXY_MODES] } },
  "appSettings.terminal.keywordRules": {
    domain: {
      shape: "keywordRules",
      colors: [...ANSI_SLOTS],
      maxRules: MAX_KEYWORD_RULES,
      maxWords: MAX_KEYWORD_WORDS,
      maxLength: MAX_KEYWORD_LENGTH,
    },
    lock: "add",
    implies: "appSettings.toggles.keyword-highlight",
  },
  "themes.location": { domain: { shape: "location" } },
  "appSettings.plugins.overrides": { lock: "never" },
});

const SETTING_TYPES: Record<string, PolicyKeyType> = {
  "appSettings.terminal.preferredShell": "string",
  "appSettings.terminal.cursorStyle": "string",
  "appSettings.terminal.keywordRules": "json",
  "appSettings.sftp.autoRefreshIntervalMs": "number",
  "appSettings.plugins.overrides": "json",
  "appSettings.keepalivePreset": "string",
  "appSettings.detachedTtlHours": "number",
  "appSettings.locale": "string",
  "appSettings.proxy": "json",
  "themes.location": "json",
};

const TOGGLE_PREFIX = "appSettings.toggles.";

// An unmapped setting key is left out (default-deny); the registry test fails for it.
function settingType(id: string): PolicyKeyType | undefined {
  return id.startsWith(TOGGLE_PREFIX) ? "bool" : SETTING_TYPES[id];
}

const bools = (prefix: string, ids: string[]): PolicyKeyDef[] =>
  ids.map((id) => ({ id: `${prefix}${id}`, type: "bool" }));

let registry: { keys: PolicyKeyDef[]; byId: Map<string, PolicyKeyDef> } | undefined;

// Built on first use: the domain constants live in stores that import the policy store.
function build() {
  const extras = keyExtras();
  const typedSettings: PolicyKeyDef[] = SETTING_KEYS.flatMap((k) => {
    const type = settingType(k.id);
    return type ? [{ id: k.id, type, ...extras[k.id] }] : [];
  });
  const keys: PolicyKeyDef[] = [
    { id: "server.url", type: "string" },
    { id: "server.allowOther", type: "bool" },
    { id: "plugins.enabled", type: "stringList" },
    { id: "plugins.disabled", type: "stringList" },
    { id: "plugins.install", type: "stringList" },
    { id: "plugins.allowInstall", type: "bool" },
    { id: "sshConfig.import", type: "bool" },
    ...bools("sync.domains.", SYNC_SETTING_DOMAINS.map((d) => d.id)),
    ...bools("sync.types.", SYNC_OBJECT_TYPES.map((t) => t.id)),
    ...bools("sync.settings.", SETTING_KEYS.map((k) => k.id)),
    ...typedSettings,
  ];
  return { keys, byId: new Map(keys.map((k) => [k.id, k])) };
}

const reg = () => (registry ??= build());

export const policyKeys = (): PolicyKeyDef[] => reg().keys;

export function policyKeyDef(id: string): PolicyKeyDef | undefined {
  return reg().byId.get(id);
}

const ENFORCED_PREFIXES = ["appSettings.toggles.", "sync."];
const ENFORCED_KEYS = new Set([
  "appSettings.terminal.cursorStyle",
  "appSettings.locale",
  "appSettings.keepalivePreset",
  "appSettings.detachedTtlHours",
  "appSettings.sftp.autoRefreshIntervalMs",
  "appSettings.terminal.preferredShell",
  "appSettings.proxy",
  "appSettings.terminal.keywordRules",
  "themes.location",
  "server.url",
  "server.allowOther",
  "sshConfig.import",
  "plugins.enabled",
  "plugins.disabled",
  "plugins.install",
  "plugins.allowInstall",
]);

// Keys whose read path honours a lock; settings rows show "managed" only for these.
export function isPolicyEnforced(key: string): boolean {
  return ENFORCED_KEYS.has(key) || ENFORCED_PREFIXES.some((p) => key.startsWith(p));
}

// Keys whose admin default the app applies; the CLI warns about the rest.
const DEFAULT_APPLIED_KEYS = new Set(["server.url", "plugins.install", "plugins.enabled", "plugins.disabled"]);
export const isDefaultApplied = (key: string): boolean => DEFAULT_APPLIED_KEYS.has(key) || settingKey(key) !== undefined;

export function policyKeysSnapshot(): Array<PolicyKeyDef & { enforced: boolean; defaultApplied: boolean }> {
  return policyKeys().map((k) => ({ ...k, enforced: isPolicyEnforced(k.id), defaultApplied: isDefaultApplied(k.id) }));
}
