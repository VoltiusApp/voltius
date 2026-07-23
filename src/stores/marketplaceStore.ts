import { create } from "zustand";
import i18n from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { loadPlugin, unloadPlugin } from "@/plugins/runtime";
import type { PluginManifest, PluginRegisterFn } from "@/plugins/api";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { appFetch } from "@/services/http";
import { resolveVerifiedHash } from "@/plugins/integrity";

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const INSTALLED_META_KEY = "installed-plugins";

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

// ─── Store ────────────────────────────────────────────────────────────────

interface MarketplaceState {
  // Sources
  sources: MarketplaceSource[];
  addSource: (url: string) => Promise<void>;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;

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
  installPlugin: (plugin: MarketplacePlugin) => Promise<void>;
  uninstallPlugin: (id: string) => Promise<void>;
  reloadPlugin: (id: string) => Promise<void>;

  // Dev: scan local plugin folders
  scanLocal: () => Promise<void>;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  // ── Sources ───────────────────────────────────────────────────────────
  sources: [FIRST_PARTY_SOURCE],

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
  },

  removeSource(id: string) {
    set((s) => ({ sources: s.sources.filter((src) => !src.deletable ? true : src.id !== id) }));
  },

  toggleSource(id: string) {
    set((s) => ({
      sources: s.sources.map((src) => src.id === id ? { ...src, enabled: !src.enabled } : src),
    }));
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

  async installPlugin(plugin: MarketplacePlugin) {
    const { installing, installedMeta } = get();
    if (installing.has(plugin.id)) return;

    set((s) => ({ installing: new Set([...s.installing, plugin.id]) }));
    try {
      const base = plugin.repo.startsWith("http")
        ? plugin.repo
        : `https://github.com/${plugin.repo}/releases/latest/download`;

      const [manifestText, jsText] = await Promise.all([
        invoke<string>("plugin_fetch_url", { url: `${base}/manifest.json` }),
        invoke<string>("plugin_fetch_url", { url: `${base}/index.js` }),
      ]);

      const manifest = JSON.parse(manifestText) as PluginManifest;

      // Integrity: refuse to execute a bundle that doesn't match its reviewed hash.
      const verifiedHash = await resolveVerifiedHash(jsText, plugin.hash);

      await invoke("plugin_write_file", { id: plugin.id, filename: "manifest.json", content: manifestText });
      await invoke("plugin_write_file", { id: plugin.id, filename: "index.js", content: jsText });

      const jsPath = await invoke<string>("plugin_resolve_path", { id: plugin.id, filename: "index.js" });
      // Cache-bust so a same-session re-install imports the freshly-verified bytes,
      // not a stale cached module (keyed by verified hash; identical bytes reuse the cache).
      const url = convertFileSrc(jsPath) + `?v=${verifiedHash ?? Date.now()}`;
      const mod = await import(/* @vite-ignore */ url) as { default: PluginRegisterFn };
      loadPlugin(manifest, mod.default);

      const newMeta: InstalledPluginMeta[] = [
        ...installedMeta.filter((m) => m.id !== plugin.id),
        { id: plugin.id, version: plugin.version, sourceId: plugin.sourceId, hash: verifiedHash },
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
    const jsPath = await invoke<string>("plugin_resolve_path", { id, filename: "index.js" });
    const url = convertFileSrc(jsPath) + `?t=${Date.now()}`;
    const mod = await import(/* @vite-ignore */ url) as { default: PluginRegisterFn };
    loadPlugin(manifest, mod.default);
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
        const jsPath = await invoke<string>("plugin_resolve_path", { id, filename: "index.js" });
        const url = convertFileSrc(jsPath);
        const mod = await import(/* @vite-ignore */ url) as { default: PluginRegisterFn };
        loadPlugin(manifest, mod.default);
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

// ─── Startup loader ───────────────────────────────────────────────────────

export async function loadInstalledPlugins(): Promise<void> {
  // Note: the recorded meta.hash is used only for the UI "unverified" signal, not re-checked
  // here. Load-time re-hashing is intentionally out of scope — under the Path B trust model a
  // local attacker who can rewrite the plugin dir already has full renderer privileges, so it
  // would add no real boundary. The integrity check binds reviewed→executed at INSTALL time.
  const store = useMarketplaceStore.getState();
  await store.loadInstalledMeta();

  const ids = await invoke<string[]>("plugins_list_installed");
  for (const id of ids) {
    if (id === "__meta__") continue;
    try {
      const manifestText = await invoke<string>("plugin_read_file", { id, filename: "manifest.json" });
      const manifest = JSON.parse(manifestText) as PluginManifest;
      const jsPath = await invoke<string>("plugin_resolve_path", { id, filename: "index.js" });
      const url = convertFileSrc(jsPath);
      const mod = await import(/* @vite-ignore */ url) as { default: PluginRegisterFn };
      const { isEnabled } = usePluginRegistryStore.getState();
      const active = isEnabled(manifest.id, manifest.defaultEnabled ?? true);
      loadPlugin(manifest, mod.default, active);
    } catch (e) {
      console.warn(`[marketplace] Failed to load installed plugin "${id}":`, e);
    }
  }
}
