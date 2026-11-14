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

import { planDisplay, type PlanDisplayContext } from "./planDisplay";

const NOW = new Date();
const acme = { id: "t1", trial: false };

interface Offers {
  proTrialAvailable?: boolean;
  teamsTrialAvailable?: boolean;
}

function display(
  input: TierFlagsInput,
  subscriptionStatus: string | null = null,
  teamName: string | null = "Acme",
  offers: Offers = {},
  context: PlanDisplayContext = {},
) {
  const { proTrialAvailable = false, teamsTrialAvailable = false } = offers;
  return planDisplay(
    { ...deriveTierFlags(input, NOW), subscriptionStatus, proTrialAvailable, teamsTrialAvailable },
    { teamName, now: NOW, ...context },
  );
}

describe("planDisplay", () => {
  test("free", () => {
    expect(display({ tier: "free" }, null, "Acme", { proTrialAvailable: true })).toMatchObject({
      plan: "free",
      premium: false,
      seat: false,
      badge: "Activate 14 days of Pro",
      label: "Free",
      via: null,
      trial: false,
      showManageBilling: false,
      showUpgrade: true,
    });
  });

  test("own Pro", () => {
    expect(display({ tier: "pro" }, "active")).toMatchObject({
      plan: "pro",
      label: "Pro",
      via: null,
      ownBilled: true,
      showManageBilling: true,
      showUpgrade: false,
    });
  });

  test("own Pro trial has no billing to manage and counts down", () => {
    const ends = Math.floor(NOW.getTime() / 1000) + 3 * 86_400;
    expect(display({ tier: "pro", trial_ends_at: ends, trial_used: true })).toMatchObject({
      label: "Pro trial",
      line: "Pro trial — 3d left",
      badge: "Pro trial — 3d left",
      trialDaysLeft: 3,
      trial: true,
      ownBilled: false,
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

  test("trial_offer_follows_server_flag", () => {
    const on = { proTrialAvailable: true };
    expect(display({ tier: "free" }, null, "Acme", on).trialOffer).toBe(true);
    expect(display({ tier: "free" }, null, "Acme", on).badge).toBe("Activate 14 days of Pro");
    expect(display({ tier: "free" }).trialOffer).toBe(false);
    expect(display({ tier: "free" }).badge).toBe("Upgrade");
    expect(display({ tier: "pro" }, "active", "Acme", on).trialOffer).toBe(false);
    expect(display({ tier: "teams", billing_tier: "free", seat_team: acme }, null, "Acme", on).trialOffer).toBe(false);
  });

  test("teams_trial_counts_as_active_trial", () => {
    const ends = Math.floor(NOW.getTime() / 1000) + 5 * 86_400;
    expect(display({ tier: "teams", trial_ends_at: ends })).toMatchObject({
      label: "Teams trial",
      trial: true,
      trialDaysLeft: 5,
      ownBilled: false,
      showManageBilling: false,
    });
  });

  test("teams_trial_offer_follows_server_flag", () => {
    const on = { teamsTrialAvailable: true };
    expect(display({ tier: "free" }, null, "Acme", on).teamsTrialOffer).toBe(true);
    expect(display({ tier: "pro" }, "active", "Acme", on).teamsTrialOffer).toBe(true);
    expect(display({ tier: "free" }).teamsTrialOffer).toBe(false);
    expect(display({ tier: "teams" }, "active", "Acme", on).teamsTrialOffer).toBe(false);
    expect(display({ tier: "business" }, "active", "Acme", on).teamsTrialOffer).toBe(false);
  });

  test("teams_trial_offer_hidden_for_seat_member", () => {
    const on = { proTrialAvailable: true, teamsTrialAvailable: true };
    expect(display({ tier: "teams", billing_tier: "free", seat_team: acme }, null, "Acme", on)).toMatchObject({
      trialOffer: false,
      teamsTrialOffer: false,
    });
  });

  test("no_upgrade_when_billing_disabled", () => {
    const on = { proTrialAvailable: true, teamsTrialAvailable: true };
    expect(display({ tier: "free" }, null, "Acme", on, { billingEnabled: false })).toMatchObject({
      upgradeTo: null,
      showUpgrade: false,
      trialOffer: false,
      teamsTrialOffer: false,
    });
  });

  test("seat only", () => {
    const d = display({ tier: "teams", billing_tier: "free", seat_team: acme });
    expect(d).toMatchObject({
      plan: "teams",
      premium: true,
      seat: true,
      label: "Teams",
      badge: "Teams",
      via: "Acme",
      line: "Teams · through your seat in Acme",
      viaTooltip: "Through Acme",
      viaLine: "Through your seat in Acme",
      ownLine: null,
      trial: false,
      ownBilled: false,
      showManageBilling: false,
      showUpgrade: false,
    });
  });

  test("a seat whose team name is not loaded yet falls back to the plan name", () => {
    const d = display({ tier: "teams", billing_tier: "free", seat_team: acme }, null, null);
    expect(d).toMatchObject({ seat: true, via: null, line: "Teams", viaTooltip: null, badge: "Teams", upgradeTo: null, showManageBilling: false });
  });

  test("seat on an owner trial", () => {
    const d = display({ tier: "teams", billing_tier: "free", seat_team: { ...acme, trial: true }, trial_used: true });
    expect(d).toMatchObject({
      label: "Teams trial",
      line: "Teams trial · through your seat in Acme",
      trial: true,
      showManageBilling: false,
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

  test("a server without billing describes and manages no subscription", () => {
    const d = planDisplay({ ...deriveTierFlags({ tier: "pro" }, NOW), proTrialAvailable: false, teamsTrialAvailable: false }, { billingEnabled: false, now: NOW });
    expect(d).toMatchObject({ ownBilled: false, showManageBilling: false, showAllPlans: false });
  });

  test("the badge icon offers an upgrade only when one can be bought", () => {
    expect(display({ tier: "pro" }).icon).toBe("lucide:crown");
    expect(display({ tier: "free" }).icon).toBe("lucide:circle-fading-arrow-up");
    checkout.value = false;
    try {
      expect(display({ tier: "free" })).toMatchObject({ badge: "Free", icon: "lucide:circle-user" });
    } finally {
      checkout.value = true;
    }
  });

  test("all plans are listed only without a seat and with checkout", () => {
    expect(display({ tier: "free" }).showAllPlans).toBe(true);
    expect(display({ tier: "teams", billing_tier: "free", seat_team: acme }).showAllPlans).toBe(false);
  });

  test("store build never offers upgrade or billing actions to open", () => {
    checkout.value = false;
    try {
      expect(display({ tier: "free" }).showUpgrade).toBe(false);
      expect(display({ tier: "pro" }, "active")).toMatchObject({ ownBilled: true, showManageBilling: false, showAllPlans: false });
      expect(display({ tier: "pro" }).upgradeTo).toBeNull();
      expect(display({ tier: "free" }, null, "Acme", { proTrialAvailable: true, teamsTrialAvailable: true })).toMatchObject({
        trialOffer: false,
        teamsTrialOffer: false,
      });
    } finally {
      checkout.value = true;
    }
  });
});
