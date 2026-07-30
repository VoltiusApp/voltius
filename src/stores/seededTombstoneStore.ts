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

interface SeededTombstoneStore {
  removed: string[];
  load(): Promise<void>;
  isRemoved(id: string): boolean;
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
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
}));
