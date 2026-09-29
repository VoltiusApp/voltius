import { create } from "zustand";
import type { TeamObjectType } from "@/services/teamObjects";

export interface ObjectAccess {
  type: TeamObjectType;
  ruleSetId: string | null;
  myPermissions: number;
  parentId: string | null;
  deleted: boolean;
}

export type TeamAccessEntries = Record<string, ObjectAccess>;
export type ObjectAccessIndex = Record<string, TeamAccessEntries>;

interface TeamObjectAccessState {
  byTeam: ObjectAccessIndex;
  supportedByTeam: Record<string, boolean>;
  replaceTeam: (teamId: string, entries: TeamAccessEntries, supported: boolean) => void;
  upsert: (teamId: string, objectId: string, entry: ObjectAccess) => void;
  clearTeam: (teamId: string) => void;
  clearAll: () => void;
}

export const useTeamObjectAccessStore = create<TeamObjectAccessState>((set) => ({
  byTeam: {},
  supportedByTeam: {},
  replaceTeam: (teamId, entries, supported) =>
    set((s) => ({
      byTeam: { ...s.byTeam, [teamId]: entries },
      supportedByTeam: { ...s.supportedByTeam, [teamId]: supported },
    })),
  upsert: (teamId, objectId, entry) =>
    set((s) => ({ byTeam: { ...s.byTeam, [teamId]: { ...(s.byTeam[teamId] ?? {}), [objectId]: entry } } })),
  clearTeam: (teamId) =>
    set((s) => {
      const byTeam = { ...s.byTeam };
      const supportedByTeam = { ...s.supportedByTeam };
      delete byTeam[teamId];
      delete supportedByTeam[teamId];
      return { byTeam, supportedByTeam };
    }),
  clearAll: () => set({ byTeam: {}, supportedByTeam: {} }),
}));

export const teamAccessEntries = (teamId: string): TeamAccessEntries =>
  useTeamObjectAccessStore.getState().byTeam[teamId] ?? {};

export const objectAccess = (teamId: string, objectId: string): ObjectAccess | undefined =>
  teamAccessEntries(teamId)[objectId];

export const ruleSetsSupported = (teamId: string): boolean =>
  useTeamObjectAccessStore.getState().supportedByTeam[teamId] ?? false;
