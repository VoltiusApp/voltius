import { create } from "zustand";
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
  canUndo: boolean;
  canRedo: boolean;
  push: (entry: HistoryEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_HISTORY = 50;

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],
  bypassing: false,
  canUndo: false,
  canRedo: false,

  push: (entry) => {
    if (get().bypassing) return;
    set((s) => {
      const past = [...s.past, entry].slice(-MAX_HISTORY);
      return { past, future: [], canUndo: true, canRedo: false };
    });
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
        pluginId: "core:history",
        pluginName: "Voltius",
        type: "toast",
        message: `Undo failed: ${err instanceof Error ? err.message : String(err)}`,
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
        pluginId: "core:history",
        pluginName: "Voltius",
        type: "toast",
        message: `Redo failed: ${err instanceof Error ? err.message : String(err)}`,
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
