import { expect, test } from "vitest";
import { pendingPlanEndOccurrence, pickLaunchPromo, type PickInput } from "./promoPicker";
import type { PromoState } from "./promos";

const DAY_MS = 86400 * 1000;
const NOW = 1_800_000_000_000;
const nowSec = NOW / 1000;

function state(over: Partial<PromoState> = {}): PromoState {
  return {
    proTrialAvailable: false,
    teamsTrialAvailable: false,
    emailVerified: true,
    seen: [],
    planEnded: null,
    teamEnded: null,
    paymentIssue: null,
    ...over,
  };
}

function input(over: Partial<PickInput> = {}): PickInput {
  return {
    state: state(),
    billingEnabled: true,
    canCheckout: true,
    signedIn: true,
    tier: "free",
    billingTier: "free",
    seatTeam: null,
    adminComped: false,
    now: NOW,
    ...over,
  };
}

test("picks_nothing_without_state", () => {
  expect(pickLaunchPromo(input({ state: null }))).toBeNull();
});

test("picks_nothing_when_billing_disabled", () => {
  expect(pickLaunchPromo(input({ billingEnabled: false, state: state({ proTrialAvailable: true }) }))).toBeNull();
});

test("picks_nothing_on_store_build", () => {
  expect(pickLaunchPromo(input({ canCheckout: false, state: state({ proTrialAvailable: true }) }))).toBeNull();
});

test("picks_nothing_when_signed_out_or_comped", () => {
  const s = state({ proTrialAvailable: true });
  expect(pickLaunchPromo(input({ signedIn: false, state: s }))).toBeNull();
  expect(pickLaunchPromo(input({ adminComped: true, state: s }))).toBeNull();
});

const FREE = { billingTier: "free" as const, seatTeam: null };
const SEAT_TEAM = { id: "t" } as unknown as PickInput["seatTeam"];

test("plan_ended_wins", () => {
  const s = state({ teamsTrialAvailable: true, planEnded: { kind: "teams_trial", at: 100 } });
  expect(pickLaunchPromo(input({ state: s }))).toBe("plan_ended");
});

test("plan_ended_skipped_when_already_upgraded", () => {
  const s = state({ planEnded: { kind: "subscription", at: 100 } });
  expect(pickLaunchPromo(input({ state: s, billingTier: "pro" }))).toBeNull();
  expect(pickLaunchPromo(input({ state: s, billingTier: "business" }))).toBeNull();
  expect(pickLaunchPromo(input({ state: s, seatTeam: SEAT_TEAM }))).toBeNull();
  const withPayment = state({ ...s, paymentIssue: { status: "past_due", renewsAt: 300 } });
  expect(pickLaunchPromo(input({ state: withPayment, billingTier: "pro" }))).toBe("plan_ended");
  const withTeamEnd = state({ ...s, teamEnded: { teamId: "t", teamName: "Acme", at: 200 } });
  expect(pendingPlanEndOccurrence(withTeamEnd, { billingTier: "pro", seatTeam: null })).toBe(200);
});

test("pro_trial_end_notice_suppressed_while_pro_offer_open", () => {
  const s = state({ proTrialAvailable: true, planEnded: { kind: "pro_trial", at: 100 } });
  expect(pickLaunchPromo(input({ state: s }))).toBe("pro_redeem");
  expect(pickLaunchPromo(input({ state: state({ ...s, proTrialAvailable: false }) }))).toBe("plan_ended");
});

test("plan_ended_not_repeated_for_same_occurrence", () => {
  const s = state({
    planEnded: { kind: "pro_trial", at: 100 },
    seen: [{ promo: "plan_ended", source: "launch", occurrence: 100, at: 101 }],
  });
  expect(pickLaunchPromo(input({ state: s }))).toBeNull();
  const again = state({ ...s, planEnded: { kind: "subscription", at: 500 } });
  expect(pickLaunchPromo(input({ state: again }))).toBe("plan_ended");
});

