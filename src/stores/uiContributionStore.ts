import { create } from "zustand";
import type { ContributedAction, UISlot, UIContributionFactory } from "@/plugins/api";

// Composite key: `${pluginId}::${slot}`
type Key = string;

interface UIContributionStore {
  contributions: Map<Key, UIContributionFactory>;
  registerContribution(pluginId: string, slot: UISlot, fn: UIContributionFactory): () => void;
  unregisterPlugin(pluginId: string): void;
}

export const useUIContributionStore = create<UIContributionStore>((set) => ({
  contributions: new Map(),

  registerContribution(pluginId, slot, fn) {
    const key = `${pluginId}::${slot}`;
    set((s) => {
      const next = new Map(s.contributions);
      next.set(key, fn);
      return { contributions: next };
    });
    return () => {
      set((s) => {
        const next = new Map(s.contributions);
        next.delete(key);
        return { contributions: next };
      });
    };
  },

  unregisterPlugin(pluginId) {
    const prefix = `${pluginId}::`;
    set((s) => {
      const next = new Map(s.contributions);
      for (const key of next.keys()) {
        if (key.startsWith(prefix)) next.delete(key);
      }
      return { contributions: next };
    });
  },
}));

export type { ContributedAction, UISlot };
