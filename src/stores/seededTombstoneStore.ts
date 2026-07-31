import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import type { PluginManifest } from "@/plugins/api";

const TOMBSTONE_FILE = "removed-seeded.json";

interface TombstoneFile {
  removed: string[];
}

async function readTombstones(): Promise<string[]> {
  try {
    const raw = await invoke<string>("plugin_read_file", { id: "__meta__", filename: TOMBSTONE_FILE });
    const parsed = JSON.parse(raw) as TombstoneFile;
    if (!parsed || !Array.isArray(parsed.removed)) return [];
    return parsed.removed;
  } catch {
    return [];
  }
}

async function writeTombstones(removed: string[]): Promise<void> {
  await invoke("plugin_write_file", {
    id: "__meta__",
    filename: TOMBSTONE_FILE,
    content: JSON.stringify({ removed }, null, 2),
  });
}

/** A seeded (app-bundled) plugin's on-disk folder name plus its parsed manifest. The
 *  folder name is what `plugin_seeded_read` needs to read files; the manifest id
 *  (e.g. "plugin-docker") is what tombstones, installedMeta and the catalogue key on. */
export interface SeededEntry {
  folder: string;
  manifest: PluginManifest;
}

/**
 * `plugins_list_seeded` returns folder names, not manifest ids — resolving
 * "does a seeded artifact exist for this manifest id" means reading every
 * seeded manifest.json. Cached for the session (module scope, like
 * `appVersionPromise` in marketplaceStore) since the seeded set never
 * changes without a new app build.
 */
let seededEntriesPromise: Promise<Map<string, SeededEntry>> | null = null;

async function loadSeededEntriesUncached(): Promise<Map<string, SeededEntry>> {
  let folders: string[] = [];
  try {
    folders = await invoke<string[]>("plugins_list_seeded");
  } catch {
    return new Map();
  }
  const entries = new Map<string, SeededEntry>();
  await Promise.all(
    folders.map(async (folder) => {
      try {
        const manifestText = await invoke<string>("plugin_seeded_read", { id: folder, filename: "manifest.json" });
        const manifest = JSON.parse(manifestText) as PluginManifest;
        if (manifest.id) entries.set(manifest.id, { folder, manifest });
      } catch {
        // Unreadable seeded manifest — not eligible for the tombstone/floor rules.
      }
    }),
  );
  return entries;
}

/** Folder + parsed manifest for every seeded plugin, keyed by manifest id. Used both
 *  by the tombstone rule and by the Browse-tab local floor (installing/previewing a
 *  built-in from its app-bundled files rather than the network). */
export async function loadSeededEntries(): Promise<Map<string, SeededEntry>> {
  if (seededEntriesPromise === null) {
    seededEntriesPromise = loadSeededEntriesUncached();
  }
  return seededEntriesPromise;
}

interface SeededTombstoneStore {
  removed: string[];
  load(): Promise<void>;
  isRemoved(id: string): boolean;
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  /** True when a seeded (app-bundled) artifact exists for this manifest id. */
  hasSeededArtifact(id: string): Promise<boolean>;
}

export const useSeededTombstoneStore = create<SeededTombstoneStore>((set, get) => ({
  removed: [],

  load: async () => {
    const removed = await readTombstones();
    set({ removed });
  },

  isRemoved: (id) => get().removed.includes(id),

  remove: async (id) => {
    if (get().removed.includes(id)) return;
    const removed = [...get().removed, id];
    set({ removed });
    useAppSettingsTimestampStore.getState().touch();
    await writeTombstones(removed).catch(() => {});
  },

  restore: async (id) => {
    if (!get().removed.includes(id)) return;
    const removed = get().removed.filter((r) => r !== id);
    set({ removed });
    useAppSettingsTimestampStore.getState().touch();
    await writeTombstones(removed).catch(() => {});
  },

  hasSeededArtifact: async (id) => (await loadSeededEntries()).has(id),
}));
