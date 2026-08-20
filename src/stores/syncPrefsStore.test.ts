import { describe, test, expect, beforeEach } from "vitest";
import { useSyncPrefsStore, SYNC_SETTING_DOMAINS } from "./syncPrefsStore";

describe("settings domain toggles", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {} }));

  test("lists the five toggleable domains and not vaults", () => {
    expect(SYNC_SETTING_DOMAINS.map((d) => d.id)).toEqual([
      "themes", "uiPreferences", "shortcuts", "appSettings", "recentPeople",
    ]);
  });

  test("domains sync by default", () => {
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(true);
  });

  test("switching a domain off is remembered", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(false);
    expect(useSyncPrefsStore.getState().isDomainSynced("appSettings")).toBe(true);
  });

  test("vaults always syncs, even if a stale value says otherwise", () => {
    useSyncPrefsStore.setState({ syncSettingDomains: { vaults: false } });
    expect(useSyncPrefsStore.getState().isDomainSynced("vaults")).toBe(true);
  });
});
