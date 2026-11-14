// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  serverFetch: vi.fn(),
  refreshAccessToken: vi.fn(),
  openBillingCheckout: vi.fn(),
  subLoad: vi.fn(),
  fetchServerMeta: vi.fn(),
  billingTier: { value: "free" },
}));

vi.mock("@/services/teamService", () => ({ serverFetch: h.serverFetch }));
vi.mock("@/services/authTokens", () => ({ refreshAccessToken: h.refreshAccessToken }));
vi.mock("@/services/billingCheckout", () => ({
  openBillingCheckout: h.openBillingCheckout,
  EMAIL_VERIFICATION_REQUIRED_EVENT: "voltius:email-verification-required",
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.subLoad, billingTier: h.billingTier.value, seatTeam: null }) },
}));
vi.mock("@/services/teamObjects", () => ({ fetchServerMeta: h.fetchServerMeta }));

import { activateTrial, fetchPromoState, startTrialOrCheckout } from "./promos";
import { usePromoStore } from "@/stores/promoStore";
import { refreshServerCapabilities, resetServerCapabilities } from "./serverCapabilities";

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });

const SERVER = {
  pro_trial_available: true,
  teams_trial_available: false,
  email_verified: true,
  seen: [{ promo: "pro_redeem", source: "launch", occurrence: null, at: 10 }],
  plan_ended: { kind: "pro_trial", at: 100 },
  team_ended: { team_id: "t1", team_name: "Acme", at: 200 },
  payment_issue: { status: "past_due", renews_at: 300 },
};

async function enableBilling(enabled: boolean) {
  h.fetchServerMeta.mockResolvedValue({ billing_enabled: enabled });
  resetServerCapabilities();
  await refreshServerCapabilities();
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.serverFetch.mockResolvedValue(json(204, null));
  h.refreshAccessToken.mockResolvedValue(undefined);
  h.subLoad.mockResolvedValue(undefined);
  h.billingTier.value = "free";
  usePromoStore.setState({ state: null, current: null, launchHandled: false });
  await enableBilling(true);
});

test("maps_server_json_to_state", async () => {
  h.serverFetch.mockResolvedValue(json(200, SERVER));
  expect(await fetchPromoState()).toEqual({
    proTrialAvailable: true,
    teamsTrialAvailable: false,
    emailVerified: true,
    seen: [{ promo: "pro_redeem", source: "launch", occurrence: null, at: 10 }],
    planEnded: { kind: "pro_trial", at: 100 },
    teamEnded: { teamId: "t1", teamName: "Acme", at: 200 },
    paymentIssue: { status: "past_due", renewsAt: 300 },
  });
  expect(h.serverFetch).toHaveBeenCalledWith("/v1/promos");
});

test("maps_null_sections_to_null", async () => {
  h.serverFetch.mockResolvedValue(json(200, { ...SERVER, plan_ended: null, team_ended: null, payment_issue: null }));
  const s = await fetchPromoState();
  expect(s).toMatchObject({ planEnded: null, teamEnded: null, paymentIssue: null });
});

test("load_failure_leaves_state_null", async () => {
  h.serverFetch.mockResolvedValue(json(503, { error: "BILLING_DISABLED", self_hosted: true }));
  expect(await fetchPromoState()).toBeNull();
  h.serverFetch.mockRejectedValue(new Error("offline"));
  expect(await fetchPromoState()).toBeNull();
  await usePromoStore.getState().load();
  expect(usePromoStore.getState().state).toBeNull();
});

test("activate_ok_refreshes_tokens_and_reloads", async () => {
  h.serverFetch.mockImplementation(async (path: string) =>
    path === "/v1/billing/trial" ? json(200, { plan: "pro", trial_ends_at: 1 }) : json(200, SERVER),
  );
  expect(await activateTrial("pro", "account")).toBe("ok");
  const [, init] = h.serverFetch.mock.calls[0];
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ plan: "pro", source: "account" });
  expect(h.refreshAccessToken).toHaveBeenCalledTimes(1);
  expect(h.subLoad).toHaveBeenCalledTimes(1);
  expect(usePromoStore.getState().state?.proTrialAvailable).toBe(true);
});

test("activate_email_unverified_dispatches_event", async () => {
  const handler = vi.fn();
  window.addEventListener("voltius:email-verification-required", handler);
  h.serverFetch.mockResolvedValue(json(403, { error: "EMAIL_NOT_VERIFIED" }));
  expect(await activateTrial("pro", "account")).toBe("email_unverified");
  expect(handler).toHaveBeenCalledTimes(1);
  window.removeEventListener("voltius:email-verification-required", handler);
});

test("activate_conflict_returns_unavailable", async () => {
  h.serverFetch.mockResolvedValue(json(409, { error: "TRIAL_UNAVAILABLE" }));
  expect(await activateTrial("teams", "teams_gate")).toBe("unavailable");
  expect(h.refreshAccessToken).not.toHaveBeenCalled();
});

