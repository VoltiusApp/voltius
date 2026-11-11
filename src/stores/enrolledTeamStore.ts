import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MergedLayer } from "@/services/policy/mergeLayers";

export interface EnrolledTeamEntry {
  tokenId: string;
  server: string;
  teamId: string;
  teamName: string;
  revision: number;
  layer: MergedLayer;
}

interface EnrolledTeamStore {
  entry: EnrolledTeamEntry | null;
  setEntry: (entry: EnrolledTeamEntry | null) => void;
}

export const useEnrolledTeamStore = create<EnrolledTeamStore>()(
  persist(
    (set) => ({
      entry: null,
      setEntry: (entry) => set({ entry }),
    }),
    { name: "voltius-enrolled-team", version: 1, partialize: (s) => ({ entry: s.entry }) },
  ),
);
