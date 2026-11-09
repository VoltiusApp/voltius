import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MergedLayer } from "@/services/policy/mergeLayers";
import { lockPolicyDoc } from "@/services/lockPolicy";

interface TeamPolicyStore {
  layer: MergedLayer | null;
  inputs: string;
  setLayer: (layer: MergedLayer | null, inputs: string) => void;
}

export const useTeamPolicyStore = create<TeamPolicyStore>()(
  persist(
    (set) => ({
      layer: null,
      inputs: "",
      setLayer: (layer, inputs) => set({ layer, inputs }),
    }),
    { name: "voltius-team-policy", version: 1, partialize: (s) => ({ layer: s.layer, inputs: s.inputs }) },
  ),
);

const LEGACY_LOCK_POLICY = "voltius-org-lock-policy";

function seedFromLegacyLockPolicy(): void {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_LOCK_POLICY) ?? "null")?.state?.policy;
    if (typeof legacy?.maxMinutes !== "number" || useTeamPolicyStore.getState().layer) return;
    const policy = lockPolicyDoc({ max_minutes: legacy.maxMinutes, force_vault: legacy.forceVault === true });
    const teams = Object.fromEntries(Object.keys(policy).map((key) => [key, []]));
    useTeamPolicyStore.getState().setLayer({ policy, teams, issues: [] }, "");
  } catch {
  } finally {
    try { localStorage.removeItem(LEGACY_LOCK_POLICY); } catch {}
  }
}

seedFromLegacyLockPolicy();
