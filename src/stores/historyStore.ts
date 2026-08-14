import { create } from "zustand";
import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";

export interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface HistoryStore {
  past: HistoryEntry[];
  future: HistoryEntry[];
  bypassing: boolean;
  suppressing: boolean;
  /** Open `withoutHistory` windows; `suppressing` is derived from it. */
  suppressDepth: number;
  canUndo: boolean;
  canRedo: boolean;
  push: (entry: HistoryEntry) => void;
  /**
   * Runs `fn` with `push` disabled, so a composite action (e.g. a paste) can call
   * several store methods that each record their own entry and still leave a single
   * entry of its own. Depth-counted, so nested and interleaved windows each close
   * only their own. Covers the do-direction only; `bypassing` already suppresses
   * pushes during undo/redo.
   */
  withoutHistory: <T>(fn: () => Promise<T>) => Promise<T>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_HISTORY = 50;

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],
  bypassing: false,
  suppressing: false,
  suppressDepth: 0,
  canUndo: false,
  canRedo: false,

  push: (entry) => {
    if (get().bypassing || get().suppressing) return;
    set((s) => {
      const past = [...s.past, entry].slice(-MAX_HISTORY);
      return { past, future: [], canUndo: true, canRedo: false };
    });
  },

  withoutHistory: async (fn) => {
    set((s) => ({ suppressDepth: s.suppressDepth + 1, suppressing: true }));
    try {
      return await fn();
    } finally {
      set((s) => {
        const suppressDepth = Math.max(0, s.suppressDepth - 1);
        return { suppressDepth, suppressing: suppressDepth > 0 };
      });
    }
  },

  undo: async () => {
    const { past, future, bypassing } = get();
    if (bypassing || past.length === 0) return;
    const entry = past[past.length - 1];
    const newPast = past.slice(0, -1);
    const newFuture = [entry, ...future];
    set({ past: newPast, future: newFuture, bypassing: true, canUndo: false, canRedo: false });
    try {
      await entry.undo();
    } catch (err) {
      set((s) => ({
        past: [...s.past, entry],
        future: s.future.slice(1),
      }));
      useNotificationStore.getState().addToast({
        source: { kind: "plugin", id: "core:history", name: "Voltius" },
        type: "toast",
        message: i18n.t("common.toast.undoFailed", { error: err instanceof Error ? err.message : String(err) }),
        severity: "error",
        duration: 4000,
      });
    } finally {
      set((s) => ({
        bypassing: false,
        canUndo: s.past.length > 0,
        canRedo: s.future.length > 0,
      }));
    }
  },

  redo: async () => {
    const { past, future, bypassing } = get();
    if (bypassing || future.length === 0) return;
    const entry = future[0];
    const newPast = [...past, entry];
    const newFuture = future.slice(1);
    set({ past: newPast, future: newFuture, bypassing: true, canUndo: false, canRedo: false });
    try {
      await entry.redo();
    } catch (err) {
      set((s) => ({
        past: s.past.slice(0, -1),
        future: [entry, ...s.future],
      }));
      useNotificationStore.getState().addToast({
        source: { kind: "plugin", id: "core:history", name: "Voltius" },
        type: "toast",
        message: i18n.t("common.toast.redoFailed", { error: err instanceof Error ? err.message : String(err) }),
        severity: "error",
        duration: 4000,
      });
    } finally {
      set((s) => ({
        bypassing: false,
        canUndo: s.past.length > 0,
        canRedo: s.future.length > 0,
      }));
    }
  },
}));
