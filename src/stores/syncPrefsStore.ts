import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Registry ────────────────────────────────────────────────────────────────
// Add new syncable object types here. AccountSection reads this automatically.

export interface SyncObjectTypeDef {
  id: string;
  label: string;
  sub: string;
}

export const SYNC_OBJECT_TYPES: SyncObjectTypeDef[] = [
  { id: "connection", label: "Hosts",       sub: "SSH connections" },
  { id: "identity",   label: "Identities",  sub: "Usernames and credentials" },
  { id: "key",        label: "SSH Keys",    sub: "Key pairs stored in keychain" },
  { id: "folder",     label: "Folders",     sub: "Folder structure for organizing objects" },
];

// ─── Store ───────────────────────────────────────────────────────────────────

interface SyncPrefsStore {
  // Per-type toggles: key = type id, value = synced (default true when absent)
  syncTypes: Record<string, boolean>;
  // Per-object exclusions by ID
  excludedIds: string[];

  setSyncType: (typeId: string, v: boolean) => void;
  toggleExcluded: (id: string) => void;
  isExcluded: (id: string) => boolean;
  isTypeSynced: (typeId: string) => boolean;
  isObjectSynced: (id: string, typeId: string) => boolean;
}

export const useSyncPrefsStore = create<SyncPrefsStore>()(
  persist(
    (set, get) => ({
      syncTypes: {},
      excludedIds: [],

      setSyncType: (typeId, v) =>
        set((s) => ({ syncTypes: { ...s.syncTypes, [typeId]: v } })),

      toggleExcluded: (id) =>
        set((s) => ({
          excludedIds: s.excludedIds.includes(id)
            ? s.excludedIds.filter((x) => x !== id)
            : [...s.excludedIds, id],
        })),

      isExcluded: (id) => get().excludedIds.includes(id),

      isTypeSynced: (typeId) => get().syncTypes[typeId] ?? true,

      isObjectSynced: (id, typeId) => {
        const s = get();
        if ((s.syncTypes[typeId] ?? true) === false) return false;
        return !s.excludedIds.includes(id);
      },
    }),
    { name: "sync-prefs" },
  ),
);
