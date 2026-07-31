import { create } from "zustand";
import i18n from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { loadPlugin, unloadPlugin, getLoadedPlugins } from "@/plugins/runtime";
import { importPluginModule, pluginRegisterOf, type PluginModule } from "@/plugins/importPluginModule";
import type { PluginManifest } from "@/plugins/api";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { appFetch } from "@/services/http";
import { resolveVerifiedHash } from "@/plugins/integrity";
import { satisfiesMinAppVersion, MinAppVersionError } from "@/plugins/version";
import { useSeededTombstoneStore, loadSeededEntries } from "@/stores/seededTombstoneStore";

// ─── Types ────────────────────────────────────────────────────────────────

export interface MarketplaceSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  deletable: boolean;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  author: string;
  description: string;
  repo: string;
  version: string;
  minAppVersion?: string;
  tags: string[];
  theme: boolean;
  sourceId: string;
  hash?: string;
  cssHash?: string;
  /** True for a Browse-tab entry synthesised from an app-bundled seeded manifest (the
   *  local floor for a tombstoned built-in) rather than fetched from a real catalogue
   *  source. Routes `installPlugin` through the no-network, no-hash-check floor path. */
  builtin?: boolean;
}

export interface InstalledPluginMeta {
  id: string;
  version: string;
  sourceId: string | "local" | "url";
  hash: string | null;
  /** Verified hash of `voltius.css`, or null when the plugin has no stylesheet.
   *  Undefined on entries written before this field existed. */
  cssHash?: string | null;
  /** Where the bundle came from, recorded so another device can re-fetch it
   *  without needing the catalogue to still list this plugin. Absent on entries
   *  written before this field existed, and on locally-scanned plugins. */
  repo?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const INSTALLED_META_KEY = "installed-plugins";
const SOURCES_META_KEY = "marketplace-sources";

export const FIRST_PARTY_SOURCE: MarketplaceSource = {
  id: "voltius",
  name: "Voltius Marketplace",
  url: "https://raw.githubusercontent.com/voltiusApp/marketplace/main/plugins.json",
  enabled: true,
  deletable: false,
};

async function readInstalledMeta(): Promise<InstalledPluginMeta[]> {
  try {
    const raw = await invoke<string>("plugin_read_file", { id: "__meta__", filename: INSTALLED_META_KEY + ".json" });
    const list = JSON.parse(raw) as InstalledPluginMeta[];
    return list.map((m) => ({ ...m, hash: m.hash ?? null }));
  } catch {
    return [];
  }
}

async function writeInstalledMeta(list: InstalledPluginMeta[]): Promise<void> {
  await invoke("plugin_write_file", {
    id: "__meta__",
    filename: INSTALLED_META_KEY + ".json",
    content: JSON.stringify(list, null, 2),
  });
}

/** On-disk shape for marketplace sources. Only user-added sources are stored; the
 *  built-in one is re-created from code each boot so its name/url stay upgradeable,
 *  with just its enabled flag carried over. */
interface PersistedSources {
  custom: MarketplaceSource[];
  enabled: Record<string, boolean>;
}

async function writeSources(sources: MarketplaceSource[]): Promise<void> {
  const payload: PersistedSources = {
    custom: sources.filter((s) => s.deletable),
    enabled: Object.fromEntries(sources.map((s) => [s.id, s.enabled])),
  };
  await invoke("plugin_write_file", {
    id: "__meta__",
    filename: SOURCES_META_KEY + ".json",
    content: JSON.stringify(payload, null, 2),
  });
}

/**
 * Best-effort read of a plugin's stylesheet from its local install directory —
 * mirrors the seeded loader (`seeded.ts`). Unlike `installPlugin`, this never
 * fetches over the network: it only reads a file already on disk (a local dev
 * plugin folder, or one this session already installed), so it carries no new
 * integrity-boundary exposure. Most plugins ship no stylesheet — that's expected.
 */
async function readLocalCss(id: string): Promise<string | undefined> {
  try {
    return await invoke<string>("plugin_read_file", { id, filename: "voltius.css" });
  } catch {
    return undefined;
  }
}

/**
 * Installs a built-in straight from its app-bundled seeded files — the local floor
 * used when the real catalogue can't serve it (offline, fetch failure, no entry, or
 * an unsatisfied `minAppVersion`). Reads `manifest.json` / `index.js` / `voltius.css`
 * via `plugin_seeded_read` and loads them directly, exactly like `loadSeededPlugins`.
 *
 * No hash check on this path, deliberately: these bytes come from the signed app
 * bundle read off local disk, not fetched over the network, so there is nothing to
 * verify them against. Do not add one here, and do not read its absence as an
 * oversight — the "never execute an unvouched-for bundle" rule is about network
 * fetches, which this path makes none of.
 */
async function installFromSeededFloor(id: string): Promise<void> {
  const entry = (await loadSeededEntries()).get(id);
  if (!entry) throw new Error(`No seeded artifact found for "${id}".`);
  const { folder } = entry;

  const manifestText = await invoke<string>("plugin_seeded_read", { id: folder, filename: "manifest.json" });
  const manifest = JSON.parse(manifestText) as PluginManifest;
  const jsText = await invoke<string>("plugin_seeded_read", { id: folder, filename: "index.js" });
  let cssText: string | undefined;
  try {
    cssText = await invoke<string>("plugin_seeded_read", { id: folder, filename: "voltius.css" });
  } catch {
    // Most seeded plugins ship no stylesheet — expected, not an error.
  }

  const mod = (await importPluginModule(jsText, cssText, manifest.id)) as PluginModule;
  const active = usePluginRegistryStore
    .getState()
    .isEnabled(manifest.id, manifest.defaultEnabled ?? true);
  // trusted=true, matching loadSeededPlugins: a floor reinstall of a built-in must
  // not silently downgrade its pre-granted gated permissions.
  loadPlugin(manifest, pluginRegisterOf(mod), active, true, cssText);

  // This id is not written to installedMeta — a floor install puts the plugin back
  // exactly where it was before uninstall: a seeded plugin with no external shadow,
  // so `loadSeededPlugins` picks it up again on the next boot.
  await useSeededTombstoneStore.getState().restore(manifest.id);
}

/**
 * `plugin.builtin` alone is not trusted — it's a Browse-tab display flag that could
 * originate from a remote catalogue entry a hostile source spoofed to steer a click
 * into the trusted, no-hash-check floor path. Route there only when local state
 * independently confirms it: the id is a real seeded artifact AND it's currently
 * tombstoned (a built-in that's still active is already installed and has no
 * business going through the floor path at all). Shared by fetchManifest and
 * installPlugin so their gates cannot drift apart.
 */
async function takesFloorPath(plugin: MarketplacePlugin): Promise<boolean> {
  return !!plugin.builtin
    && (await loadSeededEntries()).has(plugin.id)
    && useSeededTombstoneStore.getState().isRemoved(plugin.id);
}

let appVersionPromise: Promise<string | null> | null = null;

/** Resolves the running app's version once and caches it for the session. Falls
 *  open (resolves null) if `getVersion()` itself rejects — an unknown app version
 *  must never block installs. */
function resolveAppVersion(): Promise<string | null> {
  if (appVersionPromise === null) {
    appVersionPromise = getVersion().catch((e) => {
      console.warn("[marketplace] Failed to resolve app version:", e);
      return null;
    });
  }
  return appVersionPromise;
}

// ─── Store ────────────────────────────────────────────────────────────────

interface MarketplaceState {
  // App version, for minAppVersion gating (resolved once, cached)
  appVersion: string | null;
  loadAppVersion: () => Promise<void>;

