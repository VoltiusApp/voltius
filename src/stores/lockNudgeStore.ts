import { create } from "zustand";

interface LockNudgeStore {
  nonce: number;
  ids: string[];
  nudge(ids: string[]): void;
}

export const useLockNudgeStore = create<LockNudgeStore>((set) => ({
  nonce: 0,
  ids: [],
  nudge: (ids) => set((state) => ({ nonce: state.nonce + 1, ids })),
}));
