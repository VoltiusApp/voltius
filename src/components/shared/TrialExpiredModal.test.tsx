import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-testid="icon">{icon}</span>,
}));

const openBillingCheckout = vi.fn((_plan: string) => Promise.resolve(true));
const openPortal = vi.fn(() => Promise.resolve());
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: (p: string) => openBillingCheckout(p) }));
vi.mock("@/utils/billing", () => ({ openPortal: () => openPortal() }));

import { TrialExpiredModal } from "./TrialExpiredModal";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

const DAY = 86_400_000;

function seed(over: Partial<ReturnType<typeof useSubscriptionStore.getState>> = {}) {
  useSubscriptionStore.setState({
    tier: "free",
    trialUsed: true,
    trialKnown: true,
    isTrialActive: false,
    isPro: false,
    trialEndsAt: null,
    ...over,
  });
}

beforeEach(() => {
  localStorage.clear();
  openBillingCheckout.mockClear();
  openPortal.mockClear();
});
afterEach(cleanup);

test("shows once the trial is used up, even though the server cleared trial_ends_at", () => {
  seed();
  render(<TrialExpiredModal />);
  expect(screen.getByText("shared.trialExpiredModal.title")).toBeTruthy();
});

test("still shows when trial_ends_at is a past date", () => {
  seed({ trialEndsAt: new Date(Date.now() - 3 * DAY) });
  render(<TrialExpiredModal />);
  expect(screen.getByText("shared.trialExpiredModal.title")).toBeTruthy();
});

test("stays hidden while the trial is still running", () => {
  seed({ tier: "pro", isPro: true, isTrialActive: true, trialUsed: false, trialEndsAt: new Date(Date.now() + DAY) });
  render(<TrialExpiredModal />);
  expect(screen.queryByText("shared.trialExpiredModal.title")).toBeNull();
});

test("stays hidden for a paying subscriber", () => {
  seed({ tier: "pro", isPro: true });
  render(<TrialExpiredModal />);
  expect(screen.queryByText("shared.trialExpiredModal.title")).toBeNull();
});

test("stays hidden for an account that never started a trial", () => {
  seed({ trialUsed: false });
  render(<TrialExpiredModal />);
  expect(screen.queryByText("shared.trialExpiredModal.title")).toBeNull();
});

test("never reappears once dismissed", () => {
  seed();
  const first = render(<TrialExpiredModal />);
  expect(screen.getByText("shared.trialExpiredModal.title")).toBeTruthy();
  first.unmount();

  render(<TrialExpiredModal />);
  expect(screen.queryByText("shared.trialExpiredModal.title")).toBeNull();
});

test("names all three Pro perks", () => {
  seed();
  render(<TrialExpiredModal />);
  expect(screen.getByText("settings.account.plan.feature.realtimeSync")).toBeTruthy();
  expect(screen.getByText("settings.account.plan.feature.unlimitedVaults")).toBeTruthy();
  expect(screen.getByText("settings.account.plan.feature.terminalSharing")).toBeTruthy();
});

test("upgrade opens the Pro checkout, not the billing portal", () => {
  seed();
  render(<TrialExpiredModal />);
  fireEvent.click(screen.getByText("shared.trialExpiredModal.upgradeButton"));
  expect(openBillingCheckout).toHaveBeenCalledWith("pro");
  expect(openPortal).not.toHaveBeenCalled();
});

test("the Teams strip opens the Teams checkout", () => {
  seed();
  render(<TrialExpiredModal />);
  fireEvent.click(screen.getByText("settings.account.plan.teamsButton"));
  expect(openBillingCheckout).toHaveBeenCalledWith("teams");
  expect(openPortal).not.toHaveBeenCalled();
});
