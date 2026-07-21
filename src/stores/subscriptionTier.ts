// src/stores/subscriptionTier.ts
export type Tier = "free" | "pro" | "teams" | "business";

export interface TierFlagsInput {
  tier?: string;
  trial_ends_at?: number;
  trial_used?: boolean;
  email_verified?: boolean;
}

export interface TierFlags {
  tier: Tier;
  trialEndsAt: Date | null;
  trialKnown: boolean;
  trialUsed: boolean;
  isTrialActive: boolean;
  isPro: boolean;
  isTeams: boolean;
  isBusiness: boolean;
  emailVerified: boolean;
}

export function deriveTierFlags(payload: TierFlagsInput, now: Date): TierFlags {
  const tier = (payload.tier as Tier) ?? "free";
  const trialEndsAt = payload.trial_ends_at ? new Date(payload.trial_ends_at * 1000) : null;
  const trialKnown = "trial_used" in payload || "trial_ends_at" in payload;
  const trialUsed = payload.trial_used ?? false;
  const isTrialActive = tier === "pro" && trialEndsAt != null && trialEndsAt > now;
  const isPro = tier !== "free";
  const isTeams = tier === "teams" || tier === "business";
  const isBusiness = tier === "business";
  const emailVerified = payload.email_verified !== false;
  return { tier, trialEndsAt, trialKnown, trialUsed, isTrialActive, isPro, isTeams, isBusiness, emailVerified };
}
