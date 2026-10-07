import { create } from "zustand";
import { getAppLock, setAppLock, type LockKind } from "@/services/account";

interface AppLockStore {
  kind: LockKind | null;
  hydrate: () => Promise<void>;
  lockScreen: () => Promise<void>;
  unlock: () => Promise<void>;
}

export const useAppLockStore = create<AppLockStore>()((set) => ({
  kind: null,
  hydrate: async () => set({ kind: await getAppLock() }),
  lockScreen: async () => {
    await setAppLock("screen");
    set({ kind: "screen" });
  },
  unlock: async () => {
    await setAppLock(null);
    set({ kind: null });
  },
}));
