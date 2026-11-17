import { create } from "zustand";
import type { PluginManifest } from "@/plugins/api";
import { uninstallPlugin } from "@/plugins/domains/plugins";
import { errorOf } from "@/plugins/domains/result";
import { mergeBrowseCatalog, recordedPlugin } from "@/plugins/floor";
import { isRetiredPlugin } from "@/plugins/retired";
import { getLoadedPlugins } from "@/plugins/runtime";
import i18n from "@/i18n";
import { appToast } from "@/services/appToast";
import { isAlive } from "@/services/crdt";
import { installWithConsent, PERMISSIONS_GREW } from "@/services/cliPlugins";
import { whenLoginSyncSettled } from "@/services/loginSyncGate";
import { remoteSourceName } from "@/services/remoteSources";
import type { EffectiveSync } from "@/services/syncProviders";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { FIRST_PARTY_SOURCE, useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { installAllowed, policyInstallList } from "@/stores/pluginRegistryStore";
import { lockedBool } from "@/stores/policyStore";
import { loadSeededEntries, useSeededTombstoneStore, type SeededEntry } from "@/stores/seededTombstoneStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncedPluginStore, type SyncedPlugin, type SyncedPluginFields } from "@/stores/syncedPluginStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { toggleKey } from "@/stores/toggleSettingsStore";
import { singleFlight } from "@/utils/singleFlight";

export function syncEligible(id: string, sourceId: string): boolean {
  return sourceId !== "local" && sourceId !== "url" && !policyInstallList().includes(id);
}

function hasSyncChannel(sync: Pick<EffectiveSync, "configured" | "paused">): boolean {
  const pausedPro = sync.paused && useSubscriptionStore.getState().isPro;
  return sync.configured || pausedPro || Object.keys(useLanSyncStore.getState().known).length > 0;
}

export function pluginSyncBlockedReason(
  id: string,
  sourceId: string,
  sync: Pick<EffectiveSync, "configured" | "paused">,
): string | null {
  if (!syncEligible(id, sourceId)) {
    return sourceId === "local" || sourceId === "url"
      ? "settings.plugins.sync.blocked.localSource"
      : "settings.plugins.sync.blocked.managed";
  }
  if (!useSyncPrefsStore.getState().isTypeSynced("plugin")) return "settings.plugins.sync.blocked.typeOff";
  return hasSyncChannel(sync) ? null : "settings.plugins.sync.blocked.noChannel";
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

const isExcluded = (id: string) => useSyncPrefsStore.getState().isExcluded(id);
const objectSynced = (id: string) => useSyncPrefsStore.getState().isObjectSynced(id, "plugin");
const syncedEntry = (id: string) => useSyncedPluginStore.getState().entries.find((e) => e.id === id);
const userInstalling = (id: string) => useMarketplaceStore.getState().installing.has(id);

function setExcluded(ids: string[], excluded: boolean): void {
  for (const id of ids) if (isExcluded(id) !== excluded) useSyncPrefsStore.getState().toggleExcluded(id);
}

export async function recordUserInstall(entry: MarketplacePlugin, manifest: PluginManifest): Promise<void> {
  if (!syncEligible(entry.id, entry.sourceId)) return;
  const wasExcluded = isExcluded(entry.id);
  await swallowed(entry.id, async () => {
    setExcluded([entry.id], false);
    try {
      await useSyncedPluginStore.getState().recordInstall(entry.id, syncedFields(entry, manifest), { force: wasExcluded });
    } catch (e) {
      setExcluded([entry.id], wasExcluded);
      throw e;
    }
  });
}

export const recordUserUninstall = (id: string): Promise<void> =>
  swallowed(id, () => useSyncedPluginStore.getState().recordUninstall(id));

export interface ConsentRequest {
  id: string;
  keep: boolean;
}

interface SyncedPluginConsentStore {
  queue: ConsentRequest[];
  enqueue: (request: ConsentRequest) => void;
  shift: () => ConsentRequest | undefined;
}

export const useSyncedPluginConsentStore = create<SyncedPluginConsentStore>((set, get) => ({
  queue: [],
  enqueue: (request) => {
    if (!get().queue.some((r) => r.id === request.id)) set({ queue: [...get().queue, request] });
  },
  shift: () => {
    const [head, ...rest] = get().queue;
    set({ queue: rest });
    return head;
  },
}));

const enqueueConsent = (request: ConsentRequest): void => useSyncedPluginConsentStore.getState().enqueue(request);

export function consentStillWanted({ id, keep }: ConsentRequest): boolean {
  if (!installAllowed(id) || getLoadedPlugins().some((m) => m.id === id)) return false;
  if (keep) return true;
  const entry = syncedEntry(id);
  return !!entry && isAlive(entry) && objectSynced(id);
}

type SeededEntries = Map<string, SeededEntry>;

function installedHere(id: string, seeded: SeededEntries) {
  const meta = useMarketplaceStore.getState().installedMeta.find((m) => m.id === id);
  const sourceId = meta?.sourceId ?? (seeded.has(id) ? FIRST_PARTY_SOURCE.id : "local");
  return { meta, sourceId, synced: syncEligible(id, sourceId) && objectSynced(id) };
}

export const installedSourceId = (id: string, seeded: SeededEntries): string => installedHere(id, seeded).sourceId;

function seedItem(m: PluginManifest, seeded: SeededEntries): { id: string } & SyncedPluginFields {
  const { meta, sourceId } = installedHere(m.id, seeded);
  const listed = meta
    ? undefined
    : useMarketplaceStore.getState().catalog.find((p) => p.id === m.id && p.sourceId === FIRST_PARTY_SOURCE.id);
  const src = meta ?? listed;
  return { id: m.id, ...syncedFields({ repo: src?.repo ?? "", sourceId, hash: src?.hash, cssHash: src?.cssHash }, m) };
}

const fromSource = (p: MarketplacePlugin, sourceId: string) =>
  p.sourceId === sourceId || (p.builtin === true && sourceId === FIRST_PARTY_SOURCE.id);

function installCandidate(entry: SyncedPlugin, rows: MarketplacePlugin[]): MarketplacePlugin | null {
  const listed = rows.filter((p) => p.id === entry.id);
  const own = listed.find((p) => fromSource(p, entry.source_id));
  if (own) return own;
  if (entry.repo && entry.hash) {
    return recordedPlugin({
      id: entry.id,
      repo: entry.repo,
      version: "",
      sourceId: entry.source_id,
      hash: entry.hash,
      cssHash: entry.css_hash ?? undefined,
    });
  }
  return listed[0] ?? null;
}

async function installRows(seeded: SeededEntries): Promise<MarketplacePlugin[]> {
  const market = useMarketplaceStore.getState();
  if (market.catalog.length === 0) await market.fetchCatalog();
  await market.loadAppVersion();
  const { catalog, appVersion } = useMarketplaceStore.getState();
  return mergeBrowseCatalog(catalog, seeded, useSeededTombstoneStore.getState().removed, appVersion);
}

export async function resolveSyncedCandidate(id: string): Promise<MarketplacePlugin | null> {
  const entry = syncedEntry(id);
  return entry ? installCandidate(entry, await installRows(await loadSeededEntries())) : null;
}

async function attempt(verb: string, id: string, run: () => Promise<string | null>): Promise<string | null> {
  try {
    const error = await run();
    if (error !== null && error !== PERMISSIONS_GREW) console.warn(`[plugin-sync] Not ${verb} "${id}":`, error);
    return error;
  } catch (e) {
    console.warn(`[plugin-sync] Not ${verb} "${id}":`, e);
    return String(e);
  }
}

async function installSynced(entry: SyncedPlugin, candidate: MarketplacePlugin, keep: boolean): Promise<boolean> {
  const request = { id: entry.id, keep };
  if (lockedBool(toggleKey("plugin-install-review")) === true) {
    enqueueConsent(request);
    return false;
  }
  const install = async () => errorOf(await installWithConsent(candidate, entry.permissions, { syncDriven: true }));
  const error = await attempt("installing", entry.id, install);
  if (error === PERMISSIONS_GREW) enqueueConsent(request);
  return error === null;
}

const removeHere = (id: string) => attempt("removing", id, async () => errorOf(await uninstallPlugin(id)));

export async function keepOffThisDevice(ids: string[]): Promise<void> {
  setExcluded(ids, true);
  for (const id of ids) await removeHere(id);
}

export async function keepOnThisDevice(ids: string[]): Promise<void> {
  setExcluded(ids, true);
  for (const id of ids) {
    const entry = syncedEntry(id);
    const candidate = entry && (await resolveSyncedCandidate(id));
    if (!entry || !candidate) {
      console.warn(`[plugin-sync] Not installing "${id}": no install source`);
      continue;
    }
    await installSynced(entry, candidate, true);
  }
}

function toastChange(kind: "installed" | "removed", ids: string[], action: { label: string; onClick: () => void }) {
  if (ids.length === 0) return;
  const key = (suffix: string) => `settings.plugins.sync.${kind}${suffix}`;
  let message = i18n.t(key("Many"), { count: ids.length });
  if (ids.length === 1) {
    const entry = syncedEntry(ids[0]);
    const plugin = entry?.name || ids[0];
    const { manifests } = useCrossDeviceSessionsStore.getState();
    const { known } = useLanSyncStore.getState();
    const device = entry ? remoteSourceName(entry.device_id, manifests, known) : null;
    message = device ? i18n.t(key("One"), { plugin, device }) : i18n.t(key("OneUnknown"), { plugin });
  }
  appToast("info", message, { action });
}

export function notifySyncedChanges(installed: string[], removed: string[]): void {
  toastChange("installed", installed, {
    label: i18n.t("settings.plugins.sync.notHere"),
    onClick: () => void keepOffThisDevice(installed),
  });
  toastChange("removed", removed, {
    label: i18n.t("settings.plugins.sync.keepHere"),
    onClick: () => void keepOnThisDevice(removed),
  });
}

async function reconcile(): Promise<void> {
  await whenLoginSyncSettled();
  if (!useSyncPrefsStore.getState().isTypeSynced("plugin")) return;
  const { entries } = useSyncedPluginStore.getState();
  const { installedMeta } = useMarketplaceStore.getState();
  const loaded = getLoadedPlugins();
  const loadedIds = new Set(loaded.map((m) => m.id));
  const onDisk = new Set(installedMeta.map((m) => m.id));
  const seeded = await loadSeededEntries();

  const unseeded = loaded.filter((m) => !entries.some((e) => e.id === m.id) && installedHere(m.id, seeded).synced);
  const missing = entries.filter(
    (e) =>
      isAlive(e) &&
      !loadedIds.has(e.id) &&
      !onDisk.has(e.id) &&
      !userInstalling(e.id) &&
      objectSynced(e.id) &&
      !isRetiredPlugin(e.id) &&
      installAllowed(e.id),
  );
  const rows = unseeded.length > 0 || missing.length > 0 ? await installRows(seeded) : [];

  if (unseeded.length > 0) await useSyncedPluginStore.getState().seed(unseeded.map((m) => seedItem(m, seeded)));

  const installed: string[] = [];
  for (const entry of missing) {
    const candidate = installCandidate(entry, rows);
    if (candidate && (await installSynced(entry, candidate, false))) installed.push(entry.id);
  }

  const removed: string[] = [];
  const removable = entries.filter((e) => !isAlive(e) && loadedIds.has(e.id) && installedHere(e.id, seeded).synced);
  for (const { id } of removable) {
    if (!userInstalling(id) && (await removeHere(id)) === null) removed.push(id);
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
