import { create } from "zustand";

interface StatusBarState {
  mountedCount: number;
  increment: () => void;
  decrement: () => void;
}

export const useStatusBarStore = create<StatusBarState>((set) => ({
  mountedCount: 0,
  increment: () => set((s) => ({ mountedCount: s.mountedCount + 1 })),
  decrement: () => set((s) => ({ mountedCount: Math.max(0, s.mountedCount - 1) })),
}));

export function useStatusBarMounted(): boolean {
  return useStatusBarStore((s) => s.mountedCount > 0);
}
