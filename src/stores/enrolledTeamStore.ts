import { create } from "zustand";
import { persist } from "zustand/middleware";
import { parseEnrollmentToken, type EnrollmentTokenParts } from "@/services/enrollment/enrollmentToken";
import type { MergedLayer } from "@/services/policy/mergeLayers";

export interface EnrolledTeamEntry {
  tokenId: string;
  server: string;
  teamId: string;
  teamName: string;
  revision: number;
  clientVersion: string | null;
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

export function enrollmentTokenOf(machinePolicy: Record<string, unknown>): EnrollmentTokenParts | null {
  const raw = machinePolicy["enrollment.token"];
  return typeof raw === "string" ? parseEnrollmentToken(raw) : null;
}

export const entryForToken = (entry: EnrolledTeamEntry | null, token: EnrollmentTokenParts | null): EnrolledTeamEntry | null =>
  token && entry?.tokenId === token.id && entry.server === token.serverUrl ? entry : null;
