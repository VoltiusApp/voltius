import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LockPolicy } from "@/services/lockPolicy";

interface OrgLockPolicyStore {
  policy: LockPolicy | null;
  setPolicy: (policy: LockPolicy | null) => void;
}

export const useOrgLockPolicyStore = create<OrgLockPolicyStore>()(
  persist(
    (set) => ({
      policy: null,
      setPolicy: (policy) => set({ policy }),
    }),
    { name: "voltius-org-lock-policy", partialize: (s) => ({ policy: s.policy }) },
  ),
);
