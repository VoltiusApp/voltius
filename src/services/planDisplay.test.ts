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
  return planDisplay({ ...deriveTierFlags(input, NOW), subscriptionStatus });
}

describe("planDisplay", () => {
  test("free", () => {
    expect(display({ tier: "free", trial_used: false })).toMatchObject({
      plan: "free",
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
      showManageBilling: true,
      showUpgrade: false,
      showTrialEnded: false,
    });
  });

  test("own Pro trial has no billing to manage", () => {
    const ends = Math.floor(Date.now() / 1000) + 86_400;
    expect(display({ tier: "pro", trial_ends_at: ends, trial_used: true })).toMatchObject({
      label: "Pro trial",
      trial: true,
      showManageBilling: false,
      showUpgrade: false,
    });
  });

  test("seat only", () => {
    const d = display({ tier: "teams", billing_tier: "free", seat_team: acme });
    expect(d).toMatchObject({
      plan: "teams",
      label: "Teams",
      via: "Acme",
      line: "Teams · through your seat in Acme",
      viaTooltip: "Through Acme",
      trial: false,
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
      showManageBilling: true,
      showUpgrade: false,
    });
  });

  test("store build never offers upgrade or billing actions to open", () => {
    checkout.value = false;
    try {
      expect(display({ tier: "free" }).showUpgrade).toBe(false);
    } finally {
      checkout.value = true;
    }
  });
});
