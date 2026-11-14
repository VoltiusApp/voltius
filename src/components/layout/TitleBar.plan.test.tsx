import { test, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { deriveTierFlags, type TierFlagsInput } from "@/stores/subscriptionTier";
import { usePromoStore } from "@/stores/promoStore";
import { acme, forgetTeams, nameSeatTeam } from "@/services/planDisplay.testHarness";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), startDragging: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const startTrialOrCheckout = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/services/promos", async () => ({
  ...(await vi.importActual<typeof import("@/services/promos")>("@/services/promos")),
  startTrialOrCheckout,
}));
vi.mock("@/services/serverCapabilities", async () => ({
  ...(await vi.importActual<typeof import("@/services/serverCapabilities")>("@/services/serverCapabilities")),
  useServerBillingEnabled: () => true,
}));

let SubscriptionBadge: (typeof import("./TitleBar"))["SubscriptionBadge"];
beforeAll(async () => {
  await import("@/i18n");
  ({ SubscriptionBadge } = await import("./TitleBar"));
}, 60000);

const initial = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useSubscriptionStore.setState(initial, true);
  forgetTeams();
  usePromoStore.setState({ state: null, current: null });
  startTrialOrCheckout.mockClear();
});

const offerPro = (proTrialAvailable: boolean) =>
  usePromoStore.setState({
    state: { proTrialAvailable, teamsTrialAvailable: false, emailVerified: true, seen: [], planEnded: null, teamEnded: null, paymentIssue: null },
  });

const seed = (input: TierFlagsInput) => {
  nameSeatTeam();
  useSubscriptionStore.setState(deriveTierFlags(input, new Date()));
};
const badge = () => render(<SubscriptionBadge />).container.querySelector("button")!;

test("a seat member's badge names the team plan with the team in the tooltip", () => {
  seed({ tier: "teams", billing_tier: "free", seat_team: acme, trial_used: false });
  const b = badge();
  expect(b.textContent).toBe("Teams");
  expect(b.title).toBe("Through Acme");
});

test("own Pro plus a Business seat shows Business", () => {
  seed({ tier: "business", billing_tier: "pro", seat_team: acme });
  expect(badge().textContent).toBe("Business");
});

test("a free account is offered the trial when the server says so", () => {
  seed({ tier: "free" });
  offerPro(true);
  expect(badge().textContent).toBe("Activate 14 days of Pro");
});

test("without a trial on offer the badge is a plain upgrade", () => {
  seed({ tier: "free" });
  offerPro(false);
  expect(badge().textContent).toBe("Upgrade");
});

test("the trial badge starts the trial instead of opening settings", () => {
  seed({ tier: "free" });
  offerPro(true);
  fireEvent.click(badge());
  expect(startTrialOrCheckout).toHaveBeenCalledWith("pro", "titlebar");
});

test("an own Pro trial counts down", () => {
  seed({ tier: "pro", trial_ends_at: Math.floor(Date.now() / 1000) + 2 * 86_400 - 60 });
  expect(badge().textContent).toBe("Pro trial — 2d left");
});

test("before the team list loads, a seat badge shows the plan name alone", () => {
  useSubscriptionStore.setState(deriveTierFlags({ tier: "teams", billing_tier: "free", seat_team: acme }, new Date()));
  const b = badge();
  expect(b.textContent).toBe("Teams");
  expect(b.title).toBe("Teams");
});
