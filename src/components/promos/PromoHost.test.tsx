// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  activateTrial: vi.fn(),
  recordPromoEvent: vi.fn(async () => {}),
  fetchPromoState: vi.fn(async () => null),
  openBillingCheckout: vi.fn(async () => true),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/services/promos", () => ({
  activateTrial: h.activateTrial,
  recordPromoEvent: h.recordPromoEvent,
  fetchPromoState: h.fetchPromoState,
  startTrialOrCheckout: vi.fn(async () => true),
}));
vi.mock("@/services/billingCheckout", () => ({
  EMAIL_VERIFICATION_REQUIRED_EVENT: "voltius:email-verification-required",
  openBillingCheckout: h.openBillingCheckout,
}));
vi.mock("@/utils/billing", () => ({ openPortal: vi.fn(async () => {}) }));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: (sel: (s: { connections: unknown[] }) => unknown) => sel({ connections: [] }),
}));

import { PromoHost } from "./PromoHost";
import { usePromoStore } from "@/stores/promoStore";
import { useNotificationStore } from "@/stores/notificationStore";
import type { PromoState } from "@/services/promos";

const baseState: PromoState = {
  proTrialAvailable: true,
  teamsTrialAvailable: true,
  emailVerified: true,
  seen: [],
  planEnded: null,
  teamEnded: null,
  paymentIssue: null,
};

beforeEach(() => {
  h.activateTrial.mockReset();
  h.recordPromoEvent.mockClear();
  h.openBillingCheckout.mockClear();
  usePromoStore.setState({ state: baseState, current: null });
});

afterEach(() => {
  cleanup();
  usePromoStore.setState({ state: null, current: null });
});

describe("PromoHost", () => {
  test("host_renders_current_promo", () => {
    const { rerender } = render(<PromoHost />);
    expect(screen.queryByRole("dialog")).toBeNull();

    usePromoStore.setState({ current: { promo: "teams_promo", source: "launch" } });
    rerender(<PromoHost />);
    expect(screen.getByText("shared.promos.teams.title")).toBeTruthy();

    usePromoStore.setState({ current: { promo: "pro_redeem", source: "vault_limit", context: "vaults" } });
    rerender(<PromoHost />);
    expect(screen.getByText("shared.promos.pro.titleVaults")).toBeTruthy();
    expect(screen.queryByText("shared.promos.teams.title")).toBeNull();
  });

  test("dismiss_records_dismissed", () => {
    usePromoStore.setState({ current: { promo: "pro_redeem", source: "launch" } });
    render(<PromoHost />);
    fireEvent.click(screen.getByText("shared.promos.pro.later"));
    expect(usePromoStore.getState().current).toBeNull();
    expect(h.recordPromoEvent).toHaveBeenCalledWith("pro_redeem", "dismissed", "launch", undefined);
    expect(screen.queryByText("shared.promos.pro.title")).toBeNull();
  });

  test("pro_cta_activates_and_closes", async () => {
    h.activateTrial.mockResolvedValue("ok");
    usePromoStore.setState({ current: { promo: "pro_redeem", source: "account" } });
    render(<PromoHost />);
    fireEvent.click(screen.getByText("shared.promos.pro.cta"));
    await waitFor(() => expect(usePromoStore.getState().current).toBeNull());
    expect(h.activateTrial).toHaveBeenCalledWith("pro", "account");
    expect(h.recordPromoEvent).toHaveBeenCalledWith("pro_redeem", "clicked", "account", undefined);
    expect(h.recordPromoEvent).not.toHaveBeenCalledWith("pro_redeem", "dismissed", "account", undefined);
    const toasts = useNotificationStore.getState().toasts;
    expect(toasts.some((t) => t.message === "shared.promos.pro.activated" && t.severity === "success")).toBe(true);
  });

  test("teams_unavailable_closes_and_reloads", async () => {
    h.activateTrial.mockResolvedValue("unavailable");
    usePromoStore.setState({ current: { promo: "teams_promo", source: "teams_gate", context: "team" } });
    render(<PromoHost />);
    expect(screen.getByText("shared.promos.teams.titleTeam")).toBeTruthy();
    fireEvent.click(screen.getByText("shared.promos.teams.cta"));
    await waitFor(() => expect(usePromoStore.getState().current).toBeNull());
    expect(h.activateTrial).toHaveBeenCalledWith("teams", "teams_gate");
    expect(h.fetchPromoState).toHaveBeenCalled();
  });

  test("unavailable_falls_back_to_checkout", async () => {
    h.activateTrial.mockResolvedValue("unavailable");
    usePromoStore.setState({ current: { promo: "pro_redeem", source: "account" } });
    render(<PromoHost />);
    fireEvent.click(screen.getByText("shared.promos.pro.cta"));
    await waitFor(() => expect(h.openBillingCheckout).toHaveBeenCalledWith("pro"));
    expect(usePromoStore.getState().current).toBeNull();
  });

  test("unverified_email_shows_verify_cta", async () => {
    usePromoStore.setState({
      state: { ...baseState, emailVerified: false },
      current: { promo: "pro_redeem", source: "launch" },
    });
    h.activateTrial.mockResolvedValue("email_unverified");
    render(<PromoHost />);
    expect(screen.queryByText("shared.promos.pro.cta")).toBeNull();
    // The verify CTA goes through activateTrial, whose 403 path opens the existing
    // verification modal — and which still activates if the email got verified since.
    fireEvent.click(screen.getByText("shared.promos.verifyCta"));
    await waitFor(() => expect(h.activateTrial).toHaveBeenCalledWith("pro", "launch"));
    expect(usePromoStore.getState().current).not.toBeNull();
  });

  test("email_unverified_result_switches_cta_to_verify", async () => {
    h.activateTrial.mockResolvedValue("email_unverified");
    usePromoStore.setState({ current: { promo: "teams_promo", source: "launch" } });
    render(<PromoHost />);
    fireEvent.click(screen.getByText("shared.promos.teams.cta"));
    await screen.findByText("shared.promos.verifyCta");
    expect(usePromoStore.getState().current).not.toBeNull();
  });
});
