import { SETTING_KEYS } from "@/services/user-data/settingKeys";
import { SYNC_OBJECT_TYPES, SYNC_SETTING_DOMAINS } from "@/stores/syncDomains";

export type PolicyKeyType = "bool" | "string" | "number" | "stringList" | "json";

export interface PolicyKeyDef {
  id: string;
  type: PolicyKeyType;
}

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

const typedSettings: PolicyKeyDef[] = SETTING_KEYS.flatMap((k) => {
  const type = settingType(k.id);
  return type ? [{ id: k.id, type }] : [];
});

export const POLICY_KEYS: PolicyKeyDef[] = [
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

const BY_ID = new Map(POLICY_KEYS.map((k) => [k.id, k]));

export function policyKeyDef(id: string): PolicyKeyDef | undefined {
  return BY_ID.get(id);
}

const ENFORCED_PREFIXES = ["appSettings.toggles.", "sync."];
const ENFORCED_KEYS = new Set([
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
export const isDefaultApplied = (key: string): boolean => DEFAULT_APPLIED_KEYS.has(key) || key.startsWith(TOGGLE_PREFIX);

export function policyKeysSnapshot(): Array<PolicyKeyDef & { enforced: boolean; defaultApplied: boolean }> {
  return POLICY_KEYS.map((k) => ({ ...k, enforced: isPolicyEnforced(k.id), defaultApplied: isDefaultApplied(k.id) }));
}
