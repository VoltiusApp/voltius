import { test, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { deriveTierFlags, type TierFlagsInput } from "@/stores/subscriptionTier";

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

let SubscriptionBadge: (typeof import("./TitleBar"))["SubscriptionBadge"];
beforeAll(async () => {
  await import("@/i18n");
  ({ SubscriptionBadge } = await import("./TitleBar"));
}, 20000);

const initial = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useSubscriptionStore.setState(initial, true);
});

const acme = { id: "t1", name: "Acme", trial: false };
const seed = (input: TierFlagsInput) => useSubscriptionStore.setState(deriveTierFlags(input, new Date()));
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

test("a free account is offered the trial", () => {
  seed({ tier: "free", trial_used: false });
  expect(badge().textContent).toBe("layout.titleBar.plan.upgradeTrial");
});

test("an own Pro trial counts down", () => {
  seed({ tier: "pro", trial_ends_at: Math.floor(Date.now() / 1000) + 2 * 86_400 - 60 });
  expect(badge().textContent).toBe("Pro trial — 2d left");
});
