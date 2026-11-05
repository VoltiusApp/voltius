import { installPlugin, installVettedPlugin, pluginState, setPluginEnabled, uninstallPlugin } from "@/plugins/domains/plugins";
import type { DomainResult } from "@/plugins/domains/result";
import { applyPluginEnabled } from "@/plugins/applyPluginEnabled";
import { isGatedPermission } from "@/plugins/gatedPermissions";
import { getLoadedPlugins } from "@/plugins/runtime";
import { isAdminDefaulted, useAdminDefaultsStore } from "@/stores/adminDefaultsStore";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { installLocked, usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { LOCKED, adminDefault, lockedList } from "@/stores/policyStore";
import { loadSeededEntries } from "@/stores/seededTombstoneStore";
import { withAdminDefaultWrite } from "@/stores/appSettingsTimestampStore";

export type CliPluginAction = "install" | "enable" | "disable" | "remove";
export interface CliPluginChange {
  action: CliPluginAction;
  id: string;
  consentedPermissions: string[];
}

const PERMISSIONS_GREW = "permissions changed since you confirmed; run the command again";

const isLoaded = (id: string) => getLoadedPlugins().some((m) => m.id === id);
const errorOf = (r: DomainResult<unknown>): string | null => (r.ok ? null : r.error);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function applyPluginChange(c: CliPluginChange): Promise<string | null> {
  switch (c.action) {
    case "install": {
      if (isLoaded(c.id)) return null;
      const consented = new Set(c.consentedPermissions);
      const grew = (perms: string[] = []) => perms.some((p) => isGatedPermission(p) && !consented.has(p));
      return errorOf(await installVettedPlugin(c.id, (m) => (grew(m.permissions) ? PERMISSIONS_GREW : null)));
    }
    case "enable":
    case "disable":
      return errorOf(await setPluginEnabled(c.id, c.action === "enable"));
    case "remove":
      if (installLocked(c.id)) return LOCKED;
      return isLoaded(c.id) ? errorOf(await uninstallPlugin(c.id)) : null;
    default:
      return `unknown plugin action ${String(c.action)}`;
  }
}

async function installed(id: string): Promise<boolean> {
  if (isLoaded(id)) return true;
  const r = await installPlugin(id);
  if (!r.ok) console.warn("[policy] plugin not installed:", id, r.error);
  return r.ok;
}

async function runInstallPolicy(): Promise<void> {
  for (const id of ids(lockedList("plugins.install"))) await installed(id);
  const { markApplied } = useAdminDefaultsStore.getState();
  for (const id of ids(adminDefault("plugins.install"))) {
    const mark = `plugins.install/${id}`;
    if (!isAdminDefaulted(mark) && (await installed(id))) markApplied(mark);
  }
  for (const [key, enabled] of [["plugins.enabled", true], ["plugins.disabled", false]] as const) {
    for (const id of ids(adminDefault(key))) {
      const mark = `${key}/${id}`;
      const overridden = id in usePluginRegistryStore.getState().overrides;
      if (isAdminDefaulted(mark) || overridden || !isLoaded(id)) continue;
      if (await withAdminDefaultWrite(() => applyPluginEnabled(id, enabled))) markApplied(mark);
    }
  }
}

let running: Promise<void> | null = null;

export function applyPluginInstallPolicy(): Promise<void> {
  running ??= runInstallPolicy()
    .catch((e) => console.warn("[policy] applying plugin policy failed:", e))
    .finally(() => {
      running = null;
    });
  return running;
}

export const pluginInstallPolicyIdle = (): Promise<void> => running ?? Promise.resolve();

export async function mirrorPlugins() {
  const { installedMeta } = useMarketplaceStore.getState();
  const seeded = await loadSeededEntries();
  return getLoadedPlugins().map((m) => {
    const { origin, enabled, lock } = pluginState(m, installedMeta, seeded);
    return { id: m.id, version: m.version, enabled, origin, locked: lock };
  });
}
