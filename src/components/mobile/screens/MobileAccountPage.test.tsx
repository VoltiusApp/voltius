import { test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useMobileNavStore } from "@/stores/mobileNavStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const effective = vi.hoisted(() => ({
  value: { configured: false, paused: false, status: "idle", lastSync: null, error: null, errorSource: null, nearby: 0 },
}));
vi.mock("@/hooks/useSyncProviders", () => ({ useSyncProviders: () => ({ providers: [], effective: effective.value }) }));

const billing = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/services/serverCapabilities", () => ({ useServerBillingEnabled: () => billing.enabled }));

import "@/i18n";
import MobileAccountPage from "./MobileAccountPage";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { deriveTierFlags, type TierFlagsInput } from "@/stores/subscriptionTier";
import { acme, forgetTeams, nameSeatTeam } from "@/services/planDisplay.testHarness";

const initialSubscription = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useMobileNavStore.setState({ sheet: null });
  useSubscriptionStore.setState(initialSubscription, true);
  forgetTeams();
  billing.enabled = true;
});

const businessAccount = () =>
  useSubscriptionStore.setState({
    accountMode: "server", tier: "business", billingTier: "business", ownsTeamsPlan: true, isPro: true, isTeams: true, isBusiness: true,
    usedSeats: 1, totalSeats: 3, effectiveSeats: null,
  });

test("a paused sync reads as paused, not off", () => {
  effective.value = { ...effective.value, paused: true };
  const { queryByText } = render(<MobileAccountPage />);
  expect(queryByText("layout.sync.paused")).not.toBeNull();
  expect(queryByText("mobile.account.off")).toBeNull();
});

test("a sync that was never set up reads as off", () => {
  effective.value = { ...effective.value, paused: false };
  const { queryByText } = render(<MobileAccountPage />);
  expect(queryByText("mobile.account.off")).not.toBeNull();
});

test("the cloud sync row opens the sync sheet", () => {
  const { container } = render(<MobileAccountPage />);
  fireEvent.click(container.querySelector("button[data-account-sync]")!);
  expect(useMobileNavStore.getState().sheet).toEqual({ kind: "sync" });
});

test("nearby devices with sync off read as local sync under a generic sync label", () => {
  effective.value = { ...effective.value, configured: false, paused: false, nearby: 2 };
  const { queryByText, container } = render(<MobileAccountPage />);
  expect(queryByText("layout.sync.local.tooltip")).not.toBeNull();
  expect(container.querySelector("button[data-account-sync]")!.textContent).toContain("layout.sync.title");
  expect(queryByText("mobile.account.off")).toBeNull();
  effective.value = { ...effective.value, nearby: 0 };
});

test("a configured sync reads with the shared status label", () => {
  effective.value = { ...effective.value, configured: true, paused: false, status: "offline" };
  const { queryByText } = render(<MobileAccountPage />);
  expect(queryByText("layout.sync.status.offline")).not.toBeNull();
});

test("a self-hosted business account shows no billing link and an unlimited seat count", () => {
  billing.enabled = false;
  businessAccount();
  const { container, queryByText } = render(<MobileAccountPage />);
  expect(container.querySelector("[data-account-manage-billing]")).toBeNull();
  expect(queryByText("mobile.account.subscriptionActive")).toBeNull();
  expect(queryByText("members.invite.seatsUnlimited")).not.toBeNull();
  expect(queryByText("mobile.account.seatsUsed")).toBeNull();
});

test("a billed business account keeps its billing link and seat count", () => {
  businessAccount();
  const { container, queryByText } = render(<MobileAccountPage />);
  expect(container.querySelector("[data-account-manage-billing]")).not.toBeNull();
  expect(queryByText("mobile.account.seatsUsed")).not.toBeNull();
});

const signedIn = (input: TierFlagsInput) => {
  nameSeatTeam();
  useSubscriptionStore.setState({ ...deriveTierFlags(input, new Date()), accountMode: "server", subscriptionStatus: "active" });
};

test("a seat member sees the team plan through the seat, with no upgrade or billing", () => {
  signedIn({ tier: "teams", billing_tier: "free", seat_team: acme, trial_used: true });
  const { container, queryByText } = render(<MobileAccountPage />);
  expect(queryByText("Teams · through your seat in Acme")).not.toBeNull();
  expect(container.querySelector("[data-account-upgrade-pro]")).toBeNull();
  expect(container.querySelector("[data-account-upgrade-teams]")).toBeNull();
  expect(container.querySelector("[data-account-own-plan]")).toBeNull();
  expect(queryByText("mobile.account.manageBilling")).toBeNull();
  expect(container.querySelector("[data-account-manage-billing]")).toBeNull();
  expect(queryByText("mobile.account.subscriptionActive")).toBeNull();
});

test("own Pro plus a Business seat sees both lines and billing for the own plan", () => {
  signedIn({ tier: "business", billing_tier: "pro", seat_team: acme });
  const { container, queryByText } = render(<MobileAccountPage />);
  expect(queryByText("Business · through your seat in Acme")).not.toBeNull();
  expect(container.querySelector("[data-account-own-plan]")!.textContent).toBe("Your Pro subscription");
  expect(queryByText("mobile.account.manageBilling")).not.toBeNull();
  expect(container.querySelector("[data-account-upgrade-teams]")).toBeNull();
});

test("an own Pro trial counts down and has no billing to manage", () => {
  signedIn({ tier: "pro", trial_ends_at: Math.floor(Date.now() / 1000) + 2 * 86_400 - 60, trial_used: true });
  const { queryByText } = render(<MobileAccountPage />);
  expect(queryByText("Pro trial — 2d left")).not.toBeNull();
  expect(queryByText("mobile.account.manageBilling")).toBeNull();
});
