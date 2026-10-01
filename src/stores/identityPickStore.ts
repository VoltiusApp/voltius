import { create } from "zustand";
import { persist } from "zustand/middleware";
import { listIdentityPicks, setObjectPick, setTeamDefaultPick } from "@/services/teamObjects";

export type IdentityPickStatus = "unknown" | "loaded" | "unsupported";
type PickMap = "byObject" | "byTeam";

interface IdentityPickState {
  byObject: Record<string, string>;
  byTeam: Record<string, string>;
  status: IdentityPickStatus;
  load: () => Promise<void>;
  setHostPick: (objectId: string, identityId: string | null) => Promise<void>;
  setVaultDefault: (teamId: string, identityId: string | null) => Promise<void>;
}

function withEntry(map: Record<string, string>, key: string, value: string | null): Record<string, string> {
  const next = { ...map };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

let inflight: Promise<void> | null = null;

export const useIdentityPickStore = create<IdentityPickState>()(
  persist(
    (set, get) => {
      const write = async (field: PickMap, key: string, value: string | null, send: () => Promise<void>) => {
        const prev = get()[field][key] ?? null;
        set((s) => ({ ...s, [field]: withEntry(s[field], key, value) }));
        try {
          await send();
        } catch (err) {
          set((s) => ({ ...s, [field]: withEntry(s[field], key, prev) }));
          throw err;
        }
      };
      return {
        byObject: {},
        byTeam: {},
        status: "unknown",
        load: () => {
          inflight ??= listIdentityPicks()
            .then((record) => {
              if (!record) {
                set({ byObject: {}, byTeam: {}, status: "unsupported" });
                return;
              }
              set({
                byObject: Object.fromEntries(record.objects.map((p) => [p.object_id, p.identity_id])),
                byTeam: Object.fromEntries(record.defaults.map((p) => [p.team_id, p.identity_id])),
                status: "loaded",
              });
            })
            .finally(() => {
              inflight = null;
            });
          return inflight;
        },
        setHostPick: (objectId, identityId) =>
          write("byObject", objectId, identityId, () => setObjectPick(objectId, identityId)),
        setVaultDefault: (teamId, identityId) =>
          write("byTeam", teamId, identityId, () => setTeamDefaultPick(teamId, identityId)),
      };
    },
    { name: "voltius-identity-picks", partialize: (s) => ({ byObject: s.byObject, byTeam: s.byTeam }) },
  ),
);
