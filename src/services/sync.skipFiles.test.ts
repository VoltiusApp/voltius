import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { getSkippedSyncFiles, getPluginSkippedSyncFiles } from "./sync";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

describe("getSkippedSyncFiles", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {} }));

  test("always withholds theme.json — themes travel in the bundle now", () => {
    expect(getSkippedSyncFiles()).toContain("theme.json");
  });

  test("still withholds theme.json even if the themes domain is switched off", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    expect(getSkippedSyncFiles()).toContain("theme.json");
  });

  test("withholds plugin-registry.json when app settings are not synced", () => {
    expect(getSkippedSyncFiles()).not.toContain("plugin-registry.json");
    useSyncPrefsStore.getState().setSyncSettingDomain("appSettings", false);
    expect(getSkippedSyncFiles()).toContain("plugin-registry.json");
  });
});

describe("getPluginSkippedSyncFiles", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {} }));

  test("does not withhold theme.json while the themes domain is synced — it's the plugin path's only theme route", () => {
    expect(getPluginSkippedSyncFiles()).not.toContain("theme.json");
  });

  test("withholds theme.json once the themes domain is switched off", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    expect(getPluginSkippedSyncFiles()).toContain("theme.json");
  });

  test("withholds plugin-registry.json when app settings are not synced, same as the server variant", () => {
    expect(getPluginSkippedSyncFiles()).not.toContain("plugin-registry.json");
    useSyncPrefsStore.getState().setSyncSettingDomain("appSettings", false);
    expect(getPluginSkippedSyncFiles()).toContain("plugin-registry.json");
  });
});
