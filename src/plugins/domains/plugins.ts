import { useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { getLoadedPlugins, setPluginActive, pluginStorageGet, pluginStorageSet } from "@/plugins/runtime";
import { loadSeededEntries } from "@/stores/seededTombstoneStore";
import { availableUpdate, availableSeededUpdate } from "@/plugins/updates";
import { failed, type DomainResult } from "./result";
import type { PluginConfigField, PluginManifest } from "@/plugins/api";
// Declared in the tool layer, not here: the MCP verbs pre-check these same
// doomed calls (unknown id, non-deletable source) before the approval gate,
// so they can raise no card and write no audit row for a call that was
// always going to be refused. Importing the message builders back keeps the
// wording a single source of truth instead of two copies drifting apart.
import { noSuchPluginMessage, unknownConfigKeyMessage } from "@/plugins/toolSurface/tools/plugins";
import { noSuchSourceMessage, sourceNotDeletableMessage } from "@/plugins/toolSurface/tools/marketplace";

export interface PluginView {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  origin: "seeded" | "catalog" | "url" | "local";
  hash: string | null;
  permissions: string[];
  configurable: string[];
  updateAvailable: string | null;
}

export interface SourceView {
  id: string; name: string; url: string; enabled: boolean; deletable: boolean;
}

const market = () => useMarketplaceStore.getState();

const configOf = (m: PluginManifest): Record<string, PluginConfigField> =>
  m.contributes?.configuration ?? {};

/** Catalog entry for an id, across enabled sources. */
async function catalogEntry(id: string): Promise<MarketplacePlugin | undefined> {
  const s = market();
  if (s.catalog.length === 0) await s.fetchCatalog();
  return market().catalog.find((p) => p.id === id);
}

export async function listPlugins(): Promise<PluginView[]> {
  const s = market();
  await Promise.all([s.loadAppVersion(), s.loadInstalledMeta(), s.loadSources(), s.fetchCatalog()]);
  const state = market();
  const seeded = await loadSeededEntries();
  const registry = usePluginRegistryStore.getState();

  return getLoadedPlugins().map((m) => {
    const meta = state.installedMeta.find((i) => i.id === m.id);
    const isSeeded = !meta && seeded.has(m.id);
    const origin: PluginView["origin"] = meta
      ? (meta.sourceId === "local" ? "local" : meta.sourceId === "url" ? "url" : "catalog")
      : isSeeded ? "seeded" : "local";
    // Reuses the same update-detection rules (semver + hash + minAppVersion, source-scoped)
    // the Browse tab and the seeded-update banner already apply — see updates.ts.
    const update = meta
      ? availableUpdate(meta, state.catalog)
      : isSeeded
        ? availableSeededUpdate(m, state.catalog, state.appVersion)
        : null;
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      enabled: registry.isEnabled(m.id, m.defaultEnabled ?? true),
      loaded: true,
      origin,
      hash: meta?.hash ?? null,
      permissions: m.permissions ?? [],
      configurable: Object.keys(configOf(m)),
      updateAvailable: update?.version ?? null,
    };
  });
}

function loadedManifest(id: string): PluginManifest | undefined {
  return getLoadedPlugins().find((m) => m.id === id);
}

async function findView(id: string): Promise<PluginView | undefined> {
  return (await listPlugins()).find((p) => p.id === id);
}

const noSuchPlugin = (id: string) => failed(noSuchPluginMessage(id));

/** Runs a throwing store call and turns a rejection into a DomainResult refusal,
 *  preserving the thrown error's message (MinAppVersionError, hash/id mismatches,
 *  a bad source URL, ...) — same convention as settings.ts's setSetting. */
async function tryStoreCall(fn: () => Promise<void>): Promise<DomainResult<void>> {
  try {
    await fn();
    return { ok: true, result: undefined };
  } catch (err) {
    return failed(err);
  }
}

export async function installPlugin(id: string): Promise<DomainResult<PluginView>> {
  const entry = await catalogEntry(id);
  if (!entry) return failed(`no catalog plugin "${id}"; call marketplace_search for available ids`);
  const attempt = await tryStoreCall(async () => {
    const { manifestText } = await market().fetchManifest(entry);
    await market().installPlugin(entry, manifestText);
  });
  if (!attempt.ok) return attempt;
  const view = await findView(id);
  return view ? { ok: true, result: view } : failed(`install of "${id}" produced no loaded plugin`);
}

