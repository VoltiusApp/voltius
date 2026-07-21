// src/stores/subscriptionTier.test.ts
import { test, expect } from "vitest";
import { deriveTierFlags } from "./subscriptionTier.ts";

const NOW = new Date("2026-07-21T00:00:00Z");
const soon = Math.floor(new Date("2026-07-22T00:00:00Z").getTime() / 1000);
const past = Math.floor(new Date("2026-07-20T00:00:00Z").getTime() / 1000);

test("free tier: nothing unlocked", () => {
  const f = deriveTierFlags({ tier: "free" }, NOW);
  expect(f).toMatchObject({ tier: "free", isPro: false, isTeams: false, isBusiness: false, isTrialActive: false });
});

test("missing tier defaults to free", () => {
  expect(deriveTierFlags({}, NOW).tier).toBe("free");
  expect(deriveTierFlags({}, NOW).isPro).toBe(false);
});

test("pro tier is pro but not teams/business", () => {
  const f = deriveTierFlags({ tier: "pro" }, NOW);
  expect(f).toMatchObject({ isPro: true, isTeams: false, isBusiness: false });
});

test("teams tier unlocks pro + teams, not business", () => {
  const f = deriveTierFlags({ tier: "teams" }, NOW);
  expect(f).toMatchObject({ isPro: true, isTeams: true, isBusiness: false });
});

test("business tier unlocks pro + teams + business", () => {
  const f = deriveTierFlags({ tier: "business" }, NOW);
  expect(f).toMatchObject({ isPro: true, isTeams: true, isBusiness: true });
});

test("isTrialActive requires pro tier AND a future trial end", () => {
  expect(deriveTierFlags({ tier: "pro", trial_ends_at: soon }, NOW).isTrialActive).toBe(true);
  expect(deriveTierFlags({ tier: "pro", trial_ends_at: past }, NOW).isTrialActive).toBe(false);
  // teams tier with a future trial date is NOT a "pro trial"
  expect(deriveTierFlags({ tier: "teams", trial_ends_at: soon }, NOW).isTrialActive).toBe(false);
});

test("trialKnown reflects presence of trial fields; trialUsed defaults false", () => {
  expect(deriveTierFlags({ tier: "pro" }, NOW).trialKnown).toBe(false);
  expect(deriveTierFlags({ tier: "pro", trial_used: true }, NOW)).toMatchObject({ trialKnown: true, trialUsed: true });
  expect(deriveTierFlags({ tier: "pro", trial_ends_at: soon }, NOW).trialKnown).toBe(true);
});

test("emailVerified is true unless explicitly false", () => {
  expect(deriveTierFlags({ tier: "pro" }, NOW).emailVerified).toBe(true);
  expect(deriveTierFlags({ tier: "pro", email_verified: false }, NOW).emailVerified).toBe(false);
  expect(deriveTierFlags({ tier: "pro", email_verified: true }, NOW).emailVerified).toBe(true);
});

test("expired pro-trial still reads as pro (locks current 'trust server tier' behavior)", () => {
  // Live bug: the client mirrors the JWT tier; an expired pro-trial does NOT downgrade isPro.
  const f = deriveTierFlags({ tier: "pro", trial_ends_at: past, trial_used: true }, NOW);
  expect(f.isPro).toBe(true);
  expect(f.isTrialActive).toBe(false);
});
