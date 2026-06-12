import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  parseManifest,
  pruneStale,
  type LiveSessionManifest,
  type SessionOpen,
  type SessionTombstone,
} from "./liveSessionManifestCore";

interface CrossDeviceSessionsState {
  /** Other devices' manifests, keyed by deviceId. */
  manifests: Record<string, LiveSessionManifest>;
  /** Stable openedAt per locally open session (manifest display). */
  opens: Record<string, SessionOpen>;
  /** Sessions whose multiplexer was confirmed killed. */
  tombstones: Record<string, SessionTombstone>;
  ingestManifest: (raw: unknown) => void;
  ensureOpens: (sessionIds: string[]) => void;
  markClosed: (sessionId: string) => void;
}

function myDeviceId(): string | null {
  return localStorage.getItem("voltius.device_id");
}

export const useCrossDeviceSessionsStore = create<CrossDeviceSessionsState>()(
  persist(
    (set, get) => ({
      manifests: {},
      opens: {},
      tombstones: {},

      ingestManifest: (raw) => {
        const doc = parseManifest(raw);
        if (!doc || doc.deviceId === myDeviceId()) return;
        const cur = get().manifests[doc.deviceId];
        if (cur && cur.updatedAt > doc.updatedAt) return; // never regress
        set((s) => ({ manifests: { ...s.manifests, [doc.deviceId]: doc } }));
      },

      ensureOpens: (sessionIds) => {
        const { opens } = get();
        const missing = sessionIds.filter((id) => !opens[id]);
        if (missing.length === 0) return;
        const at = new Date().toISOString();
        set((s) => ({
          opens: {
            ...s.opens,
            ...Object.fromEntries(missing.map((id) => [id, { openedAt: at }])),
          },
        }));
      },

      markClosed: (sessionId) =>
        set((s) => ({
          tombstones: { ...s.tombstones, [sessionId]: { closedAt: new Date().toISOString() } },
        })),
    }),
    {
      name: "voltius-cross-device-sessions",
      version: 2,
      // v1 stored ownership claims; shared sessions only keep manifests/tombstones.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<CrossDeviceSessionsState>;
        return {
          manifests: p.manifests ?? {},
          opens: {},
          tombstones: p.tombstones ?? {},
        } as CrossDeviceSessionsState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const now = new Date();
        state.opens = pruneStale(state.opens, now);
        state.tombstones = pruneStale(state.tombstones, now);
      },
    },
  ),
);

/** Close gate: another device still has this session open (its manifest lists
 * it), so closing here must detach rather than kill. */
export function otherDeviceListsSession(sessionId: string): boolean {
  const me = myDeviceId();
  return Object.values(useCrossDeviceSessionsStore.getState().manifests).some(
    (m) => m.deviceId !== me && m.sessions.some((s) => s.id === sessionId),
  );
}
