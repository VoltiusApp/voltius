import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const checkout = vi.hoisted(() => ({ value: true }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));
vi.mock("@/services/distribution", () => ({
  get CAN_OPEN_CHECKOUT() {
    return checkout.value;
  },
}));

import { UpgradeToTeamsCTA } from "./MembersCTA";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { deriveTierFlags } from "@/stores/subscriptionTier";

const initial = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useSubscriptionStore.setState(initial, true);
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
  render(<UpgradeToTeamsCTA />);
  expect(screen.getByText("members.cta.upgradeTitle")).toBeTruthy();
  expect(screen.getByText("members.cta.upgradeBtn")).toBeTruthy();
});
