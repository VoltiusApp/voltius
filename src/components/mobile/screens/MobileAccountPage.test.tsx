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

import MobileAccountPage from "./MobileAccountPage";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

const initialSubscription = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useMobileNavStore.setState({ sheet: null });
  useSubscriptionStore.setState(initialSubscription, true);
  billing.enabled = true;
});

const businessAccount = () =>
  useSubscriptionStore.setState({
    accountMode: "server", tier: "business", isPro: true, isTeams: true, isBusiness: true,
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
