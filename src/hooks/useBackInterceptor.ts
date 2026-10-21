import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useUIStore } from "@/stores/uiStore";
import { backDepth, type BackInterceptorEntry } from "./backCore";
import type { BackPreviewTarget } from "./predictiveBack";

/**
 * Global LIFO stack of dismissable transient overlays (bottom sheets, popovers,
 * folder levels) that the Android hardware back button closes *before* it
 * navigates. These live in local component state, so the mobileNav store can't
 * see them; useAndroidBack's single back handler asks this stack first
 * (see backCore.planBack).
 */
interface BackInterceptor extends BackInterceptorEntry {
  close: () => void;
  /** The layer a predictive-back gesture previews closing (see predictiveBack.ts). */
  preview?: () => BackPreviewTarget | null;
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

/** The layer an interceptor registered right now belongs to. */
export function currentBackDepth(): number {
  const { tab, stack, sheet } = useMobileNavStore.getState();
  return backDepth({ tab, stack, sheet }, useUIStore.getState());
}

/**
 * Register `close` as a hardware-back dismiss handler while `active` is true.
 * The latest `close` closure is always used, even if it changes between renders.
 * `preview` (optional) names the element a predictive-back gesture animates.
 */
export function useBackInterceptor(
  active: boolean,
  close: () => void,
  preview?: () => BackPreviewTarget | null,
) {
  const closeRef = useRef(close);
  closeRef.current = close;
  const previewRef = useRef(preview);
  previewRef.current = preview;

  useEffect(() => {
    if (!active) return;
    const id = nextId++;
    useBackStackStore.getState().push({
      id,
      depth: currentBackDepth(),
      close: () => closeRef.current(),
      preview: () => previewRef.current?.() ?? null,
    });
    return () => useBackStackStore.getState().remove(id);
  }, [active]);
}
