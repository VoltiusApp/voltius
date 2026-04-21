import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SecurityStore {
  sessionTimeoutMinutes: number | null;
  setSessionTimeoutMinutes: (minutes: number | null) => void;
}

export const useSecurityStore = create<SecurityStore>()(
  persist(
    (set) => ({
      sessionTimeoutMinutes: null,
      setSessionTimeoutMinutes: (minutes) => set({ sessionTimeoutMinutes: minutes }),
    }),
    {
      name: "voltius-security",
      partialize: (state) => ({
        sessionTimeoutMinutes: state.sessionTimeoutMinutes,
      }),
    },
  ),
);