export async function uninstallPlugin(id: string): Promise<DomainResult<{ id: string }>> {
  const view = await findView(id);
  if (!view) return noSuchPlugin(id);
  const attempt = await tryStoreCall(() =>
    view.origin === "seeded" ? market().uninstallSeededPlugin(id) : market().uninstallPlugin(id),
  );
  if (!attempt.ok) return attempt;
  return { ok: true, result: { id } };
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<DomainResult<PluginView>> {
  if (!loadedManifest(id)) return noSuchPlugin(id);
  // Same pair, same order, as the Settings toggle (PluginsSection handleToggle).
  setPluginActive(id, enabled);
  await usePluginRegistryStore.getState().setEnabled(id, enabled);
  const view = await findView(id);
  return view ? { ok: true, result: view } : failed(`"${id}" toggled but produced no loaded plugin`);
}

export async function updatePlugin(id: string): Promise<DomainResult<PluginView>> {
  const view = await findView(id);
  if (!view) return noSuchPlugin(id);
  if (!view.updateAvailable) return failed(`"${id}" is already at ${view.version}; no update available`);
  return installPlugin(id);
}

export async function readPluginConfig(id: string): Promise<DomainResult<Record<string, unknown>>> {
  const m = loadedManifest(id);
  if (!m) return noSuchPlugin(id);
  const fields = configOf(m);
  const keys = Object.keys(fields);
  if (keys.length === 0) return failed(`"${id}" declares no configuration`);
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (await pluginStorageGet(id, k)) ?? fields[k].default;
  return { ok: true, result: out };
}

export async function writePluginConfig(
  id: string, key: string, value: unknown,
): Promise<DomainResult<{ key: string; effective: unknown }>> {
  const m = loadedManifest(id);
  if (!m) return noSuchPlugin(id);
  const fields = configOf(m);
  const field = fields[key];
  if (!field) return failed(unknownConfigKeyMessage(id, Object.keys(fields), key));
  const effective = coerce(field, value);
  if (effective === undefined) return failed(`"${key}" expects ${field.type}`);
  await pluginStorageSet(id, key, effective);
  return { ok: true, result: { key, effective } };
}

/** Validate against the declared field, clamping numbers like the host form does. */
function coerce(field: PluginConfigField, value: unknown): unknown {
  if (field.type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (field.type === "string") return typeof value === "string" ? value : undefined;
  if (field.type === "select") {
    return typeof value === "string" && (field.options ?? []).includes(value) ? value : undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  let n = value;
  if (field.min !== undefined) n = Math.max(field.min, n);
  if (field.max !== undefined) n = Math.min(field.max, n);
  return n;
}

export async function listSources(): Promise<SourceView[]> {
  await market().loadSources();
  return market().sources.map((s) => ({ ...s }));
}

export async function searchCatalog(query?: string): Promise<MarketplacePlugin[]> {
  await market().loadSources();
  await market().fetchCatalog();
  const q = query?.trim().toLowerCase();
  const all = market().catalog;
  if (!q) return all;
  return all.filter((p) =>
    [p.id, p.name, p.description, p.author, ...p.tags].some((f) => f.toLowerCase().includes(q)),
  );
}

export async function addSource(url: string): Promise<DomainResult<SourceView>> {
  const attempt = await tryStoreCall(() => market().addSource(url));
  if (!attempt.ok) return attempt;
  const view = (await listSources()).find((s) => s.url === url);
  return view ? { ok: true, result: view } : failed(`source "${url}" was not added`);
}

export async function removeSource(id: string): Promise<DomainResult<{ id: string }>> {
  const source = (await listSources()).find((s) => s.id === id);
  if (!source) return failed(noSuchSourceMessage(id));
  if (!source.deletable) return failed(sourceNotDeletableMessage(id));
  const attempt = await tryStoreCall(() => market().removeSource(id));
  if (!attempt.ok) return attempt;
  return { ok: true, result: { id } };
}
