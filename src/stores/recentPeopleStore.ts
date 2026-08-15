import { create } from "zustand";
import { persist } from "zustand/middleware";
import { pushSettingsChange, settingsStamp } from "./remoteApplyGuard";

export const MAX_RECENT = 20;

/**
 * A person worth one tap next time. No `public_key`: key material is read fresh
 * at wrap time, and a key sitting in a synced blob is a trap, not a shortcut.
 */
export interface RecentPerson {
  user_id: string;
  handle: string;
  display_name: string;
  last_invited_at: string;
}

interface RecentPeopleStore {
  recent: RecentPerson[];
  recentUpdatedAt: string;
  remember: (person: RecentPerson) => void;
  forget: (userId: string) => void;
  replaceAll: (list: RecentPerson[]) => void;
}

export const useRecentPeopleStore = create<RecentPeopleStore>()(
  persist(
    (set) => ({
      recent: [],
      recentUpdatedAt: new Date(0).toISOString(),

      remember: (person) =>
        set((s) => {
          const clean: RecentPerson = {
            user_id: person.user_id,
            handle: person.handle,
            display_name: person.display_name,
            last_invited_at: person.last_invited_at,
          };
          const recent = [clean, ...s.recent.filter((p) => p.user_id !== clean.user_id)].slice(0, MAX_RECENT);
          const recentUpdatedAt = settingsStamp();
          pushSettingsChange();
          return { recent, recentUpdatedAt };
        }),

      forget: (userId) =>
        set((s) => {
          const recentUpdatedAt = settingsStamp();
          pushSettingsChange();
          return { recent: s.recent.filter((p) => p.user_id !== userId), recentUpdatedAt };
        }),

      replaceAll: (list) => set({ recent: list.slice(0, MAX_RECENT) }),
    }),
    { name: "voltius-recent-people" },
  ),
);
