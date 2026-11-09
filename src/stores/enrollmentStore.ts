import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EnrollmentTokenParts } from "@/services/enrollment/enrollmentToken";
import {
  listMyJoinRequests,
  resolveEnrollment,
  resolveFailure,
  ResolveFailedError,
  type EnrollmentOutcome,
  type MyJoinRequest,
  type ResolvedEnrollment,
  type ResolveFailure,
} from "@/services/enrollment/enrollmentPublic";
import { canonicalServerUrl } from "@/utils/serverInstance";

const DAY_MS = 24 * 60 * 60 * 1000;
const STICKY: ResolveFailure[] = ["notFound", "gone"];
const TRANSIENT: ResolveFailure[] = ["unreachable", "rateLimited"];

interface ResolveEntry {
  at: number;
  result?: ResolvedEnrollment;
  failure?: ResolveFailure;
}

interface EnrollmentRecord {
  outcome: EnrollmentOutcome | "dismissed";
  at: number;
}

interface EnrollmentStore {
  resolved: Record<string, ResolveEntry>;
  records: Record<string, EnrollmentRecord>;
  myRequests: MyJoinRequest[] | null;
  resolve: (token: EnrollmentTokenParts, opts?: { force?: boolean }) => Promise<ResolvedEnrollment>;
  record: (tokenId: string, accountKey: string, outcome: EnrollmentOutcome | "dismissed") => void;
  loadMyRequests: () => Promise<void>;
}

export const accountKey = (serverUrl: string, accountId: string) => `${canonicalServerUrl(serverUrl)}|${accountId}`;

const isFresh = (e: ResolveEntry) => (e.failure && STICKY.includes(e.failure)) || Date.now() - e.at < DAY_MS;

export const useEnrollmentStore = create<EnrollmentStore>()(
  persist(
    (set, get) => ({
      resolved: {},
      records: {},
      myRequests: null,

      resolve: async (token, opts) => {
        const hit = get().resolved[token.id];
        if (!opts?.force && hit && isFresh(hit)) {
          if (hit.result) return hit.result;
          if (hit.failure) throw new ResolveFailedError(hit.failure);
        }
        const remember = (entry: ResolveEntry) => set((s) => ({ resolved: { ...s.resolved, [token.id]: entry } }));
        try {
          const result = await resolveEnrollment(token);
          remember({ at: Date.now(), result });
          return result;
        } catch (e) {
          const failure = resolveFailure(e);
          if (!TRANSIENT.includes(failure)) remember({ at: Date.now(), failure });
          throw e;
        }
      },

      record: (tokenId, key, outcome) =>
        set((s) => ({ records: { ...s.records, [`${tokenId}|${key}`]: { outcome, at: Date.now() } } })),

      loadMyRequests: async () => {
        set({ myRequests: await listMyJoinRequests().catch(() => null) });
      },
    }),
    { name: "voltius-enrollment", partialize: (s) => ({ resolved: s.resolved, records: s.records }) },
  ),
);