  // Sources
  sources: MarketplaceSource[];
  loadSources: () => Promise<void>;
  addSource: (url: string) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  toggleSource: (id: string) => Promise<void>;

  // Browse
  catalog: MarketplacePlugin[];
  catalogLoading: boolean;
  catalogError: string | null;
  fetchCatalog: () => Promise<void>;

  // Installed externally (not bundled)
  installedMeta: InstalledPluginMeta[];
  loadInstalledMeta: () => Promise<void>;

  // Install / uninstall
  installing: Set<string>;
  fetchManifest: (plugin: MarketplacePlugin) => Promise<{ manifest: PluginManifest; manifestText: string }>;
  installPlugin: (plugin: MarketplacePlugin, reviewedManifestText?: string) => Promise<void>;
  uninstallPlugin: (id: string) => Promise<void>;
  uninstallSeededPlugin: (id: string) => Promise<void>;
  reloadPlugin: (id: string) => Promise<void>;

  // Dev: scan local plugin folders
  scanLocal: () => Promise<void>;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  // ── App version ───────────────────────────────────────────────────────
  appVersion: null,

  async loadAppVersion() {
    const version = await resolveAppVersion();
    set({ appVersion: version });
  },

  // ── Sources ───────────────────────────────────────────────────────────
  sources: [FIRST_PARTY_SOURCE],

