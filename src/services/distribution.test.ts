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

  it("offers no plan upgrade, so no Voltius sync upgrade action", async () => {
    vi.stubEnv("VITE_DISTRIBUTION", "play");
    const { planDisplay } = await import("@/services/planDisplay");
    const { deriveTierFlags } = await import("@/stores/subscriptionTier");
    const plan = planDisplay(deriveTierFlags({ tier: "free", trial_used: false }, new Date()));
    expect(plan).toMatchObject({ showUpgrade: false, upgradeTo: null, trialOffer: false });
  });

  it("leaves a free account's Voltius sync without an upgrade action", async () => {
    vi.stubEnv("VITE_DISTRIBUTION", "play");
    const { useSubscriptionStore } = await import("@/stores/subscriptionStore");
    const { readSyncProviderInputs } = await import("@/services/syncProviderInputs");
    const { buildSyncProviders } = await import("@/services/syncProviders");
    useSubscriptionStore.setState({ accountMode: "server", tier: "free", isPro: false, seatTeam: null });
    const source = { loaded: () => [], isActive: () => false, exposed: () => undefined };
    const [voltius] = buildSyncProviders(readSyncProviderInputs(source));
    expect(voltius).toMatchObject({ availability: "needs_upgrade", action: null });
  });
});

describe("other builds", () => {
  it("keep checkout", async () => {
    const { CAN_OPEN_CHECKOUT } = await import("@/services/distribution");
    expect(CAN_OPEN_CHECKOUT).toBe(true);
  });
});
