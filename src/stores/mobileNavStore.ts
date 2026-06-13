import { create } from "zustand";
import {
  handleBack, initialMobileNavState,
  type MobileNavState, type MobileScreen, type MobileSheet, type MobileTab,
} from "./mobileNavCore";

interface MobileNavStore extends MobileNavState {
  /** Last tab that wasn't "terminal"; the immersive exit chevron returns here. Store-only (not in MobileNavState). */
  lastNonTerminalTab: MobileTab;
  setTab: (tab: MobileTab) => void;
  push: (screen: MobileScreen) => void;
  pop: () => void;
  openSheet: (sheet: NonNullable<MobileSheet>) => void;
  closeSheet: () => void;
  /** Returns true if back was consumed (sheet/stack/tab), false at root. */
  back: () => boolean;
}

export const useMobileNavStore = create<MobileNavStore>()((set, get) => ({
  ...initialMobileNavState,
  lastNonTerminalTab: "hosts",
  setTab: (tab) => set((s) => ({
    tab,
    stack: [],
    sheet: null,
    lastNonTerminalTab: tab === "terminal" ? s.lastNonTerminalTab : tab,
  })),
  push: (screen) => set((s) => ({ stack: [...s.stack, screen], sheet: null })),
  pop: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  back: () => {
    const { tab, stack, sheet } = get();
    const r = handleBack({ tab, stack, sheet });
    if (r.handled) set(r.state);
    return r.handled;
  },
}));
