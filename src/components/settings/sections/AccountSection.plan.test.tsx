import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: () => null,
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/utils/billing", () => ({ openPortal: vi.fn() }));
const startTrialOrCheckout = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/services/promos", () => ({ startTrialOrCheckout }));
vi.mock("@/services/serverCapabilities", () => ({ useServerBillingEnabled: () => true }));

await import("@/i18n");
const { PlansSection } = await import("./AccountSection");
const { useSubscriptionStore } = await import("@/stores/subscriptionStore");
const { deriveTierFlags } = await import("@/stores/subscriptionTier");
const { usePromoStore } = await import("@/stores/promoStore");
const { fireEvent } = await import("@testing-library/react");
const { acme, forgetTeams, nameSeatTeam } = await import("@/services/planDisplay.testHarness");

const initial = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useSubscriptionStore.setState(initial, true);
  forgetTeams();
  usePromoStore.setState({ state: null, current: null });
  startTrialOrCheckout.mockClear();
});

const offers = (proTrialAvailable: boolean, teamsTrialAvailable: boolean) =>
  usePromoStore.setState({
    state: { proTrialAvailable, teamsTrialAvailable, emailVerified: true, seen: [], planEnded: null, teamEnded: null, paymentIssue: null },
  });

const seed = (input: Parameters<typeof deriveTierFlags>[0]) => {
  nameSeatTeam();
  useSubscriptionStore.setState({ ...deriveTierFlags(input, new Date()), subscriptionStatus: "active" });
};

test("a seat member sees the team plan and where it comes from, with no billing or upgrade", () => {
  seed({ tier: "teams", billing_tier: "free", seat_team: acme, trial_used: true });
  const { container } = render(<PlansSection />);
  expect(container.querySelector("[data-plan-line]")!.textContent).toBe("Teams · through your seat in Acme");
  expect(screen.queryByText("settings.account.plan.manageBilling")).toBeNull();
  expect(screen.queryByText("settings.account.plan.upgrade")).toBeNull();
  expect(screen.queryByText("settings.account.plan.teamsButton")).toBeNull();
  expect(screen.queryByText("settings.account.plan.subscription.active")).toBeNull();
  expect(screen.queryByText("settings.account.plan.viewAllPlans")).toBeNull();
  expect(container.querySelector("[data-plan-own-line]")).toBeNull();
});

test("own Pro plus a Business seat sees both lines and billing for the own plan", () => {
  seed({ tier: "business", billing_tier: "pro", seat_team: acme });
  const { container } = render(<PlansSection />);
  expect(container.querySelector("[data-plan-line]")!.textContent).toBe("Business · through your seat in Acme");
  const own = container.querySelector("[data-plan-own-line]")!;
  expect(own.textContent).toBe("Your Pro subscription");
  expect(own.parentElement!.textContent).toContain("settings.account.plan.manageBilling");
  expect(screen.queryByText("settings.account.plan.teamsButton")).toBeNull();
});

test("a seat member never sees the seat count of a plan they do not own", () => {
  seed({ tier: "teams", billing_tier: "free", seat_team: acme });
  useSubscriptionStore.setState({ usedSeats: 4, totalSeats: 10 });
  render(<PlansSection />);
  expect(screen.queryByText("settings.account.plan.seats")).toBeNull();
});

test("own Pro keeps billing and the Teams offer", () => {
  seed({ tier: "pro" });
  offers(false, true);
  const { container } = render(<PlansSection />);
  expect(container.querySelector("[data-plan-line]")!.textContent).toBe("Pro");
  expect(screen.getByText("settings.account.plan.manageBilling")).toBeTruthy();
  expect(screen.getByText("settings.account.plan.teamsButton")).toBeTruthy();
});

test("the Teams strip is a plain upgrade when no trial is on offer", () => {
  seed({ tier: "pro" });
  offers(false, false);
  render(<PlansSection />);
  expect(screen.getByText("settings.account.plan.upgradeToTeamsPlain")).toBeTruthy();
  expect(screen.queryByText("settings.account.plan.teamsButton")).toBeNull();
});

test("free with a Pro trial on offer activates it through the trial-or-checkout paywall", () => {
  seed({ tier: "free" });
  offers(true, false);
  render(<PlansSection />);
  expect(screen.getByText("settings.account.plan.activateTrial")).toBeTruthy();
  fireEvent.click(screen.getByText("settings.account.plan.activate"));
  expect(startTrialOrCheckout).toHaveBeenCalledWith("pro", "account");
});

test("the Teams trial button goes through the trial-or-checkout paywall", () => {
  seed({ tier: "pro" });
  offers(false, true);
  render(<PlansSection />);
  fireEvent.click(screen.getByText("settings.account.plan.teamsButton"));
  expect(startTrialOrCheckout).toHaveBeenCalledWith("teams", "account");
});

test("free is offered Pro", () => {
  seed({ tier: "free" });
  render(<PlansSection />);
  expect(screen.getByText("settings.account.plan.upgrade")).toBeTruthy();
  expect(screen.queryByText("settings.account.plan.manageBilling")).toBeNull();
});

const groupText = (container: HTMLElement, group: string) =>
  container.querySelector(`[data-plan-group="${group}"]`)?.textContent ?? null;
const F = "settings.account.plan.feature.";

test("Business lists only what it adds, with free features on their own line", () => {
  seed({ tier: "business" });
  const { container } = render(<PlansSection />);
  const included = groupText(container, "included")!;
  expect(included).toContain("settings.account.plan.everythingIn");
  expect(included).toContain(`${F}teamPolicy`);
  expect(included).not.toContain(`${F}syncPlugins`);
  expect(included).not.toContain(`${F}localSync`);
  expect(groupText(container, "next")).toBeNull();
  expect(container.querySelector("[data-free-features]")!.textContent).toContain(`${F}syncPlugins`);
  expect(container.querySelector("[data-free-features]")!.textContent).toContain(`${F}cli`);
});

test("Pro shows what Teams adds, greyed", () => {
  seed({ tier: "pro" });
  const { container } = render(<PlansSection />);
  expect(groupText(container, "included")).toContain(`${F}cloudSync`);
  expect(groupText(container, "next")).toContain(`${F}teamVaults`);
});

test("Free lists its own features and no separate free line", () => {
  seed({ tier: "free" });
  const { container } = render(<PlansSection />);
  expect(groupText(container, "included")).toContain(`${F}privateVault`);
  expect(groupText(container, "included")).not.toContain("settings.account.plan.everythingIn");
  expect(groupText(container, "next")).toContain(`${F}cloudSync`);
  expect(container.querySelector("[data-free-features]")).toBeNull();
});

test("account_shows_teams_trial_strip_for_free_account", () => {
  seed({ tier: "free" });
  offers(false, true);
  render(<PlansSection />);
  fireEvent.click(screen.getByText("settings.account.plan.teamsButton"));
  expect(startTrialOrCheckout).toHaveBeenCalledWith("teams", "account");
});
