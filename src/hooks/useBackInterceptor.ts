import { useEffect, useRef } from "react";
import { create } from "zustand";

/**
 * Global LIFO stack of dismissable transient overlays (bottom sheets, popovers)
 * that the Android hardware back button should close *before* it navigates.
 *
 * These overlays live in local component state, so the mobileNav store can't see
 * them. useAndroidBack consumes the top interceptor first and counts the stack
 * depth into its trap accounting, so each open overlay reserves one back press.
 */
interface BackInterceptor {
  id: number;
  close: () => void;
}

interface BackStackStore {
  stack: BackInterceptor[];
  push: (i: BackInterceptor) => void;
  remove: (id: number) => void;
}

export const useBackStackStore = create<BackStackStore>()((set) => ({
  stack: [],
  push: (i) => set((s) => ({ stack: [...s.stack, i] })),
  remove: (id) => set((s) => ({ stack: s.stack.filter((i) => i.id !== id) })),
}));

let nextId = 1;

/**
 * Register `close` as a hardware-back dismiss handler while `active` is true.
 * The latest `close` closure is always used, even if it changes between renders.
 */
export function useBackInterceptor(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!active) return;
    const id = nextId++;
    useBackStackStore.getState().push({ id, close: () => closeRef.current() });
    return () => useBackStackStore.getState().remove(id);
  }, [active]);
}
