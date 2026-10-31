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
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn(async () => {}) }));
vi.mock("@/services/serverCapabilities", () => ({ useServerBillingEnabled: () => true }));

await import("@/i18n");
const { PlansSection } = await import("./AccountSection");
const { useSubscriptionStore } = await import("@/stores/subscriptionStore");
const { deriveTierFlags } = await import("@/stores/subscriptionTier");
const { acme, forgetTeams, nameSeatTeam } = await import("@/services/planDisplay.testHarness");

const initial = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useSubscriptionStore.setState(initial, true);
  forgetTeams();
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
  const { container } = render(<PlansSection />);
  expect(container.querySelector("[data-plan-line]")!.textContent).toBe("Pro");
  expect(screen.getByText("settings.account.plan.manageBilling")).toBeTruthy();
  expect(screen.getByText("settings.account.plan.teamsButton")).toBeTruthy();
});

test("free is offered Pro", () => {
  seed({ tier: "free" });
  render(<PlansSection />);
  expect(screen.getByText("settings.account.plan.upgrade")).toBeTruthy();
  expect(screen.queryByText("settings.account.plan.manageBilling")).toBeNull();
});
