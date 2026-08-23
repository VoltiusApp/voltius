import { describe, test, expect, beforeEach, vi } from "vitest";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { USER_DATA_HANDLERS } from "./registry";
import { setDomainSync, setKeySync } from "./syncChoice";

const { scheduleSyncMock } = vi.hoisted(() => ({ scheduleSyncMock: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: scheduleSyncMock }));

describe("syncChoice", () => {
  beforeEach(() => {
    scheduleSyncMock.mockClear();
    useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} });
  });

  test("switching a domain on records the choice and touches the handler", () => {
    const themes = USER_DATA_HANDLERS.find((h) => h.key === "themes")!;
    const touch = vi.spyOn(themes, "touch");
    setDomainSync("themes", true);
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(true);
    expect(touch).toHaveBeenCalled();
    expect(scheduleSyncMock).not.toHaveBeenCalled();
    touch.mockRestore();
  });

  test("switching a domain off schedules a sync so the server copy is withdrawn", () => {
    setDomainSync("themes", false);
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(false);
    expect(scheduleSyncMock).toHaveBeenCalled();
  });

  test("a single key follows the same rule, via its owning handler", () => {
    const app = USER_DATA_HANDLERS.find((h) => h.key === "appSettings")!;
    const touch = vi.spyOn(app, "touch");
    setKeySync("appSettings.locale", false);
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.locale")).toBe(false);
    expect(scheduleSyncMock).toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();

    setKeySync("appSettings.locale", true);
    expect(touch).toHaveBeenCalled();
    touch.mockRestore();
  });
});
