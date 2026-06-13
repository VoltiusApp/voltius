import { create } from "zustand";
import {
  handleBack, initialMobileNavState,
  type MobileNavState, type MobileScreen, type MobileSheet, type MobileTab,
} from "./mobileNavCore";

interface MobileNavStore extends MobileNavState {
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
  setTab: (tab) => set({ tab, stack: [], sheet: null }),
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
