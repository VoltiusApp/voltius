import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MergedLayer } from "@/services/policy/mergeLayers";

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
    { name: "voltius-team-policy", partialize: (s) => ({ layer: s.layer, inputs: s.inputs }) },
  ),
);
