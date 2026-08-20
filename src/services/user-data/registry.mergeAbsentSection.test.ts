import { describe, test, expect, beforeEach, vi } from "vitest";
import { mergeUserDataBundle } from "./registry";
import type { UserDataBundle } from "./formats";
import { useUIStore } from "@/stores/uiStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

const OLD_TS = new Date(0).toISOString();
const REMOTE_TS = "2020-01-01T00:00:00.000Z";
const LIVE_TS = "2030-01-01T00:00:00.000Z";

function remoteBundle(uiScale: number, updated_at: string): UserDataBundle {
  return {
    type: "voltius-user-data",
    version: 2,
    exported_at: updated_at,
    sections: {
      uiPreferences: { data: { uiScale, homeLayoutMode: "list" }, updated_at },
    },
  } as UserDataBundle;
}

/** A local bundle with NO uiPreferences section — as happens once filterOutgoing
 *  strips a switched-off domain out of settings.json before it's written. */
function localBundleMissingSection(): UserDataBundle {
  return {
    type: "voltius-user-data",
    version: 2,
    exported_at: OLD_TS,
    sections: {},
  };
}

describe("mergeUserDataBundle — section absent from the local bundle", () => {
  beforeEach(() => {
    useUIStore.setState({ prefsUpdatedAt: LIVE_TS, uiScale: 1.5 });
  });

  test("falls back to the handler's live state, so a newer local edit beats a stale remote", () => {
    const { merged, updatedKeys } = mergeUserDataBundle(localBundleMissingSection(), remoteBundle(2, REMOTE_TS));

    expect(merged.sections.uiPreferences.data).toMatchObject({ uiScale: 1.5 });
    expect(merged.sections.uiPreferences.updated_at).toBe(LIVE_TS);
    expect(updatedKeys).not.toContain("uiPreferences");
  });

  test("a genuinely newer remote still wins over the live local state", () => {
    const FUTURE_TS = "2031-01-01T00:00:00.000Z";
    const { merged, updatedKeys } = mergeUserDataBundle(localBundleMissingSection(), remoteBundle(3, FUTURE_TS));

    expect(merged.sections.uiPreferences.data).toMatchObject({ uiScale: 3 });
    expect(merged.sections.uiPreferences.updated_at).toBe(FUTURE_TS);
    expect(updatedKeys).toContain("uiPreferences");
  });
});
