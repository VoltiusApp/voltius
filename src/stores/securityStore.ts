import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LockAction = "vault" | "screen";

interface SecurityStore {
  sessionTimeoutMinutes: number | null;
  lockAction: LockAction;
  systemAuthUnlock: boolean;
  setSessionTimeoutMinutes: (minutes: number | null) => void;
  setLockAction: (action: LockAction) => void;
  setSystemAuthUnlock: (on: boolean) => void;
}

export const useSecurityStore = create<SecurityStore>()(
  persist(
    (set) => ({
      sessionTimeoutMinutes: null,
      lockAction: "vault",
      systemAuthUnlock: false,
      setSessionTimeoutMinutes: (minutes) => set({ sessionTimeoutMinutes: minutes }),
      setLockAction: (lockAction) => set({ lockAction }),
      setSystemAuthUnlock: (systemAuthUnlock) => set({ systemAuthUnlock }),
    }),
    {
      name: "voltius-security",
      partialize: (state) => ({
        sessionTimeoutMinutes: state.sessionTimeoutMinutes,
        lockAction: state.lockAction,
        systemAuthUnlock: state.systemAuthUnlock,
      }),
    },
  ),
);