  async loadSources() {
    let stored: PersistedSources;
    try {
      const raw = await invoke<string>("plugin_read_file", { id: "__meta__", filename: SOURCES_META_KEY + ".json" });
      stored = JSON.parse(raw) as PersistedSources;
    } catch {
      return; // fresh profile — keep the built-in source only
    }
    const enabled = stored.enabled ?? {};
    // `deletable: true` is forced so a tampered file can't make a custom source
    // permanent, and the built-in id is filtered so it can't be shadowed.
    const custom = (stored.custom ?? [])
      .filter((s) => s.id !== FIRST_PARTY_SOURCE.id)
      .map((s) => ({ ...s, deletable: true, enabled: enabled[s.id] ?? s.enabled }));
    set({
      sources: [
        { ...FIRST_PARTY_SOURCE, enabled: enabled[FIRST_PARTY_SOURCE.id] ?? FIRST_PARTY_SOURCE.enabled },
        ...custom,
      ],
    });
  },

  async addSource(url: string) {
    const res = await appFetch(url);
    if (!res.ok) throw new Error(i18n.t("common.error.failedToFetchSource", { status: res.status }));
    const data = await res.json() as { id?: string; name?: string };
    const id = data.id ?? url.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const name = data.name ?? id;
    set((s) => ({
      sources: s.sources.find((src) => src.id === id)
        ? s.sources
        : [...s.sources, { id, name, url, enabled: true, deletable: true }],
    }));
    await writeSources(get().sources);
  },

  async removeSource(id: string) {
    set((s) => ({ sources: s.sources.filter((src) => !src.deletable ? true : src.id !== id) }));
    await writeSources(get().sources);
  },

  async toggleSource(id: string) {
    set((s) => ({
      sources: s.sources.map((src) => src.id === id ? { ...src, enabled: !src.enabled } : src),
    }));
    await writeSources(get().sources);
  },

  // ── Catalog ───────────────────────────────────────────────────────────
  catalog: [],
  catalogLoading: false,
  catalogError: null,

  async fetchCatalog() {
    const { sources } = get();
    set({ catalogLoading: true, catalogError: null });
    const results: MarketplacePlugin[] = [];
    for (const source of sources.filter((s) => s.enabled)) {
      try {
        const res = await appFetch(source.url);
        if (!res.ok) continue;
        const data = await res.json();
        const list: MarketplacePlugin[] = Array.isArray(data) ? data : (data.plugins ?? []);
        // `builtin` is never trusted from a remote source — it routes installPlugin
        // through the no-hash-check local floor, so a source spoofing it could steer
        // a click into a trusted load. Stripped here alongside the sourceId overwrite,
        // same as `deletable: true` is forced on custom sources in loadSources.
        const plugins = list.map((p) => ({ ...p, sourceId: source.id, builtin: undefined }));
        results.push(...plugins);
      } catch (e) {
        console.warn(`[marketplace] Failed to fetch source "${source.id}":`, e);
      }
    }
    set({ catalog: results, catalogLoading: false });
  },

  // ── Installed meta ────────────────────────────────────────────────────
  installedMeta: [],

  async loadInstalledMeta() {
    const meta = await readInstalledMeta();
    set({ installedMeta: meta });
  },

  // ── Install ───────────────────────────────────────────────────────────
  installing: new Set(),

  // Fetch just the manifest (no side effects) to preview declared permissions before
  // installing/updating. The executed index.js is still hash-verified in installPlugin.
  async fetchManifest(plugin: MarketplacePlugin) {
    if (await takesFloorPath(plugin)) {
      const entry = (await loadSeededEntries()).get(plugin.id);
      if (!entry) throw new Error(`No seeded artifact found for "${plugin.id}".`);
      const manifestText = await invoke<string>("plugin_seeded_read", { id: entry.folder, filename: "manifest.json" });
      return { manifest: JSON.parse(manifestText) as PluginManifest, manifestText };
    }
    const base = plugin.repo.startsWith("http")
      ? plugin.repo
      : `https://github.com/${plugin.repo}/releases/latest/download`;
    const manifestText = await invoke<string>("plugin_fetch_url", { url: `${base}/manifest.json` });
    return { manifest: JSON.parse(manifestText) as PluginManifest, manifestText };
  },

