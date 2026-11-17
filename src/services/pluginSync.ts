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
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { FIRST_PARTY_SOURCE, useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { installAllowed, policyInstallList } from "@/stores/pluginRegistryStore";
import { lockedBool } from "@/stores/policyStore";
import { loadSeededEntries, useSeededTombstoneStore, type SeededEntry } from "@/stores/seededTombstoneStore";
import { useSyncedPluginStore, type SyncedPlugin, type SyncedPluginFields } from "@/stores/syncedPluginStore";
import { voltiusAvailability } from "@/services/syncProviders";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { toggleKey } from "@/stores/toggleSettingsStore";
import { singleFlight } from "@/utils/singleFlight";

export function syncEligible(id: string, sourceId: string): boolean {
  return sourceId !== "local" && sourceId !== "url" && !policyInstallList().includes(id);
}

function hasSyncChannel(): boolean {
  const { accountMode, isPro } = useSubscriptionStore.getState();
  if (voltiusAvailability({ accountMode, isPro, paused: false }) === "active") return true;
  return Object.keys(useLanSyncStore.getState().known).length > 0;
}

export function pluginSyncBlockedReason(id: string, sourceId: string): string | null {
  if (!syncEligible(id, sourceId)) {
    return sourceId === "local" || sourceId === "url"
      ? "settings.plugins.sync.blocked.localSource"
      : "settings.plugins.sync.blocked.managed";
  }
  if (!useSyncPrefsStore.getState().isTypeSynced("plugin")) return "settings.plugins.sync.blocked.typeOff";
  return hasSyncChannel() ? null : "settings.plugins.sync.blocked.noChannel";
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

function browseRows(seeded: SeededEntries): MarketplacePlugin[] {
  const { catalog, appVersion } = useMarketplaceStore.getState();
  return mergeBrowseCatalog(catalog, seeded, useSeededTombstoneStore.getState().removed, appVersion);
}

export async function resolveSyncedCandidate(id: string): Promise<MarketplacePlugin | null> {
  const entry = useSyncedPluginStore.getState().entries.find((e) => e.id === id);
  if (!entry) return null;
  const market = useMarketplaceStore.getState();
  if (market.catalog.length === 0) await market.fetchCatalog();
  await market.loadAppVersion();
  return installCandidate(entry, browseRows(await loadSeededEntries()));
}

function excludeHere(ids: string[]): void {
  for (const id of ids) if (!isExcluded(id)) useSyncPrefsStore.getState().toggleExcluded(id);
}

export async function keepOffThisDevice(ids: string[]): Promise<void> {
  excludeHere(ids);
  for (const id of ids) {
    const error = errorOf(await uninstallPlugin(id));
    if (error !== null) console.warn(`[plugin-sync] Not removing "${id}":`, error);
  }
}

export async function keepOnThisDevice(ids: string[]): Promise<void> {
  excludeHere(ids);
  for (const id of ids) {
    const entry = useSyncedPluginStore.getState().entries.find((e) => e.id === id);
    const candidate = entry && (await resolveSyncedCandidate(id));
    if (!entry || !candidate) {
      console.warn(`[plugin-sync] Not installing "${id}": no install source`);
      continue;
    }
    const error = errorOf(await installWithConsent(candidate, entry.permissions, { syncDriven: true }));
    if (error !== null) console.warn(`[plugin-sync] Not installing "${id}":`, error);
  }
}

function toastChange(kind: "installed" | "removed", ids: string[], action: { label: string; onClick: () => void }) {
  if (ids.length === 0) return;
  const entries = ids.map((id) => useSyncedPluginStore.getState().entries.find((e) => e.id === id));
  const key = (suffix: string) => `settings.plugins.sync.${kind}${suffix}`;
  let message = i18n.t(key("Many"), { count: ids.length });
  if (ids.length === 1) {
    const plugin = entries[0]?.name || ids[0];
    const { manifests } = useCrossDeviceSessionsStore.getState();
    const { known } = useLanSyncStore.getState();
    const device = entries[0] ? remoteSourceName(entries[0].device_id, manifests, known) : null;
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

  const rows = browseRows(seeded);
  const reviewLocked = lockedBool(toggleKey("plugin-install-review")) === true;
  const installed: string[] = [];
  for (const entry of missing) {
    const candidate = installCandidate(entry, rows);
    if (!candidate) continue;
    if (reviewLocked) {
      enqueueConsent(entry.id);
      continue;
    }
    const install = async () => errorOf(await installWithConsent(candidate, entry.permissions, { syncDriven: true }));
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
