import { create } from "zustand";
import { persist } from "zustand/middleware";
import { domainOf, settingKey } from "@/services/user-data/settingKeys";
import { isLocked, lockedValue } from "./policyStore";
import { SYNC_SETTING_DOMAINS } from "./syncDomains";

export * from "./syncDomains";

const TOGGLEABLE_DOMAINS = new Set(SYNC_SETTING_DOMAINS.map((d) => d.id));

function lockedFlag(key: string): boolean | undefined {
  const lock = lockedValue(key);
  return lock.locked ? lock.value === true : undefined;
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface SyncPrefsStore {
  // Per-type toggles: key = type id, value = synced (default true when absent)
  syncTypes: Record<string, boolean>;
  // Per-object exclusions by ID
  excludedIds: string[];
  // Per-domain settings toggles: key = handler key, value = synced (default true when absent)
  syncSettingDomains: Record<string, boolean>;
  // Explicit per-setting choice, keyed by dotted path. Absent = the registry
  // default, so device-scoped keys need no seeding and no store migration.
  settingSyncOverrides: Record<string, boolean>;
  // No background sync with the server from this device. Never synced itself.
  paused: boolean;

  setSyncType: (typeId: string, v: boolean) => void;
  toggleExcluded: (id: string) => void;
  isExcluded: (id: string) => boolean;
  isTypeSynced: (typeId: string) => boolean;
  isObjectSynced: (id: string, typeId: string) => boolean;
  setSyncSettingDomain: (id: string, v: boolean) => void;
  isDomainSynced: (id: string) => boolean;
  setSettingSync: (path: string, v: boolean) => void;
  isSettingSynced: (path: string) => boolean;
  setPaused: (v: boolean) => void;
}

export const useSyncPrefsStore = create<SyncPrefsStore>()(
  persist(
    (set, get) => ({
      syncTypes: {},
      excludedIds: [],
      syncSettingDomains: {},
      settingSyncOverrides: {},
      paused: false,

      setSyncType: (typeId, v) =>
        !isLocked(`sync.types.${typeId}`) &&
        set((s) => ({ syncTypes: { ...s.syncTypes, [typeId]: v } })),

      toggleExcluded: (id) =>
        set((s) => ({
          excludedIds: s.excludedIds.includes(id)
            ? s.excludedIds.filter((x) => x !== id)
            : [...s.excludedIds, id],
        })),

      isExcluded: (id) => get().excludedIds.includes(id),

      isTypeSynced: (typeId) => lockedFlag(`sync.types.${typeId}`) ?? get().syncTypes[typeId] ?? true,

      isObjectSynced: (id, typeId) => {
        const s = get();
        if (!s.isTypeSynced(typeId)) return false;
        return !s.excludedIds.includes(id);
      },

      setSyncSettingDomain: (id, v) =>
        !isLocked(`sync.domains.${id}`) &&
        set((s) => ({ syncSettingDomains: { ...s.syncSettingDomains, [id]: v } })),

      isDomainSynced: (id) => {
        if (!TOGGLEABLE_DOMAINS.has(id)) return true;
        return lockedFlag(`sync.domains.${id}`) ?? get().syncSettingDomains[id] ?? true;
      },

      // Not folded into setSyncType/setSyncSettingDomain: a computed-key
      // generic setter needs an `as Pick<SyncPrefsStore, K>` cast, which
      // costs more than the three explicit one-liners it would replace.
      setSettingSync: (path, v) =>
        !isLocked(`sync.settings.${path}`) &&
        set((s) => ({ settingSyncOverrides: { ...s.settingSyncOverrides, [path]: v } })),

      isSettingSynced: (path) => {
        const s = get();
        if (!s.isDomainSynced(domainOf(path))) return false;
        return (
          lockedFlag(`sync.settings.${path}`) ??
          (s.settingSyncOverrides ?? {})[path] ??
          !settingKey(path)?.deviceScoped
        );
      },

      setPaused: (v) => set({ paused: v }),
    }),
    { name: "sync-prefs" },
  ),
);