test("payment_issue_shown_once_per_renewal", () => {
  const issue = { status: "past_due" as const, renewsAt: 300 };
  const seen = [{ promo: "plan_ended" as const, source: "launch", occurrence: 300, at: 301 }];
  expect(pickLaunchPromo(input({ state: state({ paymentIssue: issue }) }))).toBe("plan_ended");
  expect(pickLaunchPromo(input({ state: state({ paymentIssue: issue, seen }) }))).toBeNull();
  expect(
    pickLaunchPromo(input({ state: state({ paymentIssue: { ...issue, renewsAt: 400 }, seen }) })),
  ).toBe("plan_ended");
});

test("team_ended_for_member", () => {
  const s = state({ teamEnded: { teamId: "t", teamName: "Acme", at: 200 } });
  expect(pickLaunchPromo(input({ state: s }))).toBe("plan_ended");
});

test("pending_occurrence_prefers_unseen_payment_issue", () => {
  const s = state({
    paymentIssue: { status: "unpaid", renewsAt: null },
    planEnded: { kind: "subscription", at: 100 },
  });
  expect(pendingPlanEndOccurrence(s, FREE)).toBe(0);
});

test("pending_occurrence_skips_seen_plan_end_to_team_end", () => {
  const s = state({
    planEnded: { kind: "pro_trial", at: 100 },
    teamEnded: { teamId: "t", teamName: "Acme", at: 200 },
    seen: [{ promo: "plan_ended", source: "launch", occurrence: 100, at: 101 }],
  });
  expect(pendingPlanEndOccurrence(s, FREE)).toBe(200);
  expect(pendingPlanEndOccurrence(state(), FREE)).toBeNull();
});

test("pro_redeem_when_available", () => {
  expect(pickLaunchPromo(input({ state: state({ proTrialAvailable: true }) }))).toBe("pro_redeem");
});

test("pro_redeem_seen_from_paywall_counts_as_seen", () => {
  const s = state({
    proTrialAvailable: true,
    seen: [{ promo: "pro_redeem", source: "vault_limit", occurrence: null, at: nowSec - 10 }],
  });
  expect(pickLaunchPromo(input({ state: s }))).toBeNull();
});

test("teams_waits_three_days_after_pro", () => {
  const seenAt = (ms: number) => [
    { promo: "pro_redeem" as const, source: "launch", occurrence: null, at: (NOW - ms) / 1000 },
  ];
  const base = { proTrialAvailable: true, teamsTrialAvailable: true };
  expect(pickLaunchPromo(input({ state: state({ ...base, seen: seenAt(2 * DAY_MS) }) }))).toBeNull();
  expect(pickLaunchPromo(input({ state: state({ ...base, seen: seenAt(3 * DAY_MS) }) }))).toBe("teams_promo");
});

test("teams_immediate_when_no_pro_offer", () => {
  expect(pickLaunchPromo(input({ state: state({ teamsTrialAvailable: true }) }))).toBe("teams_promo");
});

test("teams_skipped_for_seat_team_member", () => {
  const s = state({ teamsTrialAvailable: true });
  const seatTeam = { id: "t" } as unknown as PickInput["seatTeam"];
  expect(pickLaunchPromo(input({ state: s, seatTeam }))).toBeNull();
  expect(pickLaunchPromo(input({ state: s, billingTier: "teams" }))).toBeNull();
  expect(pickLaunchPromo(input({ state: s, billingTier: "business" }))).toBeNull();
});

test("teams_not_repeated_once_shown", () => {
  const s = state({
    teamsTrialAvailable: true,
    seen: [{ promo: "teams_promo", source: "launch", occurrence: null, at: 1 }],
  });
  expect(pickLaunchPromo(input({ state: s }))).toBeNull();
});

test("pro_redeem_never_for_business_or_paid", () => {
  const s = state({ proTrialAvailable: true });
  expect(pickLaunchPromo(input({ state: s, billingTier: "business" }))).not.toBe("pro_redeem");
  expect(pickLaunchPromo(input({ state: s, billingTier: "teams" }))).not.toBe("pro_redeem");
  expect(pickLaunchPromo(input({ state: s, billingTier: "pro" }))).not.toBe("pro_redeem");
  expect(pickLaunchPromo(input({ state: s, billingTier: "free" }))).toBe("pro_redeem");
});

test("pro_redeem_skipped_for_seat_team_member", () => {
  const s = state({ proTrialAvailable: true });
  expect(pickLaunchPromo(input({ state: s, seatTeam: SEAT_TEAM }))).toBeNull();
});
