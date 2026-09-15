/** Pure selection of the "effective" sync status from the Voltius (server) and
 *  Gist sync engines + plan/plugin state. No React/stores — node-testable. Shared
 *  by the desktop TitleBar and the mobile header so the two can't drift. */
import type { SyncStatus } from "./sync";
import type { SyncProviderState } from "@/plugins/api";

interface SyncStateLike {
  status: SyncStatus;
  lastSync: Date | null;
  error: string | null;
}

/** A `sync-state` after sanitizing: `lastSync` is always a valid `Date` or null. */
export interface SyncProviderSnapshot extends Omit<SyncProviderState, "lastSync"> {
  lastSync: Date | null;
}

/** Default snapshot when a sync provider plugin hasn't published state yet
 *  (disabled, uninstalled, or not-yet-initialised). Frozen: this exact object is
 *  returned by reference to every consumer on the reject/not-configured path, so
 *  it must not be mutable. */
export const NOT_CONFIGURED_SYNC_STATE: SyncProviderSnapshot = Object.freeze({
  status: "idle",
  lastSync: null,
  error: null,
  blobSizeBytes: null,
  configured: false,
});

/** Shape the gist-sync plugin exposes via `api.plugins.expose(...)`, read back
 *  through `getExposedApi("plugin-gist-sync")` — lets host UI trigger a sync
 *  without importing the plugin's module. */
export interface GistSyncPublicApi {
  syncNow(): Promise<void>;
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

/** `String(x)` can itself throw (a `Symbol.toPrimitive`/`toString` that throws, or
 *  `Object.create(null)` with no prototype to fall back to) — this is building a
 *  message about attacker/bug-controlled data, so it must not be able to throw. */
function safeStr(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "<unstringifiable>";
  }
}

export function warnPluginStateOnce(pluginId: string, field: string, message: string) {
  const dedupeKey = `${pluginId}::${field}`;
  if (warnedKeys.has(dedupeKey)) return;
  warnedKeys.add(dedupeKey);
  console.warn(`[plugin-state] ${pluginId}: ${message}`);
}

/** Test-only: clears the warn-once dedupe so each test starts fresh. */
export function __resetPluginStateWarnings(): void {
  warnedKeys.clear();
}

function sanitizeSyncProviderStateUnsafe(raw: Record<string, unknown>, pluginId: string): SyncProviderSnapshot {
  const status: SyncStatus = SYNC_STATUSES.includes(raw.status as SyncStatus)
    ? (raw.status as SyncStatus)
    : (warnPluginStateOnce(pluginId, "status", `invalid sync-state.status: ${safeStr(raw.status)}`), "idle");

  let lastSync: Date | null;
  if (raw.lastSync === null || raw.lastSync === undefined) {
    lastSync = null;
  } else {
    const coerced = coerceDate(raw.lastSync);
    if (coerced === null) warnPluginStateOnce(pluginId, "lastSync", `invalid sync-state.lastSync: ${safeStr(raw.lastSync)}`);
    lastSync = coerced;
  }

  const error: string | null = raw.error === null || typeof raw.error === "string"
    ? raw.error
    : (warnPluginStateOnce(pluginId, "error", `invalid sync-state.error: ${safeStr(raw.error)}`), null);

  const blobSizeBytes: number | null =
    raw.blobSizeBytes === null || (typeof raw.blobSizeBytes === "number" && !Number.isNaN(raw.blobSizeBytes))
      ? raw.blobSizeBytes
      : (warnPluginStateOnce(pluginId, "blobSizeBytes", `invalid sync-state.blobSizeBytes: ${safeStr(raw.blobSizeBytes)}`), null);

  const configured: boolean = typeof raw.configured === "boolean"
    ? raw.configured
    : (warnPluginStateOnce(pluginId, "configured", `invalid sync-state.configured: ${safeStr(raw.configured)}`), false);

  return { status, lastSync, error, blobSizeBytes, configured };
}

/** Validates/coerces a plugin-published `sync-state` blob at the point the host
 *  reads it. `publishState` accepts `unknown`, so a plugin (buggy or malicious)
 *  can publish anything — including objects with throwing getters, `Proxy` get
 *  traps, or a null-prototype object that can't be stringified. This must never
 *  throw: a malformed field degrades to the same value `NOT_CONFIGURED_SYNC_STATE`
 *  uses for that field, and any unexpected throw while inspecting `raw` degrades
 *  the whole object the same way `NOT_CONFIGURED_SYNC_STATE` does. Logs at most
 *  one warning per pluginId+field. Pure — callers own reference stability. */
export function sanitizeSyncProviderState(raw: unknown, pluginId: string): SyncProviderSnapshot {
  if (typeof raw !== "object" || raw === null) {
    warnPluginStateOnce(pluginId, "sync-state", "published sync-state is not an object; ignoring");
    return NOT_CONFIGURED_SYNC_STATE;
  }
  try {
    return sanitizeSyncProviderStateUnsafe(raw as Record<string, unknown>, pluginId);
  } catch (e) {
    warnPluginStateOnce(pluginId, "sync-state", `sync-state threw while being read: ${safeStr(e)}`);
    return NOT_CONFIGURED_SYNC_STATE;
  }
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
