import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const checkout = vi.hoisted(() => ({ value: true }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const startTrialOrCheckout = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/services/promos", () => ({ startTrialOrCheckout }));
vi.mock("@/services/serverCapabilities", () => ({ useServerBillingEnabled: () => true }));
vi.mock("@/services/distribution", () => ({
  get CAN_OPEN_CHECKOUT() {
    return checkout.value;
  },
}));

import { UpgradeToTeamsCTA } from "./MembersCTA";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { deriveTierFlags } from "@/stores/subscriptionTier";
import { usePromoStore } from "@/stores/promoStore";
import type { PromoState } from "@/services/promos";

const promoState: PromoState = {
  proTrialAvailable: false, teamsTrialAvailable: false, emailVerified: true,
  seen: [], planEnded: null, teamEnded: null, paymentIssue: null,
};

const initial = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useSubscriptionStore.setState(initial, true);
  usePromoStore.setState({ state: null, current: null });
  startTrialOrCheckout.mockClear();
  checkout.value = true;
});

const seatMember = () =>
  useSubscriptionStore.setState(
    deriveTierFlags({ tier: "teams", billing_tier: "free", seat_team: { id: "t1", trial: false } }, new Date()),
  );

test("a seat member is told converting needs their own Teams plan, with a plain upgrade and no trial", () => {
  seatMember();
  render(<UpgradeToTeamsCTA />);
  expect(screen.getByText("members.cta.ownPlanTitle")).toBeTruthy();
  expect(screen.queryByText("members.cta.upgradeTitle")).toBeNull();
  expect(screen.getByText("members.cta.ownPlanBtn")).toBeTruthy();
  expect(screen.queryByText("members.cta.upgradeBtn")).toBeNull();
  expect(screen.queryByText("members.cta.trialNote")).toBeNull();
});

test("a seat member in a store build gets no purchase action", () => {
  checkout.value = false;
  seatMember();
  render(<UpgradeToTeamsCTA />);
  expect(screen.getByText("members.cta.ownPlanTitle")).toBeTruthy();
  expect(screen.queryByText("members.cta.ownPlanBtn")).toBeNull();
  expect(screen.queryByText("shared.availableWith")).toBeNull();
});

test("an account without a seat keeps the Teams upsell", () => {
  useSubscriptionStore.setState(deriveTierFlags({ tier: "pro" }, new Date()));
  usePromoStore.setState({ state: { ...promoState, teamsTrialAvailable: true } });
  render(<UpgradeToTeamsCTA />);
  expect(screen.getByText("members.cta.upgradeTitle")).toBeTruthy();
  expect(screen.getByText("members.cta.upgradeBtn")).toBeTruthy();
});

test("teams_cta_opens_teams_modal_when_available", () => {
  useSubscriptionStore.setState(deriveTierFlags({ tier: "pro" }, new Date()));
  usePromoStore.setState({ state: { ...promoState, teamsTrialAvailable: true } });
  render(<UpgradeToTeamsCTA />);
  expect(screen.getByText("members.cta.trialNote")).toBeTruthy();
  fireEvent.click(screen.getByText("members.cta.upgradeBtn"));
  expect(startTrialOrCheckout).toHaveBeenCalledWith("teams", "teams_gate", "team");
});

test("without a trial on offer the CTA is a plain upgrade", () => {
  useSubscriptionStore.setState(deriveTierFlags({ tier: "pro" }, new Date()));
  usePromoStore.setState({ state: { ...promoState, teamsTrialAvailable: false } });
  render(<UpgradeToTeamsCTA />);
  expect(screen.getByText("members.cta.upgradePlainBtn")).toBeTruthy();
  expect(screen.queryByText("members.cta.trialNote")).toBeNull();
});
