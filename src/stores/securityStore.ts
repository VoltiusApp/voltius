import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LockAction = "vault" | "screen";

interface SecurityStore {
  sessionTimeoutMinutes: number | null;
  lockAction: LockAction;
  systemAuthUnlock: boolean;
  /**
   * Whether a password account's master password may wait in the OS keychain in
   * plain form, which opens the vault at launch without asking. Read before the
   * vault is unlocked, so it lives here: in this device's localStorage, outside
   * the vault, the sync bundle and team policy, none of which may turn it back on.
   * A sealed (hardware-bound) copy is not affected.
   */
  rememberMasterPassword: boolean;
  setSessionTimeoutMinutes: (minutes: number | null) => void;
  setLockAction: (action: LockAction) => void;
  setSystemAuthUnlock: (on: boolean) => void;
  /** Only the flag: `setRememberMasterPassword` in vaultSecret also removes what is stored. */
  setRememberMasterPassword: (on: boolean) => void;
}

export const useSecurityStore = create<SecurityStore>()(
  persist(
    (set) => ({
      sessionTimeoutMinutes: null,
      lockAction: "vault",
      systemAuthUnlock: false,
      rememberMasterPassword: true,
      setSessionTimeoutMinutes: (minutes) => set({ sessionTimeoutMinutes: minutes }),
      setLockAction: (lockAction) => set({ lockAction }),
      setSystemAuthUnlock: (systemAuthUnlock) => set({ systemAuthUnlock }),
      setRememberMasterPassword: (rememberMasterPassword) => set({ rememberMasterPassword }),
    }),
    {
      name: "voltius-security",
      partialize: (state) => ({
        sessionTimeoutMinutes: state.sessionTimeoutMinutes,
        lockAction: state.lockAction,
        systemAuthUnlock: state.systemAuthUnlock,
        rememberMasterPassword: state.rememberMasterPassword,
      }),
    },
  ),
);
