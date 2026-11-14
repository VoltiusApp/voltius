import { test, expect, vi } from "vitest";

const startTrialOrCheckout = vi.hoisted(() => vi.fn());
vi.mock("@/services/promos", () => ({ startTrialOrCheckout }));
vi.mock("@/stores/uiStore", () => ({ useUIStore: { getState: () => ({ openCloudAuth: vi.fn(), openSettings: vi.fn() }) } }));

const setSyncPaused = vi.hoisted(() => vi.fn());
vi.mock("@/services/sync", () => ({ setSyncPaused }));

import { runSyncProviderAction } from "./syncProviderAction";

test("resuming a paused provider lifts the pause", () => {
  runSyncProviderAction({ kind: "resume" });

  expect(setSyncPaused).toHaveBeenCalledWith(false);
});

test("pausing a syncing provider sets the pause", () => {
  runSyncProviderAction({ kind: "pause" });

  expect(setSyncPaused).toHaveBeenCalledWith(true);
});

test("upgrading from a sync provider goes through the trial-or-checkout paywall", () => {
  runSyncProviderAction({ kind: "upgrade" });

  expect(startTrialOrCheckout).toHaveBeenCalledWith("pro", "sync_provider", "sync");
});
