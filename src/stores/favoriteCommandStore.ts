import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { isAlive, type TimestampedEntity } from "@/services/crdt";
import { sha256Hex } from "@/plugins/integrity";
import { syncAfterEdit } from "@/stores/syncAfterEdit";

export interface FavoriteCommand extends TimestampedEntity {
  command: string;
  connection_id: string;
  /** The session's name when starred: the label once the host is gone. */
  session_name: string;
  created_at: string;
}

interface FavoriteCommandStore {
  favorites: FavoriteCommand[];
  load: () => Promise<void>;
  add: (command: string, connectionId: string, sessionName: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const favoriteKey = (connectionId: string, command: string): string => `${connectionId}\0${command}`;

// One id per host and command, so starring it on two devices yields one favorite.
const favoriteId = (connectionId: string, command: string) => sha256Hex(favoriteKey(connectionId, command));

const byNewest = (a: FavoriteCommand, b: FavoriteCommand) => b.created_at.localeCompare(a.created_at);

export const useFavoriteCommandStore = create<FavoriteCommandStore>((set, get) => {
  const put = async (entry: FavoriteCommand, favorites: FavoriteCommand[]) => {
    set({ favorites });
    try {
      await invoke("favorite_command_put", { entry });
      syncAfterEdit("snippet", entry.id);
    } catch (e) {
      await get().load();
      throw e;
    }
  };

  return {
    favorites: [],

    load: async () => {
      const all = await invoke<FavoriteCommand[]>("favorite_command_list");
      set({ favorites: all.filter(isAlive).sort(byNewest) });
    },

    add: async (command, connectionId, sessionName) => {
      const id = await favoriteId(connectionId, command);
      if (get().favorites.some((f) => f.id === id)) return;
      const now = new Date().toISOString();
      const entry: FavoriteCommand = {
        id,
        command,
        connection_id: connectionId,
        session_name: sessionName,
        created_at: now,
        updated_at: now,
        clocks: { command: now, connection_id: now, session_name: now, created_at: now },
      };
      await put(entry, [entry, ...get().favorites]);
    },

    remove: async (id) => {
      const favorite = get().favorites.find((f) => f.id === id);
      if (!favorite) return;
      const now = new Date().toISOString();
      const tombstone: FavoriteCommand = {
        ...favorite,
        updated_at: now,
        deleted_at: now,
        clocks: { ...favorite.clocks, __deleted__: now },
      };
      await put(tombstone, get().favorites.filter((f) => f.id !== id));
    },
  };
});
