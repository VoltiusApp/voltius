// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import "@/i18n";
import { deriveTierFlags, type TierFlagsInput } from "@/stores/subscriptionTier";

const checkout = vi.hoisted(() => ({ value: true }));
vi.mock("@/services/distribution", () => ({
  get CAN_OPEN_CHECKOUT() {
    return checkout.value;
  },
}));

import { planDisplay } from "./planDisplay";

const NOW = new Date();
const acme = { id: "t1", name: "Acme", trial: false };

function display(input: TierFlagsInput, subscriptionStatus: string | null = null) {
  return planDisplay({ ...deriveTierFlags(input, NOW), subscriptionStatus }, NOW);
}

describe("planDisplay", () => {
  test("free", () => {
    expect(display({ tier: "free", trial_used: false })).toMatchObject({
      plan: "free",
      premium: false,
      label: "Free",
      via: null,
      trial: false,
      showManageBilling: false,
      showUpgrade: true,
      showTrialEnded: false,
    });
  });

  test("free after an expired trial shows the trial-ended state", () => {
    expect(display({ tier: "free", trial_used: true })).toMatchObject({ showTrialEnded: true, showUpgrade: true });
  });

  test("own Pro", () => {
    expect(display({ tier: "pro" }, "active")).toMatchObject({
      plan: "pro",
      label: "Pro",
      via: null,
      ownPaid: true,
      showManageBilling: true,
      showUpgrade: false,
      showTrialEnded: false,
    });
  });

  test("own Pro trial has no billing to manage and counts down", () => {
    const ends = Math.floor(NOW.getTime() / 1000) + 3 * 86_400;
    expect(display({ tier: "pro", trial_ends_at: ends, trial_used: true })).toMatchObject({
      label: "Pro trial",
      line: "Pro trial — 3d left",
      trialDaysLeft: 3,
      trial: true,
      ownPaid: false,
      showManageBilling: false,
      showUpgrade: false,
    });
  });

  test("a seat hides the own Pro trial: no countdown, no billing, no own line", () => {
    const ends = Math.floor(NOW.getTime() / 1000) + 3 * 86_400;
    expect(display({ tier: "teams", billing_tier: "pro", seat_team: acme, trial_ends_at: ends, trial_used: true })).toMatchObject({
      label: "Teams",
      line: "Teams · through your seat in Acme",
      trialDaysLeft: null,
      trial: false,
      ownLine: null,
      showManageBilling: false,
      showTrialEnded: false,
    });
  });

  test("the next plan on offer follows the own plan and stops at a seat", () => {
    expect(display({ tier: "free" }).upgradeTo).toBe("pro");
    expect(display({ tier: "pro" }).upgradeTo).toBe("teams");
    expect(display({ tier: "teams" }).upgradeTo).toBe("business");
    expect(display({ tier: "business" }).upgradeTo).toBeNull();
    expect(display({ tier: "teams", billing_tier: "free", seat_team: acme }).upgradeTo).toBeNull();
    expect(display({ tier: "business", billing_tier: "pro", seat_team: acme }).upgradeTo).toBeNull();
  });

  test("the free trial is offered only to a free account that never used it", () => {
    expect(display({ tier: "free", trial_used: false }).trialOffer).toBe(true);
    expect(display({ tier: "free", trial_used: true }).trialOffer).toBe(false);
    expect(display({ tier: "free" }).trialOffer).toBe(false);
    expect(display({ tier: "teams", billing_tier: "free", seat_team: acme, trial_used: false }).trialOffer).toBe(false);
  });

  test("seat only", () => {
    const d = display({ tier: "teams", billing_tier: "free", seat_team: acme });
    expect(d).toMatchObject({
      plan: "teams",
      premium: true,
      label: "Teams",
      via: "Acme",
      line: "Teams · through your seat in Acme",
      viaTooltip: "Through Acme",
      ownLine: null,
      trial: false,
      ownPaid: false,
      showManageBilling: false,
      showUpgrade: false,
      showTrialEnded: false,
    });
  });

  test("seat on an owner trial", () => {
    const d = display({ tier: "teams", billing_tier: "free", seat_team: { ...acme, trial: true }, trial_used: true });
    expect(d).toMatchObject({
      label: "Teams trial",
      line: "Teams trial · through your seat in Acme",
      trial: true,
      showManageBilling: false,
      showTrialEnded: false,
    });
  });

  test("own Pro plus a Business seat", () => {
    const d = display({ tier: "business", billing_tier: "pro", seat_team: acme }, "active");
    expect(d).toMatchObject({
      plan: "business",
      label: "Business",
      via: "Acme",
      ownLine: "Your Pro subscription",
      showManageBilling: true,
      showUpgrade: false,
    });
  });

  test("store build never offers upgrade or billing actions to open", () => {
    checkout.value = false;
    try {
      expect(display({ tier: "free" }).showUpgrade).toBe(false);
      expect(display({ tier: "pro" }, "active")).toMatchObject({ ownPaid: true, showManageBilling: false });
      expect(display({ tier: "pro" }).upgradeTo).toBeNull();
      expect(display({ tier: "free", trial_used: false }).trialOffer).toBe(false);
    } finally {
      checkout.value = true;
    }
  });
});