  async installPlugin(plugin: MarketplacePlugin, reviewedManifestText?: string) {
    const { installing, installedMeta } = get();
    if (installing.has(plugin.id)) return;

    set((s) => ({ installing: new Set([...s.installing, plugin.id]) }));
    try {
      if (await takesFloorPath(plugin)) {
        // The floor never touches the network or the appVersion gate below — its
        // bytes ship in the running app, so they're inherently version-compatible.
        await installFromSeededFloor(plugin.id);
        return;
      }

      const appVersion = await resolveAppVersion();
      if (appVersion !== null && !satisfiesMinAppVersion(plugin, appVersion)) {
        throw new MinAppVersionError(plugin.minAppVersion!, appVersion);
      }

      const base = plugin.repo.startsWith("http")
        ? plugin.repo
        : `https://github.com/${plugin.repo}/releases/latest/download`;

      // When the caller previewed the manifest for consent, reuse that exact text so the executed
      // permission set is precisely the one shown — closing the fetch→consent→load TOCTOU
      // (manifest.json is not hash-pinned; index.js still is). Only fetch the manifest fresh when
      // no reviewed copy was supplied (e.g. the review-disclosure setting is off).
      const [fetchedManifestText, jsText, cssText] = await Promise.all([
        reviewedManifestText !== undefined
          ? Promise.resolve(reviewedManifestText)
          : invoke<string>("plugin_fetch_url", { url: `${base}/manifest.json` }),
        invoke<string>("plugin_fetch_url", { url: `${base}/index.js` }),
        // CSS: only fetched when the catalogue hash-pins it. A device must never
        // execute or inject a network-fetched file nothing can vouch for, so with
        // no cssHash this makes no request at all — identical to before this hash
        // existed, and third-party plugins without a pinned stylesheet stay unstyled.
        plugin.cssHash ? invoke<string>("plugin_fetch_url", { url: `${base}/voltius.css` }) : Promise.resolve(undefined),
      ]);
      const manifestText = fetchedManifestText;

      const manifest = JSON.parse(manifestText) as PluginManifest;

      // Integrity: refuse to execute a bundle that doesn't match its reviewed hash.
      // Both hashes must verify before anything is written — a failed check must
      // leave no partial install on disk.
      const verifiedHash = await resolveVerifiedHash(jsText, plugin.hash);
      const verifiedCssHash = plugin.cssHash ? await resolveVerifiedHash(cssText!, plugin.cssHash) : null;

      await invoke("plugin_write_file", { id: plugin.id, filename: "manifest.json", content: manifestText });
      await invoke("plugin_write_file", { id: plugin.id, filename: "index.js", content: jsText });
      if (cssText !== undefined) {
        await invoke("plugin_write_file", { id: plugin.id, filename: "voltius.css", content: cssText });
      }

      const mod = (await importPluginModule(jsText, cssText, plugin.id)) as PluginModule;
      // Honour a stored enable/disable override: reinstalling — or restoring on
      // another device — must not silently re-enable something the user turned off.
      const active = usePluginRegistryStore
        .getState()
        .isEnabled(manifest.id, manifest.defaultEnabled ?? true);
      loadPlugin(manifest, pluginRegisterOf(mod), active, false, cssText);

      const newMeta: InstalledPluginMeta[] = [
        ...installedMeta.filter((m) => m.id !== plugin.id),
        {
          id: plugin.id, version: plugin.version, sourceId: plugin.sourceId,
          hash: verifiedHash, cssHash: verifiedCssHash, repo: plugin.repo,
        },
      ];
      await writeInstalledMeta(newMeta);
      set({ installedMeta: newMeta });

      // Reinstalling any id — including one that shadows a seeded plugin —
      // clears its uninstall tombstone, so a future removal of the external
      // copy falls back to the bundled one instead of staying gone forever.
      await useSeededTombstoneStore.getState().restore(plugin.id);
    } finally {
      set((s) => {
        const next = new Set(s.installing);
        next.delete(plugin.id);
        return { installing: next };
      });
    }
  },

