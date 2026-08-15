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

/**
 * Keeps exactly the four fields a Recent row is allowed to hold. Every write
 * path goes through this: `replaceAll` takes foreign data (the sync blob, the
 * import UI), so enforcing the no-`public_key` invariant only on `remember`
 * would leave it enforced on the path that never sees untrusted input.
 */
function project(person: RecentPerson): RecentPerson {
  return {
    user_id: person.user_id,
    handle: person.handle,
    display_name: person.display_name,
    last_invited_at: person.last_invited_at,
  };
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
          const clean = project(person);
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

      // Stamps like every other write path: a list arriving through the sync
      // blob or the import UI must carry a timestamp, or `lastWriteWins` dates
      // it at the epoch and the next pull discards what was just applied. Under
      // a remote apply `settingsStamp()` adopts the remote section's timestamp
      // and `pushSettingsChange()` is a no-op, so this cannot bounce back.
      replaceAll: (list) =>
        set(() => {
          const recentUpdatedAt = settingsStamp();
          pushSettingsChange();
          return { recent: Array.isArray(list) ? list.slice(0, MAX_RECENT).map(project) : [], recentUpdatedAt };
        }),
    }),
    { name: "voltius-recent-people" },
  ),
);
