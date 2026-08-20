import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { getSkippedSyncFiles } from "./sync";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

describe("getSkippedSyncFiles", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {} }));

  test("always withholds theme.json — themes travel in the bundle now", () => {
    expect(getSkippedSyncFiles()).toContain("theme.json");
  });

  test("withholds plugin-registry.json when app settings are not synced", () => {
    expect(getSkippedSyncFiles()).not.toContain("plugin-registry.json");
    useSyncPrefsStore.getState().setSyncSettingDomain("appSettings", false);
    expect(getSkippedSyncFiles()).toContain("plugin-registry.json");
  });
});
