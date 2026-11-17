import { create } from "zustand";
import type { PluginManifest } from "@/plugins/api";
import { uninstallPlugin } from "@/plugins/domains/plugins";
import { errorOf } from "@/plugins/domains/result";
import { mergeBrowseCatalog, recordedPlugin } from "@/plugins/floor";
import { isRetiredPlugin } from "@/plugins/retired";
import { getLoadedPlugins } from "@/plugins/runtime";
import { isAlive } from "@/services/crdt";
import { installWithConsent, PERMISSIONS_GREW } from "@/services/cliPlugins";
import { whenLoginSyncSettled } from "@/services/loginSyncGate";
import { FIRST_PARTY_SOURCE, useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { installAllowed, policyInstallList } from "@/stores/pluginRegistryStore";
import { lockedBool } from "@/stores/policyStore";
import { loadSeededEntries, useSeededTombstoneStore, type SeededEntry } from "@/stores/seededTombstoneStore";
import { useSyncedPluginStore, type SyncedPlugin, type SyncedPluginFields } from "@/stores/syncedPluginStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { toggleKey } from "@/stores/toggleSettingsStore";
import { singleFlight } from "@/utils/singleFlight";

export function syncEligible(id: string, sourceId: string): boolean {
  return sourceId !== "local" && sourceId !== "url" && !policyInstallList().includes(id);
}

async function swallowed(id: string, record: () => Promise<void>): Promise<void> {
  try {
    await record();
  } catch (e) {
    console.warn(`[plugin-sync] Failed to record "${id}":`, e);
  }
}

function syncedFields(
  src: { repo: string; sourceId: string; hash?: string | null; cssHash?: string | null },
  manifest: PluginManifest,
): SyncedPluginFields {
  return {
    repo: src.repo,
    source_id: src.sourceId,
    hash: src.hash ?? null,
    css_hash: src.cssHash ?? null,
    permissions: manifest.permissions ?? [],
    name: manifest.name,
  };
}

export async function recordUserInstall(entry: MarketplacePlugin, manifest: PluginManifest): Promise<void> {
  if (!syncEligible(entry.id, entry.sourceId)) return;
  await swallowed(entry.id, async () => {
    await useSyncedPluginStore.getState().recordInstall(entry.id, syncedFields(entry, manifest));
    const prefs = useSyncPrefsStore.getState();
    if (prefs.isExcluded(entry.id)) prefs.toggleExcluded(entry.id);
  });
}

export const recordUserUninstall = (id: string): Promise<void> =>
  swallowed(id, () => useSyncedPluginStore.getState().recordUninstall(id));

interface SyncedPluginConsentStore {
  queue: string[];
  enqueue: (id: string) => void;
  shift: () => string | undefined;
}

export const useSyncedPluginConsentStore = create<SyncedPluginConsentStore>((set, get) => ({
  queue: [],
  enqueue: (id) => {
    if (!get().queue.includes(id)) set({ queue: [...get().queue, id] });
  },
  shift: () => {
    const [head, ...rest] = get().queue;
    set({ queue: rest });
    return head;
  },
}));

export const enqueueConsent = (id: string): void => useSyncedPluginConsentStore.getState().enqueue(id);

export const notifySyncedChanges: (installed: string[], removed: string[]) => void = () => {};

type SeededEntries = Map<string, SeededEntry>;

const isExcluded = (id: string) => useSyncPrefsStore.getState().isExcluded(id);

function installedHere(id: string, seeded: SeededEntries) {
  const meta = useMarketplaceStore.getState().installedMeta.find((m) => m.id === id);
  const sourceId = meta?.sourceId ?? (seeded.has(id) ? FIRST_PARTY_SOURCE.id : "local");
  return { meta, sourceId, synced: syncEligible(id, sourceId) && !isExcluded(id) };
}

function seedItem(m: PluginManifest, seeded: SeededEntries): { id: string } & SyncedPluginFields {
  const { meta, sourceId } = installedHere(m.id, seeded);
  const listed = meta
    ? undefined
    : useMarketplaceStore.getState().catalog.find((p) => p.id === m.id && p.sourceId === FIRST_PARTY_SOURCE.id);
  const src = meta ?? listed;
  return { id: m.id, ...syncedFields({ repo: src?.repo ?? "", sourceId, hash: src?.hash, cssHash: src?.cssHash }, m) };
}

function installCandidate(entry: SyncedPlugin, rows: MarketplacePlugin[]): MarketplacePlugin | null {
  const listed = rows.filter((p) => p.id === entry.id);
  const row = listed.find((p) => p.sourceId === entry.source_id) ?? listed[0];
  if (row) return row;
  if (!entry.repo || !entry.hash) return null;
  return recordedPlugin({
    id: entry.id,
    repo: entry.repo,
    version: "",
    sourceId: entry.source_id,
    hash: entry.hash,
    cssHash: entry.css_hash ?? undefined,
  });
}

async function attempt(verb: string, id: string, run: () => Promise<string | null>): Promise<boolean> {
  try {
    const error = await run();
    if (error === null) return true;
    if (error === PERMISSIONS_GREW) enqueueConsent(id);
    else console.warn(`[plugin-sync] Not ${verb} "${id}":`, error);
  } catch (e) {
    console.warn(`[plugin-sync] Not ${verb} "${id}":`, e);
  }
  return false;
}

async function reconcile(): Promise<void> {
  await whenLoginSyncSettled();
  const { entries } = useSyncedPluginStore.getState();
  const loaded = getLoadedPlugins();
  const loadedIds = new Set(loaded.map((m) => m.id));
  const seeded = await loadSeededEntries();

  const unseeded = loaded.filter((m) => !entries.some((e) => e.id === m.id) && installedHere(m.id, seeded).synced);
  const missing = entries.filter(
    (e) => isAlive(e) && !loadedIds.has(e.id) && !isExcluded(e.id) && !isRetiredPlugin(e.id) && installAllowed(e.id),
  );
  const market = useMarketplaceStore.getState();
  if (market.catalog.length === 0 && (unseeded.length > 0 || missing.length > 0)) await market.fetchCatalog();
  if (missing.length > 0) await market.loadAppVersion();

  if (unseeded.length > 0) await useSyncedPluginStore.getState().seed(unseeded.map((m) => seedItem(m, seeded)));

  const { catalog, appVersion } = useMarketplaceStore.getState();
  const rows = mergeBrowseCatalog(catalog, seeded, useSeededTombstoneStore.getState().removed, appVersion);
  const reviewLocked = lockedBool(toggleKey("plugin-install-review")) === true;
  const installed: string[] = [];
  for (const entry of missing) {
    const candidate = installCandidate(entry, rows);
    if (!candidate) continue;
    const consented = reviewLocked ? [] : entry.permissions;
    const install = async () => errorOf(await installWithConsent(candidate, consented, { syncDriven: true }));
    if (await attempt("installing", entry.id, install)) installed.push(entry.id);
  }

  const removed: string[] = [];
  const removable = entries.filter((e) => !isAlive(e) && loadedIds.has(e.id) && installedHere(e.id, seeded).synced);
  for (const { id } of removable) {
    if (await attempt("removing", id, async () => errorOf(await uninstallPlugin(id)))) removed.push(id);
  }

  notifySyncedChanges(installed, removed);
}

const reconcileFlight = singleFlight(
  () => reconcile().catch((e) => console.warn("[plugin-sync] Reconciling synced plugins failed:", e)),
  { rerunIfCalledDuring: true },
);

let pluginsBooted = false;

// A merge can land while boot is still loading plugins; reconciling then would reinstall what is merely not loaded yet.
export function reconcileSyncedPlugins(opts?: { boot?: boolean }): Promise<void> {
  if (opts?.boot) pluginsBooted = true;
  return pluginsBooted ? reconcileFlight.run() : Promise.resolve();
}
