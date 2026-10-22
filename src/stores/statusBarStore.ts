import { create } from "zustand";

interface StatusBarState {
  /** Shell-level strip the visible terminal status bar renders into, spanning
   *  beneath the side panel columns. Null where the shell has none (mobile). */
  slot: HTMLElement | null;
  setSlot: (slot: HTMLElement | null) => void;
}

export const useStatusBarStore = create<StatusBarState>((set) => ({
  slot: null,
  setSlot: (slot) => set({ slot }),
}));
