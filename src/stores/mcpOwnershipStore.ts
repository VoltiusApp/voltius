import { create } from "zustand";

export interface McpOwner {
  clientId: string;
  clientName: string;
  since: number;
}

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
      owners: { ...s.owners, [sessionId]: { ...owner, since: Date.now() } },
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
      const owners = Object.fromEntries(
        Object.entries(s.owners).filter(([, o]) => o.clientId !== clientId),
      );
      return Object.keys(owners).length === Object.keys(s.owners).length ? s : { owners };
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

export function isMcpOwned(sessionId: string): boolean {
  return sessionId in useMcpOwnershipStore.getState().owners;
}
