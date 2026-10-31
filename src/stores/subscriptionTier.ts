// src/stores/subscriptionTier.ts
export type Tier = "free" | "pro" | "teams" | "business";

export const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, teams: 2, business: 3 };

export function tierAtLeast(tier: string | undefined, plan: Tier): boolean {
  return (TIER_RANK[tier as Tier] ?? 0) >= TIER_RANK[plan];
}

export function isBusinessLocked(team: { owner_tier?: string } | undefined): boolean {
  return !!team?.owner_tier && !tierAtLeast(team.owner_tier, "business");
}

export function teamLocked(teams: { id: string; owner_tier?: string }[], teamId: string): boolean {
  return isBusinessLocked(teams.find((t) => t.id === teamId));
}

export interface SeatTeam {
  id: string;
  name: string;
  trial: boolean;
}

export interface TierFlagsInput {
  tier?: string;
  billing_tier?: string;
  seat_team?: SeatTeam;
  trial_ends_at?: number;
  trial_used?: boolean;
  email_verified?: boolean;
}

export interface TierFlags {
  tier: Tier;
  billingTier: Tier;
  seatTeam: SeatTeam | null;
  ownsTeamsPlan: boolean;
  trialEndsAt: Date | null;
  trialKnown: boolean;
  trialUsed: boolean;
  isTrialActive: boolean;
  isPro: boolean;
  isTeams: boolean;
  isBusiness: boolean;
  emailVerified: boolean;
}

function knownTier(value: string | undefined): Tier | undefined {
  return value !== undefined && value in TIER_RANK ? (value as Tier) : undefined;
}

export function deriveTierFlags(payload: TierFlagsInput, now: Date): TierFlags {
  const tier = knownTier(payload.tier) ?? "free";
  const billingTier = payload.billing_tier === undefined ? tier : (knownTier(payload.billing_tier) ?? "free");
  const seatTeam = payload.seat_team ?? null;
  const ownsTeamsPlan = tierAtLeast(billingTier, "teams");
  const trialEndsAt = payload.trial_ends_at ? new Date(payload.trial_ends_at * 1000) : null;
  const trialKnown = "trial_used" in payload || "trial_ends_at" in payload;
  const trialUsed = payload.trial_used ?? false;
  const isTrialActive = billingTier === "pro" && trialEndsAt != null && trialEndsAt > now;
  const isPro = tier !== "free";
  const isTeams = tier === "teams" || tier === "business";
  const isBusiness = tier === "business";
  const emailVerified = payload.email_verified !== false;
  return { tier, billingTier, seatTeam, ownsTeamsPlan, trialEndsAt, trialKnown, trialUsed, isTrialActive, isPro, isTeams, isBusiness, emailVerified };
}
