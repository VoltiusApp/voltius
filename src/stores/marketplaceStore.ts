import { create } from "zustand";
import i18n from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { loadPlugin, unloadPlugin } from "@/plugins/runtime";
import { importPluginModule, pluginRegisterOf, type PluginModule } from "@/plugins/importPluginModule";
import type { PluginManifest } from "@/plugins/api";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { appFetch } from "@/services/http";
import { resolveVerifiedHash } from "@/plugins/integrity";
import { satisfiesMinAppVersion, MinAppVersionError } from "@/plugins/version";

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
}

export interface InstalledPluginMeta {
  id: string;
  version: string;
  sourceId: string | "local" | "url";
  hash: string | null;
  /** Where the bundle came from, recorded so another device can re-fetch it
   *  without needing the catalogue to still list this plugin. Absent on entries
   *  written before this field existed, and on locally-scanned plugins. */
  repo?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const INSTALLED_META_KEY = "installed-plugins";
const SOURCES_META_KEY = "marketplace-sources";

const FIRST_PARTY_SOURCE: MarketplaceSource = {
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
        const plugins = list.map((p) => ({ ...p, sourceId: source.id }));
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
      const [fetchedManifestText, jsText] = await Promise.all([
        reviewedManifestText !== undefined
          ? Promise.resolve(reviewedManifestText)
          : invoke<string>("plugin_fetch_url", { url: `${base}/manifest.json` }),
        invoke<string>("plugin_fetch_url", { url: `${base}/index.js` }),
      ]);
      const manifestText = fetchedManifestText;

      const manifest = JSON.parse(manifestText) as PluginManifest;

      // Integrity: refuse to execute a bundle that doesn't match its reviewed hash.
      const verifiedHash = await resolveVerifiedHash(jsText, plugin.hash);

      await invoke("plugin_write_file", { id: plugin.id, filename: "manifest.json", content: manifestText });
      await invoke("plugin_write_file", { id: plugin.id, filename: "index.js", content: jsText });

      // No CSS: the marketplace catalogue/manifest hash-pins only index.js (see
      // resolveVerifiedHash above). Fetching a voltius.css alongside it would ship
      // unreviewed third-party code (CSS can still exfiltrate via url()/@import and
      // affect layout-based attacks) outside that integrity boundary. Extending the
      // hash contract to cover a second file needs a marketplace-catalogue format
      // change (voltiusApp/marketplace) — deliberately out of scope here, so
      // third-party plugins with a stylesheet remain unstyled until that lands.
      const mod = (await importPluginModule(jsText)) as PluginModule;
      // Honour a stored enable/disable override: reinstalling — or restoring on
      // another device — must not silently re-enable something the user turned off.
      const active = usePluginRegistryStore
        .getState()
        .isEnabled(manifest.id, manifest.defaultEnabled ?? true);
      loadPlugin(manifest, pluginRegisterOf(mod), active);

      const newMeta: InstalledPluginMeta[] = [
        ...installedMeta.filter((m) => m.id !== plugin.id),
        { id: plugin.id, version: plugin.version, sourceId: plugin.sourceId, hash: verifiedHash, repo: plugin.repo },
      ];
      await writeInstalledMeta(newMeta);
      set({ installedMeta: newMeta });
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
        ...listed, hash,
      });
    } catch (e) {
      console.warn(`[marketplace] Failed to restore "${meta.id}":`, e);
    }
  }
}

// ─── Startup loader ───────────────────────────────────────────────────────

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
