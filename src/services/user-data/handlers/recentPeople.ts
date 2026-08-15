import i18n from "@/i18n";
import { useRecentPeopleStore, type RecentPerson } from "@/stores/recentPeopleStore";
import { lastWriteWins, type UserDataHandler } from "../handler";

export const recentPeopleHandler: UserDataHandler = {
  key: "recentPeople",
  label: "Recent People",
  icon: "lucide:users-round",

  export(): RecentPerson[] {
    return useRecentPeopleStore.getState().recent;
  },

  async import(data: unknown): Promise<void> {
    useRecentPeopleStore.getState().replaceAll((data as RecentPerson[]) ?? []);
  },

  // LWW, like every other section: two devices inviting simultaneously means the
  // later list wins whole. A union merge would need per-row timestamps the sync
  // blob does not carry, for a list that self-heals through use.
  merge: lastWriteWins,

  getTimestamp(): string {
    return useRecentPeopleStore.getState().recentUpdatedAt;
  },

  describe(): string {
    return i18n.t("importExport.userData.describe.recentPeople", {
      count: useRecentPeopleStore.getState().recent.length,
    });
  },
};
