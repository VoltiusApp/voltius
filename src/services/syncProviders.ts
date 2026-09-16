import type { PluginManifest, SettingsPage, SyncProviderAvailability, SyncProviderSummary } from "@/plugins/api";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";
import { attributePage } from "@/plugins/attributePage";
import type { SyncStatus } from "./sync";
import {
  NOT_CONFIGURED_SYNC_STATE,
  sanitizeSyncProviderState,
  warnPluginStateOnce,
  type SyncProviderSnapshot,
} from "./syncStatus";

export const SYNC_PROVIDER_PERMISSION = "sync:write";
export const VOLTIUS_PROVIDER_ID = "voltius";
const DEFAULT_PROVIDER_ICON = "lucide:refresh-cw";

export type SyncProviderAction =
  | { kind: "signIn" }
  | { kind: "upgrade" }
  | { kind: "enable" }
  | { kind: "configure"; pageId: string | null };

export interface SyncProviderView {
  id: string;
  label: string;
  icon: string;
  availability: SyncProviderAvailability;
  state: SyncProviderSnapshot;
  syncNow: (() => Promise<void>) | null;
  action: SyncProviderAction | null;
}

export interface LoadedPluginInfo {
  manifest: PluginManifest;
  active: boolean;
  exposed: unknown;
  publishedState: unknown;
}

export interface VoltiusSyncInput {
  label: string;
  state: { status: SyncStatus; lastSync: Date | null; error: string | null; blobSizeBytes: number | null };
  accountMode: string | null;
  isPro: boolean;
  syncNow: () => Promise<void>;
}

export interface SyncProviderInputs {
  voltius: VoltiusSyncInput;
  plugins: LoadedPluginInfo[];
  settingsPages: SettingsPage[];
}

export interface EffectiveSync {
  configured: boolean;
  status: SyncStatus;
  lastSync: Date | null;
  error: string | null;
  errorSource: string | null;
}

const STATUS_RANK: Record<SyncStatus, number> = { idle: 0, success: 1, syncing: 2, offline: 3, error: 4 };

function voltiusProvider(v: VoltiusSyncInput): SyncProviderView {
  const availability: SyncProviderAvailability =
    v.accountMode !== "server" ? "locked" : !v.isPro ? "needs_upgrade" : "active";
  const active = availability === "active";
  return {
    id: VOLTIUS_PROVIDER_ID,
    label: v.label,
    icon: "lucide:cloud",
    availability,
    state: { ...v.state, configured: active },
    syncNow: active ? v.syncNow : null,
    action: availability === "locked" ? { kind: "signIn" } : availability === "needs_upgrade" ? { kind: "upgrade" } : null,
  };
}

function exposedSyncNow(pluginId: string, exposed: unknown): (() => Promise<void>) | null {
  let fn: unknown;
  try {
    fn = (exposed as { syncNow?: unknown } | null)?.syncNow;
  } catch {
    fn = undefined;
  }
  if (typeof fn === "function") return async () => { await (fn as () => unknown).call(exposed); };
  warnPluginStateOnce(pluginId, "syncNow", "sync provider exposes no syncNow function");
  return null;
}

function pluginProvider(p: LoadedPluginInfo, page: SettingsPage | undefined): SyncProviderView {
  const { id, name } = p.manifest;
  const state = p.publishedState === undefined ? NOT_CONFIGURED_SYNC_STATE : sanitizeSyncProviderState(p.publishedState, id);
  const availability: SyncProviderAvailability = !p.active ? "disabled" : state.configured ? "active" : "not_configured";
  return {
    id,
    label: name,
    icon: page?.icon ?? DEFAULT_PROVIDER_ICON,
    availability,
    state,
    syncNow: availability === "active" ? exposedSyncNow(id, p.exposed) : null,
    action: availability === "disabled" ? { kind: "enable" } : { kind: "configure", pageId: page?.id ?? null },
  };
}

export function buildSyncProviders(inputs: SyncProviderInputs): SyncProviderView[] {
  const pluginIds = inputs.plugins.map((p) => p.manifest.id);
  const plugins = inputs.plugins
    .filter((p) => p.manifest.permissions.includes(SYNC_PROVIDER_PERMISSION))
    .map((p) => pluginProvider(p, inputs.settingsPages.find((page) => attributePage(page.id, pluginIds) === p.manifest.id)))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [voltiusProvider(inputs.voltius), ...plugins];
}

export function aggregateSyncStatus(providers: SyncProviderView[]): EffectiveSync {
  const active = providers.filter((p) => p.availability === "active");
  if (active.length === 0) {
    const fallback = providers.find((p) => p.id === VOLTIUS_PROVIDER_ID)?.state ?? NOT_CONFIGURED_SYNC_STATE;
    return { configured: false, status: fallback.status, lastSync: fallback.lastSync, error: fallback.error, errorSource: null };
  }
  const worst = active.reduce((w, p) => (STATUS_RANK[p.state.status] > STATUS_RANK[w.state.status] ? p : w));
  const lastSync = active.reduce<Date | null>(
    (latest, p) => (p.state.lastSync && (!latest || p.state.lastSync > latest) ? p.state.lastSync : latest),
    null,
  );
  const failing = worst.state.status === "error";
  return {
    configured: true,
    status: worst.state.status,
    lastSync,
    error: failing ? worst.state.error : null,
    errorSource: failing ? worst.label : null,
  };
}

export function availableCatalogProviders(catalog: MarketplacePlugin[], installedIds: ReadonlySet<string>): MarketplacePlugin[] {
  const seen = new Set<string>();
  return catalog.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return !installedIds.has(p.id) && Boolean(p.permissions?.includes(SYNC_PROVIDER_PERMISSION));
  });
}

export function toSyncProviderSummary(p: SyncProviderView): SyncProviderSummary {
  return {
    id: p.id,
    label: p.label,
    availability: p.availability,
    status: p.state.status,
    lastSync: p.state.lastSync ? p.state.lastSync.toISOString() : null,
    error: p.state.error,
  };
}
