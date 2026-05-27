import { create } from "zustand";

interface TerminalCwdStore {
  cwds: Record<string, string>;
  setCwd: (sessionId: string, cwd: string) => void;
  clear: (sessionId: string) => void;
}

export const useTerminalCwdStore = create<TerminalCwdStore>((set) => ({
  cwds: {},
  setCwd: (sessionId, cwd) =>
    set((s) => (s.cwds[sessionId] === cwd ? s : { cwds: { ...s.cwds, [sessionId]: cwd } })),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.cwds)) return s;
      const next = { ...s.cwds };
      delete next[sessionId];
      return { cwds: next };
    }),
}));
