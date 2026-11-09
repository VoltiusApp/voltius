import { create } from "zustand";
import { persist } from "zustand/middleware";
import { logFailure } from "@/lib/logger";
import { EnrollmentError } from "@/services/enrollment/enrollmentApi";
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
import { serverAllowed } from "@/services/policy/serverPolicy";
import { canonicalServerUrl } from "@/utils/serverInstance";

const DAY_MS = 24 * 60 * 60 * 1000;
const STICKY: ResolveFailure[] = ["notFound", "gone"];
const TRANSIENT: ResolveFailure[] = ["unreachable", "rateLimited"];
const TRANSIENT_TTL_MS = 5 * 60 * 1000;

interface ResolveEntry {
  at: number;
  result?: ResolvedEnrollment;
  failure?: ResolveFailure;
  retryAfterMs?: number;
}

interface EnrollmentRecord {
  outcome: EnrollmentOutcome | "dismissed";
  at: number;
}

interface EnrollmentStore {
  resolved: Record<string, ResolveEntry>;
  records: Record<string, EnrollmentRecord>;
  dismissedRequests: string[];
  myRequests: MyJoinRequest[] | "unsupported" | null;
  resolve: (token: EnrollmentTokenParts, opts?: { force?: boolean }) => Promise<ResolvedEnrollment>;
  record: (tokenId: string, accountKey: string, outcome: EnrollmentOutcome | "dismissed") => void;
  dismissRequest: (requestId: string) => void;
  loadMyRequests: () => Promise<void>;
}

export const accountKey = (serverUrl: string, accountId: string) => `${canonicalServerUrl(serverUrl)}|${accountId}`;

const ttl = (e: ResolveEntry) =>
  e.failure && TRANSIENT.includes(e.failure) ? Math.max(TRANSIENT_TTL_MS, e.retryAfterMs ?? 0) : DAY_MS;
const isFresh = (e: ResolveEntry) => (e.failure && STICKY.includes(e.failure)) || Date.now() - e.at < ttl(e);
const inFlight = new Map<string, Promise<ResolvedEnrollment>>();

export const useEnrollmentStore = create<EnrollmentStore>()(
  persist(
    (set, get) => ({
      resolved: {},
      records: {},
      dismissedRequests: [],
      myRequests: null,

      resolve: async (token, opts) => {
        // The token secret must never reach a server this machine's policy blocks.
        if (!serverAllowed(token.serverUrl)) throw new ResolveFailedError("blocked");
        const hit = get().resolved[token.id];
        if (!opts?.force && hit && isFresh(hit)) {
          if (hit.result) return hit.result;
          if (hit.failure) throw new ResolveFailedError(hit.failure);
        }
        const pending = inFlight.get(token.id);
        if (pending) return pending;
        const remember = (entry: ResolveEntry) => set((s) => ({ resolved: { ...s.resolved, [token.id]: entry } }));
        const fetching = resolveEnrollment(token).then(
          (result) => {
            remember({ at: Date.now(), result });
            return result;
          },
          (e) => {
            remember({
              at: Date.now(),
              failure: resolveFailure(e),
              ...(e instanceof EnrollmentError && e.retryAfterMs && { retryAfterMs: Math.min(e.retryAfterMs, DAY_MS) }),
            });
            throw e;
          },
        );
        inFlight.set(token.id, fetching);
        return fetching.finally(() => inFlight.delete(token.id));
      },

      record: (tokenId, key, outcome) =>
        set((s) => ({ records: { ...s.records, [`${tokenId}|${key}`]: { outcome, at: Date.now() } } })),

      dismissRequest: (requestId) =>
        set((s) => (s.dismissedRequests.includes(requestId) ? s : { dismissedRequests: [...s.dismissedRequests, requestId] })),

      loadMyRequests: async () => {
        try {
          set({ myRequests: (await listMyJoinRequests()) ?? "unsupported" });
        } catch (e) {
          logFailure("load my join requests")(e);
        }
      },
    }),
    { name: "voltius-enrollment", partialize: (s) => ({ resolved: s.resolved, records: s.records, dismissedRequests: s.dismissedRequests }) },
  ),
);
