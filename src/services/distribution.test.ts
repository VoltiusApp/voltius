// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/invoke", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  invoke.mockReset();
  openUrl.mockReset();
});

describe("Google Play build", () => {
  it("opens neither checkout nor the billing portal", async () => {
    vi.stubEnv("VITE_DISTRIBUTION", "play");
    const { openBillingCheckout } = await import("@/services/billingCheckout");
    const { openPortal } = await import("@/utils/billing");

    expect(await openBillingCheckout("pro")).toBe(false);
    await openPortal();

    expect(invoke).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("offers no Voltius sync upgrade action", async () => {
    vi.stubEnv("VITE_DISTRIBUTION", "play");
    const { buildSyncProviders } = await import("@/services/syncProviders");
    const [voltius] = buildSyncProviders({
      voltius: {
        label: "Voltius Sync",
        state: { status: "idle", lastSync: null, error: null, blobSizeBytes: null },
        accountMode: "server",
        isPro: false,
        paused: false,
        syncNow: vi.fn(async () => {}),
      },
      plugins: [],
      settingsPages: [],
    });
    expect(voltius).toMatchObject({ availability: "needs_upgrade", action: null });
  });
});

describe("other builds", () => {
  it("keep checkout", async () => {
    const { CAN_OPEN_CHECKOUT } = await import("@/services/distribution");
    expect(CAN_OPEN_CHECKOUT).toBe(true);
  });
});
