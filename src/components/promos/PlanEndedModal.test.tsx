// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  openBillingCheckout: vi.fn(async () => true),
  openPortal: vi.fn(async () => {}),
  connections: [] as unknown[],
}));

// Interpolation values are appended so assertions can see what reached the copy.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${Object.entries(opts).map(([k, v]) => `${k}=${String(v)}`).join(" ")}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/services/promos", () => ({
  activateTrial: vi.fn(),
  recordPromoEvent: vi.fn(async () => {}),
  fetchPromoState: vi.fn(async () => null),
  startTrialOrCheckout: vi.fn(async () => true),
}));
vi.mock("@/services/billingCheckout", () => ({
  EMAIL_VERIFICATION_REQUIRED_EVENT: "voltius:email-verification-required",
  openBillingCheckout: h.openBillingCheckout,
}));
vi.mock("@/utils/billing", () => ({ openPortal: h.openPortal }));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: (sel: (s: { connections: unknown[] }) => unknown) => sel({ connections: h.connections }),
}));

import { PlanEndedModal } from "./PlanEndedModal";
import { usePromoStore } from "@/stores/promoStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { PLAN_PRICES } from "@/services/billingTrial";
import type { PromoState } from "@/services/promos";

const baseState: PromoState = {
  proTrialAvailable: false,
  teamsTrialAvailable: true,
  emailVerified: true,
  seen: [],
  planEnded: null,
  teamEnded: null,
  paymentIssue: null,
};

const onClose = vi.fn();

beforeEach(() => {
  onClose.mockReset();
  h.openBillingCheckout.mockClear();
  h.openPortal.mockClear();
  h.connections = [];
});

afterEach(() => {
  cleanup();
  usePromoStore.setState({ state: null, current: null });
});

describe("PlanEndedModal", () => {
  test("plan_ended_member_variant_has_no_purchase", () => {
    usePromoStore.setState({ state: { ...baseState, teamEnded: { teamId: "t1", teamName: "Platform", at: 500 } } });
    render(<PlanEndedModal source="launch" occurrence={500} onClose={onClose} />);
    expect(screen.getByText("shared.promos.ended.titleMember team=Platform")).toBeTruthy();
    expect(screen.getByText("shared.promos.ended.bodyMember")).toBeTruthy();
    expect(screen.queryByText(/shared\.promos\.ended\.cta/)).toBeNull();
    expect(screen.queryByText("shared.promos.ended.continueFree")).toBeNull();
    expect(screen.queryByText("shared.promos.ended.tryTeams")).toBeNull();
    fireEvent.click(screen.getByText("shared.promos.ended.gotIt"));
    expect(onClose).toHaveBeenCalledWith("dismissed");
    expect(h.openBillingCheckout).not.toHaveBeenCalled();
  });

  test("plan_ended_shows_prices_from_catalogue", () => {
    h.connections = [{ id: "a" }, { id: "b" }, { id: "c" }];
    usePromoStore.setState({ state: { ...baseState, planEnded: { kind: "teams_trial", at: 900 } } });
    render(<PlanEndedModal source="launch" occurrence={900} onClose={onClose} />);
    expect(screen.getByText("shared.promos.ended.titleTeamsTrial")).toBeTruthy();
    const { annual, monthly } = PLAN_PRICES.teams;
    const cta = screen.getByText(`shared.promos.ended.cta plan=Teams annual=${annual}`);
    expect(screen.getByText(`shared.promos.ended.ctaNote monthly=${monthly}`)).toBeTruthy();
    expect(screen.getByText("shared.promos.ended.pausedTeam")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    // The Teams upsell is pointless when Teams is the plan being kept.
    expect(screen.queryByText("shared.promos.ended.tryTeams")).toBeNull();
    fireEvent.click(cta);
    expect(h.openBillingCheckout).toHaveBeenCalledWith("teams");
    expect(onClose).toHaveBeenCalledWith("activated");
  });

  test("pro_trial_ended_offers_teams_and_hides_empty_recap", () => {
    usePromoStore.setState({ state: { ...baseState, planEnded: { kind: "pro_trial", at: 900 } } });
    render(<PlanEndedModal source="launch" occurrence={900} onClose={onClose} />);
    expect(screen.getByText("shared.promos.ended.titleProTrial")).toBeTruthy();
    expect(screen.getByText(`shared.promos.ended.cta plan=Pro annual=${PLAN_PRICES.pro.annual}`)).toBeTruthy();
    expect(screen.queryByText("shared.promos.ended.pausedTeam")).toBeNull();
    expect(screen.queryByText("shared.promos.ended.recapHosts")).toBeNull();
    fireEvent.click(screen.getByText("shared.promos.ended.continueFree"));
    expect(onClose).toHaveBeenCalledWith("dismissed");
  });

  test("plan_ended_without_variant_closes", () => {
    usePromoStore.setState({ state: baseState });
    render(<PlanEndedModal source="launch" occurrence={900} onClose={onClose} />);
    expect(onClose).toHaveBeenCalledWith("activated");
  });

  test("payment_issue_variant_opens_portal", () => {
    useSubscriptionStore.setState({ billingTier: "teams" });
    usePromoStore.setState({
      state: {
        ...baseState,
        paymentIssue: { status: "past_due", renewsAt: null },
        planEnded: { kind: "subscription", at: 900 },
      },
    });
    render(<PlanEndedModal source="launch" occurrence={0} onClose={onClose} />);
    expect(screen.getByText("shared.promos.ended.payment.title")).toBeTruthy();
    expect(screen.getByText("shared.promos.ended.payment.body plan=Teams")).toBeTruthy();
    fireEvent.click(screen.getByText("shared.promos.ended.payment.cta"));
    expect(h.openPortal).toHaveBeenCalled();
    expect(h.openBillingCheckout).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith("activated");
    useSubscriptionStore.setState({ billingTier: "free" });
  });
});
