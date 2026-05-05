import { create } from "zustand";
import type {
  ContributedAction,
  UISlot,
  UIContributionFactory,
  UIStatusBarContributionFactory,
  UIStatusBarSlot,
} from "@/plugins/api";

// Composite key: `${pluginId}::${slot}`
type Key = string;

interface UIContributionStore {
  contributions: Map<Key, UIContributionFactory>;
  statusBarContributions: Map<Key, UIStatusBarContributionFactory>;
  registerContribution(pluginId: string, slot: UISlot, fn: UIContributionFactory): () => void;
  registerStatusBarContribution(
    pluginId: string,
    slot: UIStatusBarSlot,
    fn: UIStatusBarContributionFactory,
  ): () => void;
  unregisterPlugin(pluginId: string): void;
}

export const useUIContributionStore = create<UIContributionStore>((set) => ({
  contributions: new Map(),
  statusBarContributions: new Map(),

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

  registerStatusBarContribution(pluginId, slot, fn) {
    const key = `${pluginId}::${slot}`;
    set((s) => {
      const next = new Map(s.statusBarContributions);
      next.set(key, fn);
      return { statusBarContributions: next };
    });
    return () => {
      set((s) => {
        if (s.statusBarContributions.get(key) !== fn) return {};
        const next = new Map(s.statusBarContributions);
        next.delete(key);
        return { statusBarContributions: next };
      });
    };
  },

  unregisterPlugin(pluginId) {
    const prefix = `${pluginId}::`;
    set((s) => {
      const contributions = new Map(s.contributions);
      const statusBarContributions = new Map(s.statusBarContributions);
      for (const key of contributions.keys()) {
        if (key.startsWith(prefix)) contributions.delete(key);
      }
      for (const key of statusBarContributions.keys()) {
        if (key.startsWith(prefix)) statusBarContributions.delete(key);
      }
      return { contributions, statusBarContributions };
    });
  },
}));

export type { ContributedAction, UISlot, UIStatusBarContributionFactory, UIStatusBarSlot };