  // ── Uninstall ─────────────────────────────────────────────────────────
  async uninstallPlugin(id: string) {
    unloadPlugin(id);
    await invoke("plugin_delete", { id });
    const newMeta = get().installedMeta.filter((m) => m.id !== id);
    await writeInstalledMeta(newMeta);
    set({ installedMeta: newMeta });

    // A seeded artifact for this id would otherwise auto-reload on next boot
    // (loadSeededPlugins falls back to it) — the user asked for the plugin
    // gone, not for a silent downgrade to the bundled copy.
    const tombstones = useSeededTombstoneStore.getState();
    if (await tombstones.hasSeededArtifact(id)) {
      await tombstones.remove(id);
    }
  },

  // Built-in plugins are read-only app resources — uninstalling one never
  // deletes anything from disk, only tombstones it so it stops loading and
  // stays removed across restarts (until Browse reinstalls it).
  //
  // "Seeded" as seen by the UI is "loaded and not in installedMeta" — broader
  // than "has a seeded artifact". An external plugin can end up in that same
  // bucket (its meta missing on this device, or installedMeta unreadable), and
  // tombstoning without deleting would make it reload forever on every boot.
  // Only a genuine seeded artifact gets the tombstone path; anything else falls
  // through to the real delete.
  async uninstallSeededPlugin(id: string) {
    const tombstones = useSeededTombstoneStore.getState();
    if (!(await tombstones.hasSeededArtifact(id))) {
      await get().uninstallPlugin(id);
      return;
    }
    unloadPlugin(id);
    await tombstones.remove(id);
  },

  // ── Reload (dev) ──────────────────────────────────────────────────────
  async reloadPlugin(id: string) {
    unloadPlugin(id);
    const manifestText = await invoke<string>("plugin_read_file", { id, filename: "manifest.json" });
    const manifest = JSON.parse(manifestText) as PluginManifest;
    const jsText = await invoke<string>("plugin_read_file", { id, filename: "index.js" });
    const css = await readLocalCss(id);
    const mod = (await importPluginModule(jsText, css, id)) as PluginModule;
    loadPlugin(manifest, pluginRegisterOf(mod), true, false, css);
  },

  // ── Scan local ────────────────────────────────────────────────────────
  async scanLocal() {
    const ids = await invoke<string[]>("plugins_list_installed");
    const { installedMeta } = get();
    const knownIds = new Set(installedMeta.map((m) => m.id));

    for (const id of ids) {
      if (id === "__meta__") continue;
      if (knownIds.has(id)) continue;
      try {
        const manifestText = await invoke<string>("plugin_read_file", { id, filename: "manifest.json" });
        const manifest = JSON.parse(manifestText) as PluginManifest;
        const jsText = await invoke<string>("plugin_read_file", { id, filename: "index.js" });
        const css = await readLocalCss(id);
        const mod = (await importPluginModule(jsText, css, id)) as PluginModule;
        loadPlugin(manifest, pluginRegisterOf(mod), true, false, css);
        const newMeta: InstalledPluginMeta[] = [
          ...installedMeta,
          { id, version: manifest.version, sourceId: "local", hash: null },
        ];
        await writeInstalledMeta(newMeta);
        set({ installedMeta: newMeta });
      } catch (e) {
        console.warn(`[marketplace] Failed to load local plugin "${id}":`, e);
      }
    }
  },
}));

// ─── Cross-device restore ─────────────────────────────────────────────────

/**
 * Re-fetch plugins that sync says the user has but this device doesn't. The
 * installed-plugin list rides in the sync bundle, so a fresh device knows the
 * set without having the bundles; this pulls them so a restored device comes up
 * with the same plugins, no manual reinstall.
 *
 * Every reinstall goes through `installPlugin`, so it is hash-verified on the
 * same terms as a fresh install: the current catalogue entry's hash when the
 * plugin is still listed, otherwise the hash recorded at the original install.
 * An entry with neither a catalogue entry nor a recorded hash is SKIPPED — a
 * device must never silently execute a bundle nothing can vouch for.
 */
