import { create } from "zustand";
import { getAppLock, setAppLock, type LockKind } from "@/services/account";

interface AppLockStore {
  kind: LockKind | null;
  hydrate: () => Promise<void>;
  lockScreen: () => Promise<void>;
  unlock: () => Promise<void>;
}

export const useAppLockStore = create<AppLockStore>()((set) => {
  const apply = (kind: LockKind | null) => {
    set({ kind });
    return setAppLock(kind);
  };
  return {
    kind: null,
    hydrate: async () => set({ kind: await getAppLock() }),
    lockScreen: () => apply("screen"),
    unlock: () => apply(null),
  };
});
