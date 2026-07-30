import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

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

/**
 * `plugins_list_seeded` returns folder names, not manifest ids — resolving
 * "does a seeded artifact exist for this manifest id" means reading every
 * seeded manifest.json. Cached for the session (module scope, like
 * `appVersionPromise` in marketplaceStore) since the seeded set never
 * changes without a new app build.
 */
let seededManifestIdsPromise: Promise<Set<string>> | null = null;

async function loadSeededManifestIds(): Promise<Set<string>> {
  let folders: string[] = [];
  try {
    folders = await invoke<string[]>("plugins_list_seeded");
  } catch {
    return new Set();
  }
  const ids = new Set<string>();
  await Promise.all(
    folders.map(async (folder) => {
      try {
        const manifestText = await invoke<string>("plugin_seeded_read", { id: folder, filename: "manifest.json" });
        const manifest = JSON.parse(manifestText) as { id?: string };
        if (manifest.id) ids.add(manifest.id);
      } catch {
        // Unreadable seeded manifest — not eligible for the tombstone rule.
      }
    }),
  );
  return ids;
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

  hasSeededArtifact: async (id) => {
    if (seededManifestIdsPromise === null) {
      seededManifestIdsPromise = loadSeededManifestIds();
    }
    const ids = await seededManifestIdsPromise;
    return ids.has(id);
  },
}));
