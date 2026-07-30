/** Pure selection of the "effective" sync status from the Voltius (server) and
 *  Gist sync engines + plan/plugin state. No React/stores — node-testable. Shared
 *  by the desktop TitleBar and the mobile header so the two can't drift. */
import type { SyncStatus } from "./sync";

interface SyncStateLike {
  status: SyncStatus;
  lastSync: Date | null;
  error: string | null;
}

/** Shape the gist-sync plugin publishes via `api.ui.publishState("sync-state", …)`.
 *  Host-owned: the runtime value lives in the plugin, but the type crosses the
 *  boundary since types are erased. */
export interface GistSyncState {
  status: SyncStatus;
  lastSync: Date | null;
  error: string | null;
  blobSizeBytes: number | null;
  configured: boolean;
}

/** Default snapshot when the gist-sync plugin hasn't published state yet
 *  (disabled, uninstalled, or not-yet-initialised). */
export const NOT_CONFIGURED_GIST_STATE: GistSyncState = {
  status: "idle",
  lastSync: null,
  error: null,
  blobSizeBytes: null,
  configured: false,
};

/** Shape the gist-sync plugin exposes via `api.plugins.expose(...)`, read back
 *  through `getExposedApi("plugin-gist-sync")` — lets host UI trigger a sync
 *  without importing the plugin's module. */
export interface GistSyncPublicApi {
  syncNow(opts?: { showProgress?: boolean }): Promise<void>;
}

const SYNC_STATUSES: readonly SyncStatus[] = ["idle", "syncing", "success", "error", "offline"];

/** Coerces an epoch-ms number or ISO-8601 string into a `Date`, returning `null`
 *  for anything that doesn't produce a valid one (including `NaN` dates). */
function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const warnedKeys = new Set<string>();

function warnOnce(pluginId: string, field: string, message: string) {
  const dedupeKey = `${pluginId}::${field}`;
  if (warnedKeys.has(dedupeKey)) return;
  warnedKeys.add(dedupeKey);
  console.warn(`[plugin-state] ${pluginId}: ${message}`);
}

/** Test-only: clears the warn-once dedupe so each test starts fresh. */
export function __resetGistSyncStateWarnings(): void {
  warnedKeys.clear();
}

// Keyed by the raw published object's identity so a React selector calling this on
// every render gets back the same reference for an unchanged publish — otherwise a
// fresh object each call defeats store equality checks and loops re-renders forever.
const sanitizedCache = new WeakMap<object, GistSyncState>();

/** Validates/coerces a plugin-published `sync-state` blob at the point the host
 *  reads it. `publishState` accepts `unknown`, so a plugin (buggy or malicious)
 *  can publish anything — this must never throw, and a malformed field degrades
 *  to the same value `NOT_CONFIGURED_GIST_STATE` uses for that field rather than
 *  taking down the caller. Logs at most one warning per pluginId+field. */
export function sanitizeGistSyncState(raw: unknown, pluginId: string): GistSyncState {
  if (typeof raw !== "object" || raw === null) {
    warnOnce(pluginId, "sync-state", "published sync-state is not an object; ignoring");
    return NOT_CONFIGURED_GIST_STATE;
  }
  const cached = sanitizedCache.get(raw);
  if (cached) return cached;

  const r = raw as Record<string, unknown>;

  const status: SyncStatus = SYNC_STATUSES.includes(r.status as SyncStatus)
    ? (r.status as SyncStatus)
    : (warnOnce(pluginId, "status", `invalid sync-state.status: ${String(r.status)}`), "idle");

  let lastSync: Date | null;
  if (r.lastSync === null || r.lastSync === undefined) {
    lastSync = null;
  } else {
    const coerced = coerceDate(r.lastSync);
    if (coerced === null) warnOnce(pluginId, "lastSync", `invalid sync-state.lastSync: ${String(r.lastSync)}`);
    lastSync = coerced;
  }

  const error: string | null = r.error === null || typeof r.error === "string"
    ? r.error
    : (warnOnce(pluginId, "error", `invalid sync-state.error: ${String(r.error)}`), null);

  const blobSizeBytes: number | null =
    r.blobSizeBytes === null || (typeof r.blobSizeBytes === "number" && !Number.isNaN(r.blobSizeBytes))
      ? r.blobSizeBytes
      : (warnOnce(pluginId, "blobSizeBytes", `invalid sync-state.blobSizeBytes: ${String(r.blobSizeBytes)}`), null);

  const configured: boolean = typeof r.configured === "boolean"
    ? r.configured
    : (warnOnce(pluginId, "configured", `invalid sync-state.configured: ${String(r.configured)}`), false);

  const result = { status, lastSync, error, blobSizeBytes, configured };
  sanitizedCache.set(raw, result);
  return result;
}

export interface EffectiveSync {
  /** Either sync engine is set up. */
  configured: boolean;
  /** True when the Voltius (server) engine is the one being surfaced. */
  showVoltius: boolean;
  status: SyncStatus;
  lastSync: Date | null;
  error: string | null;
}

export function selectEffectiveSyncStatus(i: {
  voltius: SyncStateLike;
  gist: SyncStateLike & { configured: boolean };
  accountMode: string | null;
  isPro: boolean;
  gistPluginEnabled: boolean;
}): EffectiveSync {
  const voltiusConfigured = i.accountMode === "server" && i.isPro;
  const gistConfigured = i.gistPluginEnabled && i.gist.configured;
  const showVoltius = voltiusConfigured || !gistConfigured;
  return {
    configured: voltiusConfigured || gistConfigured,
    showVoltius,
    status: showVoltius ? i.voltius.status : i.gist.status,
    lastSync: showVoltius ? i.voltius.lastSync : i.gist.lastSync,
    error: showVoltius ? i.voltius.error : i.gist.error,
  };
}

/** Lucide icon for a sync status (matches SyncDropdown). */
export function syncStatusIcon(status: SyncStatus): string {
  if (status === "syncing") return "lucide:refresh-cw";
  if (status === "success") return "lucide:cloud-check";
  if (status === "error") return "lucide:cloud-alert";
  if (status === "offline") return "lucide:wifi-off";
  return "lucide:cloud";
}

/** Theme color var for a sync status (matches SyncDropdown). */
export function syncStatusColor(status: SyncStatus): string {
  if (status === "success") return "var(--t-status-connected)";
  if (status === "error") return "var(--t-status-error)";
  if (status === "syncing") return "var(--t-text-primary)";
  if (status === "offline") return "var(--t-text-dim)";
  return "var(--t-text-muted)";
}
