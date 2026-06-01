import { create } from "zustand";
import {
  listTeamObjectPrefs,
  upsertTeamObjectPref,
  type TeamObjectPrefRecord,
} from "@/services/teamObjects";

export interface TeamObjectPref {
  pinned: boolean | null;
}

export type PinSource =
  | "none"
  | "personal"
  | "team"
  | "team+personal"
  | "team-hidden";

interface PinnableTeamObject {
  id: string;
  pinned?: boolean;
  favorite?: boolean;
}

interface State {
  prefs: Record<string, Record<string, TeamObjectPref>>;
  load: (teamId: string) => Promise<void>;
  setPinned: (teamId: string, objectId: string, pinned: boolean | null) => Promise<void>;
  clearTeam: (teamId: string) => void;
  getPref: (teamId: string, objectId: string) => TeamObjectPref | undefined;
  isPinned: (teamId: string, obj: PinnableTeamObject, objectType?: string) => boolean;
  pinSource: (teamId: string, obj: PinnableTeamObject, objectType?: string) => PinSource;
}

function teamDefaultPin(obj: PinnableTeamObject, objectType?: string): boolean {
  if (objectType === "snippet") return obj.favorite === true;
  return obj.pinned === true;
}

export const useTeamObjectPrefsStore = create<State>((set, get) => ({
  prefs: {},

  load: async (teamId: string) => {
    let records: TeamObjectPrefRecord[];
    try {
      records = await listTeamObjectPrefs(teamId);
    } catch {
      return;
    }
    const map: Record<string, TeamObjectPref> = {};
    for (const r of records) {
      map[r.object_id] = { pinned: r.pinned };
    }
    set((s) => ({ prefs: { ...s.prefs, [teamId]: map } }));
  },

  setPinned: async (teamId, objectId, pinned) => {
    const prev = get().prefs[teamId]?.[objectId];
    set((s) => {
      const teamMap = { ...(s.prefs[teamId] ?? {}) };
      if (pinned === null) {
        delete teamMap[objectId];
      } else {
        teamMap[objectId] = { pinned };
      }
      return { prefs: { ...s.prefs, [teamId]: teamMap } };
    });
    try {
      await upsertTeamObjectPref(teamId, objectId, pinned);
    } catch (err) {
      set((s) => {
        const teamMap = { ...(s.prefs[teamId] ?? {}) };
        if (prev === undefined) {
          delete teamMap[objectId];
        } else {
          teamMap[objectId] = prev;
        }
        return { prefs: { ...s.prefs, [teamId]: teamMap } };
      });
      throw err;
    }
  },

  clearTeam: (teamId) =>
    set((s) => {
      const next = { ...s.prefs };
      delete next[teamId];
      return { prefs: next };
    }),

  getPref: (teamId, objectId) => get().prefs[teamId]?.[objectId],

  isPinned: (teamId, obj, objectType) => {
    const personal = get().prefs[teamId]?.[obj.id]?.pinned;
    if (personal !== null && personal !== undefined) return personal;
    return teamDefaultPin(obj, objectType);
  },

  pinSource: (teamId, obj, objectType) => {
    const personal = get().prefs[teamId]?.[obj.id]?.pinned;
    const team = teamDefaultPin(obj, objectType);
    if (personal === true && team) return "team+personal";
    if (personal === true && !team) return "personal";
    if (personal === false && team) return "team-hidden";
    if (personal === false && !team) return "none";
    return team ? "team" : "none";
  },
}));