test("activate_other_failure_returns_error", async () => {
  h.serverFetch.mockResolvedValue(json(500, {}));
  expect(await activateTrial("pro", "account")).toBe("error");
  h.serverFetch.mockRejectedValue(new Error("x"));
  expect(await activateTrial("pro", "account")).toBe("error");
});

function seedState(over: Record<string, unknown> = {}) {
  usePromoStore.setState({
    state: {
      proTrialAvailable: true,
      teamsTrialAvailable: false,
      emailVerified: true,
      seen: [],
      planEnded: null,
      teamEnded: null,
      paymentIssue: null,
      ...over,
    },
  });
}

test("start_trial_opens_modal_when_available", async () => {
  seedState();
  expect(await startTrialOrCheckout("pro", "vault_limit", "vaults")).toBe(true);
  expect(usePromoStore.getState().current).toEqual({ promo: "pro_redeem", source: "vault_limit", context: "vaults" });
  expect(h.openBillingCheckout).not.toHaveBeenCalled();
});

test("start_trial_falls_back_to_checkout_when_unavailable", async () => {
  seedState({ teamsTrialAvailable: false });
  h.openBillingCheckout.mockResolvedValue(true);
  expect(await startTrialOrCheckout("teams", "teams_gate")).toBe(true);
  expect(h.openBillingCheckout).toHaveBeenCalledWith("teams");
  expect(usePromoStore.getState().current).toBeNull();
});

test("start_trial_falls_back_to_checkout_when_billing_disabled", async () => {
  await enableBilling(false);
  seedState();
  h.openBillingCheckout.mockResolvedValue(false);
  expect(await startTrialOrCheckout("pro", "account")).toBe(false);
  expect(h.openBillingCheckout).toHaveBeenCalledWith("pro");
  expect(usePromoStore.getState().current).toBeNull();
});

test("open_records_shown_with_occurrence", async () => {
  seedState({ planEnded: { kind: "subscription", at: 100 } });
  usePromoStore.getState().open("plan_ended", "launch");
  await Promise.resolve();
  const [path, init] = h.serverFetch.mock.calls[0];
  expect(path).toBe("/v1/promos/events");
  expect(JSON.parse(init.body)).toEqual({ promo: "plan_ended", event: "shown", source: "launch", occurrence: 100 });
});

test("close_dismissed_records_dismissed_and_clears", async () => {
  seedState();
  usePromoStore.getState().open("pro_redeem", "titlebar");
  usePromoStore.getState().close("dismissed");
  expect(usePromoStore.getState().current).toBeNull();
  const bodies = h.serverFetch.mock.calls.map((c) => JSON.parse(c[1].body));
  expect(bodies.map((b) => b.event)).toEqual(["shown", "dismissed"]);
});

test("record_promo_event_never_throws", async () => {
  h.serverFetch.mockRejectedValue(new Error("x"));
  const { recordPromoEvent } = await import("./promos");
  await expect(recordPromoEvent("pro_redeem", "clicked", "account")).resolves.toBeUndefined();
});

test("activate_ok_even_if_refresh_throws", async () => {
  h.serverFetch.mockImplementation(async (path: string) =>
    path === "/v1/billing/trial" ? json(200, { plan: "pro", trial_ends_at: 1 }) : json(200, SERVER),
  );
  h.refreshAccessToken.mockRejectedValue(new Error("refresh failed"));
  h.subLoad.mockRejectedValue(new Error("load failed"));
  expect(await activateTrial("pro", "account")).toBe("ok");
});

test("open_plan_ended_skips_plan_end_once_upgraded", () => {
  h.billingTier.value = "pro";
  seedState({
    planEnded: { kind: "subscription", at: 100 },
    teamEnded: { teamId: "t1", teamName: "Acme", at: 200 },
  });
  usePromoStore.getState().open("plan_ended", "launch");
  expect(usePromoStore.getState().current).toEqual({ promo: "plan_ended", source: "launch", occurrence: 200 });
});

test("open_plan_ended_records_pending_occurrence", async () => {
  seedState({
    planEnded: { kind: "pro_trial", at: 100 },
    teamEnded: { teamId: "t1", teamName: "Acme", at: 200 },
    seen: [{ promo: "plan_ended", source: "launch", occurrence: 100, at: 101 }],
  });
  usePromoStore.getState().open("plan_ended", "launch");
  expect(usePromoStore.getState().current).toEqual({ promo: "plan_ended", source: "launch", occurrence: 200 });
  usePromoStore.getState().close("dismissed");
  await Promise.resolve();
  const bodies = h.serverFetch.mock.calls.map((c) => JSON.parse(c[1].body));
  expect(bodies.map((b) => [b.event, b.occurrence])).toEqual([["shown", 200], ["dismissed", 200]]);
});