export async function restoreMissingPlugins(): Promise<void> {
  const store = useMarketplaceStore.getState();
  const onDisk = new Set(await invoke<string[]>("plugins_list_installed"));
  const missing = store.installedMeta.filter((m) => m.sourceId !== "local" && !onDisk.has(m.id));
  if (missing.length === 0) return;

  if (store.catalog.length === 0) {
    try {
      await store.fetchCatalog();
    } catch (e) {
      console.warn("[marketplace] Catalogue fetch failed during restore:", e);
    }
  }
  const catalog = useMarketplaceStore.getState().catalog;

  for (const meta of missing) {
    const listed = catalog.find((p) => p.id === meta.id);
    const repo = listed?.repo ?? meta.repo;
    const hash = listed?.hash ?? meta.hash ?? undefined;
    const cssHash = listed?.cssHash ?? meta.cssHash ?? undefined;
    if (!repo || !hash) {
      console.warn(
        `[marketplace] Not restoring "${meta.id}": no ${!repo ? "known repo" : "verifiable hash"}.`,
      );
      continue;
    }
    try {
      await useMarketplaceStore.getState().installPlugin({
        id: meta.id, name: meta.id, author: "", description: "", repo,
        version: meta.version, tags: [], theme: false, sourceId: meta.sourceId,
        ...listed, hash, cssHash,
      });
    } catch (e) {
      console.warn(`[marketplace] Failed to restore "${meta.id}":`, e);
    }
  }

  // Anything still missing after the network pass (offline, fetch failure, no
  // catalogue entry, no verifiable hash) falls back to the seeded floor when one
  // exists and the id isn't tombstoned — meta.sourceId claiming "external" must
  // never leave the plugin completely gone on a device that still has the
  // bundled copy. `installFromSeededFloor` preserves trusted=true exactly like
  // `loadSeededPlugins`, so gated permissions aren't silently downgraded.
  const loadedIds = new Set(getLoadedPlugins().map((m) => m.id));
  const stillMissing = missing.filter((m) => !loadedIds.has(m.id));
  if (stillMissing.length === 0) return;

  const seededEntries = await loadSeededEntries();
  const { isRemoved } = useSeededTombstoneStore.getState();
  for (const meta of stillMissing) {
    if (!seededEntries.has(meta.id) || isRemoved(meta.id)) continue;
    try {
      await installFromSeededFloor(meta.id);
    } catch (e) {
      console.warn(`[marketplace] Failed to load seeded floor for "${meta.id}":`, e);
    }
  }
}

// ─── Startup loader ───────────────────────────────────────────────────────

/**
 * Loads the state `loadSeededPlugins` needs to apply the tombstone/precedence
 * rule — sources, installedMeta, and the seeded-removal list — before the
 * seeded loader runs. Must complete before `loadSeededPlugins()` at boot.
 */
export async function loadPluginMeta(): Promise<void> {
  const store = useMarketplaceStore.getState();
  await store.loadSources();
  await store.loadInstalledMeta();
  await useSeededTombstoneStore.getState().load();
}

export async function loadInstalledPlugins(): Promise<void> {
  // Note: the recorded meta.hash is used only for the UI "unverified" signal, not re-checked
  // here. Load-time re-hashing is intentionally out of scope — under the Path B trust model a
  // local attacker who can rewrite the plugin dir already has full renderer privileges, so it
  // would add no real boundary. The integrity check binds reviewed→executed at INSTALL time.
  const store = useMarketplaceStore.getState();
  await store.loadSources();
  await store.loadInstalledMeta();

  const ids = await invoke<string[]>("plugins_list_installed");
  for (const id of ids) {
    if (id === "__meta__") continue;
    try {
      const manifestText = await invoke<string>("plugin_read_file", { id, filename: "manifest.json" });
      const manifest = JSON.parse(manifestText) as PluginManifest;
      const jsText = await invoke<string>("plugin_read_file", { id, filename: "index.js" });
      const css = await readLocalCss(id);
      const mod = (await importPluginModule(jsText, css, id)) as PluginModule;
      const { isEnabled } = usePluginRegistryStore.getState();
      const active = isEnabled(manifest.id, manifest.defaultEnabled ?? true);
      loadPlugin(manifest, pluginRegisterOf(mod), active, false, css);
    } catch (e) {
      console.warn(`[marketplace] Failed to load installed plugin "${id}":`, e);
    }
  }

  // After the on-disk set is loaded, pull anything sync says the user has but
  // this device is missing. `installPlugin` loads each one as it lands, so this
  // runs last to avoid double-registering a plugin the loop already handled.
  await restoreMissingPlugins();
}
