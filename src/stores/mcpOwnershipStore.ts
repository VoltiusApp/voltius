import { create } from "zustand";

export interface McpOwner {
  /** null once the client that opened this session disconnected: the session is
   *  an orphan, adoptable by the next MCP client that writes to it. */
  clientId: string | null;
  clientName: string;
  since: number;
}

/** Mirrors Rust's `chars().take(40)` clamp so the invariant holds on both sides. */
const MAX_CLIENT_NAME = 40;

interface McpOwnershipStore {
  /** Sessions an MCP client opened, by session id. */
  owners: Record<string, McpOwner>;
  /** In-flight tool calls per session. A count, not a flag: concurrent calls
   *  against one session must not un-pulse it when the first one returns. */
  busy: Record<string, number>;
  claim: (sessionId: string, owner: { clientId: string; clientName: string }) => void;
  release: (sessionId: string) => void;
  clearClient: (clientId: string) => void;
  keepOnly: (sessionIds: string[]) => void;
  beginActivity: (sessionId: string) => void;
  endActivity: (sessionId: string) => void;
}

export const useMcpOwnershipStore = create<McpOwnershipStore>((set) => ({
  owners: {},
  busy: {},

  claim: (sessionId, owner) =>
    set((s) => ({
      owners: {
        ...s.owners,
        [sessionId]: { ...owner, clientName: Array.from(owner.clientName).slice(0, MAX_CLIENT_NAME).join(""), since: Date.now() },
      },
    })),

  release: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.owners)) return s;
      const owners = { ...s.owners };
      delete owners[sessionId];
      return { owners };
    }),

  clearClient: (clientId) =>
    set((s) => {
      const hit = Object.values(s.owners).some((o) => o.clientId === clientId);
      if (!hit) return s;
      const owners = Object.fromEntries(
        Object.entries(s.owners).map(([id, o]) =>
          [id, o.clientId === clientId ? { ...o, clientId: null } : o],
        ),
      );
      return { owners };
    }),

  keepOnly: (sessionIds) =>
    set((s) => {
      const live = new Set(sessionIds);
      const pick = <T,>(rec: Record<string, T>) =>
        Object.fromEntries(Object.entries(rec).filter(([id]) => live.has(id)));
      const owners = pick(s.owners);
      const busy = pick(s.busy);
      const unchanged =
        Object.keys(owners).length === Object.keys(s.owners).length
        && Object.keys(busy).length === Object.keys(s.busy).length;
      return unchanged ? s : { owners, busy };
    }),

  beginActivity: (sessionId) =>
    set((s) => ({ busy: { ...s.busy, [sessionId]: (s.busy[sessionId] ?? 0) + 1 } })),

  endActivity: (sessionId) =>
    set((s) => {
      const next = (s.busy[sessionId] ?? 0) - 1;
      const busy = { ...s.busy };
      if (next > 0) busy[sessionId] = next;
      else delete busy[sessionId];
      return { busy };
    }),
}));
