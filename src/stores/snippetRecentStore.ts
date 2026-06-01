import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentTarget {
  connectionId: string;
  connectionName: string;
  sessionType: "ssh" | "local" | "serial";
  localShell?: string;
}

export interface RecentSnippetExecution {
  id: string;
  snippetId: string;
  targets: RecentTarget[];
  execute: boolean;
  timestamp: number;
}

interface SnippetRecentStore {
  entries: RecentSnippetExecution[];
  add: (entry: Omit<RecentSnippetExecution, "id">) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX = 20;

export const useSnippetRecentStore = create<SnippetRecentStore>()(
  persist(
    (set) => ({
      entries: [],

      add: (entry) =>
        set((s) => {
          const next: RecentSnippetExecution = { ...entry, id: crypto.randomUUID() };
          // De-duplicate: drop older entries for the same snippet+mode
          const deduped = s.entries.filter(
            (e) => !(e.snippetId === entry.snippetId && e.execute === entry.execute),
          );
          return { entries: [next, ...deduped].slice(0, MAX) };
        }),

      remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      clear: () => set({ entries: [] }),
    }),
    {
      name: "voltius-snippet-recent",
      version: 1,
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);
