import { test, expect, vi } from "vitest";

vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));
vi.mock("@/stores/uiStore", () => ({ useUIStore: { getState: () => ({ openCloudAuth: vi.fn(), openSettings: vi.fn() }) } }));

const setSyncPaused = vi.hoisted(() => vi.fn());
vi.mock("@/services/sync", () => ({ setSyncPaused }));

import { runSyncProviderAction } from "./syncProviderAction";

test("resuming a paused provider lifts the pause", () => {
  runSyncProviderAction({ kind: "resume" });

  expect(setSyncPaused).toHaveBeenCalledWith(false);
});
