import { describe, test, expect, beforeEach } from "vitest";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { filterOutgoing, filterIncoming } from "./syncFilter";
import type { UserDataBundle } from "./formats";

const bundle = (): UserDataBundle => ({
  type: "voltius-user-data",
  version: 2,
  exported_at: "2026-08-20T00:00:00.000Z",
  sections: {
    themes: { data: { activeThemeId: "dracula" }, updated_at: "2026-08-20T00:00:00.000Z" },
    appSettings: { data: { locale: "fr" }, updated_at: "2026-08-20T00:00:00.000Z" },
    vaults: { data: {}, updated_at: "2026-08-20T00:00:00.000Z" },
  },
});

describe("syncFilter", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {} }));

  test("passes everything through when nothing is switched off", () => {
    expect(Object.keys(filterOutgoing(bundle()).sections).sort())
      .toEqual(["appSettings", "themes", "vaults"]);
  });

  test("drops a switched-off section on the way out", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    const out = filterOutgoing(bundle());
    expect(out.sections.themes).toBeUndefined();
    expect(out.sections.appSettings).toBeDefined();
  });

  test("drops a switched-off section on the way in", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    expect(filterIncoming(bundle()).sections.themes).toBeUndefined();
  });

  test("never drops vaults", () => {
    useSyncPrefsStore.setState({ syncSettingDomains: { vaults: false } });
    expect(filterOutgoing(bundle()).sections.vaults).toBeDefined();
  });

  test("does not mutate the input", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    const input = bundle();
    filterOutgoing(input);
    expect(input.sections.themes).toBeDefined();
  });
});